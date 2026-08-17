import './VoiceModeButton.css'

export type VoiceModeButtonProps = {
  active?: boolean
  disabled?: boolean
  onClick: () => void
}

/**
 * Distinct Voice Mode entry — not the #273 dictation microphone.
 */
export function VoiceModeButton({
  active = false,
  disabled = false,
  onClick,
}: VoiceModeButtonProps) {
  return (
    <button
      type="button"
      className={`voice-mode-btn${active ? ' voice-mode-btn--active' : ''}`}
      aria-label={active ? 'Modalità vocale attiva' : 'Avvia modalità vocale'}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      title="Modalità vocale"
    >
      <span className="voice-mode-btn__glyph" aria-hidden="true">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
          <path
            d="M4 10v2a8 8 0 0 0 16 0v-2"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
          <path
            d="M12 18v3M8.5 21h7"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
          <rect
            x="9"
            y="3"
            width="6"
            height="10"
            rx="3"
            stroke="currentColor"
            strokeWidth="1.8"
          />
        </svg>
      </span>
      <span className="voice-mode-btn__text">Voce</span>
    </button>
  )
}
