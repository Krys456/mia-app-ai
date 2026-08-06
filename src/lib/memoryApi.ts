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
    throw new MemoryApiError(data.error?.trim() || `Memory API failed (${response.status})`, response.status)
  }
  return data
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
      { headers: authHeaders() },
    ),
  )
  return data.memories ?? []
}

/** Creates a memory via POST /api/memories (Supabase-backed). Returns void on success. */
export async function createBrainMemory(input: BrainMemoryCreateInput): Promise<void> {
  const data = await parseJson<{ success?: boolean; error?: string }>(
    await fetch(memoriesUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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

/**
 * Legacy helper — aligned with POST /api/memories `{ success: true }` contract.
 * Sends a default importance when the draft does not include one.
 */
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
    createdAt: now,
    updatedAt: now,
  }
}

export async function updateMemory(id: string, draft: MemoryDraft): Promise<MemoryItem> {
  const data = await parseJson<{ memory: MemoryItem }>(
    await fetch(memoriesUrl(`/${encodeURIComponent(id)}`), {
      method: 'PUT',
      headers: authHeaders(true),
      body: JSON.stringify(draft),
    }),
  )
  return data.memory
}

export async function deleteMemory(id: string): Promise<void> {
  await parseJson<{ ok: boolean }>(
    await fetch(memoriesUrl(`/${encodeURIComponent(id)}`), {
      method: 'DELETE',
      headers: authHeaders(),
    }),
  )
}
