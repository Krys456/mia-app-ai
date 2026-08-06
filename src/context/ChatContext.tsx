/* eslint-disable react-refresh/only-export-components -- ChatProvider + useChat share one module */
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  type ReactNode,
} from 'react'
import { buildSystemPrompt, generateLocalReply } from '../lib/personality'
import {
  DEFAULT_PERSONALIZATION,
  type AppSettings,
  type ChatMessage,
  type PersonalizationSettings,
} from '../types'

const STORAGE_KEY = 'laife.settings.v1'

function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { personalization: { ...DEFAULT_PERSONALIZATION } }
    const parsed = JSON.parse(raw) as Partial<AppSettings>
    return {
      personalization: {
        ...DEFAULT_PERSONALIZATION,
        ...parsed.personalization,
      },
    }
  } catch {
    return { personalization: { ...DEFAULT_PERSONALIZATION } }
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
  | { type: 'SEND_USER'; content: string }
  | { type: 'ASSISTANT_DONE'; content: string }
  | { type: 'ASSISTANT_FAIL' }

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
        personalization: {
          ...state.settings.personalization,
          ...action.payload,
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
    case 'ASSISTANT_FAIL':
      return { ...state, isThinking: false }
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

  const sendMessage = useCallback(
    (raw: string) => {
      const content = raw.trim()
      if (!content || state.isThinking) return

      dispatch({ type: 'SEND_USER', content })

      // Local demo reply — swap for API call using buildSystemPrompt(settings).
      window.setTimeout(() => {
        try {
          const reply = generateLocalReply(content, state.settings.personalization)
          dispatch({ type: 'ASSISTANT_DONE', content: reply })
        } catch {
          dispatch({ type: 'ASSISTANT_FAIL' })
        }
      }, 450 + Math.random() * 350)
    },
    [state.isThinking, state.settings.personalization],
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
