/**
 * Client API for conversation / message persistence.
 * Fail-soft: network errors never clear local cache.
 */

import { getOrCreateUserId } from '../userId'
import type { CachedConversation, PersistedChatMessage } from './types'

export class ChatPersistenceApiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ChatPersistenceApiError'
    this.status = status
  }
}

function resolveBase(): string {
  const base = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() ?? ''
  return base.replace(/\/$/, '')
}

function authHeaders(json = false): HeadersInit {
  const headers: Record<string, string> = {
    'X-LAIfe-User-Id': getOrCreateUserId(),
  }
  if (json) headers['Content-Type'] = 'application/json'
  return headers
}

function conversationsUrl(path = '', query?: Record<string, string | undefined>) {
  const url = new URL(`${resolveBase()}/api/conversations${path}`, window.location.origin)
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value) url.searchParams.set(key, value)
    }
  }
  return url.toString()
}

async function parseJson<T>(response: Response): Promise<T> {
  let data: T & { error?: string; success?: boolean }
  try {
    data = (await response.json()) as T & { error?: string; success?: boolean }
  } catch {
    throw new ChatPersistenceApiError('Invalid JSON from conversations API', response.status)
  }
  if (!response.ok) {
    throw new ChatPersistenceApiError(
      data.error?.trim() || `Conversations API failed (${response.status})`,
      response.status,
    )
  }
  return data
}

function normalizeRemoteMessage(raw: Record<string, unknown>): PersistedChatMessage | null {
  const clientId = String(raw.client_id || raw.clientId || raw.id || '').trim()
  const role = String(raw.role || '')
  if (!clientId || (role !== 'user' && role !== 'assistant' && role !== 'system')) return null
  const createdRaw = raw.created_at || raw.createdAt
  const createdAt =
    typeof createdRaw === 'number'
      ? createdRaw
      : createdRaw
        ? Date.parse(String(createdRaw)) || Date.now()
        : Date.now()
  return {
    id: clientId,
    serverId: typeof raw.id === 'string' && raw.id !== clientId ? raw.id : String(raw.id || ''),
    role,
    content: typeof raw.content === 'string' ? raw.content : '',
    createdAt,
    kind: raw.kind === 'error' ? 'error' : undefined,
    syncStatus: 'synced',
  }
}

function normalizeRemoteConversation(raw: Record<string, unknown>): CachedConversation {
  const id = String(raw.id || raw.conversationId || '').trim()
  const messagesRaw = Array.isArray(raw.messages) ? raw.messages : []
  const messages = messagesRaw
    .map((m) => (m && typeof m === 'object' ? normalizeRemoteMessage(m as Record<string, unknown>) : null))
    .filter(Boolean) as PersistedChatMessage[]
  const meta =
    raw.metadata && typeof raw.metadata === 'object'
      ? (raw.metadata as Record<string, unknown>)
      : {}
  const updatedRaw = raw.updated_at || raw.updatedAt
  const createdRaw = raw.created_at || raw.createdAt
  return {
    conversationId: id,
    title: String(raw.title || 'Chat'),
    messages,
    updatedAt: updatedRaw ? Date.parse(String(updatedRaw)) || Date.now() : Date.now(),
    createdAt: createdRaw ? Date.parse(String(createdRaw)) || Date.now() : Date.now(),
    engine: String(raw.engine || meta.engine || 'v1'),
    conversationState:
      meta.conversationState && typeof meta.conversationState === 'object'
        ? (meta.conversationState as Record<string, unknown>)
        : null,
    syncStatus: 'synced',
  }
}

export async function fetchRemoteConversation(
  conversationId: string,
  init?: { signal?: AbortSignal },
): Promise<CachedConversation | null> {
  const response = await fetch(conversationsUrl(`/${encodeURIComponent(conversationId)}`), {
    method: 'GET',
    headers: authHeaders(),
    signal: init?.signal,
  })
  if (response.status === 404) return null
  const data = await parseJson<{ success?: boolean; conversation?: Record<string, unknown> }>(
    response,
  )
  if (!data.conversation) return null
  return normalizeRemoteConversation(data.conversation)
}

export async function upsertRemoteConversation(input: {
  conversationId: string
  title: string
  engine?: string
  conversationState?: Record<string, unknown> | null
  createdAt?: number
  updatedAt?: number
}): Promise<{ ok: boolean }> {
  const response = await fetch(conversationsUrl(''), {
    method: 'POST',
    headers: authHeaders(true),
    body: JSON.stringify({
      id: input.conversationId,
      title: input.title,
      engine: input.engine || 'v1',
      metadata: {
        conversationState: input.conversationState || null,
      },
      createdAt: input.createdAt,
      updatedAt: input.updatedAt,
    }),
  })
  await parseJson(response)
  return { ok: true }
}

export async function upsertRemoteMessages(input: {
  conversationId: string
  messages: PersistedChatMessage[]
}): Promise<{ ok: boolean; syncedIds: string[] }> {
  const response = await fetch(
    conversationsUrl(`/${encodeURIComponent(input.conversationId)}/messages`),
    {
      method: 'POST',
      headers: authHeaders(true),
      body: JSON.stringify({
        messages: input.messages.map((m) => ({
          clientId: m.id,
          role: m.role,
          content: m.content,
          kind: m.kind || null,
          createdAt: m.createdAt,
        })),
      }),
    },
  )
  const data = await parseJson<{ success?: boolean; syncedIds?: string[] }>(response)
  return { ok: true, syncedIds: Array.isArray(data.syncedIds) ? data.syncedIds : [] }
}

export async function deleteRemoteConversation(conversationId: string): Promise<void> {
  const response = await fetch(conversationsUrl(`/${encodeURIComponent(conversationId)}`), {
    method: 'DELETE',
    headers: authHeaders(),
  })
  if (response.status === 404) return
  await parseJson(response)
}

export async function listRemoteConversations(init?: {
  signal?: AbortSignal
}): Promise<CachedConversation[]> {
  const response = await fetch(conversationsUrl(''), {
    method: 'GET',
    headers: authHeaders(),
    signal: init?.signal,
  })
  const data = await parseJson<{ success?: boolean; conversations?: Record<string, unknown>[] }>(
    response,
  )
  const list = Array.isArray(data.conversations) ? data.conversations : []
  return list.map((c) => normalizeRemoteConversation(c))
}
