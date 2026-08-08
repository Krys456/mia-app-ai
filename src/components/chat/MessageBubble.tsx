import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from 'react'
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
}: MessageBubbleProps) {
  const { regenerateAssistant, isThinking, isStreaming: chatStreaming } = useChat()
  const isAssistant = message.role === 'assistant'
  const isEmptyStream = isAssistant && !message.content && isStreaming
  const [actionsPinned, setActionsPinned] = useState(false)
  const longPressTimer = useRef<number | null>(null)
  const rootRef = useRef<HTMLElement>(null)

  const clearLongPress = useCallback(() => {
    if (longPressTimer.current != null) {
      window.clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
  }, [])

  const unpinActions = useCallback(() => setActionsPinned(false), [])

  useEffect(() => () => clearLongPress(), [clearLongPress])

  // Dismiss long-press pin on outside tap / scroll (phones have no Escape).
  useEffect(() => {
    if (!actionsPinned) return
    const onPointerDown = (event: globalThis.PointerEvent) => {
      const root = rootRef.current
      if (!root) return
      if (event.target instanceof Node && root.contains(event.target)) return
      setActionsPinned(false)
    }
    const onScroll = () => setActionsPinned(false)
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [actionsPinned])

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
      ref={rootRef}
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
          canRegenerate={!isThinking && !chatStreaming}
          forceVisible={actionsPinned}
          onRegenerate={() => {
            unpinActions()
            regenerateAssistant(message.id)
          }}
          onAction={unpinActions}
        />
      ) : null}
    </article>
  )
}

export const MessageBubble = memo(MessageBubbleComponent)
