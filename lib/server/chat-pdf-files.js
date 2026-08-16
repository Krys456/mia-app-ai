/**
 * Server PDF helpers (#275) — validation + OpenAI Files upload.
 * Never logs file bytes / extracted text.
 */

import { toFile } from 'openai'
import OpenAI from 'openai'

export const SERVER_PDF_MIME = 'application/pdf'
export const SERVER_TXT_MIME = 'text/plain'
export const SERVER_DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
export const SERVER_MAX_PDF_BYTES = 10 * 1024 * 1024
export const SERVER_MAX_TXT_BYTES = 512 * 1024
export const SERVER_HARD_MAX_TXT_BYTES = 1024 * 1024
export const SERVER_MAX_DOCX_BYTES = 5 * 1024 * 1024
/** MVP retention: 24 hours. */
export const SERVER_PDF_EXPIRES_SECONDS = 24 * 60 * 60
export const SERVER_DOCUMENT_EXPIRES_SECONDS = SERVER_PDF_EXPIRES_SECONDS
export const SERVER_MAX_RECENT_FILE_TURNS = 2

export const SERVER_SUPPORTED_DOCUMENT_MIMES = [
  SERVER_PDF_MIME,
  SERVER_TXT_MIME,
  SERVER_DOCX_MIME,
]

/**
 * @param {unknown} raw
 * @param {'.pdf'|'.txt'|'.docx'} [fallbackExt]
 */
export function sanitizeDocumentFilename(raw, fallbackExt = '.pdf') {
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

/**
 * @param {unknown} raw
 */
export function sanitizePdfFilename(raw) {
  return sanitizeDocumentFilename(raw, '.pdf')
}

/**
 * @param {Uint8Array | Buffer} bytes
 */
export function bufferLooksLikePdf(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  if (u8.length < 5) return false
  return u8[0] === 0x25 && u8[1] === 0x50 && u8[2] === 0x44 && u8[3] === 0x46
}

/**
 * @param {string | null | undefined} fileId
 */
export function isSafeOpenAiFileId(fileId) {
  return typeof fileId === 'string' && /^file-[A-Za-z0-9]+$/.test(fileId.trim())
}

/**
 * @param {{ name?: string, size?: number, mimeType?: string, fileId?: string }} input
 */
export function summarizePdfForLog(input = {}) {
  const name = typeof input.name === 'string' ? input.name : ''
  const fileId = typeof input.fileId === 'string' ? input.fileId : ''
  return {
    mimeType: typeof input.mimeType === 'string' ? input.mimeType : SERVER_PDF_MIME,
    size: typeof input.size === 'number' ? input.size : 0,
    nameLen: name.length,
    hasFileId: Boolean(fileId),
    fileIdPrefix: fileId ? fileId.slice(0, 12) : '',
  }
}

/**
 * @param {Buffer} buffer
 * @param {string} filename
 * @param {string} [mimeType]
 * @returns {{ ok: true, name: string, size: number, mimeType: string } | { ok: false, code: string, error: string }}
 */
export function validatePdfBuffer(buffer, filename, mimeType) {
  if (!Buffer.isBuffer(buffer) || buffer.length <= 0) {
    return { ok: false, code: 'empty', error: 'Il file PDF è vuoto.' }
  }
  if (buffer.length > SERVER_MAX_PDF_BYTES) {
    return { ok: false, code: 'too_large', error: 'PDF troppo grande. Massimo 10 MB.' }
  }
  const name = sanitizePdfFilename(filename)
  if (!/\.pdf$/i.test(name)) {
    return { ok: false, code: 'unsupported_type', error: 'Formato non supportato. Allega un PDF (.pdf).' }
  }
  const mime = String(mimeType || '').trim().toLowerCase()
  if (mime && mime !== SERVER_PDF_MIME && mime !== 'application/x-pdf' && mime !== 'application/octet-stream') {
    return { ok: false, code: 'unsupported_type', error: 'Formato non supportato. Allega un PDF (.pdf).' }
  }
  if (!bufferLooksLikePdf(buffer)) {
    return { ok: false, code: 'invalid_pdf', error: 'PDF non valido o danneggiato.' }
  }
  return { ok: true, name, size: buffer.length, mimeType: SERVER_PDF_MIME }
}

/**
 * Upload validated document bytes to OpenAI Files API.
 * @param {{ apiKey: string, buffer: Buffer, filename: string, mimeType: string }} input
 */
export async function uploadDocumentToOpenAiFiles(input) {
  const mimeType = String(input.mimeType || SERVER_PDF_MIME)
  const client = new OpenAI({ apiKey: input.apiKey })
  const file = await toFile(input.buffer, input.filename, { type: mimeType })
  const created = await client.files.create({
    file,
    purpose: 'user_data',
    expires_after: {
      anchor: 'created_at',
      seconds: SERVER_DOCUMENT_EXPIRES_SECONDS,
    },
  })
  return {
    fileId: created.id,
    filename: created.filename || input.filename,
    size: typeof created.bytes === 'number' ? created.bytes : input.buffer.length,
    mimeType,
    expiresAt:
      typeof created.expires_at === 'number'
        ? created.expires_at
        : Math.floor(Date.now() / 1000) + SERVER_DOCUMENT_EXPIRES_SECONDS,
  }
}

/**
 * Upload validated PDF bytes to OpenAI Files API.
 * @param {{ apiKey: string, buffer: Buffer, filename: string }} input
 */
export async function uploadPdfToOpenAiFiles(input) {
  return uploadDocumentToOpenAiFiles({
    ...input,
    mimeType: SERVER_PDF_MIME,
  })
}

/**
 * Best-effort delete — never throws to callers.
 * @param {{ apiKey: string, fileId: string }} input
 */
export async function deleteOpenAiFileBestEffort(input) {
  if (!isSafeOpenAiFileId(input.fileId)) return false
  try {
    const client = new OpenAI({ apiKey: input.apiKey })
    await client.files.delete(input.fileId.trim())
    return true
  } catch {
    return false
  }
}

/**
 * @param {Buffer} buffer
 */
function looksLikeBinaryText(buffer) {
  const sample = buffer.subarray(0, Math.min(buffer.length, 8192))
  let nul = 0
  let control = 0
  for (let i = 0; i < sample.length; i += 1) {
    const b = sample[i]
    if (b === 0) nul += 1
    if (b < 32 && b !== 9 && b !== 10 && b !== 13) control += 1
  }
  if (nul > 0) return true
  if (sample.length && control / sample.length > 0.05) return true
  return false
}

/**
 * @param {Buffer} buffer
 */
function isValidUtf8(buffer) {
  try {
    const decoder = new TextDecoder('utf-8', { fatal: true })
    decoder.decode(buffer)
    return true
  } catch {
    return false
  }
}

/**
 * @param {Buffer} buffer
 */
export function bufferLooksLikeZip(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) return false
  return (
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    (buffer[2] === 0x03 || buffer[2] === 0x05 || buffer[2] === 0x07) &&
    (buffer[3] === 0x04 || buffer[3] === 0x06 || buffer[3] === 0x08)
  )
}

