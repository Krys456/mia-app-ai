import { memo, useMemo } from 'react'
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
  const streamingId = useMemo(() => {
    if (!isStreaming) return null
    const last = messages[messages.length - 1]
    return last?.role === 'assistant' ? last.id : null
  }, [messages, isStreaming])

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
          className="bubble bubble--assistant bubble--thinking"
          aria-label="LAIfe is thinking"
        >
          <span className="bubble__label">LAIfe</span>
          <TypingAnimation />
        </article>
      ) : null}

      <div className="message-list__end" aria-hidden="true" />
    </div>
  )
}

export const MessageList = memo(MessageListComponent)
