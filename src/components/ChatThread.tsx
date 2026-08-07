import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { useChat } from '../context/ChatContext'
import { HomeHero } from './HomeHero'
import './ChatThread.css'

const NEAR_BOTTOM_PX = 96

function isNearBottom(el: HTMLElement): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM_PX
}

export function ChatThread() {
  const { messages, isThinking } = useChat()
  const endRef = useRef<HTMLDivElement>(null)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const stickToBottomRef = useRef(true)
  const programmaticScrollRef = useRef(false)
  const [showScrollButton, setShowScrollButton] = useState(false)
  const isHome = messages.length === 0 && !isThinking

  const syncStickFromScroll = () => {
    if (programmaticScrollRef.current) return
    const el = scrollerRef.current
    if (!el) return
    const near = isNearBottom(el)
    stickToBottomRef.current = near
    setShowScrollButton(!near)
  }

  const scrollToBottom = (behavior: ScrollBehavior = 'smooth') => {
    const el = scrollerRef.current
    if (!el) return

    stickToBottomRef.current = true
    setShowScrollButton(false)
    programmaticScrollRef.current = true
    el.scrollTo({ top: el.scrollHeight, behavior })

    window.setTimeout(
      () => {
        programmaticScrollRef.current = false
        if (scrollerRef.current) {
          stickToBottomRef.current = isNearBottom(scrollerRef.current)
          setShowScrollButton(!stickToBottomRef.current)
        }
      },
      behavior === 'smooth' ? 450 : 50,
    )
  }

  useEffect(() => {
    if (isHome) {
      stickToBottomRef.current = true
      setShowScrollButton(false)
      return
    }

    const el = scrollerRef.current
    if (!el) return

    syncStickFromScroll()
    el.addEventListener('scroll', syncStickFromScroll, { passive: true })
    return () => el.removeEventListener('scroll', syncStickFromScroll)
  }, [isHome])

  useEffect(() => {
    if (isHome) return

    const last = messages[messages.length - 1]
    const userJustSent = last?.role === 'user'

    if (userJustSent || stickToBottomRef.current) {
      requestAnimationFrame(() => {
        scrollToBottom('smooth')
      })
      return
    }

    setShowScrollButton(true)
  }, [messages, isThinking, isHome])

  if (isHome) {
    return <HomeHero />
  }

  return (
    <div className="chat-thread-wrap">
      <div className="chat-thread" ref={scrollerRef} role="log" aria-live="polite">
        <div className="chat-thread__list">
          {messages.map((msg) => (
            <article
              key={msg.id}
              className={`bubble bubble--${msg.role}`}
              aria-label={msg.role === 'user' ? 'You' : 'LAIfe'}
            >
              {msg.role === 'assistant' && (
                <span className="bubble__label">LAIfe</span>
              )}
              <div className="bubble__body">
                {msg.role === 'assistant' ? (
                  <ReactMarkdown>{msg.content}</ReactMarkdown>
                ) : (
                  <p>{msg.content}</p>
                )}
              </div>
            </article>
          ))}

          {isThinking && (
            <article
              className="bubble bubble--assistant bubble--thinking"
              aria-label="LAIfe is thinking"
            >
              <span className="bubble__label">LAIfe</span>
              <div className="typing" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
            </article>
          )}

          <div ref={endRef} className="chat-thread__end" />
        </div>
      </div>

      <button
        type="button"
        className={`scroll-bottom-btn${showScrollButton ? ' scroll-bottom-btn--visible' : ''}`}
        aria-label="Vai in fondo alla conversazione"
        title="Vai in fondo"
        tabIndex={showScrollButton ? 0 : -1}
        aria-hidden={!showScrollButton}
        onClick={() => scrollToBottom('smooth')}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M6 9l6 6 6-6"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>
  )
}
