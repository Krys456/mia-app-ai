/**
 * Sync orchestration: local cache first, then server, with retry.
 * Persistence failures never delete UI messages.
 */

import {
  loadCachedConversation,
  persistActiveSnapshot,
  saveCachedConversation,
} from './localCache'
import {
  deleteRemoteConversation,
  fetchRemoteConversation,
  upsertRemoteConversation,
  upsertRemoteMessages,
} from './api'
import { reconcileConversations } from './reconcile'
import type { CachedConversation, PersistedChatMessage, SyncStatus } from './types'

const pendingSync = new Set<string>()
const syncTimers = new Map<string, ReturnType<typeof setTimeout>>()

function logPersistenceError(scope: string, error: unknown, extra?: Record<string, unknown>) {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`[chatPersistence] ${scope}`, { message, ...extra, error })
  if (import.meta.env?.DEV) {
    console.warn(`[chatPersistence:dev] ${scope}:`, message, extra || {})
  }
}

export function markMessagesSyncStatus(
  messages: PersistedChatMessage[],
  status: SyncStatus,
  ids?: Set<string>,
): PersistedChatMessage[] {
  return messages.map((m) => {
    if (ids && !ids.has(m.id)) return m
    return { ...m, syncStatus: status }
  })
}

/**
 * Enqueue server sync for a conversation. Local cache is already authoritative.
 */
export function enqueueConversationSync(conversationId: string, delayMs = 0): void {
  if (!conversationId) return
  pendingSync.add(conversationId)
  const existing = syncTimers.get(conversationId)
  if (existing) clearTimeout(existing)
  const timer = setTimeout(() => {
    syncTimers.delete(conversationId)
    void flushConversationSync(conversationId)
  }, delayMs)
  syncTimers.set(conversationId, timer)
}

export async function flushConversationSync(conversationId: string): Promise<boolean> {
  const local = loadCachedConversation(conversationId)
  if (!local) {
    pendingSync.delete(conversationId)
    return true
  }

  try {
    await upsertRemoteConversation({
      conversationId: local.conversationId,
      title: local.title,
      engine: local.engine,
      conversationState: local.conversationState,
      createdAt: local.createdAt,
      updatedAt: local.updatedAt,
    })

    const toSync = local.messages.filter((m) => m.syncStatus !== 'synced')
    const batch = toSync.length > 0 ? toSync : local.messages
    if (batch.length > 0) {
      await upsertRemoteMessages({
        conversationId: local.conversationId,
        messages: batch,
      })
    }

    const synced = {
      ...local,
      messages: markMessagesSyncStatus(local.messages, 'synced'),
      syncStatus: 'synced' as const,
    }
    saveCachedConversation(synced)
    pendingSync.delete(conversationId)
    return true
  } catch (error) {
    logPersistenceError('sync_failed', error, { conversationId })
    const errored = {
      ...local,
      messages: markMessagesSyncStatus(
        local.messages,
        'error',
        new Set(local.messages.filter((m) => m.syncStatus !== 'synced').map((m) => m.id)),
      ),
      syncStatus: 'error' as const,
    }
    saveCachedConversation(errored)
    // Retry with backoff
    enqueueConversationSync(conversationId, 4000)
    return false
  }
}

/**
 * Startup reconcile: local first, then remote. Empty remote never wipes local.
 */
export async function reconcileActiveWithRemote(
  conversationId: string,
): Promise<CachedConversation | null> {
  const local = loadCachedConversation(conversationId)
  try {
    const remote = await fetchRemoteConversation(conversationId)
    const merged = reconcileConversations(local, remote)
    if (!merged) return local
    // If remote was empty and local had data, keep pending sync.
    if (local && local.messages.length > 0 && (!remote || remote.messages.length === 0)) {
      const kept = { ...merged, syncStatus: 'pending' as const }
      saveCachedConversation(kept)
      enqueueConversationSync(conversationId, 250)
      return kept
    }
    saveCachedConversation(merged)
    if (merged.messages.some((m) => m.syncStatus === 'pending' || m.syncStatus === 'error')) {
      enqueueConversationSync(conversationId, 250)
    }
    return merged
  } catch (error) {
    logPersistenceError('reconcile_fetch_failed', error, { conversationId })
    // Keep local; schedule retry
    if (local) enqueueConversationSync(conversationId, 2000)
    return local
  }
}

export function persistMessagesNow(input: {
  conversationId: string
  messages: PersistedChatMessage[]
  engine?: string
  conversationState?: Record<string, unknown> | null
  createdAt?: number
}): CachedConversation | null {
  const saved = persistActiveSnapshot({
    ...input,
    syncStatus: 'pending',
  })
  if (saved) enqueueConversationSync(input.conversationId, 100)
  return saved
}

export async function explicitDeleteConversation(conversationId: string): Promise<void> {
  const { deleteCachedConversation } = await import('./localCache')
  deleteCachedConversation(conversationId)
  try {
    await deleteRemoteConversation(conversationId)
  } catch (error) {
    logPersistenceError('delete_remote_failed', error, { conversationId })
  }
}

export function retryPendingSyncs(): void {
  void retryAllUnsynced()
}

export async function retryAllUnsynced(): Promise<void> {
  const { listCachedConversations, loadCachedConversation: load } = await import('./localCache')
  for (const entry of listCachedConversations()) {
    const full = load(entry.conversationId)
    if (!full) continue
    if (
      full.syncStatus !== 'synced' ||
      full.messages.some((m) => m.syncStatus === 'pending' || m.syncStatus === 'error')
    ) {
      await flushConversationSync(entry.conversationId)
    }
  }
}

export function installOnlineRetryListener(): () => void {
  if (typeof window === 'undefined') return () => {}
  const onOnline = () => {
    void retryAllUnsynced()
  }
  window.addEventListener('online', onOnline)
  return () => window.removeEventListener('online', onOnline)
}
