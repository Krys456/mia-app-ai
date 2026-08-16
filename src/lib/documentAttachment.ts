/**
 * Document attachments (#275 PDF + #276 TXT/DOCX).
 * No extraction / OCR / unzip. Never log file bytes.
 */

import {
  PDF_MIME,
  MAX_PDF_BYTES,
  MAX_RECENT_FILE_TURNS,
  PDF_FILE_EXPIRES_SECONDS,
  PdfValidationError,
  assertValidPdfFile,
  bufferLooksLikePdf,
  formatPdfSize,
  hasPdfExtension,
  isPdfMime,
  sanitizePdfFilename,
  summarizePdfForLog,
  truncateFilename,
} from './pdfAttachment'

export {
  PDF_MIME,
  MAX_PDF_BYTES,
  MAX_RECENT_FILE_TURNS,
  PDF_FILE_EXPIRES_SECONDS,
  PdfValidationError,
  assertValidPdfFile,
  bufferLooksLikePdf,
  formatPdfSize as formatDocumentSize,
  hasPdfExtension,
  isPdfMime,
  sanitizePdfFilename,
  summarizePdfForLog as summarizeDocumentForLog,
  truncateFilename,
}

export const TXT_MIME = 'text/plain'
export const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

/** Preferred TXT cap; hard ceiling also enforced. */
export const MAX_TXT_BYTES = 512 * 1024
export const HARD_MAX_TXT_BYTES = 1024 * 1024
export const MAX_DOCX_BYTES = 5 * 1024 * 1024

export const DOCUMENT_FILE_EXPIRES_SECONDS = PDF_FILE_EXPIRES_SECONDS

export type SupportedDocumentMime =
  | typeof PDF_MIME
  | typeof TXT_MIME
  | typeof DOCX_MIME

export type DocumentBadge = 'PDF' | 'TXT' | 'DOCX'

export type DocumentValidationCode =
  | 'unsupported_type'
  | 'too_large'
  | 'empty'
  | 'invalid_pdf'
  | 'invalid_txt'
  | 'binary_txt'
  | 'bad_encoding'
  | 'invalid_docx'
  | 'unsupported_word'
  | 'bad_name'

export class DocumentValidationError extends Error {
  readonly code: DocumentValidationCode

  constructor(code: DocumentValidationCode, message = friendlyDocumentError(code)) {
    super(message)
    this.name = 'DocumentValidationError'
    this.code = code
  }
}

export function friendlyDocumentError(code: DocumentValidationCode): string {
  switch (code) {
    case 'unsupported_type':
      return 'Formato non supportato. Usa PDF, TXT o DOCX.'
    case 'too_large':
      return 'File troppo grande per questo formato.'
    case 'empty':
      return 'Il file è vuoto.'
    case 'invalid_pdf':
      return 'PDF non valido o danneggiato.'
    case 'invalid_txt':
      return 'Documento TXT non valido.'
    case 'binary_txt':
      return 'Il file sembra contenere dati binari.'
    case 'bad_encoding':
      return 'Codifica del file di testo non supportata.'
    case 'invalid_docx':
      return 'Documento DOCX non valido.'
    case 'unsupported_word':
      return 'I file .doc / .docm non sono supportati. Usa .docx.'
    case 'bad_name':
      return 'Nome file non valido.'
    default:
      return 'Impossibile allegare il documento.'
  }
}

export function isSupportedDocumentMime(value: unknown): value is SupportedDocumentMime {
  return (
    value === PDF_MIME ||
    value === TXT_MIME ||
    value === DOCX_MIME
  )
}

export function documentBadgeFor(
  mimeType: string | undefined | null,
  name?: string,
): DocumentBadge {
  const mime = String(mimeType || '').toLowerCase()
  if (mime === PDF_MIME || /\.pdf$/i.test(String(name || ''))) return 'PDF'
  if (mime === TXT_MIME || /\.txt$/i.test(String(name || ''))) return 'TXT'
  if (mime === DOCX_MIME || /\.docx$/i.test(String(name || ''))) return 'DOCX'
  const ext = String(name || '').toLowerCase()
  if (ext.endsWith('.pdf')) return 'PDF'
  if (ext.endsWith('.txt')) return 'TXT'
  if (ext.endsWith('.docx')) return 'DOCX'
  return 'PDF'
}

