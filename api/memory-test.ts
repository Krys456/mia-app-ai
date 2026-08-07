import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getServiceSupabase } from './_lib/supabase'

console.log('API loaded')

export const config = {
  runtime: 'nodejs',
  maxDuration: 15,
}

type MemoryDecision = {
  save: boolean
  category: string
  title: string
  content: string
  importance: number
}

type SupabaseClientLike = {
  from: (table: string) => any
}

const DEFAULT_API_USER_EMAIL = 'brain-api@local'
const DEFAULT_API_USER_NAME = 'BrAIn API'
const NAME_PATTERN = /my\s+name\s+is\s+([^\n.!?,;:]+)/i

const NO_SAVE: MemoryDecision = {
  save: false,
  category: '',
  title: '',
  content: '',
  importance: 0,
}

function sendJson(res: VercelResponse, status: number, payload: unknown) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  return res.status(status).json(payload)
}

function parseBody(req: VercelRequest): Record<string, unknown> {
  if (req.body == null) return {}
  if (typeof req.body === 'string') {
    const trimmed = req.body.trim()
    if (!trimmed) return {}
    return JSON.parse(trimmed) as Record<string, unknown>
  }
  if (typeof req.body === 'object') return req.body as Record<string, unknown>
  throw new Error('Unsupported request body')
}

function analyzeConversation(
  userMessage: string,
  assistantMessage: string,
): MemoryDecision {
  const user = userMessage.trim()
  void assistantMessage
  if (!user) return { ...NO_SAVE }

  const nameMatch = user.match(NAME_PATTERN)
  if (nameMatch?.[1]) {
    const name = nameMatch[1].trim()
    if (name) {
      return {
        save: true,
        category: 'identity',
        title: 'Name',
        content: `User's name is ${name}.`,
        importance: 8,
      }
    }
  }

  return { ...NO_SAVE }
}

async function ensureDefaultUserId(supabase: SupabaseClientLike): Promise<string> {
  const { data: existing, error: lookupError } = await supabase
    .from('users')
    .select('id')
    .eq('email', DEFAULT_API_USER_EMAIL)
    .maybeSingle()

  if (lookupError) {
    throw new Error(`Failed to look up default user: ${lookupError.message}`)
  }

  if (existing?.id) {
    return String(existing.id)
  }

  const { data: created, error: createError } = await supabase
    .from('users')
    .insert({
      email: DEFAULT_API_USER_EMAIL,
      display_name: DEFAULT_API_USER_NAME,
    })
    .select('id')
    .single()

  if (createError || !created?.id) {
    throw new Error(
      `Failed to create default user: ${createError?.message ?? 'unknown error'}`,
    )
  }

  return String(created.id)
}

async function saveMemory(decision: MemoryDecision): Promise<void> {
  const supabase = await getServiceSupabase()
  const userId = await ensureDefaultUserId(supabase)

  const { error: insertError } = await supabase.from('memories').insert({
    user_id: userId,
    category: decision.category,
    title: decision.title,
    content: decision.content,
    importance: decision.importance,
    tags: [],
    source: 'automatic',
    status: 'active',
    confidence: 1.0,
  })

  if (insertError) {
    throw new Error(`Failed to insert into public.memories: ${insertError.message}`)
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  console.log('Handler started')
  try {
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Origin', '*')
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
      return sendJson(res, 200, { success: true })
    }

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST, OPTIONS')
      return sendJson(res, 500, {
        success: false,
        error: 'Method not allowed. Only POST is supported.',
      })
    }

    let body: Record<string, unknown>
    try {
      body = parseBody(req)
    } catch (parseError) {
      console.error('[api/memory-test] invalid JSON body', parseError)
      return sendJson(res, 500, {
        success: false,
        error: 'Invalid JSON body',
      })
    }

    const errors: Record<string, string> = {}
    const userMessage =
      typeof body.userMessage === 'string' ? body.userMessage.trim() : ''
    const assistantMessage =
      typeof body.assistantMessage === 'string' ? body.assistantMessage.trim() : ''

    if (typeof body.userMessage !== 'string') {
      errors.userMessage = 'userMessage must be a string'
    } else if (!userMessage) {
      errors.userMessage = 'userMessage is required'
    }

    if (typeof body.assistantMessage !== 'string') {
      errors.assistantMessage = 'assistantMessage must be a string'
    } else if (!assistantMessage) {
      errors.assistantMessage = 'assistantMessage is required'
    }

    if (Object.keys(errors).length > 0) {
      return sendJson(res, 500, {
        success: false,
        error: 'Validation failed',
        errors,
      })
    }

    const decision = analyzeConversation(userMessage, assistantMessage)
    if (!decision.save) {
      return sendJson(res, 200, { saved: false, decision })
    }

    await saveMemory(decision)
    return sendJson(res, 200, { saved: true, decision })
  } catch (error) {
    console.error('[api/memory-test]', error)
    const message = error instanceof Error ? error.message : String(error)
    if (res.headersSent) return undefined
    return sendJson(res, 500, {
      success: false,
      error: message,
    })
  }
}
