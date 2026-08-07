import { memo } from 'react'
import type { ChatMessage } from '../../types'
import { StreamingRenderer } from './StreamingRenderer'
import { TypingAnimation } from './TypingAnimation'
import './MessageBubble.css'

interface MessageBubbleProps {
  message: ChatMessage
  /** True while this assistant bubble is still receiving streamed text. */
  isStreaming?: boolean
}

function MessageBubbleComponent({ message, isStreaming = false }: MessageBubbleProps) {
  const isAssistant = message.role === 'assistant'
  const isEmptyStream = isAssistant && !message.content && isStreaming

  return (
    <article
      className={`bubble bubble--${message.role}`}
      aria-label={message.role === 'user' ? 'Tu' : 'LAIfe'}
    >
      {isAssistant ? <span className="bubble__label">LAIfe</span> : null}
      <div className={`bubble__body${isEmptyStream ? ' bubble__body--typing' : ''}`}>
        {isAssistant ? (
          isEmptyStream ? (
            <TypingAnimation />
          ) : (
            <StreamingRenderer content={message.content} />
          )
        ) : (
          <p>{message.content}</p>
        )}
      </div>
    </article>
  )
}

export const MessageBubble = memo(MessageBubbleComponent)
