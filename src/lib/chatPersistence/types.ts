import type { ChatMessage } from '../../types'

export type SyncStatus = 'synced' | 'pending' | 'error'

export type ChatEngine = 'v1' | 'v2' | string

export interface PersistedChatMessage extends ChatMessage {
  syncStatus?: SyncStatus
  /** Server UUID when known (may differ from client id). */
  serverId?: string
}

export interface CachedConversation {
  conversationId: string
  title: string
  messages: PersistedChatMessage[]
  updatedAt: number
  createdAt: number
  engine: ChatEngine
  /** V2 working Conversation State — session continuity, not long-term Memory. */
  conversationState?: Record<string, unknown> | null
  syncStatus: SyncStatus
}

export interface ConversationIndexEntry {
  conversationId: string
  title: string
  updatedAt: number
  createdAt: number
  engine: ChatEngine
  syncStatus: SyncStatus
  messageCount: number
}

export interface ConversationIndex {
  version: 1
  activeConversationId: string | null
  conversations: Record<string, ConversationIndexEntry>
}
