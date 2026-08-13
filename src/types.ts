import type { ThemeDefinition } from './lib/themes'
import { DEFAULT_THEME_ID } from './lib/themes'

export type AppView = 'chat' | 'memory' | 'vision'

export type MessageRole = 'user' | 'assistant' | 'system'

/** V2 debug snapshot attached to assistant messages when experimental mode is on. */
export interface V2DebugInfo {
  servedBy: 'v2' | 'v1-fallback'
  error?: string
  perception?: Record<string, unknown>
  decision?: Record<string, unknown>
  plan?: Record<string, unknown>
  writer?: {
    draft?: string
    final?: string
    rewritten?: boolean
    model?: string
    providerId?: string
  }
  reviewer?: Record<string, unknown>
  timing?: {
    totalMs?: number
    writerMs?: number
    reviewerMs?: number
  }
  score?: number
  reviewDecision?: 'PASS' | 'REWRITE' | string
}

export interface ChatMessage {
  id: string
  role: MessageRole
  content: string
  createdAt: number
  /** When set, render as an error notice rather than a normal assistant reply. */
  kind?: 'error'
  /** Present when Developer → LAIfe V2 Experimental is ON for that turn. */
  v2Debug?: V2DebugInfo
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

/** Developer-only preferences (device-local). */
export interface DeveloperSettings {
  /**
   * When true, chat requests send engine=v2 (client preference).
   * Server routing still follows LAIFE_CONVERSATION_RUNTIME.
   */
  v2Experimental: boolean
}

export interface AppSettings {
  personalization: PersonalizationSettings
  theme: ThemeSettings
  developer: DeveloperSettings
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

export const DEFAULT_DEVELOPER_SETTINGS: DeveloperSettings = {
  v2Experimental: false,
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
