import type { MemoryCategory, MemoryDraft, MemoryItem } from './memory'

export class MemoryApiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'MemoryApiError'
    this.status = status
  }
}

function resolveBase(): string {
  const base = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() ?? ''
  return base.replace(/\/$/, '')
}

function memoriesUrl(path = '', query?: Record<string, string | undefined>) {
  const url = new URL(`${resolveBase()}/api/memories${path}`, window.location.origin)
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value) url.searchParams.set(key, value)
    }
  }
  return url.toString()
}

async function parseJson<T>(response: Response): Promise<T> {
  let data: T & { error?: string }
  try {
    data = (await response.json()) as T & { error?: string }
  } catch {
    throw new MemoryApiError('Invalid JSON from memory API', response.status)
  }
  if (!response.ok) {
    throw new MemoryApiError(data.error?.trim() || `Memory API failed (${response.status})`, response.status)
  }
  return data
}

export async function listMemories(options?: {
  category?: MemoryCategory | 'All'
  q?: string
}): Promise<MemoryItem[]> {
  const category = options?.category && options.category !== 'All' ? options.category : undefined
  const data = await parseJson<{ memories: MemoryItem[] }>(
    await fetch(
      memoriesUrl('', {
        category,
        q: options?.q?.trim() || undefined,
      }),
    ),
  )
  return data.memories
}

export async function createMemory(draft: MemoryDraft): Promise<MemoryItem> {
  const data = await parseJson<{ memory: MemoryItem }>(
    await fetch(memoriesUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(draft),
    }),
  )
  return data.memory
}

export async function updateMemory(id: string, draft: MemoryDraft): Promise<MemoryItem> {
  const data = await parseJson<{ memory: MemoryItem }>(
    await fetch(memoriesUrl(`/${encodeURIComponent(id)}`), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(draft),
    }),
  )
  return data.memory
}

export async function deleteMemory(id: string): Promise<void> {
  await parseJson<{ ok: boolean }>(
    await fetch(memoriesUrl(`/${encodeURIComponent(id)}`), {
      method: 'DELETE',
    }),
  )
}
