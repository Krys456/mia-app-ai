/* eslint-disable react-refresh/only-export-components -- ChatProvider + useChat share one module */
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from 'react'
import { requestChatCompletion, type ChatApiMessage } from '../lib/chatApi'
import {
  finalizeConversationLearning,
  getLearningSignals,
  saveLearningSignals,
} from '../lib/learningSignals'
import { getWelcomeSession, saveWelcomeSession } from '../lib/welcomeSession'
import { buildSystemPrompt } from '../lib/personality'
import { revealReplyText } from '../lib/revealText'
import { getOrCreateUserId } from '../lib/userId'
import type { ThemeDefinition } from '../lib/themes'
import {
  DEFAULT_PERSONALIZATION,
  DEFAULT_THEME_SETTINGS,
  isPersonalityMode,
  migrateLegacyTone,
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

function normalizePersonalization(
  raw: Partial<PersonalizationSettings> & { tone?: unknown } | undefined,
): PersonalizationSettings {
  const merged: PersonalizationSettings = {
    ...DEFAULT_PERSONALIZATION,
    ...raw,
    memoryEnabled: raw?.memoryEnabled !== false,
  }

  if (isPersonalityMode(raw?.personality)) {
    merged.personality = raw.personality
  } else {
    merged.personality = migrateLegacyTone(raw?.tone) ?? DEFAULT_PERSONALIZATION.personality
  }

  if (raw?.replyLength !== 'concise' && raw?.replyLength !== 'balanced' && raw?.replyLength !== 'detailed') {
    merged.replyLength = DEFAULT_PERSONALIZATION.replyLength
  }

  if (typeof raw?.useEmojis !== 'boolean') {
    merged.useEmojis = DEFAULT_PERSONALIZATION.useEmojis
  }

  return merged
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
      personalization?: Partial<PersonalizationSettings> & { tone?: unknown }
    }
    return {
      personalization: normalizePersonalization(parsed.personalization),
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
  isStreaming: boolean
  memoryNotice: 'saved' | 'updated' | null
}

type Action =
  | { type: 'NEW_CHAT' }
  | { type: 'OPEN_SETTINGS' }
  | { type: 'CLOSE_SETTINGS' }
  | { type: 'TOGGLE_SETTINGS' }
  | { type: 'UPDATE_PERSONALIZATION'; payload: Partial<PersonalizationSettings> }
  | { type: 'UPDATE_THEME'; payload: Partial<ThemeSettings> }
  | { type: 'SEND_USER'; content: string }
  | { type: 'ASSISTANT_START'; id: string }
  | { type: 'ASSISTANT_PROGRESS'; id: string; content: string }
  | { type: 'ASSISTANT_FINISH'; id: string; content: string; memoryEvent?: 'saved' | 'updated' | null }
  | { type: 'ASSISTANT_FAIL'; error: string }
  | { type: 'CLEAR_MEMORY_NOTICE' }
  | { type: 'TRIM_TO'; count: number; thinking?: boolean }

function createInitialState(): AppState {
  return {
    messages: [],
    settings: loadSettings(),
    settingsOpen: false,
    isThinking: false,
    isStreaming: false,
    memoryNotice: null,
  }
}

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'NEW_CHAT':
      return {
        ...state,
        messages: [],
        isThinking: false,
        isStreaming: false,
        settingsOpen: false,
        memoryNotice: null,
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
        isStreaming: false,
        memoryNotice: null,
      }
    }
    case 'ASSISTANT_START': {
      const assistantMsg: ChatMessage = {
        id: action.id,
        role: 'assistant',
        content: '',
        createdAt: Date.now(),
      }
      return {
        ...state,
        messages: [...state.messages, assistantMsg],
        isThinking: false,
        isStreaming: true,
      }
    }
    case 'ASSISTANT_PROGRESS': {
      let changed = false
      const messages = state.messages.map((msg) => {
        if (msg.id !== action.id) return msg
        changed = true
        return { ...msg, content: action.content }
      })
      if (!changed) return state
      return { ...state, messages, isStreaming: true, isThinking: false }
    }
    case 'ASSISTANT_FINISH': {
      const messages = state.messages.map((msg) =>
        msg.id === action.id ? { ...msg, content: action.content } : msg,
      )
      return {
        ...state,
        messages,
        isThinking: false,
        isStreaming: false,
        memoryNotice:
          action.memoryEvent === 'saved' || action.memoryEvent === 'updated'
            ? action.memoryEvent
            : null,
      }
    }
    case 'ASSISTANT_FAIL': {
      const assistantMsg: ChatMessage = {
        id: uid(),
        role: 'assistant',
        content: action.error,
        createdAt: Date.now(),
        kind: 'error',
      }
      return {
        ...state,
        messages: [...state.messages, assistantMsg],
        isThinking: false,
        isStreaming: false,
        memoryNotice: null,
      }
    }
    case 'CLEAR_MEMORY_NOTICE':
      return { ...state, memoryNotice: null }
    case 'TRIM_TO': {
      const count = Math.max(0, Math.min(action.count, state.messages.length))
      return {
        ...state,
        messages: state.messages.slice(0, count),
        isThinking: action.thinking === true,
        isStreaming: false,
        memoryNotice: null,
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
  isStreaming: boolean
  memoryNotice: 'saved' | 'updated' | null
  newChat: () => void
  openSettings: () => void
  closeSettings: () => void
  toggleSettings: () => void
  clearMemoryNotice: () => void
  updatePersonalization: (patch: Partial<PersonalizationSettings>) => void
  updateTheme: (patch: Partial<ThemeSettings>) => void
  sendMessage: (content: string) => void
  /** Re-run the completion for an assistant message (drops that reply and regenerates). */
  regenerateAssistant: (assistantId: string) => void
}

const ChatContext = createContext<ChatContextValue | null>(null)

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error && error.name === 'AbortError')
  )
}

