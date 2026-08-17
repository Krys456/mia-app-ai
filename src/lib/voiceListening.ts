/**
 * #292 Voice Mode STT binding — continuous listen until stop.
 * Separate from #273 one-shot dictation (draft fill).
 *
 * Privacy: Web Speech audio recognition may be handled by the browser/vendor
 * implementation. LAIfe does not persist raw microphone audio, STT blobs, or
 * TTS bytes in Memory or chat history.
 */

import {
  createSpeechRecognition,
  isSpeechRecognitionSupported,
  normalizeSpeechErrorCode,
  type SpeechRecognitionErrorCode,
} from './speechRecognition'

export { isSpeechRecognitionSupported }

export interface VoiceListenHandlers {
  onStart?: () => void
  onEnd?: () => void
  onInterim?: (text: string) => void
  /** Fired with accumulated finals when recognition ends after stop(). */
  onFinal?: (text: string) => void
  onError?: (code: SpeechRecognitionErrorCode) => void
}

export interface VoiceListenSession {
  stop: () => void
  abort: () => void
  dispose: () => void
}

/**
 * Start continuous recognition. Call stop() to finalize; abort() to discard.
 */
export function startVoiceListening(
  lang: string,
  handlers: VoiceListenHandlers,
): VoiceListenSession | null {
  if (!isSpeechRecognitionSupported()) return null
  const recognition = createSpeechRecognition()
  if (!recognition) return null

  let disposed = false
  let finalizeRequested = false
  let discarded = false
  let finals = ''
  let interim = ''

  recognition.lang = lang || 'it-IT'
  recognition.continuous = true
  recognition.interimResults = true
  recognition.maxAlternatives = 1

  recognition.onstart = () => {
    if (!disposed) handlers.onStart?.()
  }

  recognition.onerror = (ev) => {
    if (disposed || discarded) return
    const code = normalizeSpeechErrorCode(ev?.error)
    if (code === 'aborted' && (finalizeRequested || discarded)) return
    handlers.onError?.(code)
  }

  recognition.onresult = (ev) => {
    if (disposed || discarded) return
    try {
      const results = ev?.results
      if (!results || results.length === 0) return
      let nextFinals = finals
      let nextInterim = ''
      for (let i = 0; i < results.length; i += 1) {
        const item = results[i]
        if (!item) continue
        const piece = item[0]?.transcript
        if (typeof piece !== 'string' || !piece.trim()) continue
        if (item.isFinal) {
          nextFinals = nextFinals ? `${nextFinals} ${piece.trim()}` : piece.trim()
        } else {
          nextInterim = piece.trim()
        }
      }
      finals = nextFinals.replace(/\s+/g, ' ').trim()
      interim = nextInterim
      const preview = [finals, interim].filter(Boolean).join(' ').trim()
      if (preview) handlers.onInterim?.(preview)
    } catch {
      handlers.onError?.('unknown')
    }
  }

  recognition.onend = () => {
    if (disposed) return
    handlers.onEnd?.()
    if (discarded) return
    const text = finals.replace(/\s+/g, ' ').trim()
    if (finalizeRequested) {
      handlers.onFinal?.(text)
    }
  }

  const dispose = () => {
    if (disposed) return
    disposed = true
    recognition.onstart = null
    recognition.onend = null
    recognition.onerror = null
    recognition.onresult = null
    try {
      recognition.abort()
    } catch {
      /* ignore */
    }
  }

  try {
    recognition.start()
  } catch {
    dispose()
    handlers.onError?.('busy')
    return null
  }

  return {
    stop: () => {
      if (disposed || discarded) return
      finalizeRequested = true
      try {
        recognition.stop()
      } catch {
        // If stop fails, still emit what we have.
        handlers.onFinal?.(finals.replace(/\s+/g, ' ').trim())
        dispose()
      }
    },
    abort: () => {
      if (disposed) return
      discarded = true
      finalizeRequested = false
      try {
        recognition.abort()
      } catch {
        /* ignore */
      }
      dispose()
    },
    dispose,
  }
}

/** @internal test helper — accumulate finals only. */
export function accumulateVoiceFinals(
  previous: string,
  piece: string,
  isFinal: boolean,
): { finals: string; interim: string } {
  const base = previous.replace(/\s+/g, ' ').trim()
  const next = String(piece || '').trim()
  if (!next) return { finals: base, interim: '' }
  if (isFinal) {
    return { finals: base ? `${base} ${next}` : next, interim: '' }
  }
  return { finals: base, interim: next }
}
