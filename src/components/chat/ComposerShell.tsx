import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react'
import { useChat } from '../../context/ChatContext'
import {
  ImageValidationError,
  prepareImageAttachment,
  summarizeImageForLog,
} from '../../lib/imageAttachment'
import type { ChatAttachment } from '../../types'
import { ComposerAttachMenu } from './ComposerAttachMenu'
import {
  composerDraftCanSend,
  type ComposerAttachment,
} from './composerTypes'
import { useComposerDraft } from './useComposerDraft'
import './ComposerShell.css'

/** Mirror previous InputBar autosize cap (8rem ≈ 128px). */
const TEXTAREA_MAX_HEIGHT_PX = 128

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
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

export type ComposerShellProps = {
  onMessageSent?: () => void
}

/**
 * Extensible composer shell (#271 + #272 image MVP).
 * Tray / attach live in built-in slots (data-composer-slot) — no empty chrome.
 */
export function ComposerShell({ onMessageSent }: ComposerShellProps) {
  const { sendMessage, messages, isThinking, isStreaming } = useChat()
  const {
    draft,
    setText,
    setImageAttachment,
    removeAttachment,
    clear,
    restore,
  } = useComposerDraft()
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const prevMessageCountRef = useRef(messages.length)
  const [attachError, setAttachError] = useState<string | null>(null)
  const [preparing, setPreparing] = useState(false)
  const busy = isThinking || isStreaming
  const canSend = composerDraftCanSend(draft) && !busy && !preparing
  const showKeyboardHint = useShowKeyboardHint()
  const image = draft.attachments[0]

  // New Chat clears messages → clear draft. Navigation / regenerate keep draft.
  useEffect(() => {
    const prev = prevMessageCountRef.current
    if (messages.length === 0 && prev > 0) {
      clear()
      setAttachError(null)
    }
    prevMessageCountRef.current = messages.length
  }, [messages.length, clear])

  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, TEXTAREA_MAX_HEIGHT_PX)}px`
  }, [draft.text])

  const onPickFile = useCallback(
    async (file: File) => {
      setAttachError(null)
      setPreparing(true)
      try {
        const prepared = await prepareImageAttachment(file)
        const attachment: ComposerAttachment = {
          id: uid(),
          kind: 'image',
          mimeType: prepared.mimeType,
          dataUrl: prepared.dataUrl,
          previewUrl: prepared.previewUrl,
          width: prepared.width,
          height: prepared.height,
          previewIsObjectUrl: prepared.previewIsObjectUrl,
          name: file.name,
        }
        console.info('[composer] image prepared', summarizeImageForLog(prepared))
        setImageAttachment(attachment)
      } catch (error) {
        const message =
          error instanceof ImageValidationError
            ? error.message
            : 'Impossibile allegare l’immagine.'
        setAttachError(message)
        console.warn(
          '[composer] image rejected',
          error instanceof ImageValidationError ? error.code : 'unknown',
        )
      } finally {
        setPreparing(false)
      }
    },
    [setImageAttachment],
  )

  const submit = () => {
    if (busy || preparing) return
    const text = draft.text.trim()
    const attachments = draft.attachments
    if (!text && attachments.length === 0) return

    const snapshot = {
      text: draft.text,
      attachments: [...attachments],
    }

    // Thread preview uses dataUrl so blob: URLs can be revoked on clear.
    const wireAttachments: ChatAttachment[] = attachments.map((att) => ({
      id: att.id,
      kind: 'image' as const,
      mimeType: att.mimeType,
      dataUrl: att.dataUrl,
      previewUrl: att.dataUrl,
      width: att.width,
      height: att.height,
    }))

    const accepted = sendMessage(text, wireAttachments)
    if (!accepted) {
      restore(snapshot)
      return
    }
    clear()
    setAttachError(null)
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
      : preparing
        ? 'Preparazione immagine…'
        : undefined

  const tray =
    image || attachError ? (
      <div className="composer-tray-inner">
        {image ? (
          <div className="composer-preview">
            <img
              src={image.previewUrl || image.dataUrl}
              alt=""
              className="composer-preview__img"
            />
            <button
              type="button"
              className="composer-preview__remove"
              aria-label="Rimuovi immagine"
              onClick={() => {
                removeAttachment(image.id)
                setAttachError(null)
              }}
            >
              ×
            </button>
          </div>
        ) : null}
        {attachError ? (
          <p className="composer-attach-error" role="alert">
            {attachError}
          </p>
        ) : null}
      </div>
    ) : null

  return (
    <div className="composer-dock">
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {statusLabel ?? ''}
      </div>

      {tray ? (
        <div className="composer-tray" data-composer-slot="tray">
          {tray}
        </div>
      ) : null}

      <form
        className={`composer${busy ? ' composer--busy' : ''}`}
        onSubmit={onSubmit}
        aria-busy={busy || preparing || undefined}
      >
        <div className="composer__left" data-composer-slot="left">
          <ComposerAttachMenu disabled={busy || preparing} onPickFile={(f) => void onPickFile(f)} />
        </div>

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
            busy
              ? 'Puoi scrivere il prossimo messaggio…'
              : image
                ? 'Aggiungi una didascalia (opzionale)…'
                : 'Messaggio a LAIfe…'
          }
          enterKeyHint="send"
          autoComplete="off"
          autoCorrect="on"
          spellCheck
        />

        <button
          type="submit"
          className={`composer__send${busy ? ' composer__send--busy' : ''}`}
          disabled={!canSend}
          aria-label={busy || preparing ? statusLabel : 'Invia messaggio'}
        >
          {busy || preparing ? (
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

      {showKeyboardHint ? (
        <p className="composer__hint">Invio per mandare · Shift+Invio per andare a capo</p>
      ) : null}
    </div>
  )
}
