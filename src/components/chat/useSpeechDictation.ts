import { useCallback, useEffect, useRef, useState } from 'react'
import { resolveRecognitionLang } from '../../lib/dictationLanguage'
import {
  bindDictationSession,
  createSpeechRecognition,
  friendlySpeechError,
  isSpeechRecognitionSupported,
  mergeDictationTranscript,
  type SpeechRecognitionErrorCode,
  type SpeechRecognitionLike,
} from '../../lib/speechRecognition'

export interface UseSpeechDictationOptions {
  /** Current draft text — snapshotted at recognition start. */
  getText: () => string
  /** Commit merged text into the composer draft. */
  setText: (text: string) => void
  /** Recent chat messages for recognition.lang sticky hint. */
  messages?: Array<{ role?: string; content?: string }>
  /** When true (chat hidden/inert), abort recognition. */
  suspended?: boolean
  /** Focus textarea after a successful final transcript. */
  onTranscriptCommitted?: () => void
}

export interface UseSpeechDictationApi {
  supported: boolean
  listening: boolean
  error: string | null
  clearError: () => void
  start: () => void
  stop: () => void
  abort: (opts?: { restore?: boolean }) => void
  /** Call when the user types — stops recognition and ignores late results. */
  onUserTyping: () => void
  statusAnnouncement: string | null
}

/**
 * Composer-local dictation lifecycle. Not stored in ChatContext.
 */
export function useSpeechDictation(options: UseSpeechDictationOptions): UseSpeechDictationApi {
  const [supported] = useState(() =>
    typeof window !== 'undefined' ? isSpeechRecognitionSupported() : false,
  )
  const [listening, setListening] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [statusAnnouncement, setStatusAnnouncement] = useState<string | null>(null)

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const disposeRef = useRef<(() => void) | null>(null)
  const sessionIdRef = useRef(0)
  const baseTextRef = useRef('')
  const committedFinalRef = useRef(false)
  const ignoreResultsRef = useRef(false)
  const optionsRef = useRef(options)
  optionsRef.current = options

  const clearSession = useCallback(() => {
    disposeRef.current?.()
    disposeRef.current = null
    recognitionRef.current = null
  }, [])

  const abort = useCallback(
    (opts?: { restore?: boolean }) => {
      const sessionId = sessionIdRef.current
      ignoreResultsRef.current = true
      sessionIdRef.current += 1

      const shouldRestore = opts?.restore !== false && !committedFinalRef.current
      const base = baseTextRef.current

      try {
        recognitionRef.current?.abort()
      } catch {
        /* ignore */
      }
      clearSession()
      setListening(false)

      if (shouldRestore && sessionId === sessionIdRef.current - 1) {
        optionsRef.current.setText(base)
      }
    },
    [clearSession],
  )

  const stop = useCallback(() => {
    ignoreResultsRef.current = false
    try {
      recognitionRef.current?.stop()
    } catch {
      try {
        recognitionRef.current?.abort()
      } catch {
        /* ignore */
      }
    }
  }, [])

  const start = useCallback(() => {
    if (!supported) return
    setError(null)

    // Abort any prior session before starting a new one.
    ignoreResultsRef.current = true
    try {
      recognitionRef.current?.abort()
    } catch {
      /* ignore */
    }
    clearSession()

    const recognition = createSpeechRecognition()
    if (!recognition) {
      setError('Dettatura non riuscita. Puoi scrivere il messaggio normalmente.')
      return
    }

    const sessionId = ++sessionIdRef.current
    ignoreResultsRef.current = false
    committedFinalRef.current = false
    baseTextRef.current = optionsRef.current.getText()

    const lang = resolveRecognitionLang({
      messages: optionsRef.current.messages,
      navigatorLanguage: typeof navigator !== 'undefined' ? navigator.language : '',
    })

    recognitionRef.current = recognition
    disposeRef.current = bindDictationSession(recognition, lang, {
      onStart: () => {
        if (sessionId !== sessionIdRef.current) return
        setListening(true)
        setStatusAnnouncement('Dettatura attiva')
      },
      onEnd: () => {
        if (sessionId !== sessionIdRef.current) return
        setListening(false)
        setStatusAnnouncement('Dettatura terminata')
        clearSession()
      },
      onFinalTranscript: (transcript) => {
        if (sessionId !== sessionIdRef.current) return
        if (ignoreResultsRef.current) return
        const merged = mergeDictationTranscript(baseTextRef.current, transcript)
        committedFinalRef.current = true
        optionsRef.current.setText(merged)
        // Update base so a subsequent final in same session (rare) appends correctly.
        baseTextRef.current = merged
        optionsRef.current.onTranscriptCommitted?.()
      },
      onError: (code: SpeechRecognitionErrorCode) => {
        if (sessionId !== sessionIdRef.current) return
        const message = friendlySpeechError(code)
        if (message) setError(message)
        if (code !== 'aborted' && !committedFinalRef.current) {
          optionsRef.current.setText(baseTextRef.current)
        }
        setListening(false)
        setStatusAnnouncement(code === 'aborted' ? null : 'Dettatura terminata')
      },
    })

    try {
      recognition.start()
    } catch {
      clearSession()
      setListening(false)
      setError('Dettatura non riuscita. Puoi scrivere il messaggio normalmente.')
      // Restore snapshot if start failed before any commit.
      optionsRef.current.setText(baseTextRef.current)
    }
  }, [supported, clearSession])

  const onUserTyping = useCallback(() => {
    if (!listening && !recognitionRef.current) return
    // Stop listening; keep whatever the user has typed (do not restore base).
    ignoreResultsRef.current = true
    committedFinalRef.current = true // prevent abort restore from wiping typed text
    sessionIdRef.current += 1
    try {
      recognitionRef.current?.abort()
    } catch {
      /* ignore */
    }
    clearSession()
    setListening(false)
    setStatusAnnouncement('Dettatura terminata')
  }, [listening, clearSession])

  // New Chat / parent clear: caller increments messages→0 and may abort via effect.
  // Suspended (Settings/Memory/Vision inert) → release mic, preserve draft.
  useEffect(() => {
    if (!options.suspended) return
    if (!listening && !recognitionRef.current) return
    ignoreResultsRef.current = true
    committedFinalRef.current = true // preserve draft; do not restore
    sessionIdRef.current += 1
    try {
      recognitionRef.current?.abort()
    } catch {
      /* ignore */
    }
    clearSession()
    setListening(false)
    setStatusAnnouncement(null)
  }, [options.suspended, listening, clearSession])

  // Unmount cleanup
  useEffect(() => {
    return () => {
      ignoreResultsRef.current = true
      sessionIdRef.current += 1
      try {
        recognitionRef.current?.abort()
      } catch {
        /* ignore */
      }
      clearSession()
    }
  }, [clearSession])

  const clearError = useCallback(() => setError(null), [])

  return {
    supported,
    listening,
    error,
    clearError,
    start,
    stop,
    abort,
    onUserTyping,
    statusAnnouncement,
  }
}
