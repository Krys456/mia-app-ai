/**
 * BrAIn Memory Classifier — architecture surface only.
 *
 * Real AI classification (OpenAI) will plug in here later.
 * This file defines the contract; no model calls yet.
 */

export type ClassifierMessage = {
  role: string
  content: string
}

/** Conversation payload passed to the classifier. */
export type ClassifierConversation = {
  messages: ClassifierMessage[]
}

/**
 * Classifier output / memory decision.
 * `importance` is an integer (intended range 1–10 when save is true).
 */
export type MemoryClassification = {
  save: boolean
  category: string
  title: string
  content: string
  importance: number
}

/**
 * AI classifier contract.
 * Implementations analyze a conversation and decide whether to save a memory.
 */
export interface MemoryClassifier {
  classify(conversation: ClassifierConversation): Promise<MemoryClassification>
}
