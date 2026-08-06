import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { sendVisionImage, VisionApiError } from '../lib/visionApi'
import './Vision.css'

export function Vision() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [imageBlob, setImageBlob] = useState<Blob | null>(null)
  const [fileName, setFileName] = useState('capture.jpg')
  const [cameraOn, setCameraOn] = useState(false)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop())
      streamRef.current = null
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- cleanup on unmount only
  }, [])

  const setPreviewFromBlob = (blob: Blob, name: string) => {
    setImageBlob(blob)
    setFileName(name)
    setStatus(null)
    setError(null)
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return URL.createObjectURL(blob)
    })
  }

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    setCameraOn(false)
  }

  const startCamera = async () => {
    setCameraError(null)
    setError(null)
    setStatus(null)

    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('Camera is not supported in this browser.')
      return
    }

    try {
      stopCamera()
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }
      setCameraOn(true)
    } catch {
      setCameraError('Unable to access the camera. Check permissions and try again.')
      setCameraOn(false)
    }
  }

  const capturePhoto = async () => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas || !cameraOn) return

    const width = video.videoWidth || 1280
    const height = video.videoHeight || 720
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.drawImage(video, 0, 0, width, height)
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((result) => resolve(result), 'image/jpeg', 0.92),
    )
    if (!blob) {
      setError('Failed to capture photo.')
      return
    }

    setPreviewFromBlob(blob, `capture-${Date.now()}.jpg`)
  }

  const onUploadChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setError('Please choose an image file.')
      return
    }
    setPreviewFromBlob(file, file.name || 'upload.jpg')
  }

  const clearPreview = () => {
    setImageBlob(null)
    setFileName('capture.jpg')
    setStatus(null)
    setError(null)
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return null
    })
  }

  const sendImage = async () => {
    if (!imageBlob) {
      setError('Capture or upload an image first.')
      return
    }

    setSending(true)
    setError(null)
    setStatus(null)
    try {
      await sendVisionImage(imageBlob, fileName)
      setStatus('Image received by BrAIn Vision.')
    } catch (err) {
      const message = err instanceof VisionApiError ? err.message : String(err)
      setError(message)
    } finally {
      setSending(false)
    }
  }

  return (
    <main className="brain-vision">
      <div className="brain-vision__inner">
        <header className="brain-vision__header">
          <p className="brain-vision__kicker">BrAIn Vision</p>
          <h1>Vision</h1>
          <p className="brain-vision__lead">
            Capture or upload an image, preview it, then send it. Analysis comes later.
          </p>
        </header>

        <section className="brain-vision__actions" aria-label="Vision inputs">
          <button type="button" className="brain-vision__primary" onClick={() => void startCamera()}>
            {cameraOn ? 'Restart camera' : 'Open camera'}
          </button>
          <button
            type="button"
            className="brain-vision__ghost"
            onClick={capturePhoto}
            disabled={!cameraOn}
          >
            Capture photo
          </button>
          <button
            type="button"
            className="brain-vision__ghost"
            onClick={() => fileInputRef.current?.click()}
          >
            Upload image
          </button>
          {cameraOn ? (
            <button type="button" className="brain-vision__ghost" onClick={stopCamera}>
              Stop camera
            </button>
          ) : null}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="brain-vision__file"
            onChange={onUploadChange}
          />
        </section>

        {cameraError ? (
          <p className="brain-vision__error" role="alert">
            {cameraError}
          </p>
        ) : null}

        <section className="brain-vision__stage" aria-label="Camera and preview">
          <div className="brain-vision__panel">
            <h2>Camera</h2>
            <div className="brain-vision__frame">
              <video
                ref={videoRef}
                className="brain-vision__video"
                playsInline
                muted
                aria-label="Live camera preview"
              />
              {!cameraOn ? (
                <p className="brain-vision__placeholder">Camera is off</p>
              ) : null}
            </div>
          </div>

          <div className="brain-vision__panel">
            <h2>Preview</h2>
            <div className="brain-vision__frame">
              {previewUrl ? (
                <img src={previewUrl} alt="Selected vision preview" className="brain-vision__preview" />
              ) : (
                <p className="brain-vision__placeholder">No image selected</p>
              )}
            </div>
          </div>
        </section>

        <canvas ref={canvasRef} className="brain-vision__canvas" aria-hidden="true" />

        <section className="brain-vision__send">
          <button
            type="button"
            className="brain-vision__primary"
            onClick={() => void sendImage()}
            disabled={!imageBlob || sending}
          >
            {sending ? 'Sending…' : 'Send image'}
          </button>
          <button
            type="button"
            className="brain-vision__ghost"
            onClick={clearPreview}
            disabled={!previewUrl || sending}
          >
            Clear
          </button>
        </section>

        {status ? <p className="brain-vision__status">{status}</p> : null}
        {error ? (
          <p className="brain-vision__error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </main>
  )
}
