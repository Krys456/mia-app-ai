/**
 * #358D — Canonical theme persistence helpers (localStorage settings blob).
 *
 * Source of truth: `theme.activeThemeId` inside `laife.settings.v2`
 * (legacy fallback: `laife.settings.v1`).
 *
 * Precedence:
 * 1. Explicit saved `activeThemeId` (any builtin/custom id)
 * 2. Else DEFAULT = The Way — Washi (`the-way-washi`)
 *
 * Never consults OS / system dark preference.
 * OAuth return query handlers must not write theme.
 */

import { DEFAULT_THEME_ID } from './themes'

/** Same key ChatContext uses for AppSettings. */
export const SETTINGS_STORAGE_KEY = 'laife.settings.v2'
export const SETTINGS_STORAGE_KEY_LEGACY = 'laife.settings.v1'

export type ThemeStorageLike = {
  getItem(key: string): string | null
  setItem?(key: string, value: string): void
}

/** Product default when no preference is stored. */
export const DEFAULT_PERSISTED_THEME_ID = DEFAULT_THEME_ID

/**
 * Extract activeThemeId from a settings JSON string.
 * Invalid / missing → WASHI. Never invents SUMI from system preference.
 */
export function resolveActiveThemeIdFromSettingsJson(
  raw: string | null | undefined,
): string {
  if (typeof raw !== 'string' || !raw.trim()) return DEFAULT_PERSISTED_THEME_ID
  try {
    const parsed = JSON.parse(raw) as { theme?: { activeThemeId?: unknown } }
    const id = parsed?.theme?.activeThemeId
    if (typeof id === 'string' && id.trim()) return id.trim()
    return DEFAULT_PERSISTED_THEME_ID
  } catch {
    return DEFAULT_PERSISTED_THEME_ID
  }
}

/** Read persisted theme id from the canonical settings store. */
export function readPersistedActiveThemeId(
  storage?: ThemeStorageLike | null,
): string {
  const store =
    storage ??
    (typeof globalThis !== 'undefined' &&
    'localStorage' in globalThis &&
    globalThis.localStorage
      ? (globalThis.localStorage as ThemeStorageLike)
      : null)
  if (!store) return DEFAULT_PERSISTED_THEME_ID
  try {
    const raw =
      store.getItem(SETTINGS_STORAGE_KEY) ?? store.getItem(SETTINGS_STORAGE_KEY_LEGACY)
    return resolveActiveThemeIdFromSettingsJson(raw)
  } catch {
    return DEFAULT_PERSISTED_THEME_ID
  }
}

/**
 * Simulate full navigation return: settings blob unchanged; only OAuth
 * query flags are stripped (calendar/email). Theme id must be identical.
 */
export function themeIdAfterOAuthReturnNavigation(opts: {
  settingsJsonBefore: string | null
  returnSearch: string
}): { themeId: string; searchAfter: string } {
  const themeId = resolveActiveThemeIdFromSettingsJson(opts.settingsJsonBefore)
  const params = new URLSearchParams(
    opts.returnSearch.startsWith('?') ? opts.returnSearch.slice(1) : opts.returnSearch,
  )
  // Mirror calendarApi / emailApi consume*ReturnQuery — strip flags only.
  params.delete('calendar')
  params.delete('email')
  params.delete('code')
  const qs = params.toString()
  return { themeId, searchAfter: qs ? `?${qs}` : '' }
}

/** Known dark builtins for early boot color-scheme (custom themes wait for React). */
const EARLY_BOOT_DARK_IDS = new Set([
  'the-way-sumi',
  'laife',
  'dark',
  'amoled',
  'ocean',
  'forest',
  'sunset',
  'royal',
  'cyber',
  'midnight',
])

/**
 * Apply data-theme + color-scheme on <html> before React paint.
 * Does not rewrite localStorage. Safe for OAuth return / PWA reopen / refresh.
 */
export function bootstrapDocumentThemeFromStorage(
  doc: Document = document,
  storage?: ThemeStorageLike | null,
): string {
  const id = readPersistedActiveThemeId(storage)
  const root = doc.documentElement
  root.dataset.theme = id
  const scheme = EARLY_BOOT_DARK_IDS.has(id) ? 'dark' : 'light'
  root.style.colorScheme = scheme
  root.dataset.colorScheme = scheme
  const meta = doc.querySelector('meta[name="theme-color"]')
  if (meta) {
    if (id === 'the-way-washi') meta.setAttribute('content', '#F5F0E6')
    else if (id === 'the-way-sumi') meta.setAttribute('content', '#100E0C')
  }
  return id
}
