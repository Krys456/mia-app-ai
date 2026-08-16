import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { useChat } from '../../context/ChatContext'
import { composerDraftHasText } from './composerTypes'
import { useComposerDraft } from './useComposerDraft'
import './ComposerShell.css'

/** Mirror previous InputBar autosize cap (8rem ≈ 128px). */
const TEXTAREA_MAX_HEIGHT_PX = 128

export interface ComposerShellProps {
  /** Called after a message is successfully accepted by ChatContext. */
  onMessageSent?: () => void
  /**
   * Future extension slots — omit or leave undefined in #271.
   * Empty slots are not rendered (no reserved chrome).
   */
  traySlot?: ReactNode
  leftSlot?: ReactNode
  rightSlot?: ReactNode
  secondarySlot?: ReactNode
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

/**
 * Extensible composer shell (#271).
 * Visible UI remains text + send — no attachment / voice / depth chrome yet.
 */
export function ComposerShell({
  onMessageSent,
  traySlot,
  leftSlot,
  rightSlot,
  secondarySlot,
}: ComposerShellProps) {
  const { sendMessage, messages, isThinking, isStreaming } = useChat()
  const { draft, setText, clear, restoreText } = useComposerDraft()
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const prevMessageCountRef = useRef(messages.length)
  const busy = isThinking || isStreaming
  const canSend = composerDraftHasText(draft) && !busy
  const showKeyboardHint = useShowKeyboardHint()

  // New Chat clears messages → clear draft. Navigation / regenerate keep draft.
  useEffect(() => {
    const prev = prevMessageCountRef.current
    if (messages.length === 0 && prev > 0) {
      clear()
    }
    prevMessageCountRef.current = messages.length
  }, [messages.length, clear])

  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, TEXTAREA_MAX_HEIGHT_PX)}px`
  }, [draft.text])

  const submit = () => {
    const text = draft.text.trim()
    if (!text || busy) return

    // Optimistic clear only after ChatContext accepts the turn.
    const accepted = sendMessage(text)
    if (!accepted) {
      // Race / busy gate — keep user text for retry.
      restoreText(text)
      return
    }
    clear()
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
    <div className="composer-dock">
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {statusLabel ?? ''}
      </div>

      {traySlot ? (
        <div className="composer-tray" data-composer-slot="tray">
          {traySlot}
        </div>
      ) : null}

      <form
        className={`composer${busy ? ' composer--busy' : ''}`}
        onSubmit={onSubmit}
        aria-busy={busy || undefined}
      >
        {leftSlot ? (
          <div className="composer__left" data-composer-slot="left">
            {leftSlot}
          </div>
        ) : null}

        <label className="sr-only" htmlFor="laife-input">
          Messaggio per LAIfe
        </label>
        <textarea
          ref={inputRef}
          id="laife-input"
          className="composer__input"
          rows={1}
          value={draft.text}
          onChange={(e) => setText(e.target.value)}
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

        {rightSlot ? (
          <div className="composer__right" data-composer-slot="right">
            {rightSlot}
          </div>
        ) : null}

        <button
          type="submit"
          className={`composer__send${busy ? ' composer__send--busy' : ''}`}
          disabled={!canSend}
          aria-label={busy ? statusLabel : 'Invia messaggio'}
        >
          {busy ? (
            <span className="composer__send-pulse" aria-hidden="true" />
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

      {secondarySlot ? (
        <div className="composer-secondary" data-composer-slot="secondary">
          {secondarySlot}
        </div>
      ) : null}

      {showKeyboardHint ? (
        <p className="composer__hint">Invio per mandare · Shift+Invio per andare a capo</p>
      ) : null}
    </div>
  )
}
