import { useState, type FormEvent, type KeyboardEvent } from 'react'
import { useChat } from '../context/ChatContext'
import './Composer.css'

export function Composer() {
  const { sendMessage, isThinking, isStreaming } = useChat()
  const [value, setValue] = useState('')
  const busy = isThinking || isStreaming

  const submit = () => {
    const text = value.trim()
    if (!text || busy) return
    sendMessage(text)
    setValue('')
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
    <div className="composer-dock">
      <form className="composer" onSubmit={onSubmit}>
        <label className="sr-only" htmlFor="laife-input">
          Message LAIfe
        </label>
        <textarea
          id="laife-input"
          className="composer__input"
          rows={1}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Message LAIfe…"
          disabled={busy}
          enterKeyHint="send"
        />
        <button
          type="submit"
          className="composer__send"
          disabled={busy || !value.trim()}
          aria-label="Send message"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M5 12h14M13 6l6 6-6 6"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </form>
      <p className="composer__hint">Enter to send · Shift+Enter for new line</p>
    </div>
  )
}
