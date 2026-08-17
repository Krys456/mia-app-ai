import type { VoiceModePhase } from './useVoiceMode'
import './VoiceModeBar.css'

export type VoiceModeBarProps = {
  phase: VoiceModePhase
  interimText: string
  error: string | null
  needsManualPlay: boolean
  onStopSend: () => void
  onCancel: () => void
  onStopSpeaking: () => void
  onListenAgain: () => void
  onPlayPending: () => void
  onExit: () => void
}

function statusLabel(phase: VoiceModePhase, needsManualPlay: boolean): string {
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
      return 'Modalità vocale'
  }
}

export function VoiceModeBar({
  phase,
  interimText,
  error,
  needsManualPlay,
  onStopSend,
  onCancel,
  onStopSpeaking,
  onListenAgain,
  onPlayPending,
  onExit,
}: VoiceModeBarProps) {
  const label = statusLabel(phase, needsManualPlay)

  return (
    <div
      className={`voice-mode-bar voice-mode-bar--${phase}${needsManualPlay ? ' voice-mode-bar--manual' : ''}`}
      role="region"
      aria-label="Modalità vocale"
    >
      <div className="voice-mode-bar__status" aria-live="polite" aria-atomic="true">
        <span className="voice-mode-bar__pulse" aria-hidden="true" />
        <div className="voice-mode-bar__copy">
          <strong className="voice-mode-bar__label">{label}</strong>
          {phase === 'listening' && interimText ? (
            <p className="voice-mode-bar__interim">{interimText}</p>
          ) : null}
          {error ? <p className="voice-mode-bar__error">{error}</p> : null}
        </div>
      </div>

      <div className="voice-mode-bar__actions">
        {phase === 'listening' ? (
          <>
            <button type="button" className="voice-mode-bar__btn voice-mode-bar__btn--primary" onClick={onStopSend}>
              Invia
            </button>
            <button type="button" className="voice-mode-bar__btn" onClick={onCancel}>
              Annulla
            </button>
          </>
        ) : null}

        {phase === 'speaking' ? (
          <button type="button" className="voice-mode-bar__btn voice-mode-bar__btn--primary" onClick={onStopSpeaking}>
            Stop
          </button>
        ) : null}

        {needsManualPlay ? (
          <button type="button" className="voice-mode-bar__btn voice-mode-bar__btn--primary" onClick={onPlayPending}>
            Riproduci
          </button>
        ) : null}

        {(phase === 'idle' || phase === 'error') && !needsManualPlay ? (
          <button type="button" className="voice-mode-bar__btn voice-mode-bar__btn--primary" onClick={onListenAgain}>
            Ascolta
          </button>
        ) : null}

        <button type="button" className="voice-mode-bar__btn voice-mode-bar__btn--ghost" onClick={onExit}>
          Chiudi
        </button>
      </div>
    </div>
  )
}
