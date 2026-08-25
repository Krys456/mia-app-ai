/**
 * #385B — Voice Mode conversational continuity (pure gates).
 * Auto-listen after TTS only when the session is still active and safe.
 */

export type AutoListenGateInput = {
  /** Voice Mode session still open. */
  voiceActive: boolean
  /** Continuous conversation enabled (Stop pauses; Ascolta re-enables). */
  continuousEnabled: boolean
  /** Audio/TTS turn still matches the current session turn (stale callback guard). */
  turnMatches: boolean
  /** Autoplay blocked — waiting for Riproduci. */
  needsManualPlay: boolean
  /** Unplayed assistant audio still held. */
  hasPendingUnplayedAudio: boolean
  /** A SpeechRecognition session already owns the mic. */
  recognitionOwned: boolean
  /** Final send in flight. */
  sendLocked: boolean
  /** Chat thinking/streaming. */
  chatBusy: boolean
}

/**
 * Whether Voice Mode may schedule startListening() after speech ends.
 */
export function shouldAutoListenAfterSpeech(input: AutoListenGateInput): boolean {
  if (!input.voiceActive) return false
  if (!input.continuousEnabled) return false
  if (!input.turnMatches) return false
  if (input.needsManualPlay) return false
  if (input.hasPendingUnplayedAudio) return false
  if (input.recognitionOwned) return false
  if (input.sendLocked) return false
  if (input.chatBusy) return false
  return true
}

/** Documented #385B state machine arcs (for tests / operators). */
export const VOICE_CONTINUITY_TRANSITIONS = [
  'idle→listening',
  'listening→processing',
  'processing→speaking',
  'speaking→listening', // #385B auto-continue
  'speaking→idle', // Stop / continuous paused
  'processing→needsManualPlay',
  'needsManualPlay→speaking', // Riproduci
  'ANY→closed', // Chiudi — no restart
  'listening|processing|speaking→error', // recoverable, no restart loop
] as const
