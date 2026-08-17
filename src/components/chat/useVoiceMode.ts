/**
 * #292 Voice Mode controller — STT → Core send → TTS playback.
 * Not stored as ChatContext audio state. One-send guarantee for finals.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useChat } from '../../context/ChatContext'
import { resolveRecognitionLang } from '../../lib/dictationLanguage'
import { prepareSpeechText } from '../../lib/speechText'
import { friendlySpeechError } from '../../lib/speechRecognition'
import { requestSpeechAudio, TtsApiError } from '../../lib/ttsApi'
import {
  isSpeechRecognitionSupported,
  startVoiceListening,
  type VoiceListenSession,
} from '../../lib/voiceListening'

export type VoiceModePhase =
  | 'idle'
  | 'listening'
  | 'processing'
  | 'speaking'
  | 'error'

export interface UseVoiceModeApi {
  active: boolean
  phase: VoiceModePhase
  supported: boolean
  interimText: string
  error: string | null
  needsManualPlay: boolean
  enter: () => void
  exit: () => void
  startListening: () => void
  stopAndSend: () => void
  cancelListening: () => void
  stopSpeaking: () => void
  playPending: () => void
  clearError: () => void
}

function releaseObjectUrl(url: string | null) {
  if (url && url.startsWith('blob:')) {
    try {
      URL.revokeObjectURL(url)
    } catch {
      /* ignore */
    }
  }
}

