import type { VoiceModePhase } from './useVoiceMode'
import './VoiceModeBar.css'

export type VoiceModeBarProps = {
  phase: VoiceModePhase
  interimText: string
  error: string | null
  needsManualPlay: boolean
  /** #385B — false after Stop until Ascolta (continuous conversation paused). */
  continuousListening?: boolean
  onStopSend: () => void
  onCancel: () => void
  onStopSpeaking: () => void
  onListenAgain: () => void
  onPlayPending: () => void
  onExit: () => void
}

function statusLabel(
  phase: VoiceModePhase,
  needsManualPlay: boolean,
  continuousListening: boolean,
): string {
  if (needsManualPlay) return 'Pronto a riprodurre'
  switch (phase) {
    case 'listening':
      return 'Ti ascolto…'
    case 'processing':
      return 'Sto elaborando…'
    case 'speaking':
      return 'Sto parlando…'
    case 'error':
      return 'Qualcosa non ha funzionato'
    default:
      // Idle: continuous pause vs waiting for next auto-listen cycle.
      return continuousListening ? 'Modalità vocale' : 'In pausa — tocca Ascolta'
  }
}

export function VoiceModeBar({
  phase,
  interimText,
  error,
  needsManualPlay,
  continuousListening = true,
  onStopSend,
  onCancel,
  onStopSpeaking,
  onListenAgain,
  onPlayPending,
  onExit,
}: VoiceModeBarProps) {
  const label = statusLabel(phase, needsManualPlay, continuousListening)

  return (
    <div
      className={`voice-mode-bar voice-mode-bar--${phase}${needsManualPlay ? ' voice-mode-bar--manual' : ''}`}
      role="region"
      aria-label="Modalità vocale"
    >
      <div className="voice-mode-bar__status">
        <span className="voice-mode-bar__pulse" aria-hidden="true" />
        <div className="voice-mode-bar__copy">
          {/* Phase only in live region — interim must not spam screen readers (#356B). */}
          <strong className="voice-mode-bar__label" aria-live="polite" aria-atomic="true">
            {label}
          </strong>
          {phase === 'listening' && interimText ? (
            <p className="voice-mode-bar__interim" aria-hidden="true">
              {interimText}
            </p>
          ) : null}
          {error ? (
            <p className="voice-mode-bar__error" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      </div>

      <div className="voice-mode-bar__actions">
        {phase === 'listening' ? (
          <>
            <button
              type="button"
              className="voice-mode-bar__btn voice-mode-bar__btn--primary"
              aria-label="Invia trascrizione e chiedi a ShinkAIdo"
              onClick={onStopSend}
            >
              Invia
            </button>
            <button
              type="button"
              className="voice-mode-bar__btn"
              aria-label="Annulla ascolto senza inviare"
              onClick={onCancel}
            >
              Annulla
            </button>
          </>
        ) : null}

        {phase === 'speaking' ? (
          <button
            type="button"
            className="voice-mode-bar__btn voice-mode-bar__btn--primary"
            aria-label="Interrompi riproduzione vocale"
            onClick={onStopSpeaking}
          >
            Stop
          </button>
        ) : null}

        {needsManualPlay ? (
          <button
            type="button"
            className="voice-mode-bar__btn voice-mode-bar__btn--primary"
            aria-label="Riproduci risposta vocale"
            onClick={onPlayPending}
          >
            Riproduci
          </button>
        ) : null}

        {(phase === 'idle' || phase === 'error') && !needsManualPlay ? (
          <button
            type="button"
            className="voice-mode-bar__btn voice-mode-bar__btn--primary"
            aria-label="Ascolta di nuovo"
            onClick={onListenAgain}
          >
            Ascolta
          </button>
        ) : null}

        <button
          type="button"
          className="voice-mode-bar__btn voice-mode-bar__btn--ghost"
          aria-label="Chiudi modalità vocale"
          onClick={onExit}
        >
          Chiudi
        </button>
      </div>
    </div>
  )
}
