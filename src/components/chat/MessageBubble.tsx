import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from 'react'
import type { ChatFileAttachment, ChatImageAttachment, ChatMessage } from '../../types'
import { documentBadgeFor, formatDocumentSize, truncateFilename } from '../../lib/documentAttachment'
import { MemoryMessageIndicator } from '../MemoryMessageIndicator'
import { MessageActions } from './MessageActions'
import { StreamingRenderer } from './StreamingRenderer'
import { TypingAnimation } from './TypingAnimation'
import './MessageBubble.css'

interface MessageBubbleProps {
  message: ChatMessage
  /** True while this assistant bubble is still receiving streamed text. */
  isStreaming?: boolean
  showActions?: boolean
  canRegenerate?: boolean
  onRegenerate?: (messageId: string) => void
}

const LONG_PRESS_MS = 480

function openImagePreview(src: string) {
  try {
    window.open(src, '_blank', 'noopener,noreferrer')
  } catch {
    /* ignore */
  }
}

function downloadImage(att: ChatImageAttachment) {
  try {
    const a = document.createElement('a')
    a.href = att.dataUrl
    const ext =
      att.mimeType === 'image/jpeg' ? 'jpg' : att.mimeType === 'image/webp' ? 'webp' : 'png'
    a.download = `laife-${att.source || 'image'}-${att.id.slice(0, 8)}.${ext}`
    a.rel = 'noopener'
    document.body.appendChild(a)
    a.click()
    a.remove()
  } catch {
    /* ignore */
  }
}

