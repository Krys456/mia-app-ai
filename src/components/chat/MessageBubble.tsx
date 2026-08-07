import { memo, useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { useChat } from '../../context/ChatContext'
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
}

const LONG_PRESS_MS = 480

function MessageBubbleComponent({
  message,
  isStreaming = false,
  showActions = false,
}: MessageBubbleProps) {
  const { regenerateAssistant, isThinking, isStreaming: chatStreaming } = useChat()
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
        <span className="bubble__label">LAIfe</span>
      ) : (
        <span className="bubble__label bubble__label--user">Tu</span>
      )}
      <div className={`bubble__body${isEmptyStream ? ' bubble__body--typing' : ''}`}>
        {isAssistant ? (
          isEmptyStream ? (
            <TypingAnimation />
          ) : (
            <StreamingRenderer content={message.content} isStreaming={isStreaming} />
          )
        ) : (
          <p>{message.content}</p>
        )}
      </div>

      {isAssistant && showActions && !isStreaming && message.content ? (
        <MessageActions
          messageId={message.id}
          content={message.content}
          canRegenerate={!isThinking && !chatStreaming}
          forceVisible={actionsPinned}
          onRegenerate={() => regenerateAssistant(message.id)}
        />
      ) : null}
    </article>
  )
}

export const MessageBubble = memo(MessageBubbleComponent)
