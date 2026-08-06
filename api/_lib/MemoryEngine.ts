/**
 * BrAIn Memory Engine — rule-based analysis via brain-memory runtime.
 */

import { analyzeConversation, type MemoryDecision } from './brain-memory'

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

export type { MemoryDecision }

export class MemoryEngine {
  async analyzeConversation(
    messages: ConversationMessage[],
  ): Promise<MemoryDecision> {
    let userMessage = ''
    let assistantMessage = ''

    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const msg = messages[i]
      if (!userMessage && msg?.role === 'user') userMessage = msg.content ?? ''
      if (!assistantMessage && msg?.role === 'assistant') {
        assistantMessage = msg.content ?? ''
      }
      if (userMessage && assistantMessage) break
    }

    return analyzeConversation(userMessage, assistantMessage)
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
