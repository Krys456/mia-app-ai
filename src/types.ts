import type { ThemeDefinition } from './lib/themes'
import { DEFAULT_THEME_ID } from './lib/themes'

export type AppView = 'chat' | 'memory' | 'vision'

export type MessageRole = 'user' | 'assistant' | 'system'

export interface ChatMessage {
  id: string
  role: MessageRole
  content: string
  createdAt: number
  /** When set, render as an error notice rather than a normal assistant reply. */
  kind?: 'error'
}

/** Soft style bias for the Dynamic Behavior Model (not a fixed persona). */
export type PersonalityMode =
  | 'automatic'
  | 'friendly'
  | 'professional'
  | 'teacher'
  | 'analytical'
  | 'motivational'

export const PERSONALITY_MODES: readonly PersonalityMode[] = [
  'automatic',
  'friendly',
  'professional',
  'teacher',
  'analytical',
  'motivational',
] as const

export interface PersonalizationSettings {
  displayName: string
  /**
   * Soft style bias only. Behavior is selected dynamically each turn
   * (conversation / explanation / brainstorming / planning / technical help /
   * emotional support / collaboration). Prefer `automatic`.
   */
  personality: PersonalityMode
  replyLength: 'concise' | 'balanced' | 'detailed'
  useEmojis: boolean
  customInstructions: string
  /** When false, chat never reads or writes memories. */
  memoryEnabled: boolean
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
  personality: 'automatic',
  replyLength: 'balanced',
  useEmojis: true,
  customInstructions: '',
  memoryEnabled: true,
}

export const DEFAULT_THEME_SETTINGS: ThemeSettings = {
  activeThemeId: DEFAULT_THEME_ID,
  customThemes: [],
}

export function isPersonalityMode(value: unknown): value is PersonalityMode {
  return (
    typeof value === 'string' &&
    (PERSONALITY_MODES as readonly string[]).includes(value)
  )
}

/** Map legacy tone values (pre-personality) onto the new modes. */
export function migrateLegacyTone(tone: unknown): PersonalityMode | null {
  switch (tone) {
    case 'warm':
    case 'playful':
      return 'friendly'
    case 'professional':
      return 'professional'
    case 'calm':
      return 'automatic'
    default:
      return null
  }
}
