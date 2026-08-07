import { memo, useCallback, useEffect, useState } from 'react'
import {
  getMessageFeedback,
  setMessageFeedback,
  subscribeMessageFeedback,
  type MessageFeedbackValue,
} from '../../lib/messageFeedback'
import './MessageActions.css'

interface MessageActionsProps {
  messageId: string
  content: string
  canRegenerate: boolean
  onRegenerate: () => void
  /** Force visible (keyboard / long-press). */
  forceVisible?: boolean
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const area = document.createElement('textarea')
      area.value = text
      area.setAttribute('readonly', '')
      area.style.position = 'fixed'
      area.style.opacity = '0'
      document.body.appendChild(area)
      area.select()
      const ok = document.execCommand('copy')
      document.body.removeChild(area)
      return ok
    } catch {
      return false
    }
  }
}

function MessageActionsComponent({
  messageId,
  content,
  canRegenerate,
  onRegenerate,
  forceVisible = false,
}: MessageActionsProps) {
  const [copied, setCopied] = useState(false)
  const [shared, setShared] = useState(false)
  const [feedback, setFeedback] = useState<MessageFeedbackValue | null>(() =>
    getMessageFeedback(messageId),
  )

  useEffect(() => {
    setFeedback(getMessageFeedback(messageId))
    return subscribeMessageFeedback((id, value) => {
      if (id === messageId) setFeedback(value)
    })
  }, [messageId])

  const onCopy = useCallback(async () => {
    const ok = await copyText(content)
    if (!ok) return
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }, [content])

  const onShare = useCallback(async () => {
    const text = content.trim()
    if (!text) return

    try {
      if (typeof navigator.share === 'function') {
        await navigator.share({ text, title: 'LAIfe' })
        setShared(true)
        window.setTimeout(() => setShared(false), 1500)
        return
      }
    } catch {
      /* user cancelled or unsupported — fall through to copy */
    }

    const ok = await copyText(text)
    if (!ok) return
    setShared(true)
    window.setTimeout(() => setShared(false), 1500)
  }, [content])

  const onFeedback = useCallback(
    (value: MessageFeedbackValue) => {
      setMessageFeedback(messageId, value)
    },
    [messageId],
  )

  return (
    <div
      className={`message-actions${forceVisible ? ' message-actions--visible' : ''}`}
      role="toolbar"
      aria-label="Azioni messaggio"
    >
      <button
        type="button"
        className={`message-actions__btn${copied ? ' message-actions__btn--pulse' : ''}`}
        onClick={() => void onCopy()}
        aria-label={copied ? 'Copiato' : 'Copia risposta'}
        title={copied ? 'Copiato' : 'Copia'}
      >
        {copied ? (
          <IconCheck />
        ) : (
          <IconCopy />
        )}
      </button>

      <button
        type="button"
        className="message-actions__btn"
        onClick={onRegenerate}
        disabled={!canRegenerate}
        aria-label="Rigenera risposta"
        title="Rigenera"
      >
        <IconRefresh />
      </button>

      <button
        type="button"
        className={`message-actions__btn${shared ? ' message-actions__btn--pulse' : ''}`}
        onClick={() => void onShare()}
        aria-label={shared ? 'Condiviso' : 'Condividi risposta'}
        title="Condividi"
      >
        <IconShare />
      </button>

      <span className="message-actions__sep" aria-hidden="true" />

      <button
        type="button"
        className={`message-actions__btn${feedback === 'up' ? ' message-actions__btn--active' : ''}`}
        onClick={() => onFeedback('up')}
        aria-label="Feedback positivo"
        aria-pressed={feedback === 'up'}
        title="Utile"
      >
        <span aria-hidden="true">👍</span>
      </button>

      <button
        type="button"
        className={`message-actions__btn${feedback === 'down' ? ' message-actions__btn--active' : ''}`}
        onClick={() => onFeedback('down')}
        aria-label="Feedback negativo"
        aria-pressed={feedback === 'down'}
        title="Non utile"
      >
        <span aria-hidden="true">👎</span>
      </button>
    </div>
  )
}

function IconCopy() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="1.7" />
      <path
        d="M5 15V5a2 2 0 0 1 2-2h10"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  )
}

function IconCheck() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="m5 12 4.5 4.5L19 7"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function IconRefresh() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 12a8 8 0 0 1 13.5-5.8M20 12a8 8 0 0 1-13.5 5.8"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <path d="M18 3v5h-5M6 21v-5h5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function IconShare() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="18" cy="5" r="2.4" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="6" cy="12" r="2.4" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="18" cy="19" r="2.4" stroke="currentColor" strokeWidth="1.7" />
      <path d="m8.2 13.1 7.5 4.2M15.7 6.7l-7.5 4.2" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  )
}

export const MessageActions = memo(MessageActionsComponent)
