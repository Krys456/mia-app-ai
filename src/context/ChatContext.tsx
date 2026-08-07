/* eslint-disable react-refresh/only-export-components -- ChatProvider + useChat share one module */
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  type ReactNode,
} from 'react'
import { requestChatCompletion, type ChatApiMessage } from '../lib/chatApi'
import { buildSystemPrompt } from '../lib/personality'
import { getOrCreateUserId } from '../lib/userId'
import type { ThemeDefinition } from '../lib/themes'
import {
  DEFAULT_PERSONALIZATION,
  DEFAULT_THEME_SETTINGS,
  type AppSettings,
  type ChatMessage,
  type PersonalizationSettings,
  type ThemeSettings,
} from '../types'

const STORAGE_KEY = 'laife.settings.v2'

function sanitizeCustomThemes(raw: unknown): ThemeDefinition[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((item): item is ThemeDefinition => {
      if (!item || typeof item !== 'object') return false
      const t = item as ThemeDefinition
      return (
        typeof t.id === 'string' &&
        typeof t.name === 'string' &&
        t.builtin === false &&
        !!t.colors &&
        typeof t.colors.bg === 'string'
      )
    })
    .map((t) => ({
      ...t,
      builtin: false,
      official: false,
      description: t.description || 'Custom palette',
      colorScheme: t.colorScheme === 'light' ? 'light' : 'dark',
      colors: {
        bg: t.colors.bg,
        surface: t.colors.surface,
        surface2: t.colors.surface2,
        text: t.colors.text,
        textMuted: t.colors.textMuted,
        accent: t.colors.accent,
        accentSecondary: t.colors.accentSecondary,
        accentTertiary: t.colors.accentTertiary,
        accentQuaternary: t.colors.accentQuaternary,
      },
    }))
}

function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem('laife.settings.v1')
    if (!raw) {
      return {
        personalization: { ...DEFAULT_PERSONALIZATION },
        theme: { ...DEFAULT_THEME_SETTINGS, customThemes: [] },
      }
    }
    const parsed = JSON.parse(raw) as Partial<AppSettings> & {
      theme?: Partial<ThemeSettings>
    }
    return {
      personalization: {
        ...DEFAULT_PERSONALIZATION,
        ...parsed.personalization,
        memoryEnabled: parsed.personalization?.memoryEnabled !== false,
      },
      theme: {
        activeThemeId: parsed.theme?.activeThemeId ?? DEFAULT_THEME_SETTINGS.activeThemeId,
        customThemes: sanitizeCustomThemes(parsed.theme?.customThemes),
      },
    }
  } catch {
    return {
      personalization: { ...DEFAULT_PERSONALIZATION },
      theme: { ...DEFAULT_THEME_SETTINGS, customThemes: [] },
    }
  }
}

