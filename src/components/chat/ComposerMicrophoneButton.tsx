import './ComposerMicrophoneButton.css'

export type ComposerMicrophoneButtonProps = {
  listening: boolean
  disabled?: boolean
  onClick: () => void
}

/**
 * Right-slot mic control (#273). Idle ↔ listening; a11y via labels + aria-pressed.
 * Dictation only fills the composer draft — never auto-sends (#356B clarity).
 */
export function ComposerMicrophoneButton({
  listening,
  disabled = false,
  onClick,
}: ComposerMicrophoneButtonProps) {
  const label = listening
    ? 'Interrompi dettatura'
    : 'Dettatura: scrive nel campo, poi invii tu'
  return (
    <button
      type="button"
      className={`composer-mic${listening ? ' composer-mic--listening' : ''}`}
      aria-label={label}
      title={label}
      aria-pressed={listening}
      disabled={disabled}
      onClick={onClick}
    >
      <span className="composer-mic__glyph" aria-hidden="true">
        {listening ? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <rect x="7" y="7" width="10" height="10" rx="1.5" />
          </svg>
        ) : (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path
              d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinejoin="round"
            />
            <path
              d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
        )}
      </span>
      {listening ? <span className="composer-mic__badge">In ascolto</span> : null}
    </button>
  )
}
