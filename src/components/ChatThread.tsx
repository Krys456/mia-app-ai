import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { useChat } from '../context/ChatContext'
import { HomeHero } from './HomeHero'
import './ChatThread.css'

const NEAR_BOTTOM_PX = 72

function isNearBottom(el: HTMLElement): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM_PX
}

/**
 * Smooth chat scrolling:
 * - rAF follow keeps the last written line in view while streaming
 * - any user gesture detaches follow immediately
 * - Scroll-to-bottom reattaches and can resume follow
 */
export function ChatThread() {
  const { messages, isThinking, isStreaming } = useChat()
  const scrollerRef = useRef<HTMLDivElement>(null)
  const stickToBottomRef = useRef(true)
  const ignoreScrollRef = useRef(false)
  const followRafRef = useRef<number | null>(null)
  const pinRafRef = useRef<number | null>(null)
  const isStreamingRef = useRef(isStreaming)
  const [showScrollButton, setShowScrollButton] = useState(false)
  const isHome = messages.length === 0 && !isThinking && !isStreaming

  isStreamingRef.current = isStreaming

  const stopFollowLoop = () => {
    if (followRafRef.current != null) {
      cancelAnimationFrame(followRafRef.current)
      followRafRef.current = null
    }
  }

  const stopPinLoop = () => {
    if (pinRafRef.current != null) {
      cancelAnimationFrame(pinRafRef.current)
      pinRafRef.current = null
    }
  }

  const setScrollTop = (el: HTMLElement, value: number) => {
    ignoreScrollRef.current = true
    el.scrollTop = value
    ignoreScrollRef.current = false
  }

  const detachFollow = () => {
    if (!stickToBottomRef.current) {
      setShowScrollButton(true)
      return
    }
    stickToBottomRef.current = false
    stopFollowLoop()
    stopPinLoop()
    setShowScrollButton(true)
  }

  const followTick = () => {
    followRafRef.current = null
    if (!stickToBottomRef.current) return

    const el = scrollerRef.current
    if (!el) return

    const target = el.scrollHeight - el.clientHeight
    const current = el.scrollTop
    const delta = target - current

    if (delta > 0.5) {
      const step = Math.max(6, Math.min(delta, delta * 0.28 + 4))
      setScrollTop(el, current + step)
    }

    if (stickToBottomRef.current && (isStreamingRef.current || delta > 0.5)) {
      followRafRef.current = requestAnimationFrame(followTick)
    }
  }

  const ensureFollowLoop = () => {
    if (!stickToBottomRef.current) return
    if (followRafRef.current != null) return
    followRafRef.current = requestAnimationFrame(followTick)
  }

  const scrollToBottomSmooth = () => {
    const el = scrollerRef.current
    if (!el) return

    stickToBottomRef.current = true
    setShowScrollButton(false)
    stopFollowLoop()
    stopPinLoop()

    const animate = () => {
      pinRafRef.current = null
      if (!stickToBottomRef.current) return

      const scroller = scrollerRef.current
      if (!scroller) return

      const target = scroller.scrollHeight - scroller.clientHeight
      const current = scroller.scrollTop
      const delta = target - current

      if (delta <= 1) {
        setScrollTop(scroller, target)
        if (isStreamingRef.current) ensureFollowLoop()
        return
      }

      setScrollTop(scroller, current + Math.max(10, delta * 0.22))
      pinRafRef.current = requestAnimationFrame(animate)
    }

    pinRafRef.current = requestAnimationFrame(animate)
  }

  useEffect(() => {
    if (isHome) {
      stickToBottomRef.current = true
      setShowScrollButton(false)
      stopFollowLoop()
      stopPinLoop()
      return
    }

    const el = scrollerRef.current
    if (!el) return

    const onUserIntent = () => detachFollow()

    const onScroll = () => {
      if (ignoreScrollRef.current) return
      if (!stickToBottomRef.current) {
        setShowScrollButton(true)
        return
      }
      // Scrollbar drag / unexpected jump away from bottom.
      if (!isNearBottom(el)) {
        detachFollow()
      }
    }

    el.addEventListener('wheel', onUserIntent, { passive: true })
    el.addEventListener('touchmove', onUserIntent, { passive: true })
    el.addEventListener('scroll', onScroll, { passive: true })

    return () => {
      el.removeEventListener('wheel', onUserIntent)
      el.removeEventListener('touchmove', onUserIntent)
      el.removeEventListener('scroll', onScroll)
      stopFollowLoop()
      stopPinLoop()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHome])

  const lastMessage = messages[messages.length - 1]
  const lastContent = lastMessage?.content ?? ''
  const lastRole = lastMessage?.role

  useEffect(() => {
    if (isHome) return

    if (lastRole === 'user') {
      stickToBottomRef.current = true
      setShowScrollButton(false)
      scrollToBottomSmooth()
      return
    }

    if (!stickToBottomRef.current) {
      setShowScrollButton(true)
      return
    }

    ensureFollowLoop()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastContent, lastRole, isThinking, isStreaming, isHome, messages.length])

  useEffect(() => {
    return () => {
      stopFollowLoop()
      stopPinLoop()
    }
  }, [])

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
                  msg.content ? (
                    <ReactMarkdown>{msg.content}</ReactMarkdown>
                  ) : (
                    <div className="typing" aria-hidden="true">
                      <span />
                      <span />
                      <span />
                    </div>
                  )
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

          <div className="chat-thread__end" />
        </div>
      </div>

      <button
        type="button"
        className={`scroll-bottom-btn${showScrollButton ? ' scroll-bottom-btn--visible' : ''}`}
        aria-label="Vai in fondo alla conversazione"
        title="Vai in fondo"
        tabIndex={showScrollButton ? 0 : -1}
        aria-hidden={!showScrollButton}
        onClick={scrollToBottomSmooth}
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
