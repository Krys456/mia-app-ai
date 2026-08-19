import { memo, useCallback, useEffect, useRef, useState } from 'react'
import {
  getMessageFeedback,
  setMessageFeedback,
  subscribeMessageFeedback,
  type MessageFeedbackValue,
} from '../../lib/messageFeedback'
import { copyText } from '../../lib/clipboard'
import './MessageActions.css'

export type MessageActionsVariant = 'assistant' | 'user'

interface MessageActionsProps {
  messageId: string
  content: string
  /** Assistant: copy + feedback + regenerate. User: copy only. */
  variant?: MessageActionsVariant
  canRegenerate?: boolean
  onRegenerate?: () => void
  /** #312 — Vision × Search compact action (only when visual context exists). */
  showVisionSearch?: boolean
  visionSearchLabel?: string
  onVisionSearch?: () => void
  /** Force visible (keyboard / long-press). */
  forceVisible?: boolean
  /** Fired after any toolbar action (helps dismiss touch pin). */
  onAction?: () => void
}

function MessageActionsComponent({
  messageId,
  content,
  variant = 'assistant',
  canRegenerate = false,
  onRegenerate,
  showVisionSearch = false,
  visionSearchLabel = 'Search',
  onVisionSearch,
  forceVisible = false,
  onAction,
}: MessageActionsProps) {
  const isUser = variant === 'user'
  const [copied, setCopied] = useState(false)
  const [feedback, setFeedback] = useState<MessageFeedbackValue | null>(() =>
    isUser ? null : getMessageFeedback(messageId),
  )
  const copiedTimerRef = useRef<number | null>(null)

  useEffect(() => {
    if (isUser) return
    setFeedback(getMessageFeedback(messageId))
    return subscribeMessageFeedback((id, value) => {
      if (id === messageId) setFeedback(value)
    })
  }, [messageId, isUser])

  useEffect(
    () => () => {
      if (copiedTimerRef.current != null) window.clearTimeout(copiedTimerRef.current)
    },
    [],
  )

  const onCopy = useCallback(async () => {
    const ok = await copyText(content)
    onAction?.()
    if (!ok) return
    setCopied(true)
    if (copiedTimerRef.current != null) window.clearTimeout(copiedTimerRef.current)
    copiedTimerRef.current = window.setTimeout(() => {
      copiedTimerRef.current = null
      setCopied(false)
    }, 1500)
  }, [content, onAction])

  const onFeedback = useCallback(
    (value: MessageFeedbackValue) => {
      setMessageFeedback(messageId, value)
      onAction?.()
    },
    [messageId, onAction],
  )

  return (
    <div
      className={`message-actions${isUser ? ' message-actions--user' : ''}${forceVisible ? ' message-actions--visible' : ''}`}
      role="toolbar"
      aria-label={isUser ? 'Azioni messaggio utente' : 'Azioni messaggio'}
    >
      {!isUser ? (
        <>
          <button
            type="button"
            className={`message-actions__btn${feedback === 'up' ? ' message-actions__btn--active' : ''}`}
            onClick={() => onFeedback('up')}
            aria-label="Mi è stata utile"
            aria-pressed={feedback === 'up'}
            title="Mi è stata utile"
          >
            <span aria-hidden="true">👍</span>
            <span className="message-actions__label">Mi è stata utile</span>
          </button>

          <button
            type="button"
            className={`message-actions__btn${feedback === 'down' ? ' message-actions__btn--active' : ''}`}
            onClick={() => onFeedback('down')}
            aria-label="Può migliorare"
            aria-pressed={feedback === 'down'}
            title="Può migliorare"
          >
            <span aria-hidden="true">👎</span>
            <span className="message-actions__label">Può migliorare</span>
          </button>

          <span className="message-actions__sep" aria-hidden="true" />
        </>
      ) : null}

      <button
        type="button"
        className={`message-actions__btn${copied ? ' message-actions__btn--pulse' : ''}`}
        onClick={() => void onCopy()}
        aria-label={copied ? 'Copiato' : 'Copia'}
        title={copied ? 'Copiato' : 'Copia'}
      >
        {copied ? <IconCheck /> : <IconCopy />}
        <span className="message-actions__label">{copied ? 'Copiato' : 'Copia'}</span>
      </button>

      {!isUser && showVisionSearch ? (
        <button
          type="button"
          className="message-actions__btn"
          onClick={() => {
            onAction?.()
            onVisionSearch?.()
          }}
          aria-label={visionSearchLabel}
          title={visionSearchLabel}
        >
          <IconSearch />
          <span className="message-actions__label">{visionSearchLabel}</span>
        </button>
      ) : null}

      {!isUser ? (
        <button
          type="button"
          className="message-actions__btn"
          onClick={() => onRegenerate?.()}
          disabled={!canRegenerate}
          aria-label="Rigenera"
          title="Rigenera"
        >
          <IconRefresh />
          <span className="message-actions__label">Rigenera</span>
        </button>
      ) : null}
    </div>
  )
}

function IconCopy() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
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
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
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
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 12a8 8 0 0 1 13.5-5.8M20 12a8 8 0 0 1-13.5 5.8"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <path
        d="M18 3v5h-5M6 21v-5h5"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function IconSearch() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.7" />
      <path
        d="M16.5 16.5 20 20"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  )
}

export const MessageActions = memo(MessageActionsComponent)
