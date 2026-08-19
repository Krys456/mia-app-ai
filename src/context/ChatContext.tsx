/* eslint-disable react-refresh/only-export-components -- ChatProvider + useChat share one module */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { applyAppearanceToDocument, normalizeAppearance } from '../lib/appearance'
import { requestChatCompletion, type ChatApiMessage } from '../lib/chatApi'
import type { MemoryFeedbackEvent } from '../lib/memoryFeedback'
import {
  deriveActiveDocumentFromMessages,
  type ActiveDocumentContext,
} from '../lib/activeDocumentContext'
import { rememberDocumentDiag } from '../lib/documentDiag'
import {
  applyTimerIntent,
  buildTimerDiag,
  clearActiveTimerStorage,
  detectTimerLanguage,
  expireRunningTimer,
  isTimerDiagClientEnabled,
  loadActiveTimerFromStorage,
  loadPendingReplace,
  logTimerSafe,
  markCompletionAnnounced,
  playTimerCompletionSound,
  remainingMs,
  rememberTimerDiag,
  saveActiveTimerToStorage,
  savePendingReplace,
  tryTimerCompletionNotification,
  type ActiveTimerContext,
  type PendingTimerReplace,
} from '../lib/timer'
import {
  applyPhoneAction,
  buildPhoneActionDiag,
  detectPhoneLanguage,
  isPhoneActionDiagEnabled,
  logPhoneActionSafe,
  rememberPhoneActionDiag,
  requestAppNavigate,
  clearMessagingContext,
  loadMessagingContext,
  saveMessagingContext,
  shouldClearMessagingOnUserText,
} from '../lib/phoneAction'
import { deriveDictationLangFromMessages } from '../lib/dictationLanguage'
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
  type ChatAttachment,
  type ChatMessage,
  type DeveloperSettings,
  type PersonalizationSettings,
  type ThemeSettings,
  type V2DebugInfo,
  type WebCitation,
} from '../types'
import { MAX_RECENT_IMAGE_TURNS } from '../lib/imageAttachment'
import { MAX_RECENT_FILE_TURNS } from '../lib/pdfAttachment'

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
  | { type: 'SEND_USER'; content: string; attachments?: ChatAttachment[] }
  /** #314 — local user+assistant exchange (timer / alarm honesty); no model call. */
  | { type: 'LOCAL_EXCHANGE'; userContent: string; assistantContent: string }
  | { type: 'ASSISTANT_START'; id: string; memoryEvent?: MemoryFeedbackEvent | null }
  | { type: 'ASSISTANT_PROGRESS'; id: string; content: string }
  | {
      type: 'ASSISTANT_FINISH'
      id: string
      content: string
      attachments?: ChatAttachment[]
      memoryEvent?: MemoryFeedbackEvent | null
      citations?: WebCitation[]
      v2Debug?: V2DebugInfo | null
    }
  | { type: 'ASSISTANT_FAIL'; error: string }
  | { type: 'TRIM_TO'; count: number; thinking?: boolean }

