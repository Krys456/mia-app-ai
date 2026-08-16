/**
 * UI-only appearance tokens (#270).
 * Applied via CSS variables — never sent to Core / Memory.
 */

import {
  DEFAULT_APPEARANCE_SETTINGS,
  isAppearanceFontFamily,
  isAppearanceFontSize,
  type AppearanceFontFamily,
  type AppearanceFontSize,
  type AppearanceSettings,
} from '../types'

export const FONT_SIZE_SCALE: Record<AppearanceFontSize, number> = {
  small: 0.92,
  default: 1,
  large: 1.12,
}

export const FONT_FAMILY_STACK: Record<AppearanceFontFamily, string> = {
  outfit: "'Outfit', ui-sans-serif, system-ui, sans-serif",
  system: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
}

export function normalizeAppearance(
  raw: Partial<AppearanceSettings> | undefined | null,
): AppearanceSettings {
  return {
    fontSize: isAppearanceFontSize(raw?.fontSize)
      ? raw.fontSize
      : DEFAULT_APPEARANCE_SETTINGS.fontSize,
    fontFamily: isAppearanceFontFamily(raw?.fontFamily)
      ? raw.fontFamily
      : DEFAULT_APPEARANCE_SETTINGS.fontFamily,
  }
}

/** Write appearance CSS variables onto :root. Safe in SSR/tests (no-op without document). */
export function applyAppearanceToDocument(appearance: AppearanceSettings): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  const scale = FONT_SIZE_SCALE[appearance.fontSize] ?? 1
  root.style.setProperty('--chat-font-scale', String(scale))
  root.style.setProperty('--font-sans', FONT_FAMILY_STACK[appearance.fontFamily])
  root.dataset.fontSize = appearance.fontSize
  root.dataset.fontFamily = appearance.fontFamily
}