/**
 * @param {Buffer} buffer
 */
export function bufferLooksLikeDocx(buffer) {
  if (!bufferLooksLikeZip(buffer)) return false
  const windowSize = Math.min(buffer.length, 512 * 1024)
  const ascii = buffer.subarray(0, windowSize).toString('latin1')
  return ascii.includes('[Content_Types].xml') && /word\//.test(ascii)
}

/**
 * @param {Buffer} buffer
 * @param {string} filename
 * @param {string} [mimeType]
 */
export function validateTxtBuffer(buffer, filename, mimeType) {
  if (!Buffer.isBuffer(buffer) || buffer.length <= 0) {
    return { ok: false, code: 'empty', error: 'Documento TXT vuoto.' }
  }
  if (buffer.length > SERVER_MAX_TXT_BYTES || buffer.length > SERVER_HARD_MAX_TXT_BYTES) {
    return { ok: false, code: 'too_large', error: 'File TXT troppo grande. Massimo 512 KB.' }
  }
  const name = sanitizeDocumentFilename(filename, '.txt')
  if (!/\.txt$/i.test(name)) {
    return { ok: false, code: 'unsupported_type', error: 'Formato non supportato. Usa PDF, TXT o DOCX.' }
  }
  const mime = String(mimeType || '')
    .trim()
    .toLowerCase()
  if (mime && mime !== SERVER_TXT_MIME && mime !== 'application/octet-stream' && mime !== 'text/txt') {
    return { ok: false, code: 'unsupported_type', error: 'Formato non supportato. Usa PDF, TXT o DOCX.' }
  }
  if (looksLikeBinaryText(buffer)) {
    return { ok: false, code: 'binary_txt', error: 'Il file sembra contenere dati binari.' }
  }
  if (!isValidUtf8(buffer)) {
    return { ok: false, code: 'bad_encoding', error: 'Codifica del file di testo non supportata.' }
  }
  return { ok: true, name, size: buffer.length, mimeType: SERVER_TXT_MIME }
}

/**
 * @param {Buffer} buffer
 * @param {string} filename
 * @param {string} [mimeType]
 */
