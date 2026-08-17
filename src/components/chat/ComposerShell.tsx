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
import {
  DocumentValidationError,
  assertValidDocumentFile,
  documentBadgeFor,
  formatDocumentSize,
  summarizeDocumentForLog,
  truncateFilename,
} from '../../lib/documentAttachment'
import { DocumentUploadError, uploadDocumentAttachment } from '../../lib/documentUpload'
import type { ChatAttachment } from '../../types'
import { ComposerAttachMenu } from './ComposerAttachMenu'
import { ComposerMicrophoneButton } from './ComposerMicrophoneButton'
import {
  composerDraftCanSend,
  type ComposerFileAttachment,
  type ComposerImageAttachment,
} from './composerTypes'
import { useComposerDraft } from './useComposerDraft'
import { useSpeechDictation } from './useSpeechDictation'
import { useVoiceMode } from './useVoiceMode'
import { VoiceModeBar } from './VoiceModeBar'
import { VoiceModeButton } from './VoiceModeButton'
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

/** Chat view hidden/inert (Settings / Memory / Vision) → release mic. */
function useChatViewSuspended(): boolean {
  const [suspended, setSuspended] = useState(false)

  useEffect(() => {
    const el = document.querySelector('.app-view--chat')
    if (!el) return
    const sync = () => {
      setSuspended(el.hasAttribute('inert') || el.hasAttribute('hidden'))
    }
    sync()
    const mo = new MutationObserver(sync)
    mo.observe(el, { attributes: true, attributeFilter: ['inert', 'hidden'] })
    return () => mo.disconnect()
  }, [])

  return suspended
}

export type ComposerShellProps = {
  onMessageSent?: () => void
}

/**
 * Extensible composer shell (#271 + #272 image + #273 dictation + #275 PDF).
 */
