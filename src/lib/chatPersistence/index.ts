/**
 * LAIfe chat persistence — public client API.
 */

export type {
  CachedConversation,
  ConversationIndex,
  ConversationIndexEntry,
  ChatEngine,
  PersistedChatMessage,
  SyncStatus,
} from './types'

export {
  clearChatPersistenceForTests,
  createConversationId,
  createMessageId,
  deleteCachedConversation,
  deriveTitle,
  getActiveConversationId,
  listCachedConversations,
  loadActiveConversationForStartup,
  loadCachedConversation,
  loadConversationIndex,
  persistActiveSnapshot,
  saveCachedConversation,
  setActiveConversationId,
} from './localCache'

export {
  isUsableConversationState,
  pickConversationState,
  reconcileConversations,
  reconcileMessages,
  reconstructConversationStateFromMessages,
} from './reconcile'

export {
  enqueueConversationSync,
  explicitDeleteConversation,
  flushConversationSync,
  installOnlineRetryListener,
  persistMessagesNow,
  reconcileActiveWithRemote,
  retryAllUnsynced,
} from './sync'