export function validateDocxBuffer(buffer, filename, mimeType) {
  if (!Buffer.isBuffer(buffer) || buffer.length <= 0) {
    return { ok: false, code: 'empty', error: 'Documento DOCX non valido.' }
  }
  if (buffer.length > SERVER_MAX_DOCX_BYTES) {
    return { ok: false, code: 'too_large', error: 'Documento DOCX troppo grande. Massimo 5 MB.' }
  }
  const lowerName = String(filename || '').toLowerCase()
  if (/\.docm$/i.test(lowerName)) {
    return { ok: false, code: 'unsupported_word', error: 'I file .docm non sono supportati.' }
  }
  if (/\.doc$/i.test(lowerName) && !/\.docx$/i.test(lowerName)) {
    return {
      ok: false,
      code: 'unsupported_word',
      error: 'I file .doc non sono ancora supportati. Usa .docx.',
    }
  }
  const name = sanitizeDocumentFilename(filename, '.docx')
  if (!/\.docx$/i.test(name)) {
    return { ok: false, code: 'unsupported_type', error: 'Formato non supportato. Usa PDF, TXT o DOCX.' }
  }
  const mime = String(mimeType || '')
    .trim()
    .toLowerCase()
  if (
    mime &&
    mime !== SERVER_DOCX_MIME &&
    mime !== 'application/octet-stream' &&
    mime !== 'application/zip'
  ) {
    return { ok: false, code: 'unsupported_type', error: 'Formato non supportato. Usa PDF, TXT o DOCX.' }
  }
  if (!bufferLooksLikeDocx(buffer)) {
    return { ok: false, code: 'invalid_docx', error: 'Documento DOCX non valido.' }
  }
  return { ok: true, name, size: buffer.length, mimeType: SERVER_DOCX_MIME }
}

/**
 * Route buffer to type-specific validator.
 * @param {Buffer} buffer
 * @param {string} filename
 * @param {string} [mimeType]
 */
export function validateDocumentBuffer(buffer, filename, mimeType) {
  const lower = String(filename || '').toLowerCase()
  if (/\.docm$/i.test(lower)) {
    return { ok: false, code: 'unsupported_word', error: 'I file .docm non sono supportati.' }
  }
  if (/\.doc$/i.test(lower) && !/\.docx$/i.test(lower)) {
    return {
      ok: false,
      code: 'unsupported_word',
      error: 'I file .doc non sono ancora supportati. Usa .docx.',
    }
  }
  if (/\.txt$/i.test(lower)) return validateTxtBuffer(buffer, filename, mimeType)
  if (/\.docx$/i.test(lower)) return validateDocxBuffer(buffer, filename, mimeType)
  if (/\.pdf$/i.test(lower)) return validatePdfBuffer(buffer, filename, mimeType)

  const mime = String(mimeType || '')
    .trim()
    .toLowerCase()
  if (mime === SERVER_TXT_MIME) return validateTxtBuffer(buffer, filename || 'document.txt', mimeType)
  if (mime === SERVER_DOCX_MIME) return validateDocxBuffer(buffer, filename || 'document.docx', mimeType)
  if (mime === SERVER_PDF_MIME || mime === 'application/x-pdf') {
    return validatePdfBuffer(buffer, filename || 'document.pdf', mimeType)
  }
  return { ok: false, code: 'unsupported_type', error: 'Formato non supportato. Usa PDF, TXT o DOCX.' }
}

/**
 * Map OpenAI upload/file errors to friendly codes.
 * @param {unknown} error
 * @param {string} [mimeType]
 */
export function mapOpenAiFileError(error, mimeType) {
  const msg = error instanceof Error ? error.message : String(error || '')
  const lower = msg.toLowerCase()
  const mime = String(mimeType || '')
  if (/password|encrypt|encrypted|protected/i.test(lower)) {
    if (mime === SERVER_DOCX_MIME) {
      return {
        code: 'encrypted_docx',
        error: 'Questo documento è protetto da password. Rimuovi la protezione e riprova.',
      }
    }
    return {
      code: 'encrypted_pdf',
      error: 'Questo PDF è protetto da password. Rimuovi la protezione e riprova.',
    }
  }
  if (/too large|maximum|size/i.test(lower)) {
    return { code: 'too_large', error: 'File troppo grande per questo formato.' }
  }
  if (/unsupported|invalid|corrupt|malformed/i.test(lower)) {
    if (mime === SERVER_TXT_MIME) {
      return { code: 'invalid_txt', error: 'Documento TXT non valido.' }
    }
    if (mime === SERVER_DOCX_MIME) {
      return { code: 'invalid_docx', error: 'File Word corrotto o non supportato.' }
    }
    return { code: 'invalid_pdf', error: 'PDF non valido o non supportato.' }
  }
  return {
    code: 'upload_failed',
    error: 'Caricamento documento non riuscito. Riprova tra un momento.',
  }
}
