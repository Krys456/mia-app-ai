/**
 * BrAIn Memory Engine
 *
 * Rule-based conversation analysis. No database, no OpenAI, no callers yet.
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

/** Decision produced by analyzeConversation — not persisted by this engine. */
export type MemoryDecision = {
  save: boolean
  category: string
  title: string
  content: string
  importance: number
}

const NO_SAVE: MemoryDecision = {
  save: false,
  category: '',
  title: '',
  content: '',
  importance: 0,
}

/** Matches phrases like "My name is Cristian". */
const NAME_PATTERN = /my\s+name\s+is\s+([^\n.!?,;:]+)/i

function extractLatestByRole(
  messages: ConversationMessage[],
  role: string,
): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === role) {
      return messages[i].content ?? ''
    }
  }
  return ''
}

export class MemoryEngine {
  /**
   * Inspect the latest user message and assistant response.
   * Simple rule-based decisions only — does not save anything.
   */
  async analyzeConversation(
    messages: ConversationMessage[],
  ): Promise<MemoryDecision> {
    const userMessage = extractLatestByRole(messages, 'user').trim()
    const assistantResponse = extractLatestByRole(messages, 'assistant').trim()

    // Assistant reply is inspected for presence; rules currently key off the user turn.
    if (!userMessage) {
      return { ...NO_SAVE }
    }
    void assistantResponse

    const nameMatch = userMessage.match(NAME_PATTERN)
    if (nameMatch?.[1]) {
      const name = nameMatch[1].trim()
      if (name) {
        return {
          save: true,
          category: 'identity',
          title: 'Name',
          content: `User's name is ${name}.`,
          importance: 8,
        }
      }
    }

    return { ...NO_SAVE }
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
