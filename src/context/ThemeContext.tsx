/* eslint-disable react-refresh/only-export-components -- ThemeProvider + useTheme share one module */
import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  type ReactNode,
} from 'react'
import {
  applyThemeToDocument,
  BUILTIN_THEMES,
  createBlankCustomTheme,
  createCustomThemeId,
  resolveTheme,
  type ThemeColors,
  type ThemeDefinition,
} from '../lib/themes'
import type { ThemeSettings } from '../types'
import { useChat } from './ChatContext'

interface ThemeContextValue {
  settings: ThemeSettings
  activeTheme: ThemeDefinition
  builtinThemes: ThemeDefinition[]
  customThemes: ThemeDefinition[]
  setActiveTheme: (themeId: string) => void
  saveCustomTheme: (theme: ThemeDefinition) => void
  updateCustomTheme: (themeId: string, patch: Partial<ThemeDefinition>) => void
  deleteCustomTheme: (themeId: string) => void
  createCustomThemeFromActive: () => ThemeDefinition
  previewTheme: (theme: ThemeDefinition) => void
  clearPreview: () => void
  resetToOfficial: () => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { settings, updateTheme } = useChat()
  const themeSettings = settings.theme

  const activeTheme = useMemo(
    () => resolveTheme(themeSettings.activeThemeId, themeSettings.customThemes),
    [themeSettings.activeThemeId, themeSettings.customThemes],
  )

  useLayoutEffect(() => {
    applyThemeToDocument(activeTheme)
  }, [activeTheme])

  const setActiveTheme = useCallback(
    (themeId: string) => {
      updateTheme({ activeThemeId: themeId })
    },
    [updateTheme],
  )

  const saveCustomTheme = useCallback(
    (theme: ThemeDefinition) => {
      const next: ThemeDefinition = {
        ...theme,
        id: theme.id || createCustomThemeId(),
        builtin: false,
        official: false,
        description: theme.description || 'Custom palette',
      }
      const existing = themeSettings.customThemes.filter((t) => t.id !== next.id)
      updateTheme({
        customThemes: [...existing, next],
        activeThemeId: next.id,
      })
    },
    [themeSettings.customThemes, updateTheme],
  )

  const updateCustomTheme = useCallback(
    (themeId: string, patch: Partial<ThemeDefinition>) => {
      const customThemes = themeSettings.customThemes.map((t) => {
        if (t.id !== themeId) return t
        return {
          ...t,
          ...patch,
          colors: patch.colors ? { ...t.colors, ...patch.colors } : t.colors,
          builtin: false,
          official: false,
        }
      })
      updateTheme({ customThemes })
    },
    [themeSettings.customThemes, updateTheme],
  )

  const deleteCustomTheme = useCallback(
    (themeId: string) => {
      const customThemes = themeSettings.customThemes.filter((t) => t.id !== themeId)
      const activeThemeId =
        themeSettings.activeThemeId === themeId
          ? 'laife'
          : themeSettings.activeThemeId
      updateTheme({ customThemes, activeThemeId })
    },
    [themeSettings.activeThemeId, themeSettings.customThemes, updateTheme],
  )

  const createCustomThemeFromActive = useCallback(
    () => createBlankCustomTheme(activeTheme),
    [activeTheme],
  )

  const previewTheme = useCallback((theme: ThemeDefinition) => {
    applyThemeToDocument(theme)
  }, [])

  const clearPreview = useCallback(() => {
    applyThemeToDocument(activeTheme)
  }, [activeTheme])

  const resetToOfficial = useCallback(() => {
    updateTheme({ activeThemeId: 'laife' })
  }, [updateTheme])

  const value = useMemo<ThemeContextValue>(
    () => ({
      settings: themeSettings,
      activeTheme,
      builtinThemes: BUILTIN_THEMES,
      customThemes: themeSettings.customThemes,
      setActiveTheme,
      saveCustomTheme,
      updateCustomTheme,
      deleteCustomTheme,
      createCustomThemeFromActive,
      previewTheme,
      clearPreview,
      resetToOfficial,
    }),
    [
      themeSettings,
      activeTheme,
      setActiveTheme,
      saveCustomTheme,
      updateCustomTheme,
      deleteCustomTheme,
      createCustomThemeFromActive,
      previewTheme,
      clearPreview,
      resetToOfficial,
    ],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}

export type { ThemeColors, ThemeDefinition }
