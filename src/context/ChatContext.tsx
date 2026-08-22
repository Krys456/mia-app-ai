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
import {
  applyCoreAssistantStyleUpdate,
  applyRegenerateStyleRollback,
  clearSessionStyleStorage,
  createEmptySessionStyleState,
  loadSessionStyleFromStorage,
  saveSessionStyleToStorage,
  type SessionStyleState,
} from '../lib/sessionStyle'
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
import {
  applyWeatherFollowUp,
  buildWeatherDiag,
  buildWeatherSuccessExchange,
  clearPendingWeatherRequest,
  clearWeatherContext,
  detectWeatherLanguage,
  geoFailureCopy,
  getBrowserPosition,
  isWeatherDiagEnabled,
  loadPendingWeatherRequest,
  loadWeatherContext,
  logWeatherSafe,
  mapStatusToCopyKey,
  rememberWeatherDiag,
  requestWeather,
  saveWeatherContext,
  weatherCopy,
  WEATHER_ENTER_AREA_TRIGGER,
  WEATHER_USE_LOCATION_TRIGGER,
} from '../lib/weather'
import {
  applyCalculatorIntent,
  buildCalculatorDiag,
  clearCalculationContext,
  detectCalculatorIntent,
  detectCalculatorLanguage,
  isCalculatorDiagEnabled,
  loadCalculationContext,
  logCalculatorSafe,
  rememberCalculatorDiag,
  saveCalculationContext,
} from '../lib/calculator'
import {
  applyUnitConversionIntent,
  buildUnitConversionDiag,
  clearConversionContext,
  detectUnitConversionIntent,
  detectUnitConversionLanguage,
  isUnitConversionDiagEnabled,
  loadConversionContext,
  logUnitConversionSafe,
  rememberUnitConversionDiag,
  saveConversionContext,
} from '../lib/unitConversion'
import {
  applyEnergyMathIntent,
  buildEnergyMathDiag,
  clearEnergyMathContext,
  detectEnergyMathIntent,
  detectEnergyMathLanguage,
  isEnergyMathDiagEnabled,
  loadEnergyMathContext,
  logEnergyMathSafe,
  rememberEnergyMathDiag,
  saveEnergyMathContext,
} from '../lib/energyMath'
import {
  applyDailyBriefingIntent,
  buildDailyBriefingDiag,
  clearBriefingContext,
  detectBriefingLanguage,
  detectBriefingPreferenceIntent,
  detectDailyBriefingIntent,
  isDailyBriefingDiagEnabled,
  loadBriefingContext,
  logDailyBriefingSafe,
  preferenceAck,
  rememberDailyBriefingDiag,
  saveBriefingContext,
} from '../lib/dailyBriefing'
import {
  applyCalendarIntent,
  detectCalendarIntent,
  loadCalendarContext,
  saveCalendarContext,
} from '../lib/calendar-chat'
import {
  applyEmailIntent,
  detectEmailIntent,
  loadEmailContext,
  saveEmailContext,
} from '../lib/email-chat'
import {
  applyPlacesIntent,
  clearPendingPlacesRequest,
  detectPlacesIntent,
  geoFailureCopy as placesGeoFailureCopy,
  loadPendingPlacesRequest,
  loadPlacesContext,
  placesCopy,
  PLACES_USE_LOCATION_TRIGGER,
  savePlacesContext,
} from '../lib/places-chat'
import { getBrowserPosition as getBrowserPositionForPlaces } from '../lib/geolocation.js'
import {
  applyTranslationIntent,
  buildTranslationDiag,
  clearTranslationContext,
  detectTranslationIntent,
  detectTranslationLanguage,
  isTranslationDiagEnabled,
  loadTranslationContext,
  logTranslationSafe,
  rememberTranslationDiag,
  saveTranslationContext,
} from '../lib/translation'
import { analyzeOuterUserRequest } from '../lib/outer-content-gate'
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
  type DailyBriefingSettings,
  type PersonalizationSettings,
  type ThemeSettings,
  type V2DebugInfo,
  type WebCitation,
  DEFAULT_BRIEFING_SETTINGS,
} from '../types'
import { normalizeBriefingSettings } from '../lib/daily-briefing/preferences.js'
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
    briefing: { ...DEFAULT_BRIEFING_SETTINGS },
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
      briefing?: Partial<DailyBriefingSettings>
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
      // #334C — old blobs without briefing → safe defaults (no migration).
      briefing: normalizeBriefingSettings(parsed.briefing) as DailyBriefingSettings,
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
  /** #326 — session-only Core presentation fingerprints (never Memory). */
  sessionStyle: SessionStyleState
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
  | { type: 'UPDATE_BRIEFING'; payload: Partial<DailyBriefingSettings> }
  | { type: 'SEND_USER'; content: string; attachments?: ChatAttachment[] }
  /** #314/#315/#317/#318 — local user+assistant exchange; no model call. */
  | {
      type: 'LOCAL_EXCHANGE'
      userContent: string
      assistantContent: string
      weatherUi?: import('../types').WeatherUiState | null
      calculatorUi?: import('../types').CalculatorUiState | null
      unitConversionUi?: import('../types').UnitConversionUiState | null
      energyMathUi?: import('../types').EnergyMathUiState | null
      dailyBriefingUi?: import('../types').DailyBriefingUiState | null
      translationUi?: import('../types').TranslationUiState | null
      calendarUi?: import('../types').CalendarUiState | null
      placesUi?: import('../types').PlacesUiState | null
    }
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
  | { type: 'TRIM_TO'; count: number; thinking?: boolean; rollbackSessionStyle?: boolean }

