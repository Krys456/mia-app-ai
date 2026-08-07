import { memo } from 'react'
import type { ChatMessage } from '../../types'
import { MessageBubble } from './MessageBubble'
import { TypingAnimation } from './TypingAnimation'
import './MessageList.css'

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
      {messages.map((message) => (
        <MessageBubble
          key={message.id}
          message={message}
          isStreaming={message.id === streamingId}
        />
      ))}

      {isThinking ? (
        <article
          className="bubble bubble--assistant"
          aria-label="LAIfe sta pensando"
        >
          <span className="bubble__label">LAIfe</span>
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
