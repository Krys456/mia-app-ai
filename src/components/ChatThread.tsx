import { useEffect, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import { useChat } from '../context/ChatContext'
import { HomeHero } from './HomeHero'
import './ChatThread.css'

export function ChatThread() {
  const { messages, isThinking } = useChat()
  const endRef = useRef<HTMLDivElement>(null)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const isHome = messages.length === 0 && !isThinking

  useEffect(() => {
    if (isHome) return
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, isThinking, isHome])

  if (isHome) {
    return <HomeHero />
  }

  return (
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
  )
}
