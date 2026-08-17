/**
 * #292 Voice Mode STT binding — push-to-talk until stop.
 * Separate from #273 one-shot dictation (draft fill).
 *
 * Privacy: Web Speech audio recognition may be handled by the browser/vendor
 * implementation. LAIfe does not persist raw microphone audio, STT blobs, or
 * TTS bytes in Memory or chat history.
 *
 * ## Event ownership model (Android Chrome critical)
 *
 * SpeechRecognitionResultList is an indexed SLOT array:
 * - Slots before `resultIndex` are unchanged.
 * - Slots from `resultIndex` onward are new or REVISED in this callback.
 * - Updating a slot REPLACES its transcript/isFinal — never appends text.
 *
 * Progressive same-slot hypotheses (common on Android):
 *   slot0: "Cos'è" → "Cos'è un" → "Cos'è un inverter"
 * must display/send "Cos'è un inverter", NOT a concatenation of every hypothesis.
 *
 * `continuous: false` + restart-while-listening avoids Android continuous-mode
 * inventing extra final slots for progressive revisions of one utterance.
 * Prior cycle finals are kept in `committedCycles` (genuine separate utterances).
 */

import {
  createSpeechRecognition,
  isSpeechRecognitionSupported,
  normalizeSpeechErrorCode,
  type SpeechRecognitionErrorCode,
  type SpeechRecognitionLike,
} from './speechRecognition'

export { isSpeechRecognitionSupported }

export interface VoiceListenHandlers {
  onStart?: () => void
  onEnd?: () => void
  /** Live display from indexed slots. Never sent. */
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

/** One SpeechRecognition result index / slot. */
export type SpeechResultSlot = {
  transcript: string
  isFinal: boolean
}

export type SpeechTranscriptState = {
  /** Indexed slots for the active recognition cycle (result list identity). */
  slots: SpeechResultSlot[]
  /**
   * Finals committed from earlier recognition cycles (after onend + restart).
   * Genuine separate utterances — not progressive revisions of one slot.
   */
  committedCycles: string[]
  /** Join of final slots in the current cycle only. */
  cycleFinalTranscript: string
  /** Join of non-final slots in the current cycle (replaceable). */
  currentInterimTranscript: string
  /** committedCycles + current cycle finals (+ interim for display). */
  committedFinalTranscript: string
  displayTranscript: string
}

function normalizePiece(raw: unknown): string {
  return String(raw || '')
    .replace(/\s+/g, ' ')
    .trim()
}

function deriveFromSlots(
  committedCycles: string[],
  slots: SpeechResultSlot[],
): Omit<SpeechTranscriptState, 'slots' | 'committedCycles'> {
  const finalParts: string[] = []
  const interimParts: string[] = []
  for (const slot of slots) {
    const piece = normalizePiece(slot.transcript)
    if (!piece) continue
    if (slot.isFinal) finalParts.push(piece)
    else interimParts.push(piece)
  }

  const cycleFinalTranscript = finalParts.join(' ').replace(/\s+/g, ' ').trim()
  const currentInterimTranscript = interimParts.join(' ').replace(/\s+/g, ' ').trim()
  const committedFinalTranscript = [...committedCycles, cycleFinalTranscript]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
  const displayTranscript = [committedFinalTranscript, currentInterimTranscript]
    .filter(Boolean)
    .join(' ')
    .trim()

  return {
    cycleFinalTranscript,
    currentInterimTranscript,
    committedFinalTranscript,
    displayTranscript,
  }
}

export function emptySpeechTranscriptState(): SpeechTranscriptState {
  return {
    slots: [],
    committedCycles: [],
    cycleFinalTranscript: '',
    currentInterimTranscript: '',
    committedFinalTranscript: '',
    displayTranscript: '',
  }
}

/**
 * Rebuild transcript fields from an explicit indexed slot snapshot.
 * Does not invent slots — caller owns resultIndex semantics.
 */
export function reduceSpeechRecognitionResults(
  results: SpeechResultPiece[],
  committedCycles: string[] = [],
): SpeechTranscriptState {
  const slots: SpeechResultSlot[] = (Array.isArray(results) ? results : []).map((item) => ({
    transcript: normalizePiece(item?.transcript),
    isFinal: Boolean(item?.isFinal),
  }))
  return {
    slots,
    committedCycles: [...committedCycles],
    ...deriveFromSlots(committedCycles, slots),
  }
}

/**
 * Apply one SpeechRecognition `onresult` using result-slot ownership.
 *
 * - Keep slots `[0, resultIndex)` from previous state (unchanged).
 * - Replace/extend slots from `resultIndex` using `event.results[i]`.
 * - Truncate to `event.results.length` (cumulative list length is source of truth).
 *
 * Never concatenates previous display/final strings with new hypotheses.
 */
export function applySpeechRecognitionEvent(
  previous: SpeechTranscriptState,
  event: { resultIndex?: number; results: SpeechResultPiece[] },
): SpeechTranscriptState {
  const incoming = Array.isArray(event.results) ? event.results : []
  const rawIndex = typeof event.resultIndex === 'number' ? event.resultIndex : 0
  const resultIndex = Math.max(0, Math.min(rawIndex, incoming.length))

  const prevSlots = previous.slots ?? []
  const slots: SpeechResultSlot[] = []

  // 1. Unchanged prefix (browser guarantee: results before resultIndex are stable).
  for (let i = 0; i < resultIndex; i += 1) {
    const fromPrev = prevSlots[i]
    const fromIncoming = incoming[i]
    // Prefer previous slot identity; fall back to incoming cumulative copy.
    if (fromPrev) {
      slots.push({
        transcript: normalizePiece(fromPrev.transcript),
        isFinal: Boolean(fromPrev.isFinal),
      })
    } else if (fromIncoming) {
      slots.push({
        transcript: normalizePiece(fromIncoming.transcript),
        isFinal: Boolean(fromIncoming.isFinal),
      })
    } else {
      slots.push({ transcript: '', isFinal: false })
    }
  }

  // 2. New or revised slots from resultIndex onward — REPLACE, do not append text.
  for (let i = resultIndex; i < incoming.length; i += 1) {
    const item = incoming[i]
    slots.push({
      transcript: normalizePiece(item?.transcript),
      isFinal: Boolean(item?.isFinal),
    })
  }

  // 3. Truncate to current cumulative list length (drop stale trailing slots).
  // (Loop above already sized to incoming.length.)

  const committedCycles = [...(previous.committedCycles ?? [])]
  return {
    slots,
    committedCycles,
    ...deriveFromSlots(committedCycles, slots),
  }
}

/**
 * After a recognition cycle ends (continuous:false onend), fold current cycle
 * finals into committedCycles and clear slots for the next cycle.
 */
export function commitRecognitionCycle(state: SpeechTranscriptState): SpeechTranscriptState {
  const cycle = normalizePiece(state.cycleFinalTranscript)
  const interim = normalizePiece(state.currentInterimTranscript)
  const piece = [cycle, interim].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim()
  const committedCycles = piece
    ? [...state.committedCycles, piece]
    : [...state.committedCycles]
  const slots: SpeechResultSlot[] = []
  return {
    slots,
    committedCycles,
    ...deriveFromSlots(committedCycles, slots),
  }
}

/** Build the send payload from canonical slot-derived state. */
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

function snapshotResults(
  rawResults: ArrayLike<{ isFinal: boolean; 0?: { transcript: string }; length: number }>,
): SpeechResultPiece[] {
  const pieces: SpeechResultPiece[] = []
  const length = rawResults.length
  for (let i = 0; i < length; i += 1) {
    const item = rawResults[i]
    const transcript = item?.[0]?.transcript
    pieces.push({
      isFinal: Boolean(item?.isFinal),
      transcript: typeof transcript === 'string' ? transcript : '',
    })
  }
  return pieces
}

/**
 * Start push-to-talk recognition. Call stop() to finalize; abort() to discard.
 *
 * Uses continuous:false + restart-while-listening so Android Chrome revises one
 * result slot per utterance instead of emitting progressive full-phrase finals
 * as independent cumulative entries.
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
  let startedOnce = false
  /** Bumps on dispose/abort so late events from this instance are ignored. */
  let sessionGen = 1
  const activeGen = () => sessionGen
  let state = emptySpeechTranscriptState()