/** Basename only; preserve known extension; strip path / controls. */
export function sanitizeDocumentFilename(raw: unknown, fallbackExt: '.pdf' | '.txt' | '.docx'): string {
  let name = String(raw || `document${fallbackExt}`)
  name = name.replace(/\\/g, '/').split('/').pop() || `document${fallbackExt}`
  name = name.replace(/[\u0000-\u001f\u007f]/g, '').trim()
  if (!name) name = `document${fallbackExt}`
  const lower = name.toLowerCase()
  if (!lower.endsWith('.pdf') && !lower.endsWith('.txt') && !lower.endsWith('.docx')) {
    name = `${name}${fallbackExt}`
  }
  if (name.length > 120) {
    const ext = name.includes('.') ? name.slice(name.lastIndexOf('.')) : fallbackExt
    name = `${name.slice(0, Math.max(8, 120 - ext.length))}${ext}`
  }
  return name
}

function extensionOf(name: string): string {
  const n = String(name || '').toLowerCase()
  const i = n.lastIndexOf('.')
  return i >= 0 ? n.slice(i) : ''
}

export function detectDocumentKindFromName(name: string): 'pdf' | 'txt' | 'docx' | 'rejected' | null {
  const ext = extensionOf(name)
  if (ext === '.pdf') return 'pdf'
  if (ext === '.txt') return 'txt'
  if (ext === '.docx') return 'docx'
  if (ext === '.doc' || ext === '.docm' || ext === '.dot' || ext === '.dotx') return 'rejected'
  return null
}

/** Reject obvious binary / non-text samples. */
export function looksLikeBinaryText(bytes: Uint8Array): boolean {
  if (bytes.length === 0) return false
  let nul = 0
  let control = 0
  const sample = bytes.length > 8192 ? bytes.subarray(0, 8192) : bytes
  for (let i = 0; i < sample.length; i += 1) {
    const b = sample[i]
    if (b === 0) nul += 1
    // Allow tab/lf/cr; count other C0 controls
    if (b < 32 && b !== 9 && b !== 10 && b !== 13) control += 1
  }
  if (nul > 0) return true
  if (control / sample.length > 0.05) return true
  return false
}

/** UTF-8 decode check; accepts BOM. */
export function assertUtf8Text(bytes: Uint8Array): void {
  try {
    const decoder = new TextDecoder('utf-8', { fatal: true })
    decoder.decode(bytes)
  } catch {
    throw new DocumentValidationError('bad_encoding')
  }
}

export function bufferLooksLikeZip(bytes: ArrayBuffer | Uint8Array): boolean {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  if (u8.length < 4) return false
  // PK\x03\x04 local, PK\x05\x06 empty, PK\x07\x08 spanned
  return (
    u8[0] === 0x50 &&
    u8[1] === 0x4b &&
    (u8[2] === 0x03 || u8[2] === 0x05 || u8[2] === 0x07) &&
    (u8[3] === 0x04 || u8[3] === 0x06 || u8[3] === 0x08)
  )
}