function saveSettings(settings: AppSettings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    /* ignore quota / private mode */
  }
}

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`
}

interface AppState {
  messages: ChatMessage[]
  settings: AppSettings
  settingsOpen: boolean
  isThinking: boolean
}

type Action =
  | { type: 'NEW_CHAT' }
  | { type: 'OPEN_SETTINGS' }
  | { type: 'CLOSE_SETTINGS' }
  | { type: 'TOGGLE_SETTINGS' }
  | { type: 'UPDATE_PERSONALIZATION'; payload: Partial<PersonalizationSettings> }
  | { type: 'UPDATE_THEME'; payload: Partial<ThemeSettings> }
  | { type: 'SEND_USER'; content: string }
  | { type: 'ASSISTANT_DONE'; content: string }
  | { type: 'ASSISTANT_FAIL'; error: string }

function createInitialState(): AppState {
  return {
    messages: [],
    settings: loadSettings(),
    settingsOpen: false,
    isThinking: false,
  }
}

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'NEW_CHAT':
      return {
        ...state,
        messages: [],
        isThinking: false,
        settingsOpen: false,
      }
    case 'OPEN_SETTINGS':
      return { ...state, settingsOpen: true }
    case 'CLOSE_SETTINGS':
      return { ...state, settingsOpen: false }
    case 'TOGGLE_SETTINGS':
      return { ...state, settingsOpen: !state.settingsOpen }
    case 'UPDATE_PERSONALIZATION': {
      const next: AppSettings = {
        ...state.settings,
        personalization: {
          ...state.settings.personalization,
          ...action.payload,
        },
      }
      saveSettings(next)
      return { ...state, settings: next }
    }
    case 'UPDATE_THEME': {
      const next: AppSettings = {
        ...state.settings,
        theme: {
          ...state.settings.theme,
          ...action.payload,
          customThemes: action.payload.customThemes ?? state.settings.theme.customThemes,
        },
      }
      saveSettings(next)
      return { ...state, settings: next }
    }
    case 'SEND_USER': {
      const userMsg: ChatMessage = {
        id: uid(),
        role: 'user',
        content: action.content,
        createdAt: Date.now(),
      }
      return {
        ...state,
        messages: [...state.messages, userMsg],
        isThinking: true,
      }
    }
    case 'ASSISTANT_DONE': {
      const assistantMsg: ChatMessage = {
        id: uid(),
        role: 'assistant',
        content: action.content,
        createdAt: Date.now(),
      }
      return {
        ...state,
        messages: [...state.messages, assistantMsg],
        isThinking: false,
      }
    }
    case 'ASSISTANT_FAIL': {
      const assistantMsg: ChatMessage = {
        id: uid(),
        role: 'assistant',
        content: action.error,
        createdAt: Date.now(),
      }
      return {
        ...state,
        messages: [...state.messages, assistantMsg],
        isThinking: false,
      }
    }
    default:
      return state
  }
}

interface ChatContextValue {
  messages: ChatMessage[]
  settings: AppSettings
  settingsOpen: boolean
  isThinking: boolean
  systemPrompt: string
  newChat: () => void
  openSettings: () => void
  closeSettings: () => void
  toggleSettings: () => void
  updatePersonalization: (patch: Partial<PersonalizationSettings>) => void
  updateTheme: (patch: Partial<ThemeSettings>) => void
  sendMessage: (content: string) => void
}

const ChatContext = createContext<ChatContextValue | null>(null)

export function ChatProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, createInitialState)

  const newChat = useCallback(() => dispatch({ type: 'NEW_CHAT' }), [])
  const openSettings = useCallback(() => dispatch({ type: 'OPEN_SETTINGS' }), [])
  const closeSettings = useCallback(() => dispatch({ type: 'CLOSE_SETTINGS' }), [])
  const toggleSettings = useCallback(() => dispatch({ type: 'TOGGLE_SETTINGS' }), [])

  const updatePersonalization = useCallback(
    (payload: Partial<PersonalizationSettings>) => {
      dispatch({ type: 'UPDATE_PERSONALIZATION', payload })
    },
    [],
  )

  const updateTheme = useCallback((payload: Partial<ThemeSettings>) => {
    dispatch({ type: 'UPDATE_THEME', payload })
  }, [])

  const sendMessage = useCallback(
    (raw: string) => {
      const content = raw.trim()
      if (!content || state.isThinking) return

      dispatch({ type: 'SEND_USER', content })

      const personalization = state.settings.personalization
      const prompt = buildSystemPrompt(personalization)
      const history: ChatApiMessage[] = [
        ...state.messages
          .filter((m) => m.role === 'user' || m.role === 'assistant')
          .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
        { role: 'user', content },
      ]

      // Keep isThinking true until ASSISTANT_DONE / ASSISTANT_FAIL (typing UI unchanged).
      void (async () => {
        try {
          const { content: reply } = await requestChatCompletion({
            messages: history,
            systemPrompt: prompt,
            userId: getOrCreateUserId(),
            memoryEnabled: personalization.memoryEnabled !== false,
          })
          dispatch({ type: 'ASSISTANT_DONE', content: reply })
        } catch (error) {
          // Temporary: no local demo fallback — surface the real API error.
          const message = error instanceof Error ? error.message : String(error)
          dispatch({ type: 'ASSISTANT_FAIL', error: message })
        }
      })()
    },
    [state.isThinking, state.messages, state.settings.personalization],
  )

  const systemPrompt = useMemo(
    () => buildSystemPrompt(state.settings.personalization),
    [state.settings.personalization],
  )

  const value = useMemo<ChatContextValue>(
    () => ({
      messages: state.messages,
      settings: state.settings,
      settingsOpen: state.settingsOpen,
      isThinking: state.isThinking,
      systemPrompt,
      newChat,
      openSettings,
      closeSettings,
      toggleSettings,
      updatePersonalization,
      updateTheme,
      sendMessage,
    }),
    [
      state.messages,
      state.settings,
      state.settingsOpen,
      state.isThinking,
      systemPrompt,
      newChat,
      openSettings,
      closeSettings,
      toggleSettings,
      updatePersonalization,
      updateTheme,
      sendMessage,
    ],
  )

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>
}

export function useChat() {
  const ctx = useContext(ChatContext)
  if (!ctx) throw new Error('useChat must be used within ChatProvider')
  return ctx
}