export function ChatProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, createInitialState)
  const generationRef = useRef(0)
  /** Sync guard — React state lags one frame behind double Enter / double tap. */
  const inFlightRef = useRef(false)
  const abortRef = useRef<AbortController | null>(null)

  const abortActiveCompletion = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
  }, [])

  const newChat = useCallback(() => {
    generationRef.current += 1
    inFlightRef.current = false
    abortActiveCompletion()
    // Close the conversation: keep preference/mistake signals, drop turn noise.
    // Invisible — never surfaces in UI; never writes factual memory.
    try {
      finalizeConversationLearning()
    } catch {
      /* ignore */
    }
    dispatch({ type: 'NEW_CHAT' })
  }, [abortActiveCompletion])
  const openSettings = useCallback(() => dispatch({ type: 'OPEN_SETTINGS' }), [])
  const closeSettings = useCallback(() => dispatch({ type: 'CLOSE_SETTINGS' }), [])
  const toggleSettings = useCallback(() => dispatch({ type: 'TOGGLE_SETTINGS' }), [])
  const clearMemoryNotice = useCallback(() => dispatch({ type: 'CLEAR_MEMORY_NOTICE' }), [])

  const updatePersonalization = useCallback(
    (payload: Partial<PersonalizationSettings>) => {
      dispatch({ type: 'UPDATE_PERSONALIZATION', payload })
    },
    [],
  )

  const updateTheme = useCallback((payload: Partial<ThemeSettings>) => {
    dispatch({ type: 'UPDATE_THEME', payload })
  }, [])

  const runAssistantCompletion = useCallback(
    (history: ChatApiMessage[], personalization: PersonalizationSettings) => {
      abortActiveCompletion()
      const controller = new AbortController()
      abortRef.current = controller
      const generation = ++generationRef.current
      inFlightRef.current = true
      const prompt = buildSystemPrompt(personalization)

      void (async () => {
        try {
          const { content: reply, memoryEvent, learningSignals, welcomeSession } =
            await requestChatCompletion(
            {
              messages: history,
              systemPrompt: prompt,
              userId: getOrCreateUserId(),
              memoryEnabled: personalization.memoryEnabled !== false,
              learningSignals: getLearningSignals(),
              welcomeSession: getWelcomeSession(),
              displayName: personalization.displayName?.trim() || undefined,
            },
            { signal: controller.signal },
          )

          if (generation !== generationRef.current) return

          // Persist internal learning signals silently (not factual memory, not UI).
          if (learningSignals) {
            try {
              saveLearningSignals(learningSignals)
            } catch {
              /* ignore */
            }
          }
          if (welcomeSession) {
            try {
              saveWelcomeSession({
                usedGreetingIds: Array.isArray(
                  (welcomeSession as { usedGreetingIds?: unknown }).usedGreetingIds,
                )
                  ? ((welcomeSession as { usedGreetingIds: string[] }).usedGreetingIds)
                  : [],
                usedStrategies: Array.isArray(
                  (welcomeSession as { usedStrategies?: unknown }).usedStrategies,
                )
                  ? ((welcomeSession as { usedStrategies: string[] }).usedStrategies)
                  : [],
                welcomeCount:
                  typeof (welcomeSession as { welcomeCount?: unknown }).welcomeCount === 'number'
                    ? (welcomeSession as { welcomeCount: number }).welcomeCount
                    : 0,
                lastSeenAt:
                  typeof (welcomeSession as { lastSeenAt?: unknown }).lastSeenAt === 'number'
                    ? (welcomeSession as { lastSeenAt: number }).lastSeenAt
                    : Date.now(),
                updatedAt:
                  typeof (welcomeSession as { updatedAt?: unknown }).updatedAt === 'number'
                    ? (welcomeSession as { updatedAt: number }).updatedAt
                    : Date.now(),
              })
            } catch {
              /* ignore */
            }
          }

          const assistantId = uid()
          dispatch({ type: 'ASSISTANT_START', id: assistantId })

          await revealReplyText(
            reply,
            (partial) => {
              if (generation !== generationRef.current) return
              dispatch({ type: 'ASSISTANT_PROGRESS', id: assistantId, content: partial })
            },
            () => generation !== generationRef.current,
          )

          if (generation !== generationRef.current) return

          dispatch({
            type: 'ASSISTANT_FINISH',
            id: assistantId,
            content: reply,
            memoryEvent: memoryEvent ?? null,
          })
        } catch (error) {
          if (generation !== generationRef.current) return
          if (isAbortError(error) || controller.signal.aborted) return
          const message = error instanceof Error ? error.message : String(error)
          dispatch({ type: 'ASSISTANT_FAIL', error: message })
        } finally {
          if (generation === generationRef.current) {
            inFlightRef.current = false
            if (abortRef.current === controller) abortRef.current = null
          }
        }
      })()
    },
    [abortActiveCompletion],
  )

  const sendMessage = useCallback(
    (raw: string) => {
      const content = raw.trim()
      if (!content || inFlightRef.current || state.isThinking || state.isStreaming) return

      const personalization = state.settings.personalization
      const history: ChatApiMessage[] = [
        ...state.messages
          .filter((m) => m.role === 'user' || m.role === 'assistant')
          .filter((m) => m.kind !== 'error')
          .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
        { role: 'user', content },
      ]

      inFlightRef.current = true
      dispatch({ type: 'SEND_USER', content })
      runAssistantCompletion(history, personalization)
    },
    [
      state.isThinking,
      state.isStreaming,
      state.messages,
      state.settings.personalization,
      runAssistantCompletion,
    ],
  )

  const regenerateAssistant = useCallback(
    (assistantId: string) => {
      if (inFlightRef.current || state.isThinking || state.isStreaming) return

      const msgs = state.messages
      const idx = msgs.findIndex((m) => m.id === assistantId)
      if (idx < 0 || msgs[idx]?.role !== 'assistant') return
      if (msgs[idx]?.kind === 'error') return

      let userIdx = idx - 1
      while (userIdx >= 0 && msgs[userIdx]?.role !== 'user') userIdx -= 1
      if (userIdx < 0) return

      const kept = msgs.slice(0, userIdx + 1)
      const history: ChatApiMessage[] = kept
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .filter((m) => m.kind !== 'error')
        .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))

      inFlightRef.current = true
      dispatch({ type: 'TRIM_TO', count: kept.length, thinking: true })
      runAssistantCompletion(history, state.settings.personalization)
    },
    [
      state.isThinking,
      state.isStreaming,
      state.messages,
      state.settings.personalization,
      runAssistantCompletion,
    ],
  )

  const value = useMemo<ChatContextValue>(
    () => ({
      messages: state.messages,
      settings: state.settings,
      settingsOpen: state.settingsOpen,
      isThinking: state.isThinking,
      isStreaming: state.isStreaming,
      memoryNotice: state.memoryNotice,
      newChat,
      openSettings,
      closeSettings,
      toggleSettings,
      clearMemoryNotice,
      updatePersonalization,
      updateTheme,
      sendMessage,
      regenerateAssistant,
    }),
    [
      state.messages,
      state.settings,
      state.settingsOpen,
      state.isThinking,
      state.isStreaming,
      state.memoryNotice,
      newChat,
      openSettings,
      closeSettings,
      toggleSettings,
      clearMemoryNotice,
      updatePersonalization,
      updateTheme,
      sendMessage,
      regenerateAssistant,
    ],
  )

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>
}

export function useChat() {
  const ctx = useContext(ChatContext)
  if (!ctx) throw new Error('useChat must be used within ChatProvider')
  return ctx
}
