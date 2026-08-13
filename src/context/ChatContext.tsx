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
import { buildSystemPrompt } from '../lib/personality'
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
  createConversationId,
  createMessageId,
  installOnlineRetryListener,
  isUsableConversationState,
  loadActiveConversationForStartup,
  persistMessagesNow,
  reconcileActiveWithRemote,
  reconstructConversationStateFromMessages,
  setActiveConversationId,
  type PersistedChatMessage,
} from '../lib/chatPersistence'
import { explicitDeleteConversation } from '../lib/chatPersistence/sync'
import {
  DEFAULT_DEVELOPER_SETTINGS,
  DEFAULT_PERSONALIZATION,
  DEFAULT_THEME_SETTINGS,
  isPersonalityMode,
  migrateLegacyTone,
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

function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem('laife.settings.v1')
    if (!raw) {
      return {
        personalization: { ...DEFAULT_PERSONALIZATION },
        theme: { ...DEFAULT_THEME_SETTINGS, customThemes: [] },
        developer: { ...DEFAULT_DEVELOPER_SETTINGS },
      }
    }
    const parsed = JSON.parse(raw) as Partial<AppSettings> & {
      theme?: Partial<ThemeSettings>
      personalization?: Partial<PersonalizationSettings> & { tone?: unknown }
      developer?: Partial<DeveloperSettings>
    }
    return {
      personalization: normalizePersonalization(parsed.personalization),
      theme: {
        activeThemeId: parsed.theme?.activeThemeId ?? DEFAULT_THEME_SETTINGS.activeThemeId,
        customThemes: sanitizeCustomThemes(parsed.theme?.customThemes),
      },
      developer: normalizeDeveloper(parsed.developer),
    }
  } catch {
    return {
      personalization: { ...DEFAULT_PERSONALIZATION },
      theme: { ...DEFAULT_THEME_SETTINGS, customThemes: [] },
      developer: { ...DEFAULT_DEVELOPER_SETTINGS },
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
  return createMessageId()
}

interface AppState {
  messages: ChatMessage[]
  settings: AppSettings
  settingsOpen: boolean
  isThinking: boolean
  isStreaming: boolean
  memoryNotice: 'saved' | 'updated' | null
  topicMemory: TopicMemory
  /** Stable conversation id — survives refresh / navigation. */
  conversationId: string
  conversationCreatedAt: number
  /** V2 working Conversation State keyed by conversationId (not Memory). */
  conversationState: Record<string, unknown> | null
  /**
   * Last-used engine label on the conversation record (persistence metadata).
   * Source of truth for routing remains settings.developer.v2Experimental.
   */
  engine: string
}

type Action =
  | { type: 'NEW_CHAT'; conversationId: string; createdAt: number }
  | { type: 'OPEN_SETTINGS' }
  | { type: 'CLOSE_SETTINGS' }
  | { type: 'TOGGLE_SETTINGS' }
  | { type: 'UPDATE_PERSONALIZATION'; payload: Partial<PersonalizationSettings> }
  | { type: 'UPDATE_THEME'; payload: Partial<ThemeSettings> }
  | { type: 'UPDATE_DEVELOPER'; payload: Partial<DeveloperSettings> }
  | { type: 'SEND_USER'; id: string; content: string; createdAt: number }
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
  | {
      type: 'HYDRATE_CONVERSATION'
      conversationId: string
      messages: ChatMessage[]
      conversationState: Record<string, unknown> | null
      createdAt: number
      engine?: string
    }
  | { type: 'SET_CONVERSATION_STATE'; conversationState: Record<string, unknown> | null }
  | { type: 'SET_ENGINE'; engine: string }

function createInitialState(): AppState {
  const settings = loadSettings()
  const cached = loadActiveConversationForStartup()
  // Toggle (settings.developer) is authoritative for which engine to use.
  // Cached conversation.engine is metadata only and must not flip the toggle.
  const engineFromToggle = settings.developer.v2Experimental ? 'v2' : 'v1'
  return {
    messages: cached?.messages ? cached.messages.map(toChatMessage) : [],
    settings,
    settingsOpen: false,
    isThinking: false,
    isStreaming: false,
    memoryNotice: null,
    topicMemory: createEmptyMemory(),
    conversationId: cached?.conversationId || createConversationId(),
    conversationCreatedAt: cached?.createdAt || Date.now(),
    conversationState: isUsableConversationState(cached?.conversationState)
      ? cached!.conversationState!
      : null,
    engine: engineFromToggle,
  }
}

function toChatMessage(m: PersistedChatMessage & { v2Debug?: V2DebugInfo }): ChatMessage {
  return {
    id: m.id,
    role: m.role,
    content: m.content,
    createdAt: m.createdAt,
    kind: m.kind,
    ...(m.v2Debug ? { v2Debug: m.v2Debug } : {}),
  }
}

function toPersistedMessages(messages: ChatMessage[]): PersistedChatMessage[] {
  return messages.map((m) => ({
    ...m,
    syncStatus: 'pending' as const,
  }))
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
        conversationId: action.conversationId,
        conversationCreatedAt: action.createdAt,
        conversationState: null,
      }
    case 'HYDRATE_CONVERSATION':
      return {
        ...state,
        conversationId: action.conversationId,
        conversationCreatedAt: action.createdAt,
        messages: action.messages,
        conversationState: action.conversationState,
        engine: action.engine || state.engine,
        isThinking: false,
        isStreaming: false,
        memoryNotice: null,
      }
    case 'SET_CONVERSATION_STATE':
      return { ...state, conversationState: action.conversationState }
    case 'SET_ENGINE':
      return { ...state, engine: action.engine }
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
    case 'UPDATE_DEVELOPER': {
      const nextDeveloper = normalizeDeveloper({
        ...state.settings.developer,
        ...action.payload,
      })
      const next: AppSettings = {
        ...state.settings,
        developer: nextDeveloper,
      }
      saveSettings(next)
      // Mirror engine metadata only — do NOT change conversationId or wipe messages.
      return {
        ...state,
        settings: next,
        engine: nextDeveloper.v2Experimental ? 'v2' : 'v1',
      }
    }
    case 'SEND_USER': {
      const userMsg: ChatMessage = {
        id: action.id,
        role: 'user',
        content: action.content,
        createdAt: action.createdAt,
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
  conversationId: string
  newChat: () => void
  /** Explicit delete only — never used by new chat / navigation / errors. */
  deleteConversation: (conversationId?: string) => Promise<void>
  openSettings: () => void
  closeSettings: () => void
  toggleSettings: () => void
  clearMemoryNotice: () => void
  updatePersonalization: (patch: Partial<PersonalizationSettings>) => void
  updateTheme: (patch: Partial<ThemeSettings>) => void
  updateDeveloper: (patch: Partial<DeveloperSettings>) => void
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
  const topicMemoryRef = useRef(state.topicMemory)
  topicMemoryRef.current = state.topicMemory
  const conversationStateRef = useRef(state.conversationState)
  conversationStateRef.current = state.conversationState
  const hydratedRef = useRef(false)
  const persistReadyRef = useRef(false)

  const abortActiveCompletion = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
  }, [])

  const persistSnapshot = useCallback(
    (messages: ChatMessage[], conversationId: string, extras?: {
      conversationState?: Record<string, unknown> | null
      createdAt?: number
      engine?: string
    }) => {
      try {
        persistMessagesNow({
          conversationId,
          messages: toPersistedMessages(messages),
          conversationState:
            extras?.conversationState !== undefined
              ? extras.conversationState
              : conversationStateRef.current,
          createdAt: extras?.createdAt,
          engine: extras?.engine || state.engine,
        })
      } catch (error) {
        console.error('[ChatContext] local persist failed', error)
      }
    },
    [state.engine],
  )

  // Mark active id on mount; reconcile with server without wiping local.
  useEffect(() => {
    setActiveConversationId(state.conversationId)
    persistReadyRef.current = true
    const stopOnline = installOnlineRetryListener()
    const conversationId = state.conversationId
    let cancelled = false
    void (async () => {
      try {
        const merged = await reconcileActiveWithRemote(conversationId)
        if (cancelled || !merged) return
        if (merged.conversationId !== conversationId) return
        // Only hydrate if remote added messages we don't have — never replace with empty.
        if (merged.messages.length === 0) return
        const localCount = state.messages.length
        if (merged.messages.length > localCount) {
          dispatch({
            type: 'HYDRATE_CONVERSATION',
            conversationId: merged.conversationId,
            messages: merged.messages.map(toChatMessage),
            conversationState: isUsableConversationState(merged.conversationState)
              ? merged.conversationState
              : reconstructConversationStateFromMessages(
                  merged.messages,
                  merged.conversationId,
                ),
            createdAt: merged.createdAt,
            // Do not let remote/cached engine override the Developer toggle.
            engine: state.settings.developer?.v2Experimental ? 'v2' : 'v1',
          })
        } else if (
          !state.conversationState &&
          isUsableConversationState(merged.conversationState)
        ) {
          dispatch({
            type: 'SET_CONVERSATION_STATE',
            conversationState: merged.conversationState,
          })
        }
      } catch (error) {
        console.error('[ChatContext] startup reconcile failed', error)
      } finally {
        hydratedRef.current = true
      }
    })()
    return () => {
      cancelled = true
      stopOnline()
    }
    // Intentionally once on mount for this provider instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Durable local cache whenever the visible transcript changes.
  useEffect(() => {
    if (!persistReadyRef.current) return
    if (state.isStreaming) {
      // Persist partial assistant text so refresh mid-reveal keeps progress.
    }
    persistSnapshot(state.messages, state.conversationId, {
      conversationState: state.conversationState,
      createdAt: state.conversationCreatedAt,
      engine: state.engine,
    })
  }, [
    state.messages,
    state.conversationId,
    state.conversationState,
    state.conversationCreatedAt,
    state.engine,
    state.isStreaming,
    persistSnapshot,
  ])

  const newChat = useCallback(() => {
    generationRef.current += 1
    inFlightRef.current = false
    abortActiveCompletion()
    // Preserve previous conversation in local cache (already persisted via effect).
    try {
      finalizeConversationLearning()
    } catch {
      /* ignore */
    }
    try {
      clearConversationPreferenceProfile()
    } catch {
      /* ignore */
    }
    const nextId = createConversationId()
    const createdAt = Date.now()
    setActiveConversationId(nextId)
    // Seed empty conversation shell so ID is stable before first message.
    persistSnapshot([], nextId, {
      conversationState: null,
      createdAt,
      engine: state.engine,
    })
    dispatch({ type: 'NEW_CHAT', conversationId: nextId, createdAt })
  }, [abortActiveCompletion, persistSnapshot, state.engine])

  const deleteConversation = useCallback(
    async (conversationId?: string) => {
      const id = conversationId || state.conversationId
      await explicitDeleteConversation(id)
      if (id === state.conversationId) {
        const nextId = createConversationId()
        const createdAt = Date.now()
        setActiveConversationId(nextId)
        dispatch({ type: 'NEW_CHAT', conversationId: nextId, createdAt })
      }
    },
    [state.conversationId],
  )

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

  const updateDeveloper = useCallback(
    (payload: Partial<DeveloperSettings>) => {
      dispatch({ type: 'UPDATE_DEVELOPER', payload })
      // Persist engine mirror on the SAME conversation — never create a new ID.
      const nextV2 =
        payload.v2Experimental !== undefined
          ? payload.v2Experimental === true
          : state.settings.developer?.v2Experimental === true
      const engine = nextV2 ? 'v2' : 'v1'
      persistSnapshot(state.messages, state.conversationId, {
        createdAt: state.conversationCreatedAt,
        engine,
        conversationState: state.conversationState,
      })
    },
    [
      persistSnapshot,
      state.messages,
      state.conversationId,
      state.conversationCreatedAt,
      state.conversationState,
      state.settings.developer?.v2Experimental,
    ],
  )

  const runAssistantCompletion = useCallback(
    (
      history: ChatApiMessage[],
      personalization: PersonalizationSettings,
      conversationId: string,
      developer: DeveloperSettings = DEFAULT_DEVELOPER_SETTINGS,
    ) => {
      abortActiveCompletion()
      const controller = new AbortController()
      abortRef.current = controller
      const generation = ++generationRef.current
      inFlightRef.current = true
      const prompt = buildSystemPrompt(personalization, topicMemoryRef.current)
      const useV2 = developer.v2Experimental === true

      void (async () => {
        try {
          console.log('[ChatContext] starting completion', {
            historyLen: history.length,
            generation,
            conversationId,
            engine: useV2 ? 'v2' : 'v1',
          })
          const {
            content: reply,
            memoryEvent,
            learningSignals,
            welcomeSession,
            pendingAutomation,
            conversationMemoryMap,
            conversationPreferenceProfile,
            conversationState: nextConversationState,
            v2Debug,
          } =
            await requestChatCompletion(
            {
              messages: history,
              systemPrompt: prompt,
              userId: getOrCreateUserId(),
              memoryEnabled: personalization.memoryEnabled !== false,
              developerMode: true,
              ...(useV2 ? { engine: 'v2' as const } : { engine: 'v1' as const }),
              learningSignals: getLearningSignals(),
              welcomeSession: getWelcomeSession(),
              displayName: personalization.displayName?.trim() || undefined,
              personalityBias: personalization.personality || 'automatic',
              pendingAutomation: getPendingAutomation() || undefined,
              conversationMemoryMap: getConversationMemoryMap() || undefined,
              conversationPreferenceProfile:
                getConversationPreferenceProfile() || undefined,
              conversationId,
              conversationState: conversationStateRef.current,
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

          if (isUsableConversationState(nextConversationState)) {
            dispatch({
              type: 'SET_CONVERSATION_STATE',
              conversationState: nextConversationState,
            })
            conversationStateRef.current = nextConversationState
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
            ...(useV2 && v2Debug ? { v2Debug } : {}),
          })
        } catch (error) {
          if (generation !== generationRef.current) return
          if (isAbortError(error) || controller.signal.aborted) return
          console.error('[ChatContext] completion failed', error)
          const message = error instanceof Error ? error.message : String(error)
          // Failure isolation: keep prior messages; only append error notice.
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

      const messageId = uid()
      const createdAt = Date.now()
      inFlightRef.current = true
      dispatch({ type: 'SEND_USER', id: messageId, content, createdAt })
      // Immediate durable write of the optimistic user message (before network).
      persistSnapshot(
        [
          ...state.messages,
          { id: messageId, role: 'user', content, createdAt },
        ],
        state.conversationId,
        { createdAt: state.conversationCreatedAt },
      )
      runAssistantCompletion(
        history,
        personalization,
        state.conversationId,
        state.settings.developer ?? DEFAULT_DEVELOPER_SETTINGS,
      )
    },
    [
      state.isThinking,
      state.isStreaming,
      state.messages,
      state.settings.personalization,
      state.settings.developer,
      state.conversationId,
      state.conversationCreatedAt,
      runAssistantCompletion,
      persistSnapshot,
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
      persistSnapshot(kept, state.conversationId, {
        createdAt: state.conversationCreatedAt,
      })
      runAssistantCompletion(
        history,
        state.settings.personalization,
        state.conversationId,
        state.settings.developer ?? DEFAULT_DEVELOPER_SETTINGS,
      )
    },
    [
      state.isThinking,
      state.isStreaming,
      state.messages,
      state.settings.personalization,
      state.settings.developer,
      state.conversationId,
      state.conversationCreatedAt,
      runAssistantCompletion,
      persistSnapshot,
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
      conversationId: state.conversationId,
      newChat,
      deleteConversation,
      openSettings,
      closeSettings,
      toggleSettings,
      clearMemoryNotice,
      updatePersonalization,
      updateTheme,
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
      state.conversationId,
      newChat,
      deleteConversation,
      openSettings,
      closeSettings,
      toggleSettings,
      clearMemoryNotice,
      updatePersonalization,
      updateTheme,
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
