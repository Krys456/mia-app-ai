import { useEffect, useMemo } from 'react'
import { useChat } from '../context/ChatContext'
import {
  memoryFeedbackLabel,
  resolveMemoryFeedbackLocale,
} from '../lib/memoryFeedback'
import './MemoryToast.css'

export function MemoryToast() {
  const { memoryNotice, clearMemoryNotice } = useChat()

  useEffect(() => {
    if (!memoryNotice) return
    const timer = window.setTimeout(() => clearMemoryNotice(), 3200)
    return () => window.clearTimeout(timer)
  }, [memoryNotice, clearMemoryNotice])

  const locale = useMemo(
    () =>
      resolveMemoryFeedbackLocale(
        typeof navigator !== 'undefined' ? navigator.language : 'en',
      ),
    [],
  )

  if (!memoryNotice) return null

  const label = memoryFeedbackLabel(memoryNotice.type, locale)
  const detail = memoryNotice.displayText?.trim() || ''

  return (
    <div className="memory-toast" role="status" aria-live="polite">
      <span className="memory-toast__icon" aria-hidden="true">
        📖
      </span>
      <span className="memory-toast__body">
        <span className="memory-toast__label">{label}</span>
        {detail ? <span className="memory-toast__detail">{detail}</span> : null}
      </span>
    </div>
  )
}
