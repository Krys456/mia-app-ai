import { memo, useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import type { ChatMessage } from '../../types'
import { MessageActions } from './MessageActions'
import { StreamingRenderer } from './StreamingRenderer'
import { TypingAnimation } from './TypingAnimation'
import './MessageBubble.css'

interface MessageBubbleProps {
  message: ChatMessage
  /** True while this assistant bubble is still receiving streamed text. */
  isStreaming?: boolean
  showActions?: boolean
  canRegenerate?: boolean
  onRegenerate?: (messageId: string) => void
}

const LONG_PRESS_MS = 480

function LaifeMark() {
  return (
    <span className="bubble__avatar bubble__avatar--assistant" aria-hidden="true">
      <span className="bubble__avatar-mark">L</span>
    </span>
  )
}

function MessageBubbleComponent({
  message,
  isStreaming = false,
  showActions = false,
  canRegenerate = false,
  onRegenerate,
}: MessageBubbleProps) {
  const isAssistant = message.role === 'assistant'
  const isEmptyStream = isAssistant && !message.content && isStreaming
  const [actionsPinned, setActionsPinned] = useState(false)
  const longPressTimer = useRef<number | null>(null)

  const clearLongPress = useCallback(() => {
    if (longPressTimer.current != null) {
      window.clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
  }, [])

  useEffect(() => () => clearLongPress(), [clearLongPress])

  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    if (!isAssistant || isStreaming || !showActions) return
    if (event.pointerType === 'mouse') return
    clearLongPress()
    longPressTimer.current = window.setTimeout(() => {
      setActionsPinned(true)
    }, LONG_PRESS_MS)
  }

  const onPointerUp = () => clearLongPress()

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!isAssistant || !showActions) return
    if (event.key === 'Escape') setActionsPinned(false)
  }

  return (
    <article
      className={`bubble bubble--${message.role}${actionsPinned ? ' bubble--actions-open' : ''}`}
      aria-label={message.role === 'user' ? 'Tu' : 'LAIfe'}
      tabIndex={isAssistant && showActions ? 0 : undefined}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={onPointerUp}
      onKeyDown={onKeyDown}
    >
      {isAssistant ? (
        <>
          <div className="bubble__meta">
            <LaifeMark />
            <span className="bubble__label">LAIfe</span>
          </div>
          <div className={`bubble__body${isEmptyStream ? ' bubble__body--typing' : ''}`}>
            {isEmptyStream ? (
              <TypingAnimation />
            ) : (
              <StreamingRenderer content={message.content} isStreaming={isStreaming} />
            )}
          </div>
        </>
      ) : (
        <div className="bubble__user-row">
          <div className="bubble__body">
            <p>{message.content}</p>
          </div>
        </div>
      )}

      {isAssistant && showActions && !isStreaming && message.content ? (
        <MessageActions
          messageId={message.id}
          content={message.content}
          canRegenerate={canRegenerate}
          forceVisible={actionsPinned}
          onRegenerate={() => onRegenerate?.(message.id)}
        />
      ) : null}
    </article>
  )
}

export const MessageBubble = memo(MessageBubbleComponent)
