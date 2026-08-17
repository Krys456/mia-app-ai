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
  /** Live display = committed finals + current replaceable interim. Never sent. */
  onInterim?: (text: string) => void
  /** Fired once with the clean finalized transcript after stop(). */
  onFinal?: (text: string) => void
  onError?: (code: SpeechRecognitionErrorCode) => void
}

export interface VoiceListenSession {
  stop: () => void
  abort: () => void
  dispose: () => void
}

export type SpeechResultPiece = {
  isFinal: boolean
  transcript: string
}

export type SpeechTranscriptState = {
  /** Permanently committed final segments (joined). */
  committedFinalTranscript: string
  /** Replaceable interim for the current unstable hypothesis. */
  currentInterimTranscript: string
  /** Display = committed + interim. */
  displayTranscript: string
  /** How many final Result entries have been committed (by index count). */
  committedFinalCount: number
}

function normalizePiece(raw: unknown): string {
  return String(raw || '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Reduce a SpeechRecognition-like cumulative result list.
 *
 * Web Speech `results` is CUMULATIVE. Correct model:
 *   committedFinalTranscript  = join every result where isFinal (once each index)
 * + currentInterimTranscript  = join/replace non-final hypotheses (never permanently append)
 *
 * Root-cause bug in the first #292 cut: `nextFinals = previousFinals` and then
 * re-walking the entire cumulative list re-appended every prior final on every
 * event ("cos'è cos'è Cos'è …").
 *
 * Fix: rebuild from the result list each event (idempotent). Do not seed from
 * previously joined final text.
 */
export function reduceSpeechRecognitionResults(
  results: SpeechResultPiece[],
): SpeechTranscriptState {
  const list = Array.isArray(results) ? results : []
  const committedParts: string[] = []
  const interimParts: string[] = []
  let committedFinalCount = 0

  for (let i = 0; i < list.length; i += 1) {
    const item = list[i]
    const piece = normalizePiece(item?.transcript)
    if (!piece) continue
    if (item.isFinal) {
      committedParts.push(piece)
      committedFinalCount = i + 1
    } else {
      interimParts.push(piece)
    }
  }

  const committedFinalTranscript = committedParts.join(' ').replace(/\s+/g, ' ').trim()
  const currentInterimTranscript = interimParts.join(' ').replace(/\s+/g, ' ').trim()
  const displayTranscript = [committedFinalTranscript, currentInterimTranscript]
    .filter(Boolean)
    .join(' ')
    .trim()

  return {
    committedFinalTranscript,
    currentInterimTranscript,
    displayTranscript,
    committedFinalCount,
  }
}

/**
 * Apply one SpeechRecognition `onresult` event.
 * `resultIndex` marks where the list changed; reduction rebuilds the cumulative
 * list so repeated callbacks stay idempotent (no double-append).
 */
export function applySpeechRecognitionEvent(
  _previous: SpeechTranscriptState,
  event: { resultIndex?: number; results: SpeechResultPiece[] },
): SpeechTranscriptState {
  void _previous
  void event.resultIndex
  return reduceSpeechRecognitionResults(event.results)
}

export function emptySpeechTranscriptState(): SpeechTranscriptState {
  return {
    committedFinalTranscript: '',
    currentInterimTranscript: '',
    displayTranscript: '',
    committedFinalCount: 0,
  }
}

/** Build the send payload: finals only, with optional last interim flush on stop. */
export function buildFinalVoiceTranscript(
  state: SpeechTranscriptState,
  opts?: { includeInterim?: boolean },
): string {
  const includeInterim = opts?.includeInterim === true
  const parts = includeInterim
    ? [state.committedFinalTranscript, state.currentInterimTranscript]
    : [state.committedFinalTranscript]
  return parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim()
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
  let finalEmitted = false
  let state = emptySpeechTranscriptState()

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
    if (disposed || discarded || finalEmitted) return
    try {
      const rawResults = ev?.results
      if (!rawResults || rawResults.length === 0) return

      const pieces: SpeechResultPiece[] = []
      for (let i = 0; i < rawResults.length; i += 1) {
        const item = rawResults[i]
        const transcript = item?.[0]?.transcript
        pieces.push({
          isFinal: Boolean(item?.isFinal),
          transcript: typeof transcript === 'string' ? transcript : '',
        })
      }

      state = applySpeechRecognitionEvent(state, {
        resultIndex: typeof ev.resultIndex === 'number' ? ev.resultIndex : 0,
        results: pieces,
      })

      if (state.displayTranscript) {
        handlers.onInterim?.(state.displayTranscript)
      } else {
        handlers.onInterim?.('')
      }
    } catch {
      handlers.onError?.('unknown')
    }
  }

  const emitFinalOnce = () => {
    if (finalEmitted || discarded || disposed) return
    finalEmitted = true
    // On explicit stop, flush any trailing interim that never became final.
    const text = buildFinalVoiceTranscript(state, {
      includeInterim: finalizeRequested,
    })
    handlers.onFinal?.(text)
  }

  recognition.onend = () => {
    if (disposed) return
    handlers.onEnd?.()
    if (discarded) return
    if (finalizeRequested) {
      emitFinalOnce()
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
      if (disposed || discarded || finalEmitted) return
      finalizeRequested = true
      try {
        recognition.stop()
      } catch {
        emitFinalOnce()
        dispose()
      }
    },
    abort: () => {
      if (disposed) return
      discarded = true
      finalizeRequested = false
      state = emptySpeechTranscriptState()
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

/**
 * @internal test helper — single-piece interim vs final update (not cumulative list).
 * Prefer reduceSpeechRecognitionResults / applySpeechRecognitionEvent for event sequences.
 */
export function accumulateVoiceFinals(
  previous: string,
  piece: string,
  isFinal: boolean,
): { finals: string; interim: string } {
  const base = previous.replace(/\s+/g, ' ').trim()
  const next = normalizePiece(piece)
  if (!next) return { finals: base, interim: '' }
  if (isFinal) {
    return { finals: base ? `${base} ${next}` : next, interim: '' }
  }
  return { finals: base, interim: next }
}
