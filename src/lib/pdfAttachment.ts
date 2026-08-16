/**
 * PDF attachment validation (#275) — client + shared constants.
 * No extraction / OCR. Never log file bytes.
 */

export const PDF_MIME = 'application/pdf'
export const MAX_PDF_BYTES = 10 * 1024 * 1024
/** How many recent PDF-bearing user turns keep file_id in history. */
export const MAX_RECENT_FILE_TURNS = 2
/** OpenAI Files API expiry for MVP uploads (24h). */
export const PDF_FILE_EXPIRES_SECONDS = 24 * 60 * 60

export type PdfValidationCode =
  | 'unsupported_type'
  | 'too_large'
  | 'empty'
  | 'invalid_pdf'
  | 'bad_name'

export class PdfValidationError extends Error {
  readonly code: PdfValidationCode

  constructor(code: PdfValidationCode, message = friendlyPdfError(code)) {
    super(message)
    this.name = 'PdfValidationError'
    this.code = code
  }
}

export function friendlyPdfError(code: PdfValidationCode): string {
  switch (code) {
    case 'unsupported_type':
      return 'Formato non supportato. Allega un PDF (.pdf).'
    case 'too_large':
      return 'PDF troppo grande. Massimo 10 MB.'
    case 'empty':
      return 'Il file PDF è vuoto.'
    case 'invalid_pdf':
      return 'PDF non valido o danneggiato.'
    case 'bad_name':
      return 'Nome file non valido.'
    default:
      return 'Impossibile allegare il PDF.'
  }
}

/** Basename only; strip path traversal / controls; keep .pdf. */
export function sanitizePdfFilename(raw: unknown): string {
  let name = String(raw || 'document.pdf')
  name = name.replace(/\\/g, '/').split('/').pop() || 'document.pdf'
  name = name.replace(/[\u0000-\u001f\u007f]/g, '').trim()
  if (!name) name = 'document.pdf'
  if (!/\.pdf$/i.test(name)) name = `${name}.pdf`
  // Cap length while preserving extension
  if (name.length > 120) {
    name = `${name.slice(0, 116)}.pdf`
  }
  return name
}

export function hasPdfExtension(name: string): boolean {
  return /\.pdf$/i.test(String(name || '').trim())
}

export function isPdfMime(value: unknown): boolean {
  if (typeof value !== 'string') return false
  const m = value.trim().toLowerCase()
  return m === PDF_MIME || m === 'application/x-pdf'
}

/** First bytes must be %PDF */
export function bufferLooksLikePdf(bytes: ArrayBuffer | Uint8Array): boolean {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  if (u8.length < 5) return false
  return (
    u8[0] === 0x25 && // %
    u8[1] === 0x50 && // P
    u8[2] === 0x44 && // D
    u8[3] === 0x46 // F
  )
}

export async function assertValidPdfFile(file: File): Promise<{
  name: string
  size: number
  mimeType: typeof PDF_MIME
}> {
  if (!file || !(file instanceof File)) {
    throw new PdfValidationError('empty')
  }
  if (file.size <= 0) throw new PdfValidationError('empty')
  if (file.size > MAX_PDF_BYTES) throw new PdfValidationError('too_large')

  const name = sanitizePdfFilename(file.name)
  if (!hasPdfExtension(name)) throw new PdfValidationError('unsupported_type')

  const mimeOk = !file.type || isPdfMime(file.type)
  if (!mimeOk) throw new PdfValidationError('unsupported_type')

  const head = await file.slice(0, 8).arrayBuffer()
  if (!bufferLooksLikePdf(head)) throw new PdfValidationError('invalid_pdf')

  return { name, size: file.size, mimeType: PDF_MIME }
}

/** Safe metadata for logs — never bytes / base64 / extracted text. */
export function summarizePdfForLog(input: {
  name?: string
  size?: number
  mimeType?: string
  fileId?: string
}): Record<string, string | number | boolean> {
  const name = typeof input.name === 'string' ? input.name : ''
  const fileId = typeof input.fileId === 'string' ? input.fileId : ''
  return {
    mimeType: typeof input.mimeType === 'string' ? input.mimeType : PDF_MIME,
    size: typeof input.size === 'number' ? input.size : 0,
    nameLen: name.length,
    hasFileId: Boolean(fileId),
    fileIdPrefix: fileId ? fileId.slice(0, 12) : '',
  }
}

export function formatPdfSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 1)} MB`
}

export function truncateFilename(name: string, max = 28): string {
  const n = String(name || 'document.pdf')
  if (n.length <= max) return n
  const ext = n.includes('.') ? n.slice(n.lastIndexOf('.')) : ''
  const keep = Math.max(8, max - ext.length - 1)
  return `${n.slice(0, keep)}…${ext}`
}
