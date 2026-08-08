import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { useChat } from '../../context/ChatContext'
import './InputBar.css'

interface InputBarProps {
  /** Called after a message is successfully queued for send. */
  onMessageSent?: () => void
}

export function InputBar({ onMessageSent }: InputBarProps) {
  const { sendMessage, isThinking, isStreaming } = useChat()
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const busy = isThinking || isStreaming
  const canSend = Boolean(value.trim()) && !busy

  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 128)}px`
  }, [value])

  const submit = () => {
    const text = value.trim()
    if (!text || busy) return
    sendMessage(text)
    setValue('')
    onMessageSent?.()
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    submit()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  const statusLabel = isThinking
    ? 'LAIfe sta pensando'
    : isStreaming
      ? 'LAIfe sta rispondendo'
      : undefined

  return (
    <div className="input-bar-dock">
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {statusLabel ?? ''}
      </div>
      <form
        className={`input-bar${busy ? ' input-bar--busy' : ''}`}
        onSubmit={onSubmit}
        aria-busy={busy || undefined}
      >
        <label className="sr-only" htmlFor="laife-input">
          Messaggio per LAIfe
        </label>
        <textarea
          ref={inputRef}
          id="laife-input"
          className="input-bar__input"
          rows={1}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={
            busy ? 'Puoi scrivere il prossimo messaggio…' : 'Messaggio a LAIfe…'
          }
          /* Keep drafting available while LAIfe responds — send stays gated. */
          enterKeyHint="send"
          autoComplete="off"
          autoCorrect="on"
          spellCheck
        />
        <button
          type="submit"
          className={`input-bar__send${busy ? ' input-bar__send--busy' : ''}`}
          disabled={!canSend}
          aria-label={busy ? statusLabel : 'Invia messaggio'}
        >
          {busy ? (
            <span className="input-bar__send-pulse" aria-hidden="true" />
          ) : (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M5 12h14M13 6l6 6-6 6"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </button>
      </form>
      <p className="input-bar__hint">Invio per mandare · Shift+Invio per andare a capo</p>
    </div>
  )
}
