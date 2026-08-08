import { memo } from 'react'
import type { ChatMessage } from '../../types'
import { MessageBubble } from './MessageBubble'
import { TypingAnimation } from './TypingAnimation'
import './MessageList.css'
import './MessageBubble.css'

interface MessageListProps {
  messages: ChatMessage[]
  isThinking: boolean
  isStreaming: boolean
}

function MessageListComponent({ messages, isThinking, isStreaming }: MessageListProps) {
  const last = messages[messages.length - 1]
  const streamingId =
    isStreaming && last?.role === 'assistant' ? last.id : null

  return (
    <div className="message-list">
      {messages.map((message) => {
        const isThisStreaming = message.id === streamingId
        return (
          <MessageBubble
            key={message.id}
            message={message}
            isStreaming={isThisStreaming}
            showActions={
              message.role === 'assistant' &&
              message.kind !== 'error' &&
              !isThisStreaming
            }
          />
        )
      })}

      {isThinking ? (
        <article className="bubble bubble--assistant" aria-label="LAIfe sta pensando">
          <div className="bubble__meta">
            <span className="bubble__avatar bubble__avatar--assistant" aria-hidden="true">
              <span className="bubble__avatar-mark">L</span>
            </span>
            <span className="bubble__label">LAIfe</span>
          </div>
          <div className="bubble__body bubble__body--typing">
            <TypingAnimation />
          </div>
        </article>
      ) : null}

      <div className="message-list__end" aria-hidden="true" />
    </div>
  )
}

export const MessageList = memo(MessageListComponent)
