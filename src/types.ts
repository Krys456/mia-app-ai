export type MessageRole = 'user' | 'assistant' | 'system'

export interface ChatMessage {
  id: string
  role: MessageRole
  content: string
  createdAt: number
}

export interface PersonalizationSettings {
  displayName: string
  tone: 'warm' | 'playful' | 'professional' | 'calm'
  replyLength: 'concise' | 'balanced' | 'detailed'
  useEmojis: boolean
  customInstructions: string
}

export interface AppSettings {
  personalization: PersonalizationSettings
}

export const DEFAULT_PERSONALIZATION: PersonalizationSettings = {
  displayName: '',
  tone: 'warm',
  replyLength: 'concise',
  useEmojis: true,
  customInstructions: '',
}
