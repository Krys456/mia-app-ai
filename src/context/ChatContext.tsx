/* eslint-disable react-refresh/only-export-components -- ChatProvider + useChat share one module */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from 'react'
import { applyAppearanceToDocument, normalizeAppearance } from '../lib/appearance'
import { requestChatCompletion, type ChatApiMessage } from '../lib/chatApi'
import {
  finalizeConversationLearning,
  getLearningSignals,
  saveLearningSignals,
} from '../lib/learningSignals'
import { getWelcomeSession, saveWelcomeSession } from '../lib/welcomeSession'
import {
  getConversationMemoryMap,
  saveConversationMemoryMap,
  sanitizeConversationMemoryMap,
} from '../lib/conversationMemoryMap'
import {
  clearConversationPreferenceProfile,
  getConversationPreferenceProfile,
  saveConversationPreferenceProfile,
  sanitizeConversationPreferenceProfile,
} from '../lib/conversationPreferenceProfile'
import {
  getPendingAutomation,
  savePendingAutomation,
} from '../lib/pendingAutomation'
import {
  applyPivotSuppression,
  COMFORT_TRAP_TOPICS,
  createEmptyMemory,
  detectRepetitionSignals,
  recentTopicIds,
  rememberAssistantMessage,
  type TopicMemory,
} from '../lib/diversity'
import { revealReplyText } from '../lib/revealText'
import { getOrCreateUserId } from '../lib/userId'
import type { ThemeDefinition } from '../lib/themes'
import {
  DEFAULT_APPEARANCE_SETTINGS,
  DEFAULT_DEVELOPER_SETTINGS,
  DEFAULT_PERSONALIZATION,
  DEFAULT_THEME_SETTINGS,
  isPersonalityMode,
  migrateLegacyTone,
  type AppearanceSettings,
  type AppSettings,
  type ChatMessage,
  type DeveloperSettings,
  type PersonalizationSettings,
  type ThemeSettings,
  type V2DebugInfo,
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

function normalizeDeveloper(
  raw: Partial<DeveloperSettings> | undefined,
): DeveloperSettings {
  return {
    ...DEFAULT_DEVELOPER_SETTINGS,
    ...raw,
    v2Experimental: raw?.v2Experimental === true,
  }
}

function defaultAppSettings(): AppSettings {
  return {
    personalization: { ...DEFAULT_PERSONALIZATION },
    theme: { ...DEFAULT_THEME_SETTINGS, customThemes: [] },
    appearance: { ...DEFAULT_APPEARANCE_SETTINGS },
    developer: { ...DEFAULT_DEVELOPER_SETTINGS },
  }
}

function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem('laife.settings.v1')
    if (!raw) return defaultAppSettings()
    const parsed = JSON.parse(raw) as Partial<AppSettings> & {
      theme?: Partial<ThemeSettings>
      personalization?: Partial<PersonalizationSettings> & { tone?: unknown }
      appearance?: Partial<AppearanceSettings>
      developer?: Partial<DeveloperSettings>
    }
    return {
      personalization: normalizePersonalization(parsed.personalization),
      theme: {
        activeThemeId: parsed.theme?.activeThemeId ?? DEFAULT_THEME_SETTINGS.activeThemeId,
        customThemes: sanitizeCustomThemes(parsed.theme?.customThemes),
      },
      // Old laife.settings.v2 blobs without appearance → safe defaults.
      appearance: normalizeAppearance(parsed.appearance),
      developer: normalizeDeveloper(parsed.developer),
    }
  } catch {
    return defaultAppSettings()
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
  topicMemory: TopicMemory
}

