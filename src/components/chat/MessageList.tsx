import { memo, useCallback } from 'react'
import { useChat } from '../../context/ChatContext'
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
  const { regenerateAssistant } = useChat()
  const last = messages[messages.length - 1]
  const streamingId =
    isStreaming && last?.role === 'assistant' ? last.id : null
  const canRegenerate = !isThinking && !isStreaming

  const onRegenerate = useCallback(
    (messageId: string) => {
      regenerateAssistant(messageId)
    },
    [regenerateAssistant],
  )

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
              (message.role === 'assistant' &&
                message.kind !== 'error' &&
                !isThisStreaming) ||
              (message.role === 'user' && Boolean(message.content))
            }
            canRegenerate={canRegenerate}
            onRegenerate={onRegenerate}
          />
        )
      })}

      {isThinking ? (
        <article
          className="bubble bubble--assistant bubble--thinking"
          aria-label="LAIfe sta pensando"
        >
          <div className="bubble__meta">
            <span
              className="bubble__avatar bubble__avatar--assistant bubble__avatar--pulse"
              aria-hidden="true"
            >
              <span className="bubble__avatar-mark">L</span>
            </span>
            <span className="bubble__label">LAIfe</span>
          </div>
          <div className="bubble__body bubble__body--typing">
            <TypingAnimation label="Sta pensando…" />
          </div>
        </article>
      ) : null}

      <div className="message-list__end" aria-hidden="true" />
    </div>
  )
}

export const MessageList = memo(MessageListComponent)
