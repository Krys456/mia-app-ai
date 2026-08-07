import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getServiceSupabase } from '../_lib/supabase'

console.log('API loaded')

export const config = {
  runtime: 'nodejs',
  maxDuration: 15,
}

type MemoryCreateInput = {
  category: string
  title: string
  content: string
  importance: number
}

type ValidationResult =
  | { ok: true; data: MemoryCreateInput }
  | { ok: false; errors: Record<string, string> }

type SupabaseClientLike = {
  from: (table: string) => any
}

const DEFAULT_API_USER_EMAIL = 'brain-api@local'
const DEFAULT_API_USER_NAME = 'BrAIn API'

function sendJson(res: VercelResponse, status: number, payload: Record<string, unknown>) {
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

async function saveMemory(input: MemoryCreateInput): Promise<void> {
  const supabase = await getServiceSupabase()
  const userId = await ensureDefaultUserId(supabase)

  const { error: insertError } = await supabase.from('memories').insert({
    user_id: userId,
    category: input.category,
    title: input.title,
    content: input.content,
    importance: input.importance,
    tags: [],
    source: 'manual',
    status: 'active',
    confidence: 1.0,
  })

  if (insertError) {
    throw new Error(`Failed to insert into public.memories: ${insertError.message}`)
  }
}

async function listMemories(category?: string) {
  const supabase = await getServiceSupabase()
  const userId = await ensureDefaultUserId(supabase)

  let request = supabase
    .from('memories')
    .select('id, category, title, content, importance')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
    .limit(100)

  if (category) {
    request = request.eq('category', category)
  }

  const { data, error } = await request
  if (error) {
    throw new Error(`Failed to list public.memories: ${error.message}`)
  }

  return (data ?? []).map((row) => ({
    id: String(row.id),
    category: String(row.category ?? ''),
    title: String(row.title ?? ''),
    content: String(row.content ?? ''),
    importance:
      typeof row.importance === 'number' && Number.isFinite(row.importance)
        ? row.importance
        : 0,
  }))
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  console.log('Handler started')
  try {
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Origin', '*')
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-LAIfe-User-Id')
      return sendJson(res, 200, { success: true })
    }

    if (req.method === 'GET') {
      const category =
        typeof req.query.category === 'string' ? req.query.category.trim() : undefined
      const memories = await listMemories(category || undefined)
      return sendJson(res, 200, { success: true, memories })
    }

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST, OPTIONS')
      return sendJson(res, 500, {
        success: false,
        error: 'Method not allowed. Only GET and POST are supported.',
      })
    }

    let body: Record<string, unknown>
    try {
      body = parseBody(req)
    } catch (parseError) {
      console.error('[api/memories] invalid JSON body', parseError)
      return sendJson(res, 500, {
        success: false,
        error: 'Invalid JSON body',
      })
    }

    const validated = validateMemoryCreate(body)
    if (!validated.ok) {
      console.error('[api/memories] validation failed', validated.errors)
      return sendJson(res, 500, {
        success: false,
        error: 'Validation failed',
        errors: validated.errors,
      })
    }

    await saveMemory(validated.data)
    return sendJson(res, 201, { success: true })
  } catch (error) {
    console.error('[api/memories]', error)
    const message = error instanceof Error ? error.message : String(error)
    if (res.headersSent) return undefined
    return sendJson(res, 500, {
      success: false,
      error: message,
    })
  }
}