type Action =
  | { type: 'NEW_CHAT' }
  | { type: 'OPEN_SETTINGS' }
  | { type: 'CLOSE_SETTINGS' }
  | { type: 'TOGGLE_SETTINGS' }
  | { type: 'UPDATE_PERSONALIZATION'; payload: Partial<PersonalizationSettings> }
  | { type: 'UPDATE_THEME'; payload: Partial<ThemeSettings> }
  | { type: 'UPDATE_APPEARANCE'; payload: Partial<AppearanceSettings> }
  | { type: 'UPDATE_DEVELOPER'; payload: Partial<DeveloperSettings> }
  | { type: 'SEND_USER'; content: string }
  | { type: 'ASSISTANT_START'; id: string }
  | { type: 'ASSISTANT_PROGRESS'; id: string; content: string }
  | {
      type: 'ASSISTANT_FINISH'
      id: string
      content: string
      memoryEvent?: 'saved' | 'updated' | null
      v2Debug?: V2DebugInfo | null
    }
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
    topicMemory: createEmptyMemory(),
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
        topicMemory: createEmptyMemory(),
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
    case 'UPDATE_APPEARANCE': {
      const next: AppSettings = {
        ...state.settings,
        appearance: normalizeAppearance({
          ...state.settings.appearance,
          ...action.payload,
        }),
      }
      saveSettings(next)
      return { ...state, settings: next }
    }
    case 'UPDATE_DEVELOPER': {
      const next: AppSettings = {
        ...state.settings,
        developer: normalizeDeveloper({
          ...state.settings.developer,
          ...action.payload,
        }),
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
      let topicMemory = state.topicMemory
      const signal = detectRepetitionSignals(action.content)
      if (signal.matched) {
        topicMemory = applyPivotSuppression(topicMemory, [
          ...recentTopicIds(topicMemory),
          ...COMFORT_TRAP_TOPICS,
        ])
      }
      return {
        ...state,
        messages: [...state.messages, userMsg],
        isThinking: true,
        isStreaming: false,
        memoryNotice: null,
        topicMemory,
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
        msg.id === action.id
          ? {
              ...msg,
              content: action.content,
              ...(action.v2Debug ? { v2Debug: action.v2Debug } : {}),
            }
          : msg,
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
        topicMemory: rememberAssistantMessage(state.topicMemory, action.content),
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
  updateAppearance: (patch: Partial<AppearanceSettings>) => void
  updateDeveloper: (patch: Partial<DeveloperSettings>) => void
  /** Returns true when the user turn was accepted into the thread. */
  sendMessage: (content: string) => boolean
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
  const topicMemoryRef = useRef(state.topicMemory)
  topicMemoryRef.current = state.topicMemory

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
    // Conversation Preference Profile is session-scoped — reset on new chat.
    try {
      clearConversationPreferenceProfile()
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

  const updateAppearance = useCallback((payload: Partial<AppearanceSettings>) => {
    dispatch({ type: 'UPDATE_APPEARANCE', payload })
  }, [])

  const updateDeveloper = useCallback((payload: Partial<DeveloperSettings>) => {
    dispatch({ type: 'UPDATE_DEVELOPER', payload })
  }, [])

  useEffect(() => {
    applyAppearanceToDocument(state.settings.appearance)
  }, [state.settings.appearance])

  const runAssistantCompletion = useCallback(
    (
      history: ChatApiMessage[],
      personalization: PersonalizationSettings,
      _developer: DeveloperSettings = DEFAULT_DEVELOPER_SETTINGS,
    ) => {
      abortActiveCompletion()
      const controller = new AbortController()
      abortRef.current = controller
      const generation = ++generationRef.current
      inFlightRef.current = true

      void (async () => {
        try {
          console.log('[ChatContext] starting completion', {
            historyLen: history.length,
            generation,
            runtime: 'core',
          })
          const {
            content: reply,
            memoryEvent,
            learningSignals,
            welcomeSession,
            pendingAutomation,
            conversationMemoryMap,
            conversationPreferenceProfile,
          } =
            await requestChatCompletion(
            {
              messages: history,
              userId: getOrCreateUserId(),
              memoryEnabled: personalization.memoryEnabled !== false,
              learningSignals: getLearningSignals(),
              welcomeSession: getWelcomeSession(),
              displayName: personalization.displayName?.trim() || undefined,
              personalityBias: personalization.personality || 'automatic',
              replyLength: personalization.replyLength,
              useEmojis: personalization.useEmojis,
              customInstructions: personalization.customInstructions?.trim() || undefined,
              pendingAutomation: getPendingAutomation() || undefined,
              conversationMemoryMap: getConversationMemoryMap() || undefined,
              conversationPreferenceProfile:
                getConversationPreferenceProfile() || undefined,
            },
            { signal: controller.signal },
          )

          console.log('[ChatContext] completion ok', {
            generation,
            replyLen: reply?.length ?? 0,
            memoryEvent: memoryEvent ?? null,
          })

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
          if (pendingAutomation !== undefined) {
            try {
              savePendingAutomation(
                pendingAutomation && typeof pendingAutomation === 'object'
                  ? (pendingAutomation as Record<string, unknown>)
                  : null,
              )
            } catch {
              /* ignore */
            }
          }
          if (conversationMemoryMap) {
            try {
              const cleaned = sanitizeConversationMemoryMap(conversationMemoryMap)
              if (cleaned) saveConversationMemoryMap(cleaned)
            } catch {
              /* ignore */
            }
          }
          if (conversationPreferenceProfile) {
            try {
              const cleaned = sanitizeConversationPreferenceProfile(
                conversationPreferenceProfile,
              )
              if (cleaned) saveConversationPreferenceProfile(cleaned)
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
          console.error('[ChatContext] completion failed', error)
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
    (raw: string): boolean => {
      const content = raw.trim()
      if (!content || inFlightRef.current || state.isThinking || state.isStreaming) {
        return false
      }

      const personalization = state.settings.personalization
      const developer = state.settings.developer ?? DEFAULT_DEVELOPER_SETTINGS
      const history: ChatApiMessage[] = [
        ...state.messages
          .filter((m) => m.role === 'user' || m.role === 'assistant')
          .filter((m) => m.kind !== 'error')
          .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
        { role: 'user', content },
      ]

      inFlightRef.current = true
      dispatch({ type: 'SEND_USER', content })
      runAssistantCompletion(history, personalization, developer)
      return true
    },
    [
      state.isThinking,
      state.isStreaming,
      state.messages,
      state.settings.personalization,
      state.settings.developer,
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
      runAssistantCompletion(
        history,
        state.settings.personalization,
        state.settings.developer ?? DEFAULT_DEVELOPER_SETTINGS,
      )
    },
    [
      state.isThinking,
      state.isStreaming,
      state.messages,
      state.settings.personalization,
      state.settings.developer,
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
      updateAppearance,
      updateDeveloper,
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
      updateAppearance,
      updateDeveloper,
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
