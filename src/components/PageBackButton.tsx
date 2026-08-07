import './Header.css'
import './PageBackButton.css'

interface PageBackButtonProps {
  label?: string
  onClick: () => void
}

/** Shared top-left back control — same icon/style language as header actions. */
export function PageBackButton({ label = 'Indietro', onClick }: PageBackButtonProps) {
  return (
    <button
      type="button"
      className="header-btn page-back-btn"
      onClick={onClick}
      aria-label={label}
      title={label}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M15 6 9 12l6 6"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span className="page-back-btn__label">{label}</span>
    </button>
  )
}
