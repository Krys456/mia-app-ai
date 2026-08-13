/**
 * Deterministic local ↔ remote message reconciliation.
 * empty_remote must NOT delete non-empty local.
 */

import type { CachedConversation, PersistedChatMessage, SyncStatus } from './types'
import { deriveTitle } from './localCache'

function messageKey(message: PersistedChatMessage): string {
  if (message.serverId) return `server:${message.serverId}`
  return `client:${message.id}`
}

function contentFingerprint(message: PersistedChatMessage): string {
  return `${message.role}|${message.content.trim()}|${message.kind || ''}`
}

/**
 * Merge local + remote messages without duplicates.
 * Prefer unique ids; keep unsynced local; append remote-only chronologically.
 */
export function reconcileMessages(
  local: PersistedChatMessage[],
  remote: PersistedChatMessage[],
): PersistedChatMessage[] {
  const localList = Array.isArray(local) ? local : []
  const remoteList = Array.isArray(remote) ? remote : []

  /** @type {Map<string, PersistedChatMessage>} */
  const byKey = new Map()
  /** @type {Map<string, string>} fingerprint → key for soft dedupe */
  const byFingerprint = new Map()

  const upsert = (msg: PersistedChatMessage, preferRemoteSync: boolean) => {
    const key = messageKey(msg)
    const fp = contentFingerprint(msg)
    const existingKey = byFingerprint.get(fp)
    if (existingKey && existingKey !== key) {
      const existing = byKey.get(existingKey)
      if (existing) {
        // Same content under different ids — keep earlier, merge sync metadata.
        const merged: PersistedChatMessage = {
          ...existing,
          serverId: existing.serverId || msg.serverId,
          syncStatus: mergeSyncStatus(existing.syncStatus, msg.syncStatus),
          createdAt: Math.min(existing.createdAt || Date.now(), msg.createdAt || Date.now()),
        }
        byKey.set(existingKey, merged)
        return
      }
    }

    const prev = byKey.get(key)
    if (!prev) {
      byKey.set(key, { ...msg })
      byFingerprint.set(fp, key)
      return
    }

    const merged: PersistedChatMessage = {
      ...prev,
      ...msg,
      // Prefer non-empty content; never blank out.
      content: msg.content?.trim() ? msg.content : prev.content,
      serverId: msg.serverId || prev.serverId,
      syncStatus: preferRemoteSync
        ? mergeSyncStatus(prev.syncStatus, msg.syncStatus)
        : mergeSyncStatus(msg.syncStatus, prev.syncStatus),
      createdAt: Math.min(prev.createdAt || Date.now(), msg.createdAt || Date.now()),
    }
    byKey.set(key, merged)
    byFingerprint.set(fp, key)
  }

  for (const msg of localList) upsert(msg, false)
  for (const msg of remoteList) upsert(msg, true)

  return [...byKey.values()].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
}

function mergeSyncStatus(a?: SyncStatus, b?: SyncStatus): SyncStatus | undefined {
  if (a === 'pending' || b === 'pending') return 'pending'
  if (a === 'error' || b === 'error') return a === 'synced' ? b : a || b
  if (a === 'synced' || b === 'synced') return 'synced'
  return a || b
}

/**
 * Reconcile full conversations.
 * If remote is empty/missing and local has messages → keep local (invariant).
 */
export function reconcileConversations(
  local: CachedConversation | null,
  remote: CachedConversation | null,
): CachedConversation | null {
  if (!local && !remote) return null
  if (local && (!remote || !Array.isArray(remote.messages) || remote.messages.length === 0)) {
    // empty_remote_response must NOT delete non-empty local conversation
    if (local.messages.length > 0) return local
    return remote && remote.conversationId === local.conversationId
      ? { ...local, ...remote, messages: local.messages }
      : local
  }
  if (!local && remote) return remote

  const left = local as CachedConversation
  const right = remote as CachedConversation
  const messages = reconcileMessages(left.messages, right.messages)
  const updatedAt = Math.max(left.updatedAt || 0, right.updatedAt || 0)
  return {
    conversationId: left.conversationId || right.conversationId,
    title: left.title || right.title || deriveTitle(messages),
    messages,
    updatedAt,
    createdAt: Math.min(left.createdAt || updatedAt, right.createdAt || updatedAt),
    engine: left.engine || right.engine || 'v1',
    conversationState: pickConversationState(left.conversationState, right.conversationState),
    syncStatus: mergeSyncStatus(left.syncStatus, right.syncStatus) || 'pending',
  }
}

/**
 * Prefer non-null structured state; if malformed, return null (caller reconstructs).
 */
export function pickConversationState(
  local: Record<string, unknown> | null | undefined,
  remote: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  const a = local && typeof local === 'object' && !Array.isArray(local) ? local : null
  const b = remote && typeof remote === 'object' && !Array.isArray(remote) ? remote : null
  if (a && b) {
    // Prefer richer / newer-looking local when both exist.
    const aKeys = Object.keys(a).length
    const bKeys = Object.keys(b).length
    return aKeys >= bKeys ? a : b
  }
  return a || b
}

/**
 * Safe reconstruction stub when Conversation State is missing/malformed.
 * Not Memory — just a minimal working envelope derived from recent messages.
 */
export function reconstructConversationStateFromMessages(
  messages: PersistedChatMessage[],
  conversationId: string,
): Record<string, unknown> {
  const recent = (messages || []).filter((m) => m.kind !== 'error').slice(-12)
  const lastUser = [...recent].reverse().find((m) => m.role === 'user')
  return {
    version: 1,
    conversationId,
    reconstructed: true,
    activeTopic: null,
    recentMessageCount: recent.length,
    lastUserPreview: lastUser?.content?.slice(0, 120) || null,
    updatedAt: Date.now(),
  }
}

export function isUsableConversationState(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}
