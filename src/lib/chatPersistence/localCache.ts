/**
 * Local durable chat cache (localStorage).
 * Immediate source of truth for visible UI — never require a network round-trip
 * to keep already-visible messages.
 */

import type {
  CachedConversation,
  ConversationIndex,
  ConversationIndexEntry,
  PersistedChatMessage,
  SyncStatus,
} from './types'

const INDEX_KEY = 'laife.chat.index.v1'
const ACTIVE_KEY = 'laife.chat.activeConversationId.v1'
const CONVERSATION_PREFIX = 'laife.chat.conversation.v1.'

function asString(value: unknown): string {
  if (typeof value === 'string') return value
  if (value == null) return ''
  return String(value)
}

function safeParse<T>(raw: string | null): T | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStorage(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value)
    return true
  } catch (error) {
    console.error('[chatPersistence] localStorage write failed', { key, error })
    return false
  }
}

function removeStorage(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch {
    /* ignore */
  }
}

export function createConversationId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

export function createMessageId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`
}

function emptyIndex(): ConversationIndex {
  return { version: 1, activeConversationId: null, conversations: {} }
}

export function loadConversationIndex(): ConversationIndex {
  const parsed = safeParse<ConversationIndex>(readStorage(INDEX_KEY))
  if (!parsed || parsed.version !== 1 || typeof parsed.conversations !== 'object') {
    return emptyIndex()
  }
  const active =
    typeof parsed.activeConversationId === 'string' ? parsed.activeConversationId : null
  return {
    version: 1,
    activeConversationId: active,
    conversations: parsed.conversations || {},
  }
}

export function saveConversationIndex(index: ConversationIndex): boolean {
  return writeStorage(INDEX_KEY, JSON.stringify(index))
}

export function getActiveConversationId(): string | null {
  const fromKey = asString(readStorage(ACTIVE_KEY)).trim()
  if (fromKey) return fromKey
  return loadConversationIndex().activeConversationId
}

export function setActiveConversationId(conversationId: string | null): void {
  const index = loadConversationIndex()
  index.activeConversationId = conversationId
  saveConversationIndex(index)
  if (conversationId) writeStorage(ACTIVE_KEY, conversationId)
  else removeStorage(ACTIVE_KEY)
}

function conversationKey(conversationId: string): string {
  return `${CONVERSATION_PREFIX}${conversationId}`
}

function sanitizeMessage(raw: unknown): PersistedChatMessage | null {
  if (!raw || typeof raw !== 'object') return null
  const m = raw as Record<string, unknown>
  const id = asString(m.id).trim()
  const role = asString(m.role)
  const content = typeof m.content === 'string' ? m.content : ''
  if (!id || (role !== 'user' && role !== 'assistant' && role !== 'system')) return null
  const syncStatus =
    m.syncStatus === 'synced' || m.syncStatus === 'pending' || m.syncStatus === 'error'
      ? m.syncStatus
      : undefined
  return {
    id,
    role,
    content,
    createdAt: typeof m.createdAt === 'number' ? m.createdAt : Date.now(),
    kind: m.kind === 'error' ? 'error' : undefined,
    syncStatus,
    serverId: typeof m.serverId === 'string' ? m.serverId : undefined,
  }
}

export function loadCachedConversation(conversationId: string): CachedConversation | null {
  if (!conversationId) return null
  const parsed = safeParse<CachedConversation>(readStorage(conversationKey(conversationId)))
  if (!parsed || asString(parsed.conversationId) !== conversationId) return null
  const messages = Array.isArray(parsed.messages)
    ? parsed.messages.map(sanitizeMessage).filter(Boolean) as PersistedChatMessage[]
    : []
  return {
    conversationId,
    title: asString(parsed.title) || 'Chat',
    messages,
    updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : Date.now(),
    createdAt: typeof parsed.createdAt === 'number' ? parsed.createdAt : Date.now(),
    engine: asString(parsed.engine) || 'v1',
    conversationState:
      parsed.conversationState && typeof parsed.conversationState === 'object'
        ? parsed.conversationState
        : null,
    syncStatus:
      parsed.syncStatus === 'synced' ||
      parsed.syncStatus === 'pending' ||
      parsed.syncStatus === 'error'
        ? parsed.syncStatus
        : 'pending',
  }
}

export function deriveTitle(messages: PersistedChatMessage[]): string {
  const firstUser = messages.find((m) => m.role === 'user' && m.content.trim())
  if (!firstUser) return 'New chat'
  const clipped = firstUser.content.trim().replace(/\s+/g, ' ').slice(0, 48)
  return clipped.length < firstUser.content.trim().length ? `${clipped}…` : clipped
}

export function saveCachedConversation(conversation: CachedConversation): boolean {
  const id = asString(conversation.conversationId).trim()
  if (!id) return false
  const messages = Array.isArray(conversation.messages)
    ? conversation.messages.map(sanitizeMessage).filter(Boolean) as PersistedChatMessage[]
    : []
  const record: CachedConversation = {
    conversationId: id,
    title: asString(conversation.title) || deriveTitle(messages),
    messages,
    updatedAt: typeof conversation.updatedAt === 'number' ? conversation.updatedAt : Date.now(),
    createdAt: typeof conversation.createdAt === 'number' ? conversation.createdAt : Date.now(),
    engine: asString(conversation.engine) || 'v1',
    conversationState:
      conversation.conversationState && typeof conversation.conversationState === 'object'
        ? conversation.conversationState
        : null,
    syncStatus: conversation.syncStatus || 'pending',
  }
  const ok = writeStorage(conversationKey(id), JSON.stringify(record))
  if (!ok) return false

  const index = loadConversationIndex()
  const entry: ConversationIndexEntry = {
    conversationId: id,
    title: record.title,
    updatedAt: record.updatedAt,
    createdAt: record.createdAt,
    engine: record.engine,
    syncStatus: record.syncStatus,
    messageCount: record.messages.length,
  }
  index.conversations[id] = entry
  if (!index.activeConversationId) index.activeConversationId = id
  saveConversationIndex(index)
  return true
}

/**
 * Persist active conversation snapshot. Never throws.
 * Empty remote must never call a wipe path — this only writes local.
 */
export function persistActiveSnapshot(input: {
  conversationId: string
  messages: PersistedChatMessage[]
  engine?: string
  conversationState?: Record<string, unknown> | null
  syncStatus?: SyncStatus
  createdAt?: number
  title?: string
}): CachedConversation | null {
  const id = asString(input.conversationId).trim()
  if (!id) return null
  const previous = loadCachedConversation(id)
  const now = Date.now()
  const record: CachedConversation = {
    conversationId: id,
    title: input.title || previous?.title || deriveTitle(input.messages),
    messages: input.messages,
    updatedAt: now,
    createdAt: input.createdAt || previous?.createdAt || now,
    engine: input.engine || previous?.engine || 'v1',
    conversationState:
      input.conversationState !== undefined
        ? input.conversationState
        : previous?.conversationState ?? null,
    syncStatus: input.syncStatus || previous?.syncStatus || 'pending',
  }
  saveCachedConversation(record)
  setActiveConversationId(id)
  return record
}

export function listCachedConversations(): ConversationIndexEntry[] {
  const index = loadConversationIndex()
  return Object.values(index.conversations).sort((a, b) => b.updatedAt - a.updatedAt)
}

export function deleteCachedConversation(conversationId: string): void {
  const id = asString(conversationId).trim()
  if (!id) return
  removeStorage(conversationKey(id))
  const index = loadConversationIndex()
  delete index.conversations[id]
  if (index.activeConversationId === id) {
    index.activeConversationId = null
    removeStorage(ACTIVE_KEY)
  }
  saveConversationIndex(index)
}

/**
 * Load the conversation that should appear on startup.
 * Never returns an empty wipe when a richer cache exists.
 */
export function loadActiveConversationForStartup(): CachedConversation | null {
  const activeId = getActiveConversationId()
  if (activeId) {
    const cached = loadCachedConversation(activeId)
    if (cached && cached.messages.length > 0) return cached
    if (cached) return cached
  }
  // Fallback: most recently updated non-empty conversation
  const listed = listCachedConversations()
  for (const entry of listed) {
    const full = loadCachedConversation(entry.conversationId)
    if (full && full.messages.length > 0) {
      setActiveConversationId(full.conversationId)
      return full
    }
  }
  return activeId ? loadCachedConversation(activeId) : null
}

/** Test helper — clear only chat persistence keys (not settings/userId). */
export function clearChatPersistenceForTests(): void {
  const index = loadConversationIndex()
  for (const id of Object.keys(index.conversations)) {
    removeStorage(conversationKey(id))
  }
  removeStorage(INDEX_KEY)
  removeStorage(ACTIVE_KEY)
}
