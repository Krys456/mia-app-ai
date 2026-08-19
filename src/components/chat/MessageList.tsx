import { memo, useCallback, useMemo } from 'react'
import { useChat } from '../../context/ChatContext'
import type { ChatMessage } from '../../types'
import { MessageBubble } from './MessageBubble'
import { TypingAnimation } from './TypingAnimation'
import {
  resolveVisionSearchUiLang,
  shouldShowVisionSearchAction,
  visionSearchActionLabel,
  visionSearchButtonTrigger,
} from '../../lib/visionSearchActions'
import './MessageList.css'
import './MessageBubble.css'

interface MessageListProps {
  messages: ChatMessage[]
  isThinking: boolean
  isStreaming: boolean
  /** #290 — native text selection active in assistant prose. */
  selectionActive?: boolean
}

function MessageListComponent({
  messages,
  isThinking,
  isStreaming,
  selectionActive = false,
}: MessageListProps) {
  const { regenerateAssistant, sendMessage, handleWeatherUiAction } = useChat()
  const last = messages[messages.length - 1]
  const streamingId =
    isStreaming && last?.role === 'assistant' ? last.id : null
  const canRegenerate = !isThinking && !isStreaming

  const searchLang = useMemo(
    () =>
      resolveVisionSearchUiLang({
        messages,
        navigatorLanguage: typeof navigator !== 'undefined' ? navigator.language : 'it',
      }),
    [messages],
  )
  const searchLabel = visionSearchActionLabel(searchLang)

  const onRegenerate = useCallback(
    (messageId: string) => {
      regenerateAssistant(messageId)
    },
    [regenerateAssistant],
  )

  const onVisionSearch = useCallback(
    (_messageId: string) => {
      // Generic lookup intent — server resolves the Vision turn + forces web_search.
      sendMessage(visionSearchButtonTrigger(searchLang))
    },
    [sendMessage, searchLang],
  )

  return (
    <div className="message-list">
      {messages.map((message) => {
        const isThisStreaming = message.id === streamingId
        const showVisionSearch =
          message.role === 'assistant' &&
          !isThisStreaming &&
          shouldShowVisionSearchAction(messages, message.id)
        return (
          <MessageBubble
            key={message.id}
            message={message}
            isStreaming={isThisStreaming}
            selectionActive={selectionActive}
            showActions={
              (message.role === 'assistant' &&
                message.kind !== 'error' &&
                !isThisStreaming) ||
              (message.role === 'user' &&
                (Boolean(message.content) || Boolean(message.attachments?.length)))
            }
            canRegenerate={canRegenerate}
            onRegenerate={onRegenerate}
            showVisionSearch={showVisionSearch}
            visionSearchLabel={searchLabel}
            onVisionSearch={onVisionSearch}
            onWeatherAction={handleWeatherUiAction}
          />
        )
      })}

      {isThinking ? (
        <article
          className="bubble bubble--assistant bubble--thinking"
          aria-label="ShinkAIdo sta pensando"
        >
          <div className="bubble__meta">
            <span
              className="bubble__avatar bubble__avatar--assistant bubble__avatar--pulse"
              aria-hidden="true"
            >
              <span className="bubble__avatar-mark">L</span>
            </span>
            <span className="bubble__label">ShinkAIdo</span>
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
