/**
 * Image attachment helpers for #272 MVP (client).
 * jpeg / png / webp only — GIF rejected (animation ambiguity).
 */

export const SUPPORTED_IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp'] as const
export type SupportedImageMime = (typeof SUPPORTED_IMAGE_MIMES)[number]

export const MAX_IMAGE_SOURCE_BYTES = 4 * 1024 * 1024
/** Approximate max length of the full data URL string after compression. */
export const MAX_IMAGE_DATA_URL_CHARS = Math.floor(1.5 * 1024 * 1024)
export const MAX_IMAGE_LONG_EDGE = 1920
export const MAX_IMAGES_PER_MESSAGE = 1
/** How many recent image-bearing user turns keep multimodal history. */
export const MAX_RECENT_IMAGE_TURNS = 2

export function isSupportedImageMime(value: unknown): value is SupportedImageMime {
  return (
    typeof value === 'string' &&
    (SUPPORTED_IMAGE_MIMES as readonly string[]).includes(value)
  )
}

export function isImageDataUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false
  return /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/i.test(value.trim())
}

export function mimeFromDataUrl(dataUrl: string): SupportedImageMime | null {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,/i.exec(dataUrl.trim())
  if (!m) return null
  const mime = m[1].toLowerCase()
  return isSupportedImageMime(mime) ? mime : null
}

export function estimateDataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(',')
  const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl
  // 4 base64 chars → 3 bytes
  return Math.floor((b64.length * 3) / 4)
}

/** Safe metadata for logs — never includes bytes/base64. */
export function summarizeImageForLog(input: {
  mimeType?: string
  dataUrl?: string
  byteLength?: number
}): Record<string, string | number | boolean> {
  const dataUrl = typeof input.dataUrl === 'string' ? input.dataUrl : ''
  return {
    mimeType: typeof input.mimeType === 'string' ? input.mimeType : 'unknown',
    dataUrlChars: dataUrl.length,
    approxBytes:
      typeof input.byteLength === 'number'
        ? input.byteLength
        : dataUrl
          ? estimateDataUrlBytes(dataUrl)
          : 0,
    hasDataUrl: Boolean(dataUrl),
  }
}

export class ImageValidationError extends Error {
  readonly code:
    | 'unsupported_type'
    | 'too_large'
    | 'unreadable'
    | 'too_many'
    | 'empty'

  constructor(
    code: ImageValidationError['code'],
    message = friendlyImageError(code),
  ) {
    super(message)
    this.name = 'ImageValidationError'
    this.code = code
  }
}

export function friendlyImageError(code: ImageValidationError['code']): string {
  switch (code) {
    case 'unsupported_type':
      return 'Formato immagine non supportato. Usa JPEG, PNG o WebP.'
    case 'too_large':
      return 'Immagine troppo grande. Prova una foto più leggera (max 4 MB).'
    case 'unreadable':
      return 'Impossibile leggere l’immagine. Scegline un’altra.'
    case 'too_many':
      return 'Puoi allegare una sola immagine per messaggio.'
    case 'empty':
      return 'Nessuna immagine selezionata.'
    default:
      return 'Immagine non valida.'
  }
}

function sniffMime(bytes: Uint8Array): SupportedImageMime | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg'
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return 'image/png'
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp'
  }
  // GIF signature — explicitly unsupported in MVP
  if (
    bytes.length >= 6 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46
  ) {
    return null
  }
  return null
}

export async function validateImageFile(file: File): Promise<SupportedImageMime> {
  if (!file || file.size <= 0) throw new ImageValidationError('empty')
  if (file.size > MAX_IMAGE_SOURCE_BYTES) throw new ImageValidationError('too_large')

  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer())
  const sniffed = sniffMime(head)
  if (!sniffed) throw new ImageValidationError('unsupported_type')

  // Prefer sniffed over declared type; reject mismatches that claim gif/etc.
  if (file.type && file.type !== sniffed && file.type !== 'image/jpg') {
    if (!isSupportedImageMime(file.type) && file.type !== 'image/jpg') {
      throw new ImageValidationError('unsupported_type')
    }
  }
  return sniffed
}

export interface PreparedImageAttachment {
  mimeType: SupportedImageMime
  dataUrl: string
  previewUrl: string
  width: number
  height: number
  /** True when previewUrl is a blob: URL that must be revoked. */
  previewIsObjectUrl: boolean
}

function loadImageBitmap(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new ImageValidationError('unreadable'))
    }
    img.src = url
  })
}

/**
 * Resize/compress a validated image File into a data URL for Core.
 */
export async function prepareImageAttachment(file: File): Promise<PreparedImageAttachment> {
  const mimeType = await validateImageFile(file)
  let img: HTMLImageElement
  try {
    img = await loadImageBitmap(file)
  } catch (error) {
    if (error instanceof ImageValidationError) throw error
    throw new ImageValidationError('unreadable')
  }

  const srcW = img.naturalWidth || img.width
  const srcH = img.naturalHeight || img.height
  if (!srcW || !srcH) throw new ImageValidationError('unreadable')

  const scale = Math.min(1, MAX_IMAGE_LONG_EDGE / Math.max(srcW, srcH))
  const width = Math.max(1, Math.round(srcW * scale))
  const height = Math.max(1, Math.round(srcH * scale))

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new ImageValidationError('unreadable')
  ctx.drawImage(img, 0, 0, width, height)

  // PNG keeps alpha; JPEG/WebP use lossy quality ladder until under limit.
  const preferPng = mimeType === 'image/png'
  let dataUrl = ''
  if (preferPng) {
    dataUrl = canvas.toDataURL('image/png')
    if (dataUrl.length > MAX_IMAGE_DATA_URL_CHARS) {
      // Fall back to JPEG if PNG stays huge (e.g. photos mislabeled as png).
      dataUrl = encodeJpegLadder(canvas)
    }
  } else {
    dataUrl = encodeJpegLadder(canvas)
  }

  if (!dataUrl || dataUrl.length > MAX_IMAGE_DATA_URL_CHARS) {
    throw new ImageValidationError('too_large')
  }

  const outMime = mimeFromDataUrl(dataUrl) ?? (preferPng ? 'image/png' : 'image/jpeg')
  const previewUrl = URL.createObjectURL(file)

  return {
    mimeType: outMime,
    dataUrl,
    previewUrl,
    width,
    height,
    previewIsObjectUrl: true,
  }
}

function encodeJpegLadder(canvas: HTMLCanvasElement): string {
  let quality = 0.82
  let dataUrl = canvas.toDataURL('image/jpeg', quality)
  while (dataUrl.length > MAX_IMAGE_DATA_URL_CHARS && quality > 0.45) {
    quality -= 0.1
    dataUrl = canvas.toDataURL('image/jpeg', quality)
  }
  return dataUrl
}

export function revokePreviewUrl(url: string | undefined | null): void {
  if (typeof url === 'string' && url.startsWith('blob:')) {
    try {
      URL.revokeObjectURL(url)
    } catch {
      /* ignore */
    }
  }
}
