import { memo } from 'react'
import './TypingAnimation.css'

interface TypingAnimationProps {
  /** Optional visible status for premium presence (still decorative to AT). */
  label?: string
}

function TypingAnimationComponent({ label }: TypingAnimationProps) {
  return (
    <div className={`typing${label ? ' typing--labeled' : ''}`} aria-hidden="true">
      <span className="typing__dots">
        <span />
        <span />
        <span />
      </span>
      {label ? <span className="typing__label">{label}</span> : null}
    </div>
  )
}

export const TypingAnimation = memo(TypingAnimationComponent)
