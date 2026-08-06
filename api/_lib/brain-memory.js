/**
 * BrAIn memory runtime (plain JS for reliable Vercel dynamic import).
 * Lazy-loads @supabase/supabase-js from node_modules only when called.
 */

const DEFAULT_API_USER_EMAIL = 'brain-api@local'
const DEFAULT_API_USER_NAME = 'BrAIn API'
const NAME_PATTERN = /my\s+name\s+is\s+([^\n.!?,;:]+)/i

const NO_SAVE = {
  save: false,
  category: '',
  title: '',
  content: '',
  importance: 0,
}

let cachedClient = null

async function loadCreateClient() {
  // Hide from static bundlers that hoist dynamic imports into cold-start.
  const spec = '@supabase/' + 'supabase-js'
  const mod = await import(spec)
  return mod.createClient
}

async function getSupabase() {
  if (cachedClient) return cachedClient

  const url =
    (process.env.SUPABASE_URL && process.env.SUPABASE_URL.trim()) ||
    (process.env.VITE_SUPABASE_URL && process.env.VITE_SUPABASE_URL.trim()) ||
    ''
  const key =
    (process.env.SUPABASE_SERVICE_ROLE_KEY &&
      process.env.SUPABASE_SERVICE_ROLE_KEY.trim()) ||
    ''

  if (!url) {
    throw new Error(
      'Missing SUPABASE_URL. Set SUPABASE_URL (preferred) or VITE_SUPABASE_URL in the environment.',
    )
  }

  if (!key) {
    throw new Error(
      'Missing SUPABASE_SERVICE_ROLE_KEY. Set SUPABASE_SERVICE_ROLE_KEY in the environment for memory API inserts.',
    )
  }

  const createClient = await loadCreateClient()
  cachedClient = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
  return cachedClient
}

async function ensureDefaultUserId(supabase) {
  const { data: existing, error: lookupError } = await supabase
    .from('users')
    .select('id')
    .eq('email', DEFAULT_API_USER_EMAIL)
    .maybeSingle()

  if (lookupError) {
    throw new Error(`Failed to look up default user: ${lookupError.message}`)
  }

  if (existing && existing.id) {
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

  if (createError || !created || !created.id) {
    throw new Error(
      `Failed to create default user: ${
        (createError && createError.message) || 'unknown error'
      }`,
    )
  }

  return String(created.id)
}

function tokenize(query) {
  return String(query)
    .toLowerCase()
    .split(/[^a-z0-9àèéìòù]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length > 1)
}

export async function saveMemory(input) {
  const supabase = await getSupabase()
  const userId = await ensureDefaultUserId(supabase)

  const { error: insertError } = await supabase.from('memories').insert({
    user_id: userId,
    category: input.category,
    title: input.title,
    content: input.content,
    importance: input.importance ?? 1,
    tags: input.tags ?? [],
    source: (input.source && String(input.source).trim()) || 'automatic',
    status: (input.status && String(input.status).trim()) || 'active',
    confidence:
      typeof input.confidence === 'number' && Number.isFinite(input.confidence)
        ? input.confidence
        : 1.0,
  })

  if (insertError) {
    throw new Error(`Failed to insert into public.memories: ${insertError.message}`)
  }
}

export async function listMemories(options = {}) {
  const supabase = await getSupabase()
  const userId = await ensureDefaultUserId(supabase)

  let request = supabase
    .from('memories')
    .select('id, category, title, content, importance')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
    .limit(100)

  if (options.category) {
    request = request.eq('category', options.category)
  }

  const { data, error } = await request
  if (error) {
    throw new Error(`Failed to list public.memories: ${error.message}`)
  }

  return (data || []).map((row) => ({
    id: String(row.id),
    category: String(row.category || ''),
    title: String(row.title || ''),
    content: String(row.content || ''),
    importance:
      typeof row.importance === 'number' && Number.isFinite(row.importance)
        ? row.importance
        : 0,
  }))
}

async function recordMemoryUsage(supabase, memoryIds) {
  if (!memoryIds.length) return

  try {
    const { error } = await supabase.rpc('mark_memories_used', {
      memory_ids: memoryIds,
    })

    if (error) {
      const now = new Date().toISOString()
      await Promise.all(
        memoryIds.map(async (id) => {
          const { data } = await supabase
            .from('memories')
            .select('usage_count')
            .eq('id', id)
            .maybeSingle()

          const current =
            typeof data?.usage_count === 'number' && Number.isFinite(data.usage_count)
              ? data.usage_count
              : 0

          await supabase
            .from('memories')
            .update({
              usage_count: current + 1,
              last_used_at: now,
            })
            .eq('id', id)
        }),
      )
    }
  } catch {
    // ignore
  }
}

export async function searchMemories(query, options = {}) {
  const supabase = await getSupabase()
  const userId = await ensureDefaultUserId(supabase)
  const limit = Math.min(Math.max(options.limit ?? 5, 1), 20)

  let request = supabase
    .from('memories')
    .select('id, category, title, content, importance')
    .eq('user_id', userId)
    .order('importance', { ascending: false })
    .limit(100)

  if (options.category) {
    request = request.eq('category', options.category)
  }

  const { data, error } = await request
  if (error) {
    throw new Error(error.message)
  }

  const rows = (data || []).map((row) => ({
    id: String(row.id),
    category: String(row.category || ''),
    title: String(row.title || ''),
    content: String(row.content || ''),
    importance:
      typeof row.importance === 'number' && Number.isFinite(row.importance)
        ? row.importance
        : 0,
  }))

  if (!rows.length) return []

  const tokens = tokenize(query)
  const scored = rows.map((row) => {
    const haystack = `${row.title} ${row.content} ${row.category}`.toLowerCase()
    let score = row.importance
    let matched = tokens.length === 0

    for (const token of tokens) {
      if (haystack.includes(token)) {
        matched = true
        score += 4
        if (row.title.toLowerCase().includes(token)) score += 3
      }
    }

    return { row, score, matched }
  })

  const relevant = tokens.length > 0 ? scored.filter((item) => item.matched) : scored
  const pool = relevant.length > 0 ? relevant : scored

  const results = pool
    .sort((a, b) => b.score - a.score || b.row.importance - a.row.importance)
    .slice(0, limit)
    .map((item) => item.row)

  if (results.length > 0) {
    await recordMemoryUsage(
      supabase,
      results.map((item) => item.id),
    )
  }

  return results
}

export function analyzeConversation(userMessage, assistantMessage) {
  const user = String(userMessage || '').trim()
  void assistantMessage
  if (!user) return { ...NO_SAVE }

  const nameMatch = user.match(NAME_PATTERN)
  if (nameMatch && nameMatch[1]) {
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

export async function runMemoryPipeline(input) {
  const decision = analyzeConversation(input.userMessage, input.assistantMessage)
  if (!decision.save) {
    return { saved: false, decision }
  }

  await saveMemory({
    category: decision.category,
    title: decision.title,
    content: decision.content,
    importance: decision.importance,
  })

  return { saved: true, decision }
}
