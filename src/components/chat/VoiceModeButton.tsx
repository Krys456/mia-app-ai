import './VoiceModeButton.css'

export type VoiceModeButtonProps = {
  active?: boolean
  disabled?: boolean
  onClick: () => void
}

/**
 * Compact Voice Mode entry — waveform icon, not the #273 dictation microphone.
 * Accessible label distinguishes "Modalità vocale" from "Dettatura" (#356B).
 */
export function VoiceModeButton({
  active = false,
  disabled = false,
  onClick,
}: VoiceModeButtonProps) {
  const label = active
    ? 'Chiudi modalità vocale'
    : 'Modalità vocale: ascolta, invia e risponde a voce'
  return (
    <button
      type="button"
      className={`voice-mode-btn${active ? ' voice-mode-btn--active' : ''}`}
      aria-label={label}
      title={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
    >
      <span className="voice-mode-btn__glyph" aria-hidden="true">
        {/* Sound-wave / conversation-wave — deliberately not a microphone */}
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <path
            d="M4.5 10v4M8 7.5v9M12 4.5v15M16 7.5v9M19.5 10v4"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="round"
          />
        </svg>
      </span>
    </button>
  )
}
