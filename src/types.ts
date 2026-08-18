import type { ThemeDefinition } from './lib/themes'
import { DEFAULT_THEME_ID } from './lib/themes'

export type AppView = 'chat' | 'memory' | 'vision' | 'privacy' | 'reminders'

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
  /** Visible caption / body text. Never a data URL. */
  content: string
  createdAt: number
  /** Optional attachments (#272 image / #275 PDF). Max 1; image XOR file. */
  attachments?: ChatAttachment[]
  /**
   * #291 optional normalized web citations for Fonti UI.
   * Session-scoped with the message — not a DB field; never sent back as model input.
   */
  citations?: WebCitation[]
  /** When set, render as an error notice rather than a normal assistant reply. */
  kind?: 'error'
  /** Legacy V2 debug payload (unused on Core path; kept for typed message compat). */
  v2Debug?: V2DebugInfo
  /**
   * Ephemeral Memory feedback for THIS assistant completion (#281).
   * Session-scoped with the message — not a DB/chat persistence field.
   */
  memoryEvent?: {
    type: 'created' | 'updated' | 'removed'
    displayText?: string
  }
}

/** #291 normalized citation from provider url_citation annotations. */
export interface WebCitation {
  title: string
  url: string
  startIndex?: number
  endIndex?: number
}

/** Session-scoped image attachment on a chat message (#272). */
export type SupportedImageMime = 'image/jpeg' | 'image/png' | 'image/webp'

export interface ChatImageAttachment {
  id: string
  kind: 'image'
  mimeType: SupportedImageMime
  /** Compressed data URL for Core / regenerate / follow-up. */
  dataUrl: string
  /** Optional blob: or data: preview for UI. */
  previewUrl?: string
  width?: number
  height?: number
  /**
   * #289 session-only provenance.
   * `generated` / `edited` = server tool result (assistant replay).
   * `uploaded` = user-provided (default when omitted).
   * Not a security boundary alone — replay requires artifactProof.
   */
  source?: 'generated' | 'edited' | 'uploaded'
  /** Server HMAC proof required for assistant history replay (#289). */
  artifactProof?: string
}

/** Supported document MIME union (#275 PDF + #276 TXT/DOCX). */
export type SupportedDocumentMime =
  | 'application/pdf'
  | 'text/plain'
  | 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

/** Session-scoped document attachment — metadata + OpenAI fileId only (no bytes). */
export interface ChatFileAttachment {
  id: string
  kind: 'file'
  name: string
  mimeType: SupportedDocumentMime
  size: number
  fileId: string
  expiresAt?: number
}

export type ChatAttachment = ChatImageAttachment | ChatFileAttachment

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

/**
 * UI-only reading preferences (#270).
 * Never sent to /api/chat and never stored as Memory.
 */
export type AppearanceFontSize = 'small' | 'default' | 'large'
export type AppearanceFontFamily = 'outfit' | 'system'

export interface AppearanceSettings {
  fontSize: AppearanceFontSize
  fontFamily: AppearanceFontFamily
}

/** Developer-only preferences (device-local). Kept for settings migration compat. */
export interface DeveloperSettings {
  /**
   * Legacy flag (pre-Core). UI removed in #269; Core ignores this.
   * Still normalized from localStorage so old devices don't break settings load.
   */
  v2Experimental: boolean
}

export interface AppSettings {
  personalization: PersonalizationSettings
  theme: ThemeSettings
  appearance: AppearanceSettings
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

export const DEFAULT_APPEARANCE_SETTINGS: AppearanceSettings = {
  fontSize: 'default',
  fontFamily: 'outfit',
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

export function isAppearanceFontSize(value: unknown): value is AppearanceFontSize {
  return value === 'small' || value === 'default' || value === 'large'
}

export function isAppearanceFontFamily(value: unknown): value is AppearanceFontFamily {
  return value === 'outfit' || value === 'system'
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
