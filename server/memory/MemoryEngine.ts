/**
 * BrAIn Memory Engine — architecture surface only.
 *
 * Methods return placeholders. No database, no OpenAI, no callers yet.
 */

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

export class MemoryEngine {
  async analyzeConversation(
    _messages: ConversationMessage[],
  ): Promise<ConversationAnalysis> {
    return {
      topics: [],
      summary: '',
      signals: [],
    }
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
