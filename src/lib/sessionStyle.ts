/**
 * #326 — Client session style ownership (Core-only).
 * Fingerprint helpers live in lib/server/conversation-state.js (shared pure JS).
 * Lifetime: React state + optional sessionStorage (same tab). Never Memory/localStorage.
 */

import {
  collectSessionStyleFingerprints as collectServer,
  createEmptySessionStyleState as emptyServer,
  rollbackLastSessionStyleFingerprint as rollbackServer,
  sanitizeSessionStyleState as sanitizeServer,
} from '../../lib/server/conversation-state.js'

export interface SessionStyleState {
  lastResponseLengthBucket: 'short' | 'medium' | 'long' | null
  lastEndingWasQuestion: boolean | null
  recentOpeningTypes: string[]
  recentAcknowledgementTypes: string[]
  recentFirstPhrases: string[]
  recentEndingTypes: string[]
  recentEmojis: string[]
  recentStructureTypes: string[]
}

export const SESSION_STYLE_STORAGE_KEY = 'shinkaido:sessionStyle:v1'

export function createEmptySessionStyleState(): SessionStyleState {
  return emptyServer() as SessionStyleState
}

export function sanitizeSessionStyleState(raw: unknown): SessionStyleState {
  return sanitizeServer(raw) as SessionStyleState
}

export function collectSessionStyleFingerprints(
  assistantText: string,
  prev?: SessionStyleState | null,
): SessionStyleState {
  return collectServer(assistantText, prev) as SessionStyleState
}

export function rollbackLastSessionStyleFingerprint(
  prev?: SessionStyleState | null,
): SessionStyleState {
  return rollbackServer(prev) as SessionStyleState
}

/** Load session-only style from sessionStorage (same tab). */
export function loadSessionStyleFromStorage(): SessionStyleState {
  try {
    if (typeof sessionStorage === 'undefined') return createEmptySessionStyleState()
    const raw = sessionStorage.getItem(SESSION_STYLE_STORAGE_KEY)
    if (!raw) return createEmptySessionStyleState()
    return sanitizeSessionStyleState(JSON.parse(raw) as unknown)
  } catch {
    return createEmptySessionStyleState()
  }
}

/** Persist session-only style (tab session). Cleared on new chat. */
export function saveSessionStyleToStorage(style: SessionStyleState): void {
  try {
    if (typeof sessionStorage === 'undefined') return
    sessionStorage.setItem(
      SESSION_STYLE_STORAGE_KEY,
      JSON.stringify(sanitizeSessionStyleState(style)),
    )
  } catch {
    /* ignore quota / private mode */
  }
}

export function clearSessionStyleStorage(): void {
  try {
    if (typeof sessionStorage === 'undefined') return
    sessionStorage.removeItem(SESSION_STYLE_STORAGE_KEY)
  } catch {
    /* ignore */
  }
}

/**
 * Update after a successful Core assistant reply only.
 * Empty / whitespace replies do not mutate state.
 */
export function applyCoreAssistantStyleUpdate(
  prev: SessionStyleState | null | undefined,
  assistantText: string,
): SessionStyleState {
  const text = String(assistantText || '').trim()
  if (!text) return sanitizeSessionStyleState(prev)
  return collectSessionStyleFingerprints(text, prev)
}

/** Regenerate: drop last Core fingerprint so the replacement does not double-count. */
export function applyRegenerateStyleRollback(
  prev: SessionStyleState | null | undefined,
): SessionStyleState {
  return rollbackLastSessionStyleFingerprint(prev)
}
