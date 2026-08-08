import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { useChat } from '../../context/ChatContext'
import './InputBar.css'

interface InputBarProps {
  /** Called after a message is successfully queued for send. */
  onMessageSent?: () => void
}

function useShowKeyboardHint() {
  const [show, setShow] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia('(hover: hover) and (pointer: fine)')
    const sync = () => setShow(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  return show
}

export function InputBar({ onMessageSent }: InputBarProps) {
  const { sendMessage, isThinking, isStreaming } = useChat()
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const busy = isThinking || isStreaming
  const showKeyboardHint = useShowKeyboardHint()

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

  return (
    <div className="input-bar-dock">
      <form className="input-bar" onSubmit={onSubmit}>
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
          placeholder="Messaggio a LAIfe…"
          disabled={busy}
          enterKeyHint="send"
          autoComplete="off"
          autoCorrect="on"
          spellCheck
        />
        <button
          type="submit"
          className="input-bar__send"
          disabled={busy || !value.trim()}
          aria-label="Invia messaggio"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M5 12h14M13 6l6 6-6 6"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </form>
      {showKeyboardHint ? (
        <p className="input-bar__hint">Invio per mandare · Shift+Invio per andare a capo</p>
      ) : null}
    </div>
  )
}
