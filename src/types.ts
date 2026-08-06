import type { ThemeDefinition } from './lib/themes'
import { DEFAULT_THEME_ID } from './lib/themes'

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

export interface ThemeSettings {
  /** Active theme id (builtin or custom). */
  activeThemeId: string
  /** User-created themes stored on this device. */
  customThemes: ThemeDefinition[]
}

export interface AppSettings {
  personalization: PersonalizationSettings
  theme: ThemeSettings
}

export const DEFAULT_PERSONALIZATION: PersonalizationSettings = {
  displayName: '',
  tone: 'warm',
  replyLength: 'concise',
  useEmojis: true,
  customInstructions: '',
}

export const DEFAULT_THEME_SETTINGS: ThemeSettings = {
  activeThemeId: DEFAULT_THEME_ID,
  customThemes: [],
}