export function ComposerShell({ onMessageSent }: ComposerShellProps) {
  const { sendMessage, messages, isThinking, isStreaming, settingsOpen } = useChat()
  const {
    draft,
    setText,
    setAttachment,
    removeAttachment,
    clear,
    restore,
  } = useComposerDraft()
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const draftTextRef = useRef(draft.text)
  draftTextRef.current = draft.text
  const prevMessageCountRef = useRef(messages.length)
  const [attachError, setAttachError] = useState<string | null>(null)
  const [preparing, setPreparing] = useState(false)
  const [uploading, setUploading] = useState(false)
  const busy = isThinking || isStreaming
  const canSend = composerDraftCanSend(draft) && !busy && !preparing && !uploading
  const showKeyboardHint = useShowKeyboardHint()
  const chatSuspended = useChatViewSuspended()
  const voice = useVoiceMode()
  const attachment = draft.attachments[0]
  const image = attachment?.kind === 'image' ? attachment : null
  const document = attachment?.kind === 'file' ? attachment : null
  const documentBadge = document ? documentBadgeFor(document.mimeType, document.name) : null

  const focusInput = useCallback(() => {
    requestAnimationFrame(() => {
      inputRef.current?.focus()
    })
  }, [])

  const dictation = useSpeechDictation({
    getText: () => draftTextRef.current,
    setText,
    messages,
    // Suspend dictation while Voice Mode owns the mic (#292 ≠ #273).
    suspended: chatSuspended || settingsOpen || voice.active,
    onTranscriptCommitted: focusInput,
  })
  const dictationAbortRef = useRef(dictation.abort)
  const dictationClearErrorRef = useRef(dictation.clearError)
  const voiceExitRef = useRef(voice.exit)
  dictationAbortRef.current = dictation.abort
  dictationClearErrorRef.current = dictation.clearError
  voiceExitRef.current = voice.exit

  // New Chat clears messages → abort dictation/voice + clear draft.
  useEffect(() => {
    const prev = prevMessageCountRef.current
    if (messages.length === 0 && prev > 0) {
      dictationAbortRef.current({ restore: false })
      voiceExitRef.current()
      clear()
      setAttachError(null)
      dictationClearErrorRef.current()
    }
    prevMessageCountRef.current = messages.length
  }, [messages.length, clear])

  // Suspend Voice Mode when chat view is hidden or Settings opens.
  useEffect(() => {
    if ((chatSuspended || settingsOpen) && voice.active) {
      voiceExitRef.current()
    }
  }, [chatSuspended, settingsOpen, voice.active])

  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, TEXTAREA_MAX_HEIGHT_PX)}px`
  }, [draft.text])

  const onPickFile = useCallback(
    async (file: File, source: 'photos' | 'camera' | 'document') => {
      setAttachError(null)
      setPreparing(true)
      try {
        if (source === 'document') {
          const validated = await assertValidDocumentFile(file)
          const next: ComposerFileAttachment = {
            id: uid(),
            kind: 'file',
            name: validated.name,
            mimeType: validated.mimeType,
            size: validated.size,
            localFile: file,
          }
          console.info('[composer] document prepared', summarizeDocumentForLog(next))
          setAttachment(next)
        } else {
          const prepared = await prepareImageAttachment(file)
          const next: ComposerImageAttachment = {
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
          setAttachment(next)
        }
      } catch (error) {
        const message =
          error instanceof ImageValidationError || error instanceof DocumentValidationError
            ? error.message
            : source === 'document'
              ? 'Impossibile allegare il documento.'
              : 'Impossibile allegare l’immagine.'
        setAttachError(message)
        console.warn(
          '[composer] attachment rejected',
          error instanceof ImageValidationError || error instanceof DocumentValidationError
            ? error.code
            : 'unknown',
        )
      } finally {
        setPreparing(false)
      }
    },
    [setAttachment],
  )

  const submit = async () => {
    if (busy || preparing || uploading || dictation.listening || voice.active) return
    const text = draft.text.trim()
    const attachments = draft.attachments
    if (!text && attachments.length === 0) return

    const snapshot = {
      text: draft.text,
      attachments: [...attachments],
    }

    let wireAttachments: ChatAttachment[] = []

    try {
      if (attachments[0]?.kind === 'file') {
        const fileAtt = attachments[0]
        setUploading(true)
        setAttachError(null)

        let fileId = fileAtt.fileId
        let expiresAt = fileAtt.expiresAt
        let name = fileAtt.name
        let size = fileAtt.size
        let mimeType = fileAtt.mimeType

        if (!fileId) {
          if (!fileAtt.localFile) {
            setAttachError('Documento non disponibile. Selezionalo di nuovo.')
            restore(snapshot)
            return
          }
          const uploaded = await uploadDocumentAttachment(fileAtt.localFile)
          fileId = uploaded.fileId
          expiresAt = uploaded.expiresAt ?? undefined
          name = uploaded.filename
          size = uploaded.size
          mimeType = uploaded.mimeType
          // Keep fileId on draft so a chat failure can retry without re-upload.
          const withId: ComposerFileAttachment = {
            ...fileAtt,
            fileId,
            expiresAt,
            name,
            size,
            mimeType,
          }
          restore({ text: snapshot.text, attachments: [withId] })
          snapshot.attachments = [withId]
        }

        wireAttachments = [
          {
            id: fileAtt.id,
            kind: 'file',
            name,
            mimeType,
            size,
            fileId,
            ...(expiresAt ? { expiresAt } : {}),
          },
        ]
      } else if (attachments[0]?.kind === 'image') {
        wireAttachments = attachments.map((att) => {
          const img = att as ComposerImageAttachment
          return {
            id: img.id,
            kind: 'image' as const,
            mimeType: img.mimeType,
            dataUrl: img.dataUrl,
            previewUrl: img.dataUrl,
            width: img.width,
            height: img.height,
          }
        })
      }
    } catch (error) {
      const message =
        error instanceof DocumentUploadError || error instanceof DocumentValidationError
          ? error.message
          : 'Caricamento documento non riuscito. Riprova.'
      setAttachError(message)
      restore(snapshot)
      return
    } finally {
      setUploading(false)
    }

    const accepted = sendMessage(text, wireAttachments)
    if (!accepted) {
      restore(snapshot)
      return
    }
    clear()
    setAttachError(null)
    dictation.clearError()
    onMessageSent?.()
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    void submit()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void submit()
    }
  }

  const onTextChange = (value: string) => {
    if (dictation.listening) {
      dictation.onUserTyping()
    }
    setText(value)
    if (dictation.error) dictation.clearError()
  }

  const onMicClick = () => {
    if (voice.active) return
    if (dictation.listening) {
      dictation.stop()
      return
    }
    dictation.clearError()
    dictation.start()
  }

  const onVoiceClick = () => {
    if (voice.active) {
      voice.exit()
      return
    }
    dictation.abort({ restore: false })
    dictation.clearError()
    setAttachError(null)
    voice.enter()
  }

  const showMic =
    !voice.active &&
    dictation.supported &&
    (dictation.listening || (!composerDraftCanSend(draft) && !busy && !preparing && !uploading))
  const showVoiceEntry =
    voice.supported &&
    (voice.active || (!dictation.listening && !busy && !preparing && !uploading))
  const statusLabel = isThinking
    ? 'ShinkAIdo sta pensando'
    : isStreaming
      ? 'ShinkAIdo sta rispondendo'
      : uploading
        ? 'Caricamento documento…'
        : preparing
          ? document
            ? 'Preparazione documento…'
            : 'Preparazione immagine…'
          : voice.active
            ? voice.phase === 'listening'
              ? 'Modalità vocale: in ascolto'
              : voice.phase === 'processing'
                ? 'Modalità vocale: elaborazione'
                : voice.phase === 'speaking'
                  ? 'Modalità vocale: riproduzione'
                  : 'Modalità vocale'
            : dictation.listening
              ? 'Dettatura attiva'
              : dictation.statusAnnouncement || undefined

  const tray =
    voice.active || image || document || attachError || dictation.error ? (
      <div className="composer-tray-inner">
        {voice.active ? (
          <VoiceModeBar
            phase={voice.phase}
            interimText={voice.interimText}
            error={voice.error}
            needsManualPlay={voice.needsManualPlay}
            onStopSend={voice.stopAndSend}
            onCancel={voice.cancelListening}
            onStopSpeaking={voice.stopSpeaking}
            onListenAgain={voice.startListening}
            onPlayPending={voice.playPending}
            onExit={voice.exit}
          />
        ) : null}
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
        {document && documentBadge ? (
          <div className="composer-file-chip" aria-label={`${documentBadge} ${document.name}`}>
            <span className="composer-file-chip__icon" aria-hidden="true">
              {documentBadge}
            </span>
            <span className="composer-file-chip__meta">
              <span className="composer-file-chip__name">{truncateFilename(document.name)}</span>
              <span className="composer-file-chip__size">{formatDocumentSize(document.size)}</span>
            </span>
            <button
              type="button"
              className="composer-file-chip__remove"
              aria-label="Rimuovi documento"
              onClick={() => {
                removeAttachment(document.id)
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
        {dictation.error && !voice.active ? (
          <p className="composer-attach-error" role="alert">
            {dictation.error}
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
        className={`composer${busy ? ' composer--busy' : ''}${dictation.listening ? ' composer--dictating' : ''}${voice.active ? ' composer--voice' : ''}`}
        onSubmit={onSubmit}
        aria-busy={
          busy || preparing || uploading || dictation.listening || voice.active || undefined
        }
      >
        <div className="composer__left" data-composer-slot="left">
          <ComposerAttachMenu
            disabled={busy || preparing || uploading || dictation.listening || voice.active}
            onPickFile={(f, source) => void onPickFile(f, source)}
          />
          {showVoiceEntry ? (
            <VoiceModeButton
              active={voice.active}
              disabled={busy || preparing || uploading || dictation.listening}
              onClick={onVoiceClick}
            />
          ) : null}
        </div>

        <label className="sr-only" htmlFor="laife-input">
          Messaggio per ShinkAIdo
        </label>
        <textarea
          ref={inputRef}
          id="laife-input"
          className="composer__input"
          rows={1}
          value={draft.text}
          onChange={(e) => onTextChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={
            voice.active
              ? ''
              : dictation.listening
                ? 'Ti ascolto…'
                : busy
                  ? 'Puoi scrivere il prossimo messaggio…'
                  : image || document
                    ? 'Aggiungi una didascalia (opzionale)…'
                    : 'Messaggio a ShinkAIdo…'
          }
          enterKeyHint="send"
          autoComplete="off"
          autoCorrect="on"
          spellCheck
          disabled={voice.active || undefined}
          readOnly={voice.active || undefined}
        />

        <div className="composer__right" data-composer-slot="right">
          {showMic ? (
            <ComposerMicrophoneButton
              listening={dictation.listening}
              disabled={busy || preparing || uploading || voice.active}
              onClick={onMicClick}
            />
          ) : (
            <button
              type="submit"
              className={`composer__send${busy || uploading ? ' composer__send--busy' : ''}`}
              disabled={!canSend || voice.active}
              aria-label={busy || preparing || uploading ? statusLabel : 'Invia messaggio'}
            >
              {busy || preparing || uploading ? (
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
          )}
        </div>
      </form>

      {showKeyboardHint && !voice.active ? (
        <p className="composer__hint">Invio per mandare · Shift+Invio per andare a capo</p>
      ) : null}
    </div>
  )
}
