import type { MemoryDraft, MemoryItem } from './memory'
import { getOrCreateUserId } from './userId'

export class MemoryApiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'MemoryApiError'
    this.status = status
  }
}

export type BrainMemoryCreateInput = {
  category: string
  title: string
  content: string
  importance: number
}

function resolveBase(): string {
  const base = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() ?? ''
  return base.replace(/\/$/, '')
}

/** Always targets /api/memories (never /api/memory). */
function memoriesUrl(path = '', query?: Record<string, string | undefined>) {
  const url = new URL(`${resolveBase()}/api/memories${path}`, window.location.origin)
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value) url.searchParams.set(key, value)
    }
  }
  return url.toString()
}

function authHeaders(json = false): HeadersInit {
  const headers: Record<string, string> = {
    'X-LAIfe-User-Id': getOrCreateUserId(),
  }
  if (json) headers['Content-Type'] = 'application/json'
  return headers
}

async function parseJson<T>(response: Response): Promise<T> {
  let data: T & { error?: string; success?: boolean }
  try {
    data = (await response.json()) as T & { error?: string; success?: boolean }
  } catch {
    throw new MemoryApiError('Invalid JSON from memory API', response.status)
  }
  if (!response.ok) {
    throw new MemoryApiError(
      data.error?.trim() || `Memory API failed (${response.status})`,
      response.status,
    )
  }
  return data
}

function normalizeMemory(raw: Partial<MemoryItem> & Record<string, unknown>): MemoryItem {
  return {
    id: String(raw.id ?? ''),
    category: String(raw.category ?? ''),
    title: String(raw.title ?? ''),
    content: String(raw.content ?? ''),
    importance: typeof raw.importance === 'number' ? raw.importance : undefined,
    usageCount:
      typeof raw.usageCount === 'number'
        ? raw.usageCount
        : typeof raw.usage_count === 'number'
          ? raw.usage_count
          : 0,
    lastUsedAt:
      typeof raw.lastUsedAt === 'string'
        ? raw.lastUsedAt
        : typeof raw.last_used_at === 'string'
          ? raw.last_used_at
          : null,
    createdAt: String(raw.createdAt ?? raw.created_at ?? ''),
    updatedAt: String(raw.updatedAt ?? raw.updated_at ?? ''),
  }
}

export async function listMemories(options?: {
  category?: string
  q?: string
}): Promise<MemoryItem[]> {
  const category = options?.category && options.category !== 'All' ? options.category : undefined
  const data = await parseJson<{ success?: boolean; memories: MemoryItem[] }>(
    await fetch(
      memoriesUrl('', {
        category,
        q: options?.q?.trim() || undefined,
      }),
      { headers: authHeaders(), credentials: 'include' },
    ),
  )
  return (data.memories ?? []).map((item) =>
    normalizeMemory(item as Partial<MemoryItem> & Record<string, unknown>),
  )
}

/** Creates a memory via POST /api/memories (Supabase-backed). */
export async function createBrainMemory(input: BrainMemoryCreateInput): Promise<void> {
  const data = await parseJson<{ success?: boolean; error?: string }>(
    await fetch(memoriesUrl(), {
      method: 'POST',
      headers: authHeaders(true),
      credentials: 'include',
      body: JSON.stringify({
        category: input.category,
        title: input.title,
        content: input.content,
        importance: input.importance,
      }),
    }),
  )

  if (data.success !== true) {
    throw new MemoryApiError(
      data.error?.trim() || 'Memory API did not return success: true',
      500,
    )
  }
}

export async function createMemory(draft: MemoryDraft): Promise<MemoryItem> {
  await createBrainMemory({
    category: draft.category,
    title: draft.title,
    content: draft.content,
    importance: 5,
  })

  const now = new Date().toISOString()
  return {
    id: `local_${Date.now().toString(36)}`,
    category: draft.category,
    title: draft.title,
    content: draft.content,
    usageCount: 0,
    lastUsedAt: null,
    createdAt: now,
    updatedAt: now,
  }
}

export async function updateMemory(id: string, draft: MemoryDraft): Promise<MemoryItem> {
  const data = await parseJson<{ memory: MemoryItem }>(
    await fetch(memoriesUrl(`/${encodeURIComponent(id)}`), {
      method: 'PUT',
      headers: authHeaders(true),
      credentials: 'include',
      body: JSON.stringify(draft),
    }),
  )
  return normalizeMemory(data.memory as Partial<MemoryItem> & Record<string, unknown>)
}

export async function deleteMemory(id: string): Promise<void> {
  await parseJson<{ ok: boolean }>(
    await fetch(memoriesUrl(`/${encodeURIComponent(id)}`), {
      method: 'DELETE',
      headers: authHeaders(),
      credentials: 'include',
    }),
  )
}

/** Deletes every memory for the default API user. */
export async function deleteAllMemories(): Promise<number> {
  const data = await parseJson<{ success?: boolean; deleted?: number }>(
    await fetch(memoriesUrl('', { clear: '1' }), {
      method: 'DELETE',
      headers: authHeaders(),
      credentials: 'include',
    }),
  )
  return typeof data.deleted === 'number' ? data.deleted : 0
}