function createInitialState(): AppState {
  return {
    messages: [],
    settings: loadSettings(),
    settingsOpen: false,
    isThinking: false,
    isStreaming: false,
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
        ...(action.attachments?.length ? { attachments: action.attachments } : {}),
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
        topicMemory,
      }
    }
    case 'LOCAL_EXCHANGE': {
      const userMsg: ChatMessage = {
        id: uid(),
        role: 'user',
        content: action.userContent,
        createdAt: Date.now(),
      }
      const assistantMsg: ChatMessage = {
        id: uid(),
        role: 'assistant',
        content: action.assistantContent,
        createdAt: Date.now(),
      }
      return {
        ...state,
        messages: [...state.messages, userMsg, assistantMsg],
        isThinking: false,
        isStreaming: false,
        topicMemory: rememberAssistantMessage(state.topicMemory, action.assistantContent),
      }
    }
    case 'ASSISTANT_START': {
      const startEvent =
        action.memoryEvent &&
        (action.memoryEvent.type === 'created' ||
          action.memoryEvent.type === 'updated' ||
          action.memoryEvent.type === 'removed')
          ? action.memoryEvent
          : null
      const assistantMsg: ChatMessage = {
        id: action.id,
        role: 'assistant',
        content: '',
        createdAt: Date.now(),
        ...(startEvent ? { memoryEvent: startEvent } : {}),
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
        // Preserve memoryEvent across progressive reveal updates.
        return { ...msg, content: action.content }
      })
      if (!changed) return state
      return { ...state, messages, isStreaming: true, isThinking: false }
    }
    case 'ASSISTANT_FINISH': {
      const memoryEvent =
        action.memoryEvent &&
        (action.memoryEvent.type === 'created' ||
          action.memoryEvent.type === 'updated' ||
          action.memoryEvent.type === 'removed')
          ? action.memoryEvent
          : null
      const messages = state.messages.map((msg) => {
        if (msg.id !== action.id) return msg
        const next: ChatMessage = {
          ...msg,
          content: action.content,
          ...(action.v2Debug ? { v2Debug: action.v2Debug } : {}),
          ...(action.attachments?.length ? { attachments: action.attachments } : {}),
          ...(action.citations?.length ? { citations: action.citations } : {}),
        }
        if (memoryEvent) next.memoryEvent = memoryEvent
        else delete next.memoryEvent
        if (!action.citations?.length) delete next.citations
        return next
      })
      return {
        ...state,
        messages,
        isThinking: false,
        isStreaming: false,
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
      }
    }
    case 'TRIM_TO': {
      const count = Math.max(0, Math.min(action.count, state.messages.length))
      return {
        ...state,
        messages: state.messages.slice(0, count),
        isThinking: action.thinking === true,
        isStreaming: false,
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
  /** #313 — metadata-only active document for continuity UI. */
  activeDocument: ActiveDocumentContext | null
  clearActiveDocument: () => void
  /** #314 — client-first active timer (endsAt truth). */
  activeTimer: ActiveTimerContext | null
  stopActiveTimer: () => void
  addMinuteToActiveTimer: () => void
  dismissCompletedTimer: () => void
  newChat: () => void
  openSettings: () => void
  closeSettings: () => void
  toggleSettings: () => void
  updatePersonalization: (patch: Partial<PersonalizationSettings>) => void
  updateTheme: (patch: Partial<ThemeSettings>) => void
  updateAppearance: (patch: Partial<AppearanceSettings>) => void
  updateDeveloper: (patch: Partial<DeveloperSettings>) => void
  /** Returns true when the user turn was accepted into the thread. */
  sendMessage: (content: string, attachments?: ChatAttachment[]) => boolean
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

function toApiMessages(messages: ChatMessage[]): ChatApiMessage[] {
  // Preserve multimodal form for the most recent N image / file turns separately.
  // Image turns include user uploads AND assistant generated/edited images (#289).
  let remainingImages = MAX_RECENT_IMAGE_TURNS
  let remainingFiles = MAX_RECENT_FILE_TURNS
  const reversed = [...messages]
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .filter((m) => m.kind !== 'error')
    .reverse()
    .map((m) => {
      if (m.role === 'assistant') {
        const imageAtts = (m.attachments ?? []).filter(
          (a): a is Extract<ChatAttachment, { kind: 'image' }> =>
            a.kind === 'image' &&
            Boolean(a.dataUrl) &&
            Boolean(a.artifactProof) &&
            (a.source === 'generated' || a.source === 'edited'),
        )
        if (imageAtts.length && remainingImages > 0) {
          remainingImages -= 1
          return {
            role: 'assistant' as const,
            content: m.content,
            attachments: imageAtts.slice(0, 1).map((a) => ({
              type: 'image' as const,
              mimeType: a.mimeType,
              dataUrl: a.dataUrl,
              source: a.source as 'generated' | 'edited',
              id: a.id,
              artifactProof: a.artifactProof as string,
            })),
          }
        }
        return { role: 'assistant' as const, content: m.content }
      }
      const imageAtts = (m.attachments ?? []).filter(
        (a): a is Extract<ChatAttachment, { kind: 'image' }> =>
          a.kind === 'image' && Boolean(a.dataUrl),
      )
      const fileAtts = (m.attachments ?? []).filter(
        (a): a is Extract<ChatAttachment, { kind: 'file' }> =>
          a.kind === 'file' && Boolean(a.fileId),
      )
      if (imageAtts.length && remainingImages > 0) {
        remainingImages -= 1
        return {
          role: 'user' as const,
          content: m.content,
          attachments: imageAtts.slice(0, 1).map((a) => ({
            type: 'image' as const,
            mimeType: a.mimeType,
            dataUrl: a.dataUrl,
            ...(a.source ? { source: a.source } : {}),
            ...(a.id ? { id: a.id } : {}),
          })),
        }
      }
      if (fileAtts.length && remainingFiles > 0) {
        remainingFiles -= 1
        return {
          role: 'user' as const,
          content: m.content,
          attachments: fileAtts.slice(0, 1).map((a) => ({
            type: 'file' as const,
            fileId: a.fileId,
            name: a.name,
            mimeType: a.mimeType,
            size: a.size,
            ...(typeof a.expiresAt === 'number' ? { expiresAt: a.expiresAt } : {}),
          })),
        }
      }
      return { role: 'user' as const, content: m.content }
    })
  return reversed.reverse()
}

export function ChatProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, createInitialState)
  const generationRef = useRef(0)
  /** Sync guard — React state lags one frame behind double Enter / double tap. */
  const inFlightRef = useRef(false)
  const abortRef = useRef<AbortController | null>(null)
  const topicMemoryRef = useRef(state.topicMemory)
  topicMemoryRef.current = state.topicMemory
  /** #313 — user dismissed active document until next file upload. */
  const suppressDocReuseRef = useRef(false)
  const [activeDocument, setActiveDocument] = useState<ActiveDocumentContext | null>(null)
  /** #314 — client-first timer (persisted endsAt). */
  const [activeTimer, setActiveTimer] = useState<ActiveTimerContext | null>(() =>
    loadActiveTimerFromStorage(),
  )
  const [pendingTimerReplace, setPendingTimerReplace] = useState<PendingTimerReplace | null>(() =>
    loadPendingReplace(),
  )
  const timerLangRef = useRef<'it' | 'en'>('it')
  const completionLockRef = useRef(false)

  const syncActiveDocument = useCallback((messages: ChatMessage[]) => {
    if (suppressDocReuseRef.current) {
      setActiveDocument(null)
      return
    }
    setActiveDocument(deriveActiveDocumentFromMessages(messages))
  }, [])

  useEffect(() => {
    syncActiveDocument(state.messages)
  }, [state.messages, syncActiveDocument])

  const clearActiveDocument = useCallback(() => {
    suppressDocReuseRef.current = true
    setActiveDocument(null)
  }, [])

  const persistTimer = useCallback((next: ActiveTimerContext | null) => {
    setActiveTimer(next)
    if (!next || next.status === 'cancelled') {
      clearActiveTimerStorage()
      return
    }
    saveActiveTimerToStorage(next)
  }, [])

  const persistPendingReplace = useCallback((next: PendingTimerReplace | null) => {
    setPendingTimerReplace(next)
    savePendingReplace(next)
  }, [])

  const stopActiveTimer = useCallback(() => {
    setActiveTimer((prev) => {
      if (!prev || prev.status !== 'running') {
        clearActiveTimerStorage()
        return null
      }
      clearActiveTimerStorage()
      return null
    })
    persistPendingReplace(null)
    logTimerSafe({ action: 'ui_stop' })
  }, [persistPendingReplace])

  const addMinuteToActiveTimer = useCallback(() => {
    setActiveTimer((prev) => {
      if (!prev || prev.status !== 'running') return prev
      const next = {
        ...prev,
        endsAt: prev.endsAt + 60_000,
        durationMs: prev.durationMs + 60_000,
      }
      saveActiveTimerToStorage(next)
      logTimerSafe({
        action: 'ui_add_minute',
        durationMs: 60_000,
        remainingMs: remainingMs(next),
      })
      return next
    })
  }, [])

  const dismissCompletedTimer = useCallback(() => {
    clearActiveTimerStorage()
    setActiveTimer(null)
    completionLockRef.current = false
  }, [])

  // #314 — tick completion from endsAt (truth), not chained timeouts.
  useEffect(() => {
    if (!activeTimer || activeTimer.status !== 'running') return
    const tick = () => {
      const now = Date.now()
      if (activeTimer.endsAt > now) return
      if (completionLockRef.current || activeTimer.completionAnnounced) return
      completionLockRef.current = true
      const lang = timerLangRef.current
      const { timer: done } = expireRunningTimer(activeTimer, lang, now)
      const announced = markCompletionAnnounced(done)
      persistTimer(announced)
      void (async () => {
        const sound = await playTimerCompletionSound()
        const note = tryTimerCompletionNotification(lang)
        if (isTimerDiagClientEnabled()) {
          rememberTimerDiag(
            buildTimerDiag({
              timerIntent: 'complete',
              timerAction: 'complete',
              activeTimerFound: true,
              timerCompleted: true,
              endsAt: announced.endsAt,
              remainingMs: 0,
              completionSoundAttempted: sound.attempted,
              notificationAttempted: note.attempted,
              failureCode: sound.failureCode || note.failureCode,
            }),
          )
        }
        logTimerSafe({ action: 'complete', remainingMs: 0, status: 'completed' })
      })()
    }
    tick()
    const id = window.setInterval(tick, 250)
    return () => window.clearInterval(id)
  }, [activeTimer, persistTimer])

  // Restore expired-on-reload completion once.
  useEffect(() => {
    if (!activeTimer || activeTimer.status !== 'completed' || activeTimer.completionAnnounced) return
    if (completionLockRef.current) return
    completionLockRef.current = true
    const lang = timerLangRef.current
    const announced = markCompletionAnnounced(activeTimer)
    persistTimer(announced)
    void (async () => {
      const sound = await playTimerCompletionSound()
      const note = tryTimerCompletionNotification(lang)
      if (isTimerDiagClientEnabled()) {
        rememberTimerDiag(
          buildTimerDiag({
            timerIntent: 'complete_on_reload',
            timerAction: 'complete',
            activeTimerFound: true,
            timerCompleted: true,
            endsAt: announced.endsAt,
            remainingMs: 0,
            completionSoundAttempted: sound.attempted,
            notificationAttempted: note.attempted,
            failureCode: sound.failureCode || note.failureCode,
          }),
        )
      }
    })()
  }, [activeTimer, persistTimer])

  const abortActiveCompletion = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
  }, [])

  const newChat = useCallback(() => {
    generationRef.current += 1
    inFlightRef.current = false
    suppressDocReuseRef.current = false
    setActiveDocument(null)
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
          if (import.meta.env.DEV) {
            console.log('[ChatContext] starting completion', {
              historyLen: history.length,
              generation,
              runtime: 'core',
            })
          }
          const {
            content: reply,
            images: replyImages,
            citations: replyCitations,
            memoryEvent,
            learningSignals,
            welcomeSession,
            pendingAutomation,
            conversationMemoryMap,
            conversationPreferenceProfile,
            documentDiag,
            activeDocument: activeDocEcho,
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
              browserLocale:
                typeof navigator !== 'undefined' && navigator.language
                  ? navigator.language
                  : 'it',
              suppressActiveDocumentReuse: suppressDocReuseRef.current,
            },
            { signal: controller.signal },
          )

          if (documentDiag) {
            rememberDocumentDiag(documentDiag)
          }
          if (
            activeDocEcho &&
            typeof activeDocEcho === 'object' &&
            typeof (activeDocEcho as ActiveDocumentContext).fileId === 'string' &&
            !suppressDocReuseRef.current
          ) {
            const echo = activeDocEcho as ActiveDocumentContext
            setActiveDocument({
              fileId: echo.fileId,
              filename: echo.filename || 'document',
              mimeType: echo.mimeType || 'application/pdf',
              size: typeof echo.size === 'number' ? echo.size : 0,
              expiresAt: echo.expiresAt ?? null,
              sourceTurnId: echo.sourceTurnId ?? null,
            })
          }

          if (import.meta.env.DEV) {
            console.log('[ChatContext] completion ok', {
              generation,
              replyLen: reply?.length ?? 0,
              imageCount: replyImages?.length ?? 0,
              memoryEventType: memoryEvent?.type ?? null,
            })
          }

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
          const assistantAttachments: ChatAttachment[] = (replyImages ?? [])
            .slice(0, 1)
            .flatMap((img) => {
              const mime =
                img.mimeType === 'image/jpeg' ||
                img.mimeType === 'image/png' ||
                img.mimeType === 'image/webp'
                  ? img.mimeType
                  : null
              if (!mime || !img.dataUrl || !img.artifactProof) return []
              return [
                {
                  id: img.id || uid(),
                  kind: 'image' as const,
                  mimeType: mime,
                  dataUrl: img.dataUrl,
                  previewUrl: img.dataUrl,
                  source: img.source,
                  artifactProof: img.artifactProof,
                  ...(typeof img.width === 'number' ? { width: img.width } : {}),
                  ...(typeof img.height === 'number' ? { height: img.height } : {}),
                },
              ]
            })

          dispatch({
            type: 'ASSISTANT_START',
            id: assistantId,
            // Attach before reveal so progressive PROGRESS updates cannot orphan the event.
            memoryEvent: memoryEvent ?? null,
          })

          const revealText = reply || (assistantAttachments.length ? '' : '')
          await revealReplyText(
            revealText,
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
            content: reply || '',
            ...(assistantAttachments.length ? { attachments: assistantAttachments } : {}),
            ...(replyCitations?.length ? { citations: replyCitations } : {}),
            memoryEvent: memoryEvent ?? null,
          })
        } catch (error) {
          if (generation !== generationRef.current) return
          if (isAbortError(error) || controller.signal.aborted) return
          console.error('[ChatContext] completion failed', error instanceof Error ? error.name : 'unknown')
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
    (raw: string, attachments: ChatAttachment[] = []): boolean => {
      const content = raw.trim()
      const images = attachments
        .filter((a): a is Extract<ChatAttachment, { kind: 'image' }> => a.kind === 'image' && Boolean(a.dataUrl))
        .slice(0, 1)
      const files = attachments
        .filter(
          (a): a is Extract<ChatAttachment, { kind: 'file' }> =>
            a.kind === 'file' && Boolean(a.fileId),
        )
        .slice(0, 1)
      // MVP: image XOR file (one attachment total).
      const wireAtts: ChatAttachment[] = images.length ? images : files
      if ((!content && wireAtts.length === 0) || inFlightRef.current || state.isThinking || state.isStreaming) {
        return false
      }

      // #313 — new file upload becomes the active document (clears dismiss).
      if (files.length) {
        suppressDocReuseRef.current = false
      }

      // #314 — deterministic timer / alarm honesty (no attachments). Never LLM-owned time.
      if (content && wireAtts.length === 0) {
        const sticky = deriveDictationLangFromMessages(state.messages)
        const langHint =
          sticky === 'en' ? 'en' : sticky === 'it' ? 'it' : detectTimerLanguage(content, 'it')
        timerLangRef.current = langHint
        const result = applyTimerIntent({
          text: content,
          activeTimer: activeTimer?.status === 'running' ? activeTimer : null,
          pendingReplace: pendingTimerReplace,
          languageHint: langHint,
        })
        if (result.handled && result.reply) {
          if (result.clearTimer) {
            persistTimer(null)
            completionLockRef.current = false
          } else if (result.timer) {
            if (result.diag.timerStarted) completionLockRef.current = false
            persistTimer(result.timer)
          }
          persistPendingReplace(result.pendingReplace)
          dispatch({
            type: 'LOCAL_EXCHANGE',
            userContent: content,
            assistantContent: result.reply,
          })
          logTimerSafe({
            action: String(result.diag.timerAction || result.diag.timerIntent),
            durationMs: result.diag.parsedDurationMs,
            remainingMs: result.diag.remainingMs,
            status: result.timer?.status ?? null,
          })
          if (isTimerDiagClientEnabled()) {
            rememberTimerDiag(
              buildTimerDiag({
                ...result.diag,
                completionSoundAttempted: false,
                notificationAttempted: false,
              }),
            )
          }
          return true
        }
      }

      // #315 — deterministic Phone Actions (same user-gesture turn; never LLM-owned).
      if (content && wireAtts.length === 0) {
        const sticky = deriveDictationLangFromMessages(state.messages)
        const langHint =
          sticky === 'en'
            ? 'en'
            : sticky === 'it'
              ? 'it'
              : detectPhoneLanguage(content, detectTimerLanguage(content, 'it'))
        let lastAssistantText = ''
        for (let i = state.messages.length - 1; i >= 0; i -= 1) {
          const m = state.messages[i]
          if (m?.role === 'assistant' && m.kind !== 'error' && String(m.content || '').trim()) {
            lastAssistantText = String(m.content).trim()
            break
          }
        }
        const phone = applyPhoneAction({
          text: content,
          lastAssistantText,
          languageHint: langHint,
          messagingContext: loadMessagingContext(),
          env: {
            navigateApp: (view: string) => {
              requestAppNavigate(view)
            },
          },
        })
        if (phone.handled && phone.reply) {
          if (phone.messagingContext) {
            saveMessagingContext(phone.messagingContext)
          } else if (
            phone.action &&
            phone.action !== 'sms' &&
            phone.action !== 'whatsapp' &&
            shouldClearMessagingOnUserText(content)
          ) {
            clearMessagingContext()
          }
          dispatch({
            type: 'LOCAL_EXCHANGE',
            userContent: content,
            assistantContent: phone.reply,
          })
          logPhoneActionSafe({
            action: phone.action,
            target: phone.target,
            safetyClass: phone.safetyClass,
            handoffAttempted: Boolean(phone.diag.handoffAttempted),
            failureCode: phone.diag.failureCode ?? null,
          })
          if (isPhoneActionDiagEnabled()) {
            rememberPhoneActionDiag(buildPhoneActionDiag(phone.diag))
          }
          return true
        }
        if (shouldClearMessagingOnUserText(content)) {
          clearMessagingContext()
        }
      }

      const personalization = state.settings.personalization
      const developer = state.settings.developer ?? DEFAULT_DEVELOPER_SETTINGS
      const history: ChatApiMessage[] = [
        ...toApiMessages(state.messages),
        {
          role: 'user',
          content,
          ...(wireAtts.length
            ? {
                attachments: wireAtts.map((a) =>
                  a.kind === 'image'
                    ? {
                        type: 'image' as const,
                        mimeType: a.mimeType,
                        dataUrl: a.dataUrl,
                      }
                    : {
                        type: 'file' as const,
                        fileId: a.fileId,
                        name: a.name,
                        mimeType: a.mimeType,
                        size: a.size,
                      },
                ),
              }
            : {}),
        },
      ]

      inFlightRef.current = true
      dispatch({
        type: 'SEND_USER',
        content,
        ...(wireAtts.length ? { attachments: wireAtts } : {}),
      })
      runAssistantCompletion(history, personalization, developer)
      return true
    },
    [
      state.isThinking,
      state.isStreaming,
      state.messages,
      state.settings.personalization,
      state.settings.developer,
      activeTimer,
      pendingTimerReplace,
      persistTimer,
      persistPendingReplace,
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
      const history: ChatApiMessage[] = toApiMessages(kept)

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
      activeDocument,
      clearActiveDocument,
      activeTimer,
      stopActiveTimer,
      addMinuteToActiveTimer,
      dismissCompletedTimer,
      newChat,
      openSettings,
      closeSettings,
      toggleSettings,
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
      activeDocument,
      clearActiveDocument,
      activeTimer,
      stopActiveTimer,
      addMinuteToActiveTimer,
      dismissCompletedTimer,
      newChat,
      openSettings,
      closeSettings,
      toggleSettings,
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
