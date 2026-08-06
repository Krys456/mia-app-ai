import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getServiceSupabase } from '../_lib/supabase'

export const config = {
  runtime: 'nodejs',
  maxDuration: 15,
}

const DEFAULT_API_USER_EMAIL = 'brain-api@local'
const DEFAULT_API_USER_NAME = 'BrAIn API'

type MemoryCreateInput = {
  category: string
  title: string
  content: string
  importance: number
}

type ValidationResult =
  | { ok: true; data: MemoryCreateInput }
  | { ok: false; errors: Record<string, string> }

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

function validateMemoryCreate(body: Record<string, unknown>): ValidationResult {
  const errors: Record<string, string> = {}

  const category = typeof body.category === 'string' ? body.category.trim() : ''
  const title = typeof body.title === 'string' ? body.title.trim() : ''
  const content = typeof body.content === 'string' ? body.content.trim() : ''

  if (typeof body.category !== 'string') {
    errors.category = 'category must be a string'
  } else if (!category) {
    errors.category = 'category is required'
  }

  if (typeof body.title !== 'string') {
    errors.title = 'title must be a string'
  } else if (!title) {
    errors.title = 'title is required'
  }

  if (typeof body.content !== 'string') {
    errors.content = 'content must be a string'
  } else if (!content) {
    errors.content = 'content is required'
  }

  let importance: number | null = null
  if (typeof body.importance === 'number' && Number.isFinite(body.importance)) {
    importance = body.importance
  } else if (typeof body.importance === 'string' && body.importance.trim()) {
    const parsed = Number(body.importance)
    if (Number.isFinite(parsed)) importance = parsed
  }

  if (importance === null) {
    errors.importance = 'importance must be a number between 1 and 10'
  } else if (!Number.isInteger(importance) || importance < 1 || importance > 10) {
    errors.importance = 'importance must be an integer between 1 and 10'
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors }
  }

  return {
    ok: true,
    data: {
      category,
      title,
      content,
      importance: importance as number,
    },
  }
}

async function ensureDefaultUserId(): Promise<string> {
  const supabase = getServiceSupabase()

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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    return res.status(204).end()
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS')
    return sendJson(res, 405, {
      success: false,
      error: 'Method not allowed. Only POST is supported.',
    })
  }

  let body: Record<string, unknown>
  try {
    body = parseBody(req)
  } catch {
    return sendJson(res, 400, {
      success: false,
      error: 'Invalid JSON body',
    })
  }

  const validated = validateMemoryCreate(body)
  if (!validated.ok) {
    return sendJson(res, 400, {
      success: false,
      error: 'Validation failed',
      errors: validated.errors,
    })
  }

  try {
    const supabase = getServiceSupabase()
    const userId = await ensureDefaultUserId()

    const { error: insertError } = await supabase.from('memories').insert({
      user_id: userId,
      category: validated.data.category,
      title: validated.data.title,
      content: validated.data.content,
      importance: validated.data.importance,
    })

    if (insertError) {
      console.error('[api/memories] insert failed', insertError)
      return sendJson(res, 500, {
        success: false,
        error: insertError.message,
      })
    }

    return sendJson(res, 201, { success: true })
  } catch (error) {
    console.error('[api/memories]', error)
    const message = error instanceof Error ? error.message : String(error)
    return sendJson(res, 500, {
      success: false,
      error: message,
    })
  }
}