export function useVoiceMode(): UseVoiceModeApi {
  const { sendMessage, messages, isThinking, isStreaming } = useChat()
  const [supported] = useState(() =>
    typeof window !== 'undefined' ? isSpeechRecognitionSupported() : false,
  )
  const [active, setActive] = useState(false)
  const [phase, setPhase] = useState<VoiceModePhase>('idle')
  const [interimText, setInterimText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [needsManualPlay, setNeedsManualPlay] = useState(false)

  const sessionRef = useRef<VoiceListenSession | null>(null)
  const sendLockRef = useRef(false)
  const turnIdRef = useRef(0)
  const pendingSpeakRef = useRef<{
    turnId: number
    baselineCount: number
    userContent: string
  } | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const objectUrlRef = useRef<string | null>(null)
  const ttsAbortRef = useRef<AbortController | null>(null)
  const pendingBlobRef = useRef<Blob | null>(null)
  const messagesRef = useRef(messages)
  messagesRef.current = messages

  const clearAudio = useCallback(() => {
    ttsAbortRef.current?.abort()
    ttsAbortRef.current = null
    const audio = audioRef.current
    audioRef.current = null
    if (audio) {
      try {
        audio.pause()
        audio.removeAttribute('src')
        audio.load()
      } catch {
        /* ignore */
      }
    }
    releaseObjectUrl(objectUrlRef.current)
    objectUrlRef.current = null
    pendingBlobRef.current = null
    setNeedsManualPlay(false)
  }, [])

  const clearListenSession = useCallback(() => {
    sessionRef.current?.dispose()
    sessionRef.current = null
  }, [])

  const clearError = useCallback(() => setError(null), [])

  const stopSpeaking = useCallback(() => {
    clearAudio()
    setPhase('idle')
  }, [clearAudio])

  const playBlob = useCallback(
    async (blob: Blob, turnId: number) => {
      clearAudio()
      pendingBlobRef.current = blob
      const url = URL.createObjectURL(blob)
      objectUrlRef.current = url
      const audio = new Audio(url)
      audioRef.current = audio
      audio.onended = () => {
        if (turnIdRef.current !== turnId) return
        clearAudio()
        setPhase('idle')
      }
      audio.onerror = () => {
        if (turnIdRef.current !== turnId) return
        clearAudio()
        setError('Riproduzione audio non riuscita.')
        setPhase('error')
      }
      try {
        setPhase('speaking')
        await audio.play()
        setNeedsManualPlay(false)
      } catch {
        // Autoplay blocked — keep blob for manual play.
        setNeedsManualPlay(true)
        setPhase('idle')
        setError('Tocca Riproduci per ascoltare la risposta.')
      }
    },
    [clearAudio],
  )

  const playPending = useCallback(() => {
    const blob = pendingBlobRef.current
    if (!blob) return
    const turnId = turnIdRef.current
    void playBlob(blob, turnId)
  }, [playBlob])

  const speakAssistantText = useCallback(
    async (text: string, turnId: number) => {
      const speech = prepareSpeechText(text)
      if (!speech) {
        setPhase('idle')
        return
      }
      ttsAbortRef.current?.abort()
      const controller = new AbortController()
      ttsAbortRef.current = controller
      try {
        const blob = await requestSpeechAudio(speech, { signal: controller.signal })
        if (turnIdRef.current !== turnId || controller.signal.aborted) return
        await playBlob(blob, turnId)
      } catch (err) {
        if (controller.signal.aborted || turnIdRef.current !== turnId) return
        const message =
          err instanceof TtsApiError
            ? err.message
            : 'Riproduzione vocale non riuscita. La risposta resta in chat.'
        setError(message)
        setPhase('error')
      }
    },
    [playBlob],
  )

  // After Core finishes a voice-originated turn, speak the assistant text.
  useEffect(() => {
    const pending = pendingSpeakRef.current
    if (!pending) return
    if (isThinking || isStreaming) return

    const msgs = messagesRef.current
    if (msgs.length <= pending.baselineCount) {
      // Send failed or was aborted before assistant arrived.
      if (!sendLockRef.current) {
        pendingSpeakRef.current = null
        setPhase((p) => (p === 'processing' ? 'idle' : p))
      }
      return
    }

    const last = msgs[msgs.length - 1]
    if (!last || last.role !== 'assistant') return
    if (last.kind === 'error') {
      pendingSpeakRef.current = null
      sendLockRef.current = false
      setError(last.content || 'Richiesta non riuscita.')
      setPhase('error')
      return
    }

    pendingSpeakRef.current = null
    sendLockRef.current = false
    const turnId = pending.turnId
    void speakAssistantText(last.content || '', turnId)
  }, [isThinking, isStreaming, messages, speakAssistantText])

  const cancelListening = useCallback(() => {
    // Discard — never send a partial/interim transcript.
    sendLockRef.current = false
    pendingSpeakRef.current = null
    sessionRef.current?.abort()
    sessionRef.current = null
    setInterimText('')
    setPhase('idle')
  }, [])

  const startListening = useCallback(() => {
    if (!supported) {
      setError('Modalità vocale non supportata in questo browser.')
      setPhase('error')
      return
    }
    if (sendLockRef.current || isThinking || isStreaming) return

    // Stop any current TTS before listening (MVP interruption).
    clearAudio()
    clearListenSession()
    setError(null)
    setInterimText('')
    setNeedsManualPlay(false)

    const lang = resolveRecognitionLang({
      messages: messagesRef.current.map((m) => ({ role: m.role, content: m.content })),
      navigatorLanguage: typeof navigator !== 'undefined' ? navigator.language : undefined,
    })

    const session = startVoiceListening(lang, {
      onStart: () => setPhase('listening'),
      onInterim: (text) => setInterimText(text),
      onFinal: (text) => {
        sessionRef.current = null
        setInterimText('')
        const finalText = text.replace(/\s+/g, ' ').trim()
        if (!finalText) {
          setError('Non ho sentito nulla. Tocca Ascolta e riprova.')
          setPhase('error')
          return
        }
        if (sendLockRef.current) return
        sendLockRef.current = true
        const turnId = ++turnIdRef.current
        const baselineCount = messagesRef.current.length
        pendingSpeakRef.current = {
          turnId,
          baselineCount,
          userContent: finalText,
        }
        setPhase('processing')
        const ok = sendMessage(finalText)
        if (!ok) {
          pendingSpeakRef.current = null
          sendLockRef.current = false
          setError('Non posso inviare ora. Riprova tra un momento.')
          setPhase('error')
        }
      },
      onError: (code) => {
        if (code === 'aborted') return
        const msg =
          friendlySpeechError(code) ||
          'Ascolto non riuscito. Puoi scrivere normalmente.'
        setError(msg)
        setPhase('error')
        clearListenSession()
      },
      onEnd: () => {
        /* final handled in onFinal when stop() was requested */
      },
    })

    if (!session) {
      setError('Microfono non disponibile.')
      setPhase('error')
      return
    }
    sessionRef.current = session
    setPhase('listening')
  }, [
    clearAudio,
    clearListenSession,
    isStreaming,
    isThinking,
    sendMessage,
    supported,
  ])

  const stopAndSend = useCallback(() => {
    if (phase !== 'listening') return
    sessionRef.current?.stop()
  }, [phase])

  const enter = useCallback(() => {
    setActive(true)
    setError(null)
    setInterimText('')
    setPhase('idle')
    // Start listening immediately on enter (user gesture → permission).
    // Defer one tick so active UI mounts first.
    queueMicrotask(() => {
      startListening()
    })
  }, [startListening])

  const exit = useCallback(() => {
    turnIdRef.current += 1
    pendingSpeakRef.current = null
    sendLockRef.current = false
    clearListenSession()
    clearAudio()
    setInterimText('')
    setError(null)
    setActive(false)
    setPhase('idle')
  }, [clearAudio, clearListenSession])

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      turnIdRef.current += 1
      pendingSpeakRef.current = null
      sendLockRef.current = false
      sessionRef.current?.dispose()
      sessionRef.current = null
      ttsAbortRef.current?.abort()
      const audio = audioRef.current
      if (audio) {
        try {
          audio.pause()
        } catch {
          /* ignore */
        }
      }
      releaseObjectUrl(objectUrlRef.current)
    }
  }, [])

  return {
    active,
    phase,
    supported,
    interimText,
    error,
    needsManualPlay,
    enter,
    exit,
    startListening,
    stopAndSend,
    cancelListening,
    stopSpeaking,
    playPending,
    clearError,
  }
}