function createInitialState(): AppState {
  return {
    messages: [],
    settings: loadSettings(),
    settingsOpen: false,
    isThinking: false,
    isStreaming: false,
    topicMemory: createEmptyMemory(),
    sessionStyle: loadSessionStyleFromStorage(),
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
        sessionStyle: createEmptySessionStyleState(),
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
    case 'UPDATE_BRIEFING': {
      const next: AppSettings = {
        ...state.settings,
        briefing: normalizeBriefingSettings({
          ...state.settings.briefing,
          ...action.payload,
        }) as DailyBriefingSettings,
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
        ...(action.weatherUi ? { weatherUi: action.weatherUi } : {}),
        ...(action.calculatorUi ? { calculatorUi: action.calculatorUi } : {}),
        ...(action.unitConversionUi ? { unitConversionUi: action.unitConversionUi } : {}),
        ...(action.energyMathUi ? { energyMathUi: action.energyMathUi } : {}),
        ...(action.dailyBriefingUi ? { dailyBriefingUi: action.dailyBriefingUi } : {}),
        ...(action.translationUi ? { translationUi: action.translationUi } : {}),
        ...(action.calendarUi ? { calendarUi: action.calendarUi } : {}),
        ...(action.placesUi ? { placesUi: action.placesUi } : {}),
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
        // #326 — Core-only style update (ASSISTANT_FINISH is never used by capability routes).
        sessionStyle: applyCoreAssistantStyleUpdate(state.sessionStyle, action.content),
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
        sessionStyle:
          action.rollbackSessionStyle === true
            ? applyRegenerateStyleRollback(state.sessionStyle)
            : state.sessionStyle,
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
  /** #334C — device-local Daily Briefing presentation prefs. */
  updateBriefing: (patch: Partial<DailyBriefingSettings>) => void
  /** Returns true when the user turn was accepted into the thread. */
  sendMessage: (content: string, attachments?: ChatAttachment[]) => boolean
  /** #317 — Weather UI action chips (location grant). */
  handleWeatherUiAction: (actionId: string) => void
  /** #318 — Calculator result chip actions (copy). */
  handleCalculatorUiAction: (actionId: string) => void
  /** #319 — Unit Conversion result chip actions (copy). */
  handleUnitConversionUiAction: (actionId: string) => void
  /** #320 — Energy Math result chip actions (copy / show calculation). */
  handleEnergyMathUiAction: (actionId: string) => void
  /** #322 — Translation result chip actions (copy). */
  handleTranslationUiAction: (actionId: string) => void
  /** #336B — Calendar status chip actions (open Settings). */
  handleCalendarUiAction: (actionId: string) => void
  /** #355B — Places status chip actions (location grant / navigate). */
  handlePlacesUiAction: (actionId: string) => void
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
  const sessionStyleRef = useRef(state.sessionStyle)
  sessionStyleRef.current = state.sessionStyle

  // #326 — mirror session style to sessionStorage (same-tab refresh).
  useEffect(() => {
    saveSessionStyleToStorage(state.sessionStyle)
  }, [state.sessionStyle])
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
    try {
      clearWeatherContext()
      clearPendingWeatherRequest()
    } catch {
      /* ignore */
    }
    try {
      clearCalculationContext()
    } catch {
      /* ignore */
    }
    try {
      clearConversionContext()
    } catch {
      /* ignore */
    }
    try {
      clearEnergyMathContext()
    } catch {
      /* ignore */
    }
    try {
      clearBriefingContext()
    } catch {
      /* ignore */
    }
    try {
      clearTranslationContext()
    } catch {
      /* ignore */
    }
    try {
      clearSessionStyleStorage()
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

  const updateBriefing = useCallback((payload: Partial<DailyBriefingSettings>) => {
    dispatch({ type: 'UPDATE_BRIEFING', payload })
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
              sessionStyle: sessionStyleRef.current as unknown as Record<string, unknown>,
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

  const runWeatherProvider = useCallback(
    async (opts: {
      intent: {
        operation?: string
        locationText?: string | null
        timeHint?: string | null
        language?: 'it' | 'en'
        complexAdvice?: boolean
      }
      language: 'it' | 'en'
      userContent: string
      latitude?: number
      longitude?: number
      locationSource?: 'explicit' | 'gps'
    }) => {
      const lang = opts.language
      const result = (await requestWeather({
        operation: opts.intent.operation || 'current',
        timeHint: opts.intent.timeHint || null,
        language: lang,
        locationText: opts.intent.locationText || null,
        latitude: opts.latitude,
        longitude: opts.longitude,
      })) as Record<string, unknown>

      if (result.status === 'geocode_ambiguous' && Array.isArray(result.geocodeCandidates)) {
        const options = (result.geocodeCandidates as Array<Record<string, unknown>>)
          .slice(0, 5)
          .map((c, i) => {
            const bits = [c.name, c.admin1, c.country].filter(Boolean).join(', ')
            return `${i + 1}. ${bits}`
          })
          .join('\n')
        dispatch({
          type: 'LOCAL_EXCHANGE',
          userContent: opts.userContent,
          assistantContent: weatherCopy('geocode_ambiguous', lang, { options }),
        })
        logWeatherSafe({
          operation: opts.intent.operation,
          locationSource: 'explicit',
          status: 'geocode_ambiguous',
          failureCode: 'geocode_ambiguous',
        })
        return
      }

      if (result.status !== 'ok') {
        dispatch({
          type: 'LOCAL_EXCHANGE',
          userContent: opts.userContent,
          assistantContent: weatherCopy(mapStatusToCopyKey(String(result.status)), lang),
        })
        logWeatherSafe({
          operation: opts.intent.operation,
          locationSource: opts.locationSource || null,
          status: String(result.status),
          failureCode: (result.failureCode as string) || null,
        })
        if (isWeatherDiagEnabled()) {
          rememberWeatherDiag(
            buildWeatherDiag({
              weatherIntent: 'weather',
              operation: opts.intent.operation,
              timeHint: opts.intent.timeHint,
              locationSource: opts.locationSource || null,
              geocodeReached: Boolean(result.geocodeReached),
              providerRequestReached: Boolean(result.providerRequestReached),
              providerHttpStatus: result.providerHttpStatus as number | null,
              failureCode: (result.failureCode as string) || String(result.status),
              requestId: result.requestId as string | undefined,
            }),
          )
        }
        return
      }

      const built = buildWeatherSuccessExchange({
        weather: result,
        language: lang,
        operation: opts.intent.operation,
        timeHint: opts.intent.timeHint,
        locationText: opts.intent.locationText,
        latitude: opts.latitude,
        longitude: opts.longitude,
        locationSource: opts.locationSource || (opts.intent.locationText ? 'explicit' : 'gps'),
        complexAdvice: Boolean(opts.intent.complexAdvice),
      })
      if (built.weatherContext) saveWeatherContext(built.weatherContext)
      clearPendingWeatherRequest()
      dispatch({
        type: 'LOCAL_EXCHANGE',
        userContent: opts.userContent,
        assistantContent: built.reply,
        weatherUi: (built.weatherUi as import('../types').WeatherUiState | null) || null,
      })
      logWeatherSafe({
        operation: opts.intent.operation,
        locationSource: opts.locationSource || null,
        status: 'ok',
        cacheHit: false,
      })
      if (isWeatherDiagEnabled()) {
        rememberWeatherDiag(
          buildWeatherDiag({
            weatherIntent: 'weather',
            operation: opts.intent.operation,
            timeHint: opts.intent.timeHint,
            locationSource: opts.locationSource || null,
            geocodeReached: Boolean(result.geocodeReached),
            providerRequestReached: Boolean(result.providerRequestReached),
            providerHttpStatus: result.providerHttpStatus as number | null,
            hourlyDataPresent: Array.isArray(result.hourly) && (result.hourly as unknown[]).length > 0,
            dailyDataPresent: Array.isArray(result.daily) && (result.daily as unknown[]).length > 0,
            forecastDays: 7,
            cacheHit: false,
            activeWeatherContextCreated: Boolean(built.activeWeatherContextCreated),
            requestId: result.requestId as string | undefined,
          }),
        )
      }
    },
    [],
  )

  const runWeatherWithGeolocation = useCallback(
    async (lang: 'it' | 'en') => {
      const pending = loadPendingWeatherRequest()
      const userLabel = lang === 'en' ? 'Use my location' : 'Usa la mia posizione'
      dispatch({
        type: 'LOCAL_EXCHANGE',
        userContent: userLabel,
        assistantContent: lang === 'en' ? 'Checking your location…' : 'Controllo la tua posizione…',
      })
      const pos = await getBrowserPosition()
      if (!pos.ok) {
        dispatch({
          type: 'LOCAL_EXCHANGE',
          userContent: userLabel,
          assistantContent: geoFailureCopy(pos.code, lang),
          weatherUi: {
            kind: 'location_permission',
            actions: [{ id: 'enter_area', label: weatherCopy('enter_area_btn', lang) }],
          },
        })
        logWeatherSafe({ status: 'location_denied', failureCode: pos.code, locationSource: 'gps' })
        if (isWeatherDiagEnabled()) {
          rememberWeatherDiag(
            buildWeatherDiag({
              weatherIntent: 'weather',
              operation: pending?.operation || 'current',
              locationSource: 'gps',
              failureCode: pos.code,
            }),
          )
        }
        return
      }
      await runWeatherProvider({
        intent: {
          operation: pending?.operation || 'current',
          timeHint: pending?.timeHint || null,
          language: pending?.language || lang,
          complexAdvice: Boolean(pending?.complexAdvice),
          locationText: null,
        },
        language: pending?.language || lang,
        userContent: userLabel,
        latitude: pos.latitude,
        longitude: pos.longitude,
        locationSource: 'gps',
      })
    },
    [runWeatherProvider],
  )

  const handleWeatherUiAction = useCallback(
    (actionId: string) => {
      if (actionId === 'use_location') {
        void runWeatherWithGeolocation(detectWeatherLanguage('', 'it') as 'it' | 'en')
        return
      }
      if (actionId === 'enter_area') {
        const follow = applyWeatherFollowUp({
          text: WEATHER_ENTER_AREA_TRIGGER,
          languageHint: 'it',
          weatherContext: loadWeatherContext(),
        })
        dispatch({
          type: 'LOCAL_EXCHANGE',
          userContent: 'Inserisci zona',
          assistantContent: follow.reply || weatherCopy('enter_area', 'it'),
        })
      }
    },
    [runWeatherWithGeolocation],
  )

  const handleCalendarUiAction = useCallback(
    (actionId: string) => {
      if (actionId === 'open_settings') {
        dispatch({ type: 'OPEN_SETTINGS' })
      }
    },
    [],
  )

  // #355B — resolve a Places follow-up (chip tap or synthetic sentinel text)
  // against the stored session context. Zero model calls; always terminates
  // locally when the text is Places-shaped.
  const runPlacesFollowUp = useCallback(async (text: string, langHint: 'it' | 'en') => {
    const placesCtx = loadPlacesContext()
    try {
      const result = await applyPlacesIntent({
        text,
        languageHint: langHint,
        placesContext: placesCtx,
      })
      if (result.placesContext) {
        savePlacesContext(result.placesContext)
      } else if (result.placesContext === null) {
        savePlacesContext(null)
      }
      if (result.handled && result.reply) {
        dispatch({
          type: 'LOCAL_EXCHANGE',
          userContent: text,
          assistantContent: result.reply,
          placesUi: (result.placesUi as import('../types').PlacesUiState | null) || null,
        })
      }
    } catch {
      dispatch({
        type: 'LOCAL_EXCHANGE',
        userContent: text,
        assistantContent:
          langHint === 'en'
            ? 'Places search failed right now.'
            : 'La ricerca luoghi non è riuscita al momento.',
      })
    }
  }, [])

  // #355B — after explicit "Usa la mia posizione" grant, re-run the pending
  // Places query (same original text) now WITH coordinates. Coordinates are
  // only ever passed transiently into applyPlacesIntent — never stored.
  const runPlacesWithGeolocation = useCallback(async (langHint: 'it' | 'en') => {
    const pending = loadPendingPlacesRequest()
    const lang = (pending?.language as 'it' | 'en' | undefined) || langHint
    const userLabel = lang === 'en' ? 'Use my location' : 'Usa la mia posizione'
    dispatch({
      type: 'LOCAL_EXCHANGE',
      userContent: userLabel,
      assistantContent: lang === 'en' ? 'Checking your location…' : 'Controllo la tua posizione…',
    })
    const pos = await getBrowserPositionForPlaces()
    if (!pos.ok) {
      dispatch({
        type: 'LOCAL_EXCHANGE',
        userContent: userLabel,
        assistantContent: placesGeoFailureCopy(pos.code, lang),
      })
      return
    }
    const placesCtx = loadPlacesContext()
    const text = pending?.text || PLACES_USE_LOCATION_TRIGGER
    try {
      const result = await applyPlacesIntent({
        text,
        languageHint: lang,
        placesContext: placesCtx,
        latitude: pos.latitude,
        longitude: pos.longitude,
      })
      if (result.placesContext) savePlacesContext(result.placesContext)
      dispatch({
        type: 'LOCAL_EXCHANGE',
        userContent: userLabel,
        assistantContent:
          result.reply || placesCopy('error', lang),
        placesUi: (result.placesUi as import('../types').PlacesUiState | null) || null,
      })
    } catch {
      dispatch({
        type: 'LOCAL_EXCHANGE',
        userContent: userLabel,
        assistantContent: placesCopy('error', lang),
      })
    } finally {
      clearPendingPlacesRequest()
    }
  }, [])

  const handlePlacesUiAction = useCallback(
    (actionId: string) => {
      const sticky = deriveDictationLangFromMessages(state.messages)
      const langHint = sticky === 'en' ? 'en' : 'it'
      if (actionId === 'use_location') {
        void runPlacesWithGeolocation(langHint)
        return
      }
      if (actionId === 'navigate') {
        void runPlacesFollowUp(langHint === 'en' ? 'take me there' : 'Portami lì', langHint)
        return
      }
      if (actionId === 'maps') {
        void runPlacesFollowUp(langHint === 'en' ? 'open it on maps' : 'Aprilo su Maps', langHint)
      }
    },
    [state.messages, runPlacesWithGeolocation, runPlacesFollowUp],
  )

  const handleCalculatorUiAction = useCallback((actionId: string) => {
    if (actionId !== 'copy_result') return
    const calc = applyCalculatorIntent({
      text: 'Copia il risultato',
      languageHint: 'it',
      calcContext: loadCalculationContext(),
      env: {
        copyTextSync: (text: string) => {
          try {
            const area = document.createElement('textarea')
            area.value = text
            area.setAttribute('readonly', '')
            area.style.position = 'fixed'
            area.style.opacity = '0'
            document.body.appendChild(area)
            area.select()
            const ok = document.execCommand('copy')
            document.body.removeChild(area)
            return ok
          } catch {
            return false
          }
        },
      },
    })
    if (calc.handled && calc.reply) {
      dispatch({
        type: 'LOCAL_EXCHANGE',
        userContent: 'Copia',
        assistantContent: calc.reply,
      })
      if (isCalculatorDiagEnabled()) {
        rememberCalculatorDiag(buildCalculatorDiag(calc.diag || {}))
      }
    }
  }, [])

  const handleUnitConversionUiAction = useCallback((actionId: string) => {
    if (actionId !== 'copy_result') return
    const unit = applyUnitConversionIntent({
      text: 'Copia il risultato',
      languageHint: 'it',
      conversionContext: loadConversionContext(),
      env: {
        copyTextSync: (text: string) => {
          try {
            const area = document.createElement('textarea')
            area.value = text
            area.setAttribute('readonly', '')
            area.style.position = 'fixed'
            area.style.opacity = '0'
            document.body.appendChild(area)
            area.select()
            const ok = document.execCommand('copy')
            document.body.removeChild(area)
            return ok
          } catch {
            return false
          }
        },
      },
    })
    if (unit.handled && unit.reply) {
      dispatch({
        type: 'LOCAL_EXCHANGE',
        userContent: 'Copia',
        assistantContent: unit.reply,
      })
      if (isUnitConversionDiagEnabled()) {
        rememberUnitConversionDiag(buildUnitConversionDiag(unit.diag || {}))
      }
    }
  }, [])

  const handleEnergyMathUiAction = useCallback((actionId: string) => {
    if (actionId !== 'copy_result' && actionId !== 'show_calculation') return
    const text = actionId === 'show_calculation' ? 'Spiegami il calcolo' : 'Copia il risultato'
    const em = applyEnergyMathIntent({
      text,
      languageHint: 'it',
      energyContext: loadEnergyMathContext(),
      env: {
        copyTextSync: (t: string) => {
          try {
            const area = document.createElement('textarea')
            area.value = t
            area.setAttribute('readonly', '')
            area.style.position = 'fixed'
            area.style.opacity = '0'
            document.body.appendChild(area)
            area.select()
            const ok = document.execCommand('copy')
            document.body.removeChild(area)
            return ok
          } catch {
            return false
          }
        },
      },
    })
    if (em.handled && em.reply) {
      dispatch({
        type: 'LOCAL_EXCHANGE',
        userContent: actionId === 'show_calculation' ? 'Mostra calcolo' : 'Copia',
        assistantContent: em.reply,
        energyMathUi: (em.energyUi as import('../types').EnergyMathUiState | null) || null,
      })
      if (isEnergyMathDiagEnabled()) {
        rememberEnergyMathDiag(buildEnergyMathDiag(em.diag || {}))
      }
    }
  }, [])

  const handleTranslationUiAction = useCallback((actionId: string) => {
    if (actionId !== 'copy') return
    void (async () => {
      const result = await applyTranslationIntent({
        text: 'Copia la traduzione',
        languageHint: 'it',
        translationContext: loadTranslationContext(),
        env: {
          copyTextSync: (t: string) => {
            try {
              const area = document.createElement('textarea')
              area.value = t
              area.setAttribute('readonly', '')
              area.style.position = 'fixed'
              area.style.opacity = '0'
              document.body.appendChild(area)
              area.select()
              const ok = document.execCommand('copy')
              document.body.removeChild(area)
              return ok
            } catch {
              return false
            }
          },
        },
      })
      if (result.handled && result.reply) {
        dispatch({
          type: 'LOCAL_EXCHANGE',
          userContent: 'Copia',
          assistantContent: result.reply,
        })
        if (isTranslationDiagEnabled()) {
          rememberTranslationDiag(buildTranslationDiag(result.diag || {}))
        }
      }
    })()
  }, [])

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

      // #330A3 — CONTENT IS NOT AUTHORIZATION: shared outer-content gate.
      // When the user is explaining/analyzing/pasting/documenting, embedded
      // capability phrases must not authorize LOCAL_EXCHANGE routers.
      const outerContent =
        content && wireAtts.length === 0
          ? analyzeOuterUserRequest(content)
          : {
              contentIsData: false,
              localRoutersSuppressed: false,
              outerContentMode: 'direct' as const,
              outerFrame: 'none',
              outerSurface: '',
              reason: null as string | null,
            }
      const allowLocalRouters =
        Boolean(content) && wireAtts.length === 0 && !outerContent.localRoutersSuppressed

      // #322 — Translation OUTER GUARD before Timer / Phone / all action routers.
      // Text-only only: attachments keep Document / Vision pipelines authoritative.
      if (allowLocalRouters) {
        const sticky = deriveDictationLangFromMessages(state.messages)
        const langHint =
          sticky === 'en'
            ? 'en'
            : sticky === 'it'
              ? 'it'
              : detectTranslationLanguage(content, detectTimerLanguage(content, 'it'))
        const translationCtx = loadTranslationContext()
        const translationIntent = detectTranslationIntent(content, {
          languageHint: langHint,
          hasTranslationContext: Boolean(translationCtx),
        })
        if (translationIntent.intent === 'translation') {
          void (async () => {
            try {
              const result = await applyTranslationIntent({
                text: content,
                languageHint: langHint,
                translationContext: translationCtx,
                messages: state.messages.map((m) => ({
                  role: m.role,
                  content: String(m.content || ''),
                })),
                env: {
                  copyTextSync: (text: string) => {
                    try {
                      const area = document.createElement('textarea')
                      area.value = text
                      area.setAttribute('readonly', '')
                      area.style.position = 'fixed'
                      area.style.opacity = '0'
                      document.body.appendChild(area)
                      area.select()
                      const ok = document.execCommand('copy')
                      document.body.removeChild(area)
                      return ok
                    } catch {
                      return false
                    }
                  },
                },
              })
              const reply =
                result.handled && result.reply
                  ? result.reply
                  : langHint === 'en'
                    ? 'I couldn’t complete the translation right now.'
                    : 'Non riesco a completare la traduzione in questo momento.'
              if (result.translationContext) saveTranslationContext(result.translationContext)
              dispatch({
                type: 'LOCAL_EXCHANGE',
                userContent: content,
                assistantContent: reply,
                translationUi:
                  (result.translationUi as import('../types').TranslationUiState | null) || null,
              })
              logTranslationSafe({
                operation: (result.diag?.operation as string) || null,
                targetLanguage: (result.diag?.targetLanguage as string) || null,
                contextReused: Boolean(result.diag?.contextReused),
                status: (result.diag?.status as string) || null,
                failureCode: (result.diag?.failureCode as string) || null,
              })
              if (isTranslationDiagEnabled()) {
                rememberTranslationDiag(buildTranslationDiag(result.diag || {}))
              }
            } catch {
              dispatch({
                type: 'LOCAL_EXCHANGE',
                userContent: content,
                assistantContent:
                  langHint === 'en'
                    ? 'I couldn’t complete the translation right now.'
                    : 'Non riesco a completare la traduzione in questo momento.',
              })
            }
          })()
          return true
        }
      }

      // #314 — deterministic timer / alarm honesty (no attachments). Never LLM-owned time.
      if (allowLocalRouters) {
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
      if (allowLocalRouters) {
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

      // #336B — Calendar chat before Daily Briefing (claims "Cosa ho oggi/domani?").
      // CRITICAL: matched Calendar intents MUST return here (LOCAL_EXCHANGE only).
      // Never fall through to /api/chat — including disabled/disconnected/error.
      if (allowLocalRouters) {
        const sticky = deriveDictationLangFromMessages(state.messages)
        const langHint =
          sticky === 'en'
            ? 'en'
            : sticky === 'it'
              ? 'it'
              : detectBriefingLanguage(content, detectTimerLanguage(content, 'it'))
        const calendarCtx = loadCalendarContext()
        const calendarIntent = detectCalendarIntent(content, {
          languageHint: langHint,
          hasCalendarContext: Boolean(calendarCtx),
        })
        if (calendarIntent.intent === 'calendar') {
          void (async () => {
            try {
              const cal = await applyCalendarIntent({
                text: content,
                languageHint: langHint,
                calendarContext: calendarCtx,
              })
              const reply =
                cal.handled && cal.reply
                  ? cal.reply
                  : langHint === 'en'
                    ? 'I couldn’t read the calendar right now.'
                    : 'Non riesco a leggere il calendario in questo momento.'
              if (cal.calendarContext) saveCalendarContext(cal.calendarContext)
              dispatch({
                type: 'LOCAL_EXCHANGE',
                userContent: content,
                assistantContent: reply,
                calendarUi:
                  (cal.calendarUi as import('../types').CalendarUiState | null) || null,
              })
            } catch {
              dispatch({
                type: 'LOCAL_EXCHANGE',
                userContent: content,
                assistantContent:
                  langHint === 'en'
                    ? 'I couldn’t read the calendar right now.'
                    : 'Non riesco a leggere il calendario in questo momento.',
              })
            }
          })()
          return true
        }
      }

      // #337B — Gmail read-only chat. CRITICAL: matched Email intents MUST terminate locally.
      // Never fall through to /api/chat — including disabled/disconnected/error. Calendar
      // (above) is FROZEN: this block is a pure insertion, no Calendar behavior changed.
      if (allowLocalRouters) {
        const sticky = deriveDictationLangFromMessages(state.messages)
        const langHint =
          sticky === 'en'
            ? 'en'
            : sticky === 'it'
              ? 'it'
              : detectBriefingLanguage(content, detectTimerLanguage(content, 'it'))
        const emailCtx = loadEmailContext()
        const emailIntent = detectEmailIntent(content, {
          languageHint: langHint,
          hasEmailContext: Boolean(emailCtx),
        })
        if (emailIntent.intent === 'email') {
          void (async () => {
            try {
              const mail = await applyEmailIntent({
                text: content,
                languageHint: langHint,
                emailContext: emailCtx,
              })
              const reply =
                mail.handled && mail.reply
                  ? mail.reply
                  : langHint === 'en'
                    ? 'I couldn’t read Gmail right now.'
                    : 'Non riesco a leggere Gmail in questo momento.'
              if (mail.emailContext) saveEmailContext(mail.emailContext)
              dispatch({
                type: 'LOCAL_EXCHANGE',
                userContent: content,
                assistantContent: reply,
              })
            } catch {
              dispatch({
                type: 'LOCAL_EXCHANGE',
                userContent: content,
                assistantContent:
                  langHint === 'en'
                    ? 'I couldn’t read Gmail right now.'
                    : 'Non riesco a leggere Gmail in questo momento.',
              })
            }
          })()
          return true
        }
      }

      // #355B — Places (nearby search) after Email, before Daily Briefing / Weather.
      // CRITICAL: matched Places intents MUST terminate locally (LOCAL_EXCHANGE only).
      // Phone Actions (above) still owns bare "Apri Google Maps"; Weather (below)
      // still owns weather-shaped "vicino" cues via its own keyword gate — Places
      // only claims when a place-category word (farmacia/bar/…) or a named place
      // is paired with a proximity cue.
      if (allowLocalRouters) {
        const sticky = deriveDictationLangFromMessages(state.messages)
        const langHint =
          sticky === 'en'
            ? 'en'
            : sticky === 'it'
              ? 'it'
              : detectBriefingLanguage(content, detectTimerLanguage(content, 'it'))
        const placesCtx = loadPlacesContext()
        const placesIntent = detectPlacesIntent(content, {
          languageHint: langHint,
          hasPlacesContext: Boolean(placesCtx),
        })
        if (placesIntent.intent === 'places') {
          void (async () => {
            try {
              const places = await applyPlacesIntent({
                text: content,
                languageHint: langHint,
                placesContext: placesCtx,
              })
              const reply =
                places.handled && places.reply
                  ? places.reply
                  : langHint === 'en'
                    ? 'Places search failed right now.'
                    : 'La ricerca luoghi non è riuscita al momento.'
              savePlacesContext(places.placesContext ?? null)
              dispatch({
                type: 'LOCAL_EXCHANGE',
                userContent: content,
                assistantContent: reply,
                placesUi: (places.placesUi as import('../types').PlacesUiState | null) || null,
              })
            } catch {
              dispatch({
                type: 'LOCAL_EXCHANGE',
                userContent: content,
                assistantContent:
                  langHint === 'en'
                    ? 'Places search failed right now.'
                    : 'La ricerca luoghi non è riuscita al momento.',
              })
            }
          })()
          return true
        }
      }

      // #321/#334C — Daily Briefing before Energy Math / Unit / Calc / Weather.
      if (allowLocalRouters) {
        const sticky = deriveDictationLangFromMessages(state.messages)
        const langHint =
          sticky === 'en'
            ? 'en'
            : sticky === 'it'
              ? 'it'
              : detectBriefingLanguage(content, detectTimerLanguage(content, 'it'))

        // Persistent preference commands (explicit only; never Memory).
        const prefIntent = detectBriefingPreferenceIntent(content)
        if (prefIntent?.persist && prefIntent.patch) {
          updateBriefing(prefIntent.patch)
          const ack =
            preferenceAck(prefIntent.patch, prefIntent.language || langHint, true) ||
            (langHint === 'en' ? 'Preference saved.' : 'Preferenza salvata.')
          dispatch({
            type: 'LOCAL_EXCHANGE',
            userContent: content,
            assistantContent: ack,
          })
          return true
        }

        const briefingCtx = loadBriefingContext()
        const briefingIntent = detectDailyBriefingIntent(content, {
          languageHint: langHint,
          hasBriefingContext: Boolean(briefingCtx),
        })
        if (briefingIntent.intent === 'daily-briefing') {
          void (async () => {
            try {
              const brief = await applyDailyBriefingIntent({
                text: content,
                languageHint: langHint,
                briefingContext: briefingCtx,
                weatherContext: loadWeatherContext(),
                briefingPrefs: state.settings.briefing,
                oneShotLength: prefIntent?.oneShotLength || null,
                oneShotHideWeather: Boolean(prefIntent?.oneShotHideWeather),
              })
              const reply =
                brief.handled && brief.reply
                  ? brief.reply
                  : langHint === 'en'
                    ? 'I couldn’t build the briefing right now. Try again shortly.'
                    : 'Non riesco a costruire il briefing in questo momento. Riprova tra poco.'
              if (brief.briefingContext) saveBriefingContext(brief.briefingContext)
              dispatch({
                type: 'LOCAL_EXCHANGE',
                userContent: content,
                assistantContent: reply,
                dailyBriefingUi:
                  (brief.briefingUi as import('../types').DailyBriefingUiState | null) || null,
              })
              logDailyBriefingSafe({
                calendarStatus: (brief.diag?.calendarStatus as string) || null,
                reminderStatus: (brief.diag?.reminderStatus as string) || null,
                weatherStatus: (brief.diag?.weatherStatus as string) || null,
                partialSuccess: Boolean(brief.diag?.partialSuccess),
                failureCode: (brief.diag?.failureCode as string) || null,
              })
              if (isDailyBriefingDiagEnabled()) {
                rememberDailyBriefingDiag(buildDailyBriefingDiag(brief.diag || {}))
              }
            } catch {
              dispatch({
                type: 'LOCAL_EXCHANGE',
                userContent: content,
                assistantContent:
                  langHint === 'en'
                    ? 'I couldn’t build the briefing right now. Try again shortly.'
                    : 'Non riesco a costruire il briefing in questo momento. Riprova tra poco.',
              })
            }
          })()
          return true
        }
      }

      // #320 — Energy Math before Unit Conversion (composition vs convert).
      if (allowLocalRouters) {
        const sticky = deriveDictationLangFromMessages(state.messages)
        const langHint =
          sticky === 'en'
            ? 'en'
            : sticky === 'it'
              ? 'it'
              : detectEnergyMathLanguage(content, detectTimerLanguage(content, 'it'))
        const energyCtx = loadEnergyMathContext()
        const energyIntent = detectEnergyMathIntent(content, {
          languageHint: langHint,
          hasEnergyContext: Boolean(energyCtx),
        })
        if (energyIntent.intent === 'energy-math') {
          const em = applyEnergyMathIntent({
            text: content,
            languageHint: langHint,
            energyContext: energyCtx,
            env: {
              copyTextSync: (text: string) => {
                try {
                  const area = document.createElement('textarea')
                  area.value = text
                  area.setAttribute('readonly', '')
                  area.style.position = 'fixed'
                  area.style.opacity = '0'
                  document.body.appendChild(area)
                  area.select()
                  const ok = document.execCommand('copy')
                  document.body.removeChild(area)
                  return ok
                } catch {
                  return false
                }
              },
            },
          })
          if (em.handled && em.reply) {
            if (em.energyContext) saveEnergyMathContext(em.energyContext)
            dispatch({
              type: 'LOCAL_EXCHANGE',
              userContent: content,
              assistantContent: em.reply,
              energyMathUi: (em.energyUi as import('../types').EnergyMathUiState | null) || null,
            })
            logEnergyMathSafe({
              operation: String(em.diag.operation || ''),
              inputDimensions: em.diag.inputDimensions ?? null,
              outputDimension: (em.diag.outputDimension as string) || null,
              parserStatus: (em.diag.parserStatus as string) || null,
              assumptionMode: (em.diag.assumptionMode as string) || null,
              failureCode: (em.diag.failureCode as string) || null,
              contextReused: Boolean(em.diag.contextReused),
            })
            if (isEnergyMathDiagEnabled()) {
              rememberEnergyMathDiag(buildEnergyMathDiag(em.diag || {}))
            }
            return true
          }
        }
      }

      // #319 — Unit Conversion before Calculator + Weather (protects "25 gradi… in °F").
      if (allowLocalRouters) {
        const sticky = deriveDictationLangFromMessages(state.messages)
        const langHint =
          sticky === 'en'
            ? 'en'
            : sticky === 'it'
              ? 'it'
              : detectUnitConversionLanguage(content, detectTimerLanguage(content, 'it'))
        const convCtx = loadConversionContext()
        const unitIntent = detectUnitConversionIntent(content, {
          languageHint: langHint,
          hasConversionContext: Boolean(convCtx),
        })
        if (unitIntent.intent === 'unit-conversion') {
          const unit = applyUnitConversionIntent({
            text: content,
            languageHint: langHint,
            conversionContext: convCtx,
            env: {
              copyTextSync: (text: string) => {
                try {
                  const area = document.createElement('textarea')
                  area.value = text
                  area.setAttribute('readonly', '')
                  area.style.position = 'fixed'
                  area.style.opacity = '0'
                  document.body.appendChild(area)
                  area.select()
                  const ok = document.execCommand('copy')
                  document.body.removeChild(area)
                  return ok
                } catch {
                  return false
                }
              },
            },
          })
          if (unit.handled && unit.reply) {
            if (unit.conversionContext) saveConversionContext(unit.conversionContext)
            dispatch({
              type: 'LOCAL_EXCHANGE',
              userContent: content,
              assistantContent: unit.reply,
              unitConversionUi:
                (unit.unitUi as import('../types').UnitConversionUiState | null) || null,
            })
            logUnitConversionSafe({
              operation: String(unit.diag.operation || ''),
              dimension: (unit.diag.dimension as string) || null,
              sourceUnit: (unit.diag.sourceUnit as string) || null,
              targetUnit: (unit.diag.targetUnit as string) || null,
              parserStatus: (unit.diag.parserStatus as string) || null,
              failureCode: (unit.diag.failureCode as string) || null,
              contextReused: Boolean(unit.diag.contextReused),
            })
            if (isUnitConversionDiagEnabled()) {
              rememberUnitConversionDiag(buildUnitConversionDiag(unit.diag || {}))
            }
            return true
          }
        }
      }

      // #318 — clear Calculator intents before Weather so "Quanto fa 15%…"
      // is not stolen by temperature heuristics (Weather module untouched).
      if (allowLocalRouters) {
        const sticky = deriveDictationLangFromMessages(state.messages)
        const langHint =
          sticky === 'en'
            ? 'en'
            : sticky === 'it'
              ? 'it'
              : detectCalculatorLanguage(content, detectTimerLanguage(content, 'it'))
        const calcCtxEarly = loadCalculationContext()
        const earlyIntent = detectCalculatorIntent(content, {
          languageHint: langHint,
          hasCalcContext: Boolean(calcCtxEarly),
        })
        const clearCalc =
          earlyIntent.intent === 'calculator' &&
          (earlyIntent.percentHit ||
            earlyIntent.followUp ||
            earlyIntent.operation === 'expression' ||
            earlyIntent.operation === 'copy_result' ||
            earlyIntent.operation === 'explain' ||
            /[\+\-\*\/×÷^√%]/.test(content) ||
            /\bsqrt\s*\(/i.test(content) ||
            /\d\s*%/.test(content))
        if (clearCalc) {
          const calc = applyCalculatorIntent({
            text: content,
            languageHint: langHint,
            calcContext: calcCtxEarly,
            env: {
              copyTextSync: (text: string) => {
                try {
                  const area = document.createElement('textarea')
                  area.value = text
                  area.setAttribute('readonly', '')
                  area.style.position = 'fixed'
                  area.style.opacity = '0'
                  document.body.appendChild(area)
                  area.select()
                  const ok = document.execCommand('copy')
                  document.body.removeChild(area)
                  return ok
                } catch {
                  return false
                }
              },
            },
          })
          if (calc.handled && calc.reply) {
            if (calc.calcContext) saveCalculationContext(calc.calcContext)
            dispatch({
              type: 'LOCAL_EXCHANGE',
              userContent: content,
              assistantContent: calc.reply,
              calculatorUi: (calc.calcUi as import('../types').CalculatorUiState | null) || null,
            })
            logCalculatorSafe({
              operation: String(calc.diag.operation || ''),
              parserStatus: (calc.diag.parserStatus as string) || null,
              failureCode: (calc.diag.failureCode as string) || null,
              contextReused: Boolean(calc.diag.contextReused),
            })
            if (isCalculatorDiagEnabled()) {
              rememberCalculatorDiag(buildCalculatorDiag(calc.diag || {}))
            }
            return true
          }
        }
      }

      // #317 — deterministic Weather (after Phone Actions so "Portami a Milano" stays Maps).
      if (allowLocalRouters) {
        const sticky = deriveDictationLangFromMessages(state.messages)
        const langHint =
          sticky === 'en'
            ? 'en'
            : sticky === 'it'
              ? 'it'
              : detectWeatherLanguage(content, detectTimerLanguage(content, 'it'))

        if (content.trim() === WEATHER_USE_LOCATION_TRIGGER) {
          void runWeatherWithGeolocation(langHint as 'it' | 'en')
          return true
        }
        if (content.trim() === WEATHER_ENTER_AREA_TRIGGER) {
          const follow = applyWeatherFollowUp({
            text: WEATHER_ENTER_AREA_TRIGGER,
            languageHint: langHint,
            weatherContext: loadWeatherContext(),
          })
          dispatch({
            type: 'LOCAL_EXCHANGE',
            userContent: langHint === 'en' ? 'Enter area' : 'Inserisci zona',
            assistantContent: follow.reply || weatherCopy('enter_area', langHint),
          })
          return true
        }

        const weatherCtx = loadWeatherContext()
        const weather = applyWeatherFollowUp({
          text: content,
          languageHint: langHint,
          weatherContext: weatherCtx,
        })
        if (weather.handled && weather.reply && !(weather as { needsProvider?: boolean }).needsProvider) {
          if (weather.weatherContext) saveWeatherContext(weather.weatherContext)
          dispatch({
            type: 'LOCAL_EXCHANGE',
            userContent: content,
            assistantContent: weather.reply,
            weatherUi: (weather.weatherUi as import('../types').WeatherUiState | null) || null,
          })
          logWeatherSafe({
            operation: String(weather.diag.operation || ''),
            locationSource: (weather.diag.locationSource as string) || null,
            status: weather.status || null,
            failureCode: (weather.diag.failureCode as string) || null,
            cacheHit: Boolean(weather.cacheHit || weather.diag.cacheHit),
          })
          if (isWeatherDiagEnabled()) {
            rememberWeatherDiag(buildWeatherDiag(weather.diag || {}))
          }
          return true
        }
        if ((weather as { needsProvider?: boolean }).needsProvider && weather.intent) {
          void runWeatherProvider({
            intent: weather.intent,
            language: langHint as 'it' | 'en',
            userContent: content,
            locationSource: weather.intent.locationText ? 'explicit' : undefined,
          })
          return true
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
      state.settings.briefing,
      updateBriefing,
      activeTimer,
      pendingTimerReplace,
      persistTimer,
      persistPendingReplace,
      runAssistantCompletion,
      runWeatherProvider,
      runWeatherWithGeolocation,
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
      dispatch({ type: 'TRIM_TO', count: kept.length, thinking: true, rollbackSessionStyle: true })
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
      updateBriefing,
      sendMessage,
      handleWeatherUiAction,
      handleCalculatorUiAction,
      handleUnitConversionUiAction,
      handleEnergyMathUiAction,
      handleTranslationUiAction,
      handleCalendarUiAction,
      handlePlacesUiAction,
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
      updateBriefing,
      sendMessage,
      handleWeatherUiAction,
      handleCalculatorUiAction,
      handleUnitConversionUiAction,
      handleEnergyMathUiAction,
      handleTranslationUiAction,
      handleCalendarUiAction,
      handlePlacesUiAction,
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
