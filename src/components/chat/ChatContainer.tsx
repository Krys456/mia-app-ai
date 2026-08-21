import { useEffect, useRef } from 'react'
import { useChat } from '../../context/ChatContext'
import { HomeExperience } from '../home/HomeExperience'
import { ComposerShell } from './ComposerShell'
import { CopyToast } from './CopyToast'
import { MessageList } from './MessageList'
import { ScrollToBottomButton } from './ScrollToBottomButton'
import { SelectionActionBar } from './SelectionActionBar'
import { SelectionInsightSheet } from './SelectionInsightSheet'
import { useAutoScroll } from './useAutoScroll'
import { useMessageSelection } from './useMessageSelection'
import './ChatContainer.css'
import './chat-tool-surfaces.css'

/**
 * Top-level chat shell.
 * Owns layout + auto-scroll wiring. Message formatting and input live in children.
 * Composer stays mounted across home ↔ thread so focus survives the first send.
 */
export function ChatContainer() {
  const { messages, isThinking, isStreaming } = useChat()
  const { scrollerRef, showButton, scrollToBottom, onUserMessage, onAssistantStart } =
    useAutoScroll(isStreaming)
  const wasHomeRef = useRef(true)
  const lastPinnedAssistantIdRef = useRef<string | null>(null)
  const {
    snapshot,
    insight,
    hasActiveSelection,
    runDefine,
    runExplain,
    runSearch,
    retryInsight,
    dismissAll,
    clearSelectionUi,
  } = useMessageSelection()

  const isHome = messages.length === 0 && !isThinking && !isStreaming

  // After leaving the empty hero, the viewport mounts — show the new user turn.
  useEffect(() => {
    if (wasHomeRef.current && !isHome) {
      onUserMessage()
    }
    wasHomeRef.current = isHome
  }, [isHome, onUserMessage])

  // When a new assistant bubble starts, pin once to its beginning — never follow growth.
  useEffect(() => {
    if (!isStreaming) {
      lastPinnedAssistantIdRef.current = null
      return
    }
    const last = messages[messages.length - 1]
    if (!last || last.role !== 'assistant') return
    if (lastPinnedAssistantIdRef.current === last.id) return

    let cancelled = false
    const pin = () => {
      if (cancelled) return
      const el = Array.from(document.querySelectorAll('[data-message-id]')).find(
        (node) => node.getAttribute('data-message-id') === last.id,
      ) as HTMLElement | undefined
      if (!el) {
        requestAnimationFrame(pin)
        return
      }
      lastPinnedAssistantIdRef.current = last.id
      onAssistantStart(last.id, el)
    }
    requestAnimationFrame(pin)
    return () => {
      cancelled = true
    }
  }, [isStreaming, messages, onAssistantStart])

  return (
    <div className={`chat-container${isHome ? ' chat-container--home' : ''}`}>
      {isHome ? (
        <HomeExperience />
      ) : (
        <div className="chat-container__stage">
          <div
            className="chat-container__viewport scroll-surface"
            ref={scrollerRef}
            role="log"
            aria-live="off"
            aria-relevant="additions"
          >
            <MessageList
              messages={messages}
              isThinking={isThinking}
              isStreaming={isStreaming}
              selectionActive={hasActiveSelection}
            />
          </div>

          <ScrollToBottomButton visible={showButton} onClick={scrollToBottom} />
        </div>
      )}

      <ComposerShell onMessageSent={onUserMessage} />

      {snapshot && !insight ? (
        <SelectionActionBar
          snapshot={snapshot}
          onDefine={runDefine}
          onExplain={runExplain}
          onSearch={runSearch}
          onDismiss={clearSelectionUi}
        />
      ) : null}

      {insight ? (
        <SelectionInsightSheet
          insight={insight}
          onDismiss={dismissAll}
          onRetry={insight.error ? retryInsight : undefined}
        />
      ) : null}

      {/* #331 — copy feedback for code / prompt / long quote blocks */}
      <CopyToast />
    </div>
  )
}