  const emitDisplay = () => {
    handlers.onInterim?.(state.displayTranscript)
  }

  const emitFinalOnce = () => {
    if (finalEmitted || discarded || disposed) return
    finalEmitted = true
    const text = buildFinalVoiceTranscript(state, {
      includeInterim: finalizeRequested,
    })
    handlers.onFinal?.(text)
  }

  const clearHandlers = (target: SpeechRecognitionLike) => {
    target.onstart = null
    target.onend = null
    target.onerror = null
    target.onresult = null
  }

  const bindHandlers = (gen: number) => {
    recognition.lang = lang || 'it-IT'
    // Android Chrome: continuous:true often finalizes progressive hypotheses as
    // additional cumulative slots ("Cos'è" + "Cos'è un" + …). false + restart
    // keeps one evolving slot per cycle; genuine pauses become new cycles.
    recognition.continuous = false
    recognition.interimResults = true
    recognition.maxAlternatives = 1

    recognition.onstart = () => {
      if (disposed || discarded || activeGen() !== gen) return
      if (!startedOnce) {
        startedOnce = true
        handlers.onStart?.()
      }
    }

    recognition.onerror = (ev) => {
      if (disposed || discarded || activeGen() !== gen) return
      const code = normalizeSpeechErrorCode(ev?.error)
      if (code === 'aborted' && (finalizeRequested || discarded)) return
      // no-speech during keep-alive listen: restart rather than hard-fail.
      if (code === 'no-speech' && !finalizeRequested) {
        return
      }
      handlers.onError?.(code)
    }

    recognition.onresult = (ev) => {
      if (disposed || discarded || finalEmitted || activeGen() !== gen) return
      try {
        const rawResults = ev?.results
        if (!rawResults || rawResults.length === 0) return
        state = applySpeechRecognitionEvent(state, {
          resultIndex: typeof ev.resultIndex === 'number' ? ev.resultIndex : 0,
          results: snapshotResults(rawResults),
        })
        emitDisplay()
      } catch {
        handlers.onError?.('unknown')
      }
    }

    recognition.onend = () => {
      if (disposed || activeGen() !== gen) return
      if (discarded) {
        handlers.onEnd?.()
        return
      }
      if (finalizeRequested) {
        handlers.onEnd?.()
        emitFinalOnce()
        return
      }
      // Natural cycle end — commit this cycle's transcript, then keep listening.
      state = commitRecognitionCycle(state)
      emitDisplay()
      try {
        recognition.start()
      } catch {
        // Browser may throw if start is called too quickly; retry once.
        try {
          recognition.start()
        } catch {
          handlers.onError?.('busy')
        }
      }
    }
  }

  bindHandlers(sessionGen)

  const dispose = () => {
    if (disposed) return
    disposed = true
    sessionGen += 1
    clearHandlers(recognition)
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
      sessionGen += 1
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
