import { useEffect, useMemo, useState } from 'react'
import type { MemoryFeedbackEvent } from '../lib/memoryFeedback'
import {
  localizeMemoryDisplayText,
  memoryFeedbackLabel,
  resolveMemoryFeedbackLocale,
} from '../lib/memoryFeedback'
import './MemoryMessageIndicator.css'

interface MemoryMessageIndicatorProps {
  event: MemoryFeedbackEvent
}

/**
 * Persistent, message-bound Memory feedback (#281).
 * Sits above assistant content; no timer, no fixed overlay.
 */
export function MemoryMessageIndicator({ event }: MemoryMessageIndicatorProps) {
  const locale = useMemo(
    () =>
      resolveMemoryFeedbackLocale(
        typeof navigator !== 'undefined' ? navigator.language : 'en',
      ),
    [],
  )

  const label = memoryFeedbackLabel(event.type, locale)
  const detail = localizeMemoryDisplayText(event.displayText, locale)
  const srText = detail ? `${label}. ${detail}` : label

  // One-time polite announcement on mount (when the completion attaches the event).
  // Persistent visible text stays static — no ongoing aria-live chatter.
  const [liveAnnouncement, setLiveAnnouncement] = useState(srText)
  useEffect(() => {
    setLiveAnnouncement(srText)
    const timer = window.setTimeout(() => setLiveAnnouncement(''), 1600)
    return () => window.clearTimeout(timer)
  }, [srText])

  return (
    <div className="memory-message-indicator">
      {liveAnnouncement ? (
        <span className="memory-message-indicator__live" role="status" aria-live="polite">
          {liveAnnouncement}
        </span>
      ) : null}
      <div className="memory-message-indicator__row" aria-hidden={liveAnnouncement ? true : undefined}>
        <span className="memory-message-indicator__icon" aria-hidden="true">
          📖
        </span>
        <span className="memory-message-indicator__body">
          <span className="memory-message-indicator__label">{label}</span>
          {detail ? (
            <span className="memory-message-indicator__detail">{detail}</span>
          ) : null}
        </span>
      </div>
    </div>
  )
}
