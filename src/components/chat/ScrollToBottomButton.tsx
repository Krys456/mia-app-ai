import { memo } from 'react'
import './ScrollToBottomButton.css'

interface ScrollToBottomButtonProps {
  visible: boolean
  onClick: () => void
}

function ScrollToBottomButtonComponent({ visible, onClick }: ScrollToBottomButtonProps) {
  return (
    <button
      type="button"
      className={`scroll-bottom-btn${visible ? ' scroll-bottom-btn--visible' : ''}`}
      aria-label="Vai in fondo alla conversazione"
      title="Vai in fondo"
      tabIndex={visible ? 0 : -1}
      aria-hidden={!visible}
      onClick={onClick}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M6 9l6 6 6-6"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  )
}

export const ScrollToBottomButton = memo(ScrollToBottomButtonComponent)
