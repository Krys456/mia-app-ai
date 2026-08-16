import { useCallback, useEffect, useId, useRef, useState, type ChangeEvent } from 'react'
import { PageHeader } from '../components/PageHeader'
import { useChat } from '../context/ChatContext'
import {
  ImageValidationError,
  prepareImageAttachment,
  summarizeImageForLog,
} from '../lib/imageAttachment'
import {
  captionForVisionAction,
  resolveVisionActionLang,
  type VisionAction,
} from '../lib/visionActions'
import type { ChatAttachment } from '../types'
import './Vision.css'

interface VisionProps {
  onBack: () => void
  /** After a successful Vision send — navigate to normal Chat. */
  onHandoffToChat: () => void
}

type VisionPhase = 'empty' | 'camera' | 'ready' | 'sending'

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

function blobToImageFile(blob: Blob, name: string): File {
  const type = blob.type && blob.type.startsWith('image/') ? blob.type : 'image/jpeg'
  return new File([blob], name, { type })
}

/**
 * LAIfe Vision / Lens — capture or choose a photo, then hand off to Core chat (#274).
 */
export function Vision({ onBack, onHandoffToChat }: VisionProps) {
  const { sendMessage, messages } = useChat()
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const previewUrlRef = useRef<string | null>(null)
  const fileInputId = useId()

  const [phase, setPhase] = useState<VisionPhase>('empty')
  const [attachment, setAttachment] = useState<ChatAttachment | null>(null)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)

  const stopCameraTracks = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
  }, [])

  const revokePreview = useCallback(() => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current)
      previewUrlRef.current = null
    }
  }, [])

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop())
      streamRef.current = null
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current)
        previewUrlRef.current = null
      }
    }
  }, [])

  const setPreparedAttachment = useCallback(
    (next: ChatAttachment, previewUrl: string) => {
      revokePreview()
      previewUrlRef.current = previewUrl
      setAttachment({ ...next, previewUrl })
      setPhase('ready')
      setError(null)
      setCameraError(null)
      setStatus(null)
    },
    [revokePreview],
  )

  const prepareFromFile = useCallback(
    async (file: File) => {
      setError(null)
      setStatus('Preparazione immagine…')
      try {
        const prepared = await prepareImageAttachment(file)
        console.info('[vision] image prepared', summarizeImageForLog(prepared))
        const att: ChatAttachment = {
          id: uid(),
          kind: 'image',
          mimeType: prepared.mimeType,
          dataUrl: prepared.dataUrl,
          previewUrl: prepared.previewUrl,
          width: prepared.width,
          height: prepared.height,
        }
        // prepareImageAttachment already created a blob preview URL — take ownership.
        setPreparedAttachment(att, prepared.previewUrl)
        setStatus(null)
      } catch (err) {
        const message =
          err instanceof ImageValidationError
            ? err.message
            : 'Impossibile preparare l’immagine.'
        setError(message)
        setStatus(null)
        console.warn(
          '[vision] image rejected',
          err instanceof ImageValidationError ? err.code : 'unknown',
        )
      }
    },
    [setPreparedAttachment],
  )

  const startCamera = async () => {
    setCameraError(null)
    setError(null)
    setStatus(null)

    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError(
        'La fotocamera non è supportata in questo browser. Puoi scegliere una foto dalla galleria.',
      )
      return
    }

    try {
      stopCameraTracks()
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }
      setPhase('camera')
      setStatus('Fotocamera attiva')
    } catch {
      setCameraError(
        'Impossibile accedere alla fotocamera. Controlla i permessi oppure scegli una foto dalla galleria.',
      )
      setPhase(attachment ? 'ready' : 'empty')
    }
  }

  const capturePhoto = async () => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas || phase !== 'camera') return

    const width = video.videoWidth || 1280
    const height = video.videoHeight || 720
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      setError('Acquisizione foto non riuscita.')
      return
    }

    ctx.drawImage(video, 0, 0, width, height)
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((result) => resolve(result), 'image/jpeg', 0.92),
    )
    // Stop live camera after capture (no background camera).
    stopCameraTracks()

    if (!blob) {
      setError('Acquisizione foto non riuscita.')
      setPhase(attachment ? 'ready' : 'empty')
      return
    }

    await prepareFromFile(blobToImageFile(blob, `capture-${Date.now()}.jpg`))
  }

  const onUploadChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    void prepareFromFile(file)
  }

  const clearImage = () => {
    revokePreview()
    setAttachment(null)
    setError(null)
    setStatus(null)
    setPhase('empty')
  }

  const cancelCamera = () => {
    stopCameraTracks()
    setStatus(null)
    setPhase(attachment ? 'ready' : 'empty')
  }

  const runAction = (action: VisionAction) => {
    if (!attachment || phase === 'sending') return

    const lang = resolveVisionActionLang({
      messages,
      navigatorLanguage: typeof navigator !== 'undefined' ? navigator.language : '',
    })
    const caption = captionForVisionAction(action, lang)

    // Stop camera before handoff.
    stopCameraTracks()

    setPhase('sending')
    setError(null)
    setStatus(
      action === 'analyze'
        ? 'Invio a LAIfe…'
        : action === 'read'
          ? 'Lettura testo…'
          : 'Spiegazione…',
    )

    // Thread uses dataUrl for preview so we can revoke the blob URL.
    const wire: ChatAttachment = {
      id: attachment.id,
      kind: 'image',
      mimeType: attachment.mimeType,
      dataUrl: attachment.dataUrl,
      previewUrl: attachment.dataUrl,
      width: attachment.width,
      height: attachment.height,
    }

    const accepted = sendMessage(caption, [wire])
    if (!accepted) {
      setPhase('ready')
      setStatus(null)
      setError('Impossibile inviare ora. Riprova tra un momento.')
      return
    }

    revokePreview()
    setAttachment(null)
    onHandoffToChat()
  }

  const previewSrc = attachment?.previewUrl || attachment?.dataUrl || null
  const busy = phase === 'sending'

  return (
    <main className="laife-vision">
      <PageHeader title="Vision AI" onBack={onBack} />

      <div className="laife-vision__body scroll-surface">
        <p className="laife-vision__lead">
          Inquadra o scegli una foto. LAIfe la analizza nella chat normale — stesso Core.
        </p>

        <div className="sr-only" aria-live="polite" aria-atomic="true">
          {status ?? ''}
        </div>

        {phase === 'camera' ? (
          <section className="laife-vision__stage" aria-label="Fotocamera live">
            <div className="laife-vision__frame laife-vision__frame--live">
              <video
                ref={videoRef}
                className="laife-vision__video"
                playsInline
                muted
                aria-label="Anteprima fotocamera live"
              />
            </div>
            <div className="laife-vision__actions">
              <button
                type="button"
                className="laife-vision__primary"
                onClick={() => void capturePhoto()}
                disabled={busy}
              >
                Scatta foto
              </button>
              <button type="button" className="laife-vision__ghost" onClick={cancelCamera} disabled={busy}>
                Annulla
              </button>
            </div>
          </section>
        ) : null}

        {phase !== 'camera' && previewSrc ? (
          <section className="laife-vision__stage" aria-label="Anteprima immagine">
            <div className="laife-vision__frame">
              <img
                src={previewSrc}
                alt="Anteprima foto selezionata per Vision"
                className="laife-vision__preview"
              />
            </div>
            <div className="laife-vision__actions" role="group" aria-label="Azioni Vision">
              <button
                type="button"
                className="laife-vision__primary"
                onClick={() => runAction('analyze')}
                disabled={busy}
              >
                Analizza
              </button>
              <button
                type="button"
                className="laife-vision__ghost"
                onClick={() => runAction('read')}
                disabled={busy}
              >
                Leggi testo
              </button>
              <button
                type="button"
                className="laife-vision__ghost"
                onClick={() => runAction('explain')}
                disabled={busy}
              >
                Spiega
              </button>
              <button type="button" className="laife-vision__ghost" onClick={clearImage} disabled={busy}>
                Rimuovi
              </button>
              <button
                type="button"
                className="laife-vision__ghost"
                onClick={() => void startCamera()}
                disabled={busy}
              >
                Scatta di nuovo
              </button>
            </div>
          </section>
        ) : null}

        {phase === 'empty' || (phase !== 'camera' && !previewSrc) ? (
          <section className="laife-vision__actions" aria-label="Avvio Vision">
            <button
              type="button"
              className="laife-vision__primary"
              onClick={() => void startCamera()}
              disabled={busy}
            >
              Apri fotocamera
            </button>
            <button
              type="button"
              className="laife-vision__ghost"
              onClick={() => fileInputRef.current?.click()}
              disabled={busy}
            >
              Scegli foto
            </button>
          </section>
        ) : null}

        {phase === 'ready' || phase === 'sending' ? (
          <div className="laife-vision__secondary">
            <button
              type="button"
              className="laife-vision__ghost"
              onClick={() => fileInputRef.current?.click()}
              disabled={busy}
            >
              Scegli foto
            </button>
          </div>
        ) : null}

        <label className="sr-only" htmlFor={fileInputId}>
          Scegli foto dalla galleria
        </label>
        <input
          id={fileInputId}
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/*"
          className="laife-vision__file"
          onChange={onUploadChange}
        />

        <canvas ref={canvasRef} className="laife-vision__canvas" aria-hidden="true" />

        {cameraError ? (
          <p className="laife-vision__error" role="alert">
            {cameraError}
          </p>
        ) : null}
        {error ? (
          <p className="laife-vision__error" role="alert">
            {error}
          </p>
        ) : null}
        {status && phase !== 'camera' ? (
          <p className="laife-vision__status" aria-hidden="true">
            {status}
          </p>
        ) : null}
      </div>
    </main>
  )
}