function MessageBubbleComponent({
  message,
  isStreaming = false,
  showActions = false,
  canRegenerate = false,
  onRegenerate,
}: MessageBubbleProps) {
  const isAssistant = message.role === 'assistant'
  const isError = isAssistant && message.kind === 'error'
  const imageAttachments = (message.attachments ?? []).filter(
    (a): a is ChatImageAttachment => a.kind === 'image',
  )
  const fileAttachments = (message.attachments ?? []).filter(
    (a): a is ChatFileAttachment => a.kind === 'file',
  )
  const hasImages = imageAttachments.length > 0
  const isEmptyStream =
    isAssistant && !message.content && !hasImages && isStreaming && !isError
  const [actionsPinned, setActionsPinned] = useState(false)
  const longPressTimer = useRef<number | null>(null)
  const rootRef = useRef<HTMLElement>(null)

  const clearLongPress = useCallback(() => {
    if (longPressTimer.current != null) {
      window.clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
  }, [])

  const unpinActions = useCallback(() => setActionsPinned(false), [])

  useEffect(() => () => clearLongPress(), [clearLongPress])

  // Dismiss long-press pin on outside tap / scroll (phones have no Escape).
  useEffect(() => {
    if (!actionsPinned) return
    const onPointerDown = (event: globalThis.PointerEvent) => {
      const root = rootRef.current
      if (!root) return
      if (event.target instanceof Node && root.contains(event.target)) return
      setActionsPinned(false)
    }
    const onScroll = () => setActionsPinned(false)
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [actionsPinned])

  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    if (!showActions || isStreaming || isError) return
    if (!message.content && !message.attachments?.length) return
    if (event.pointerType === 'mouse') return
    clearLongPress()
    longPressTimer.current = window.setTimeout(() => {
      setActionsPinned(true)
    }, LONG_PRESS_MS)
  }

  const onPointerUp = () => clearLongPress()

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!showActions) return
    if (event.key === 'Escape') setActionsPinned(false)
  }

  const hasVisibleBody =
    Boolean(message.content?.trim()) || Boolean(message.attachments?.length)
  const actionsEnabled =
    showActions &&
    !isStreaming &&
    !isError &&
    (isAssistant
      ? Boolean(message.content?.trim()) || hasImages
      : Boolean(message.content.trim()))
  // User image-only: no Copy toolbar (nothing safe to copy). Assistant unchanged for text;
  // image-only assistant still gets regenerate via actions when enabled.

  return (
    <article
      ref={rootRef}
      data-message-id={message.id}
      className={`bubble bubble--${message.role}${isError ? ' bubble--error' : ''}${actionsPinned ? ' bubble--actions-open' : ''}`}
      aria-label={message.role === 'user' ? 'Tu' : isError ? 'Errore' : 'LAIfe'}
      role={isError ? 'alert' : undefined}
      tabIndex={actionsEnabled || (showActions && hasVisibleBody) ? 0 : undefined}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={onPointerUp}
      onKeyDown={onKeyDown}
    >
      {isAssistant ? (
        <>
          <div className="bubble__meta">
            <span
              className={`bubble__avatar bubble__avatar--assistant${isEmptyStream ? ' bubble__avatar--pulse' : ''}`}
              aria-hidden="true"
            >
              <span className="bubble__avatar-mark">L</span>
            </span>
            <span className="bubble__label">{isError ? 'Errore' : 'LAIfe'}</span>
          </div>
          {!isError && message.memoryEvent ? (
            <MemoryMessageIndicator event={message.memoryEvent} />
          ) : null}
          <div
            className={`bubble__body${isEmptyStream ? ' bubble__body--typing' : ''}${isError ? ' bubble__body--error' : ''}`}
          >
            {isEmptyStream ? (
              <TypingAnimation label="Sta rispondendo…" />
            ) : isError ? (
              <p className="bubble__error-text">
                Qualcosa è andato storto. {message.content}
              </p>
            ) : (
              <>
                {hasImages ? (
                  <div className="bubble__attachments bubble__attachments--assistant">
                    {imageAttachments.map((att) => (
                      <div key={att.id} className="bubble__attachment-figure">
                        <button
                          type="button"
                          className="bubble__attachment-open"
                          onClick={() => openImagePreview(att.previewUrl || att.dataUrl)}
                          aria-label="Apri immagine"
                        >
                          <img
                            src={att.previewUrl || att.dataUrl}
                            alt=""
                            className="bubble__attachment-img"
                          />
                        </button>
                        <button
                          type="button"
                          className="bubble__attachment-download"
                          onClick={() => downloadImage(att)}
                        >
                          Salva
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}
                {message.content ? (
                  <StreamingRenderer content={message.content} isStreaming={isStreaming} />
                ) : null}
              </>
            )}
          </div>
        </>
      ) : (
        <div className="bubble__user-row">
          <div className="bubble__body">
            {hasImages ? (
              <div className="bubble__attachments">
                {imageAttachments.map((att) => (
                  <img
                    key={att.id}
                    src={att.previewUrl || att.dataUrl}
                    alt=""
                    className="bubble__attachment-img"
                  />
                ))}
              </div>
            ) : null}
            {fileAttachments.length ? (
              <div className="bubble__attachments">
                {fileAttachments.map((att) => {
                  const badge = documentBadgeFor(att.mimeType, att.name)
                  return (
                    <div key={att.id} className="bubble__attachment-file" aria-label={`${badge} ${att.name}`}>
                      <span className="bubble__attachment-file-icon" aria-hidden="true">
                        {badge}
                      </span>
                      <span className="bubble__attachment-file-meta">
                        <span className="bubble__attachment-file-name">
                          {truncateFilename(att.name, 36)}
                        </span>
                        <span className="bubble__attachment-file-size">
                          {formatDocumentSize(att.size)}
                        </span>
                      </span>
                    </div>
                  )
                })}
              </div>
            ) : null}
            {message.content ? <p>{message.content}</p> : null}
          </div>
        </div>
      )}

      {actionsEnabled ? (
        <MessageActions
          messageId={message.id}
          content={message.content}
          variant={isAssistant ? 'assistant' : 'user'}
          canRegenerate={isAssistant ? canRegenerate : false}
          forceVisible={actionsPinned}
          onRegenerate={() => {
            unpinActions()
            onRegenerate?.(message.id)
          }}
          onAction={unpinActions}
        />
      ) : null}
    </article>
  )
}

export const MessageBubble = memo(MessageBubbleComponent)
