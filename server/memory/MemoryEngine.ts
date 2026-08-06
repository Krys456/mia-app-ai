/**
 * BrAIn Memory Engine
 *
 * Delegates conversation analysis to a MemoryClassifier.
 * No hardcoded save rules and no OpenAI calls in this layer.
 */

import type {
  ClassifierConversation,
  MemoryClassification,
  MemoryClassifier,
} from './MemoryClassifier'

export type ConversationMessage = {
  role: string
  content: string
}

export type ConversationAnalysis = {
  topics: string[]
  summary: string
  signals: string[]
}

export type MemoryObject = {
  category: string
  title: string
  content: string
  importance: number
}

/** Decision produced by analyzeConversation — not persisted by this engine. */
export type MemoryDecision = MemoryClassification

const NO_SAVE: MemoryDecision = {
  save: false,
  category: '',
  title: '',
  content: '',
  importance: 0,
}

/**
 * Temporary no-op classifier used until a real AI implementation is wired.
 * Always returns save=false. Not an AI model.
 */
class UnimplementedMemoryClassifier implements MemoryClassifier {
  async classify(_conversation: ClassifierConversation): Promise<MemoryClassification> {
    return { ...NO_SAVE }
  }
}

export class MemoryEngine {
  private readonly classifier: MemoryClassifier

  constructor(classifier?: MemoryClassifier) {
    this.classifier = classifier ?? new UnimplementedMemoryClassifier()
  }

  /**
   * Analyze a conversation via the injected MemoryClassifier.
   * Does not save anything.
   */
  async analyzeConversation(
    messages: ConversationMessage[],
  ): Promise<MemoryDecision> {
    return this.classifier.classify({ messages })
  }

  async shouldSave(_analysis: ConversationAnalysis): Promise<boolean> {
    return false
  }

  async buildMemoryObject(
    _analysis: ConversationAnalysis,
  ): Promise<MemoryObject> {
    return {
      category: '',
      title: '',
      content: '',
      importance: 0,
    }
  }
}
