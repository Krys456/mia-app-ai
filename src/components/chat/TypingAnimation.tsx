import { memo } from 'react'
import './TypingAnimation.css'

function TypingAnimationComponent() {
  return (
    <div className="typing" aria-hidden="true">
      <span />
      <span />
      <span />
    </div>
  )
}

export const TypingAnimation = memo(TypingAnimationComponent)
