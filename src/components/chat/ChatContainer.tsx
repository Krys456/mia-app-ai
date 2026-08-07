import { useEffect, useRef } from 'react'
import { useChat } from '../../context/ChatContext'
import { HomeHero } from '../HomeHero'
import { InputBar } from './InputBar'
import { MessageList } from './MessageList'
import { ScrollToBottomButton } from './ScrollToBottomButton'
import { useAutoScroll } from './useAutoScroll'
import './ChatContainer.css'

/**
 * Top-level chat shell.
 * Owns layout + auto-scroll wiring. Message formatting and input live in children.
 */
export function ChatContainer() {
  const { messages, isThinking, isStreaming } = useChat()
  const { scrollerRef, showButton, scrollToBottom, onUserMessage } =
    useAutoScroll(isStreaming)
  const wasHomeRef = useRef(true)

  const isHome = messages.length === 0 && !isThinking && !isStreaming

  // After leaving the empty hero, the viewport mounts — enter FOLLOWING for the new turn.
  useEffect(() => {
    if (wasHomeRef.current && !isHome) {
      onUserMessage()
    }
    wasHomeRef.current = isHome
  }, [isHome, onUserMessage])

  if (isHome) {
    return (
      <div className="chat-container chat-container--home">
        <HomeHero />
        <InputBar onMessageSent={onUserMessage} />
      </div>
    )
  }

  return (
    <div className="chat-container">
      <div className="chat-container__stage">
        <div
          className="chat-container__viewport"
          ref={scrollerRef}
          role="log"
          aria-live="polite"
        >
          <MessageList
            messages={messages}
            isThinking={isThinking}
            isStreaming={isStreaming}
          />
        </div>

        <ScrollToBottomButton visible={showButton} onClick={scrollToBottom} />
      </div>

      <InputBar onMessageSent={onUserMessage} />
    </div>
  )
}