/** Lightweight OOXML sniff without unzipping. */
export function bufferLooksLikeDocx(bytes: ArrayBuffer | Uint8Array): boolean {
  if (!bufferLooksLikeZip(bytes)) return false
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  const windowSize = Math.min(u8.length, 512 * 1024)
  // Latin-1 decode of a bounded window — find ASCII OOXML path markers.
  let ascii = ''
  const chunk = 2048
  for (let offset = 0; offset < windowSize; offset += chunk) {
    const end = Math.min(offset + chunk, windowSize)
    let part = ''
    for (let i = offset; i < end; i += 1) part += String.fromCharCode(u8[i])
    ascii += part
    if (ascii.includes('[Content_Types].xml') && /word\//.test(ascii)) return true
    if (ascii.length > 8192) ascii = ascii.slice(-4096)
  }
  return ascii.includes('[Content_Types].xml') && /word\//.test(ascii)
}

export async function assertValidTxtFile(file: File): Promise<{
  name: string
  size: number
  mimeType: typeof TXT_MIME
}> {
  if (!file || !(file instanceof File)) {
    throw new DocumentValidationError('empty', 'Documento TXT vuoto.')
  }
  if (file.size <= 0) throw new DocumentValidationError('empty', 'Documento TXT vuoto.')
  if (file.size > HARD_MAX_TXT_BYTES || file.size > MAX_TXT_BYTES) {
    throw new DocumentValidationError('too_large', 'File TXT troppo grande. Massimo 512 KB.')
  }

  const name = sanitizeDocumentFilename(file.name, '.txt')
  if (!/\.txt$/i.test(name)) throw new DocumentValidationError('unsupported_type')
  if (/\.docm?$/i.test(file.name) || /\.docx$/i.test(file.name)) {
    throw new DocumentValidationError('unsupported_type')
  }

  const mime = String(file.type || '').trim().toLowerCase()
  if (mime && mime !== TXT_MIME && mime !== 'application/octet-stream' && mime !== 'text/txt') {
    throw new DocumentValidationError('unsupported_type')
  }

  const buf = new Uint8Array(await file.arrayBuffer())
  if (looksLikeBinaryText(buf)) throw new DocumentValidationError('binary_txt')
  assertUtf8Text(buf)

  return { name, size: file.size, mimeType: TXT_MIME }
}

export async function assertValidDocxFile(file: File): Promise<{
  name: string
  size: number
  mimeType: typeof DOCX_MIME
}> {
  if (!file || !(file instanceof File)) throw new DocumentValidationError('empty')
  if (file.size <= 0) throw new DocumentValidationError('empty')
  if (file.size > MAX_DOCX_BYTES) {
    throw new DocumentValidationError('too_large', 'Documento DOCX troppo grande. Massimo 5 MB.')
  }

  const rawName = String(file.name || '')
  const ext = extensionOf(rawName)
  if (ext === '.doc' || ext === '.docm' || ext === '.dot' || ext === '.dotx') {
    throw new DocumentValidationError(
      'unsupported_word',
      ext === '.docm'
        ? 'I file .docm non sono supportati.'
        : 'I file .doc non sono ancora supportati. Usa .docx.',
    )
  }

  const name = sanitizeDocumentFilename(file.name, '.docx')
  if (!/\.docx$/i.test(name)) throw new DocumentValidationError('unsupported_type')

  const mime = String(file.type || '').trim().toLowerCase()
  if (
    mime &&
    mime !== DOCX_MIME &&
    mime !== 'application/octet-stream' &&
    mime !== 'application/zip'
  ) {
    throw new DocumentValidationError('unsupported_type')
  }

  const buf = new Uint8Array(await file.arrayBuffer())
  if (!bufferLooksLikeDocx(buf)) {
    throw new DocumentValidationError('invalid_docx', 'Documento DOCX non valido.')
  }

  return { name, size: file.size, mimeType: DOCX_MIME }
}

export async function assertValidDocumentFile(file: File): Promise<{
  name: string
  size: number
  mimeType: SupportedDocumentMime
}> {
  const kind = detectDocumentKindFromName(file.name || '')
  if (kind === 'rejected') {
    const ext = extensionOf(file.name || '')
    throw new DocumentValidationError(
      'unsupported_word',
      ext === '.docm'
        ? 'I file .docm non sono supportati.'
        : 'I file .doc non sono ancora supportati. Usa .docx.',
    )
  }
  if (kind === 'txt') return assertValidTxtFile(file)
  if (kind === 'docx') return assertValidDocxFile(file)
  if (kind === 'pdf') {
    try {
      return await assertValidPdfFile(file)
    } catch (err) {
      if (err instanceof PdfValidationError) {
        throw new DocumentValidationError(
          err.code === 'invalid_pdf'
            ? 'invalid_pdf'
            : err.code === 'too_large'
              ? 'too_large'
              : err.code === 'empty'
                ? 'empty'
                : 'unsupported_type',
          err.message,
        )
      }
      throw err
    }
  }

  // MIME fallback when extension missing
  const mime = String(file.type || '').toLowerCase()
  if (isPdfMime(mime)) return assertValidPdfFile(file).catch((err) => {
    if (err instanceof PdfValidationError) {
      throw new DocumentValidationError(
        err.code === 'invalid_pdf' ? 'invalid_pdf' : 'unsupported_type',
        err.message,
      )
    }
    throw err
  })
  if (mime === TXT_MIME) return assertValidTxtFile(file)
  if (mime === DOCX_MIME) return assertValidDocxFile(file)

  throw new DocumentValidationError('unsupported_type')
}
