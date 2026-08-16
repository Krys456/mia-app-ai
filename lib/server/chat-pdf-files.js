/**
 * Server PDF helpers (#275) — validation + OpenAI Files upload.
 * Never logs file bytes / extracted text.
 */

import { toFile } from 'openai'
import OpenAI from 'openai'

export const SERVER_PDF_MIME = 'application/pdf'
export const SERVER_MAX_PDF_BYTES = 10 * 1024 * 1024
/** MVP retention: 24 hours. */
export const SERVER_PDF_EXPIRES_SECONDS = 24 * 60 * 60
export const SERVER_MAX_RECENT_FILE_TURNS = 2

/**
 * @param {unknown} raw
 */
export function sanitizePdfFilename(raw) {
  let name = String(raw || 'document.pdf')
  name = name.replace(/\\/g, '/').split('/').pop() || 'document.pdf'
  name = name.replace(/[\u0000-\u001f\u007f]/g, '').trim()
  if (!name) name = 'document.pdf'
  if (!/\.pdf$/i.test(name)) name = `${name}.pdf`
  if (name.length > 120) name = `${name.slice(0, 116)}.pdf`
  return name
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
 * Upload validated PDF bytes to OpenAI Files API.
 * @param {{ apiKey: string, buffer: Buffer, filename: string }} input
 */
export async function uploadPdfToOpenAiFiles(input) {
  const client = new OpenAI({ apiKey: input.apiKey })
  const file = await toFile(input.buffer, input.filename, { type: SERVER_PDF_MIME })
  const created = await client.files.create({
    file,
    purpose: 'user_data',
    expires_after: {
      anchor: 'created_at',
      seconds: SERVER_PDF_EXPIRES_SECONDS,
    },
  })
  return {
    fileId: created.id,
    filename: created.filename || input.filename,
    size: typeof created.bytes === 'number' ? created.bytes : input.buffer.length,
    expiresAt:
      typeof created.expires_at === 'number'
        ? created.expires_at
        : Math.floor(Date.now() / 1000) + SERVER_PDF_EXPIRES_SECONDS,
  }
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
 * Map OpenAI upload/file errors to friendly codes.
 * @param {unknown} error
 */
export function mapOpenAiFileError(error) {
  const msg = error instanceof Error ? error.message : String(error || '')
  const lower = msg.toLowerCase()
  if (/password|encrypt|encrypted|protected/i.test(lower)) {
    return {
      code: 'encrypted_pdf',
      error: 'Questo PDF è protetto da password. Rimuovi la protezione e riprova.',
    }
  }
  if (/too large|maximum|size/i.test(lower)) {
    return { code: 'too_large', error: 'PDF troppo grande. Massimo 10 MB.' }
  }
  if (/unsupported|invalid|corrupt|malformed/i.test(lower)) {
    return { code: 'invalid_pdf', error: 'PDF non valido o non supportato.' }
  }
  return {
    code: 'upload_failed',
    error: 'Caricamento PDF non riuscito. Riprova tra un momento.',
  }
}
