import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { useChat } from '../context/ChatContext'
import { HomeHero } from './HomeHero'
import './ChatThread.css'

/** Distance from bottom that counts as "near" for auto re-attach. */
const NEAR_BOTTOM_PX = 40

function distanceFromBottom(el: HTMLElement): number {
  return el.scrollHeight - el.scrollTop - el.clientHeight
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    target.isContentEditable
  )
}

/**
 * ChatGPT-style "follow output":
 * - While following, each frame applies only the content growth
 *   (scrollTop += ΔscrollHeight) — never jumps with scrollIntoView
 *   or scrollTop = scrollHeight.
 * - User wheel / touch / keys / drag away from bottom detaches immediately.
 * - Returning within NEAR_BOTTOM_PX re-attaches follow.
 */
export function ChatThread() {
  const { messages, isThinking, isStreaming } = useChat()
  const scrollerRef = useRef<HTMLDivElement>(null)
  const followRef = useRef(true)
  const lastHeightRef = useRef(0)
  const ignoreScrollRef = useRef(false)
  const rafRef = useRef<number | null>(null)
  const pinRafRef = useRef<number | null>(null)
  const [showScrollButton, setShowScrollButton] = useState(false)
  const isHome = messages.length === 0 && !isThinking && !isStreaming

  const syncHeight = (el: HTMLElement) => {
    lastHeightRef.current = el.scrollHeight
  }

  const applyScrollDelta = (el: HTMLElement, delta: number) => {
    if (delta === 0) return
    ignoreScrollRef.current = true
    el.scrollTop += delta
    ignoreScrollRef.current = false
  }

  const attachFollow = () => {
    const el = scrollerRef.current
    followRef.current = true
    setShowScrollButton(false)
    if (el) syncHeight(el)
  }

  const detachFollow = () => {
    if (!followRef.current) {
      setShowScrollButton(true)
      return
    }
    followRef.current = false
    if (pinRafRef.current != null) {
      cancelAnimationFrame(pinRafRef.current)
      pinRafRef.current = null
    }
    setShowScrollButton(true)
  }

  /** Continuous rAF loop: follow content growth only. */
  useEffect(() => {
    if (isHome) {
      followRef.current = true
      setShowScrollButton(false)
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
      return
    }

    const el = scrollerRef.current
    if (!el) return

    syncHeight(el)

    const tick = () => {
      rafRef.current = requestAnimationFrame(tick)

      const scroller = scrollerRef.current
      if (!scroller) return

      const height = scroller.scrollHeight
      const growth = height - lastHeightRef.current
      lastHeightRef.current = height

      if (followRef.current && growth > 0) {
        applyScrollDelta(scroller, growth)
      }
    }

    rafRef.current = requestAnimationFrame(tick)

    return () => {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }
  }, [isHome])

  /** User intent + near-bottom re-attach. */
  useEffect(() => {
    if (isHome) return
    const el = scrollerRef.current
    if (!el) return

    const onWheel = (event: WheelEvent) => {
      // Scroll up → leave follow. Scroll down only detaches if already away from bottom.
      if (event.deltaY < 0 || distanceFromBottom(el) > NEAR_BOTTOM_PX) {
        detachFollow()
      }
    }

    const onTouchMove = () => {
      detachFollow()
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return
      if (
        event.key === 'PageUp' ||
        event.key === 'Home' ||
        event.key === 'ArrowUp' ||
        (event.key === 'PageDown' && distanceFromBottom(el) > NEAR_BOTTOM_PX) ||
        (event.key === 'ArrowDown' && distanceFromBottom(el) > NEAR_BOTTOM_PX) ||
        (event.key === ' ' && !event.shiftKey && distanceFromBottom(el) > NEAR_BOTTOM_PX)
      ) {
        detachFollow()
      }
    }

    const onScroll = () => {
      if (ignoreScrollRef.current) return

      const near = distanceFromBottom(el) <= NEAR_BOTTOM_PX

      if (followRef.current) {
        if (!near) detachFollow()
        return
      }

      // Detached: re-attach when user returns near the bottom.
      if (near) {
        attachFollow()
      } else {
        setShowScrollButton(true)
      }
    }

    el.addEventListener('wheel', onWheel, { passive: true })
    el.addEventListener('touchmove', onTouchMove, { passive: true })
    el.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('keydown', onKeyDown)

    return () => {
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('scroll', onScroll)
      window.removeEventListener('keydown', onKeyDown)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHome])

  /** Scroll-to-bottom button: ease toward bottom, then attach follow. */
  const scrollToBottomFollow = () => {
    const el = scrollerRef.current
    if (!el) return

    if (pinRafRef.current != null) {
      cancelAnimationFrame(pinRafRef.current)
      pinRafRef.current = null
    }

    setShowScrollButton(false)

    const pinTick = () => {
      pinRafRef.current = null
      const scroller = scrollerRef.current
      if (!scroller) return

      const remaining = distanceFromBottom(scroller)

      if (remaining <= NEAR_BOTTOM_PX) {
        // Close enough — attach follow; growth loop keeps us synced.
        // Nudge remaining distance in small steps (never one-shot to max).
        if (remaining > 0) {
          applyScrollDelta(scroller, remaining)
        }
        syncHeight(scroller)
        attachFollow()
        return
      }

      // Ease a fraction of the remaining distance each frame.
      const step = Math.max(12, remaining * 0.2)
      applyScrollDelta(scroller, step)
      syncHeight(scroller)
      pinRafRef.current = requestAnimationFrame(pinTick)
    }

    followRef.current = true
    pinRafRef.current = requestAnimationFrame(pinTick)
  }

  useEffect(() => {
    return () => {
      if (pinRafRef.current != null) cancelAnimationFrame(pinRafRef.current)
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
        onClick={scrollToBottomFollow}
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
