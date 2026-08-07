/**
 * Extensible local feedback store for assistant messages.
 * Ready to swap the persistence layer for a remote API later.
 */

export type MessageFeedbackValue = 'up' | 'down'

export type MessageFeedbackRecord = {
  messageId: string
  value: MessageFeedbackValue
  updatedAt: number
}

export type MessageFeedbackListener = (messageId: string, value: MessageFeedbackValue | null) => void

const STORAGE_KEY = 'laife.messageFeedback.v1'

type StoreShape = Record<string, MessageFeedbackRecord>

const listeners = new Set<MessageFeedbackListener>()

function readStore(): StoreShape {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as StoreShape
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeStore(store: StoreShape) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
  } catch {
    /* ignore quota / private mode */
  }
}

function emit(messageId: string, value: MessageFeedbackValue | null) {
  for (const listener of listeners) listener(messageId, value)
}

export function getMessageFeedback(messageId: string): MessageFeedbackValue | null {
  return readStore()[messageId]?.value ?? null
}

/**
 * Set feedback for a message. Passing the same value again clears it (toggle).
 */
export function setMessageFeedback(
  messageId: string,
  value: MessageFeedbackValue,
): MessageFeedbackValue | null {
  const store = readStore()
  const current = store[messageId]?.value ?? null

  if (current === value) {
    delete store[messageId]
    writeStore(store)
    emit(messageId, null)
    return null
  }

  store[messageId] = {
    messageId,
    value,
    updatedAt: Date.now(),
  }
  writeStore(store)
  emit(messageId, value)
  return value
}

export function subscribeMessageFeedback(listener: MessageFeedbackListener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Hook-friendly snapshot of all feedback (for future analytics export). */
export function listMessageFeedback(): MessageFeedbackRecord[] {
  return Object.values(readStore()).sort((a, b) => b.updatedAt - a.updatedAt)
}
