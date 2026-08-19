/**
 * #313 — Bounded active document context (metadata only; never file bytes).
 */

import { isSafeOpenAiFileId } from './chat-pdf-files.js'

/**
 * @typedef {{
 *   type: 'active_document'
 *   fileId: string
 *   filename: string
 *   mimeType: string
 *   size: number
 *   expiresAt: number | null
 *   sourceTurnId: string | null
 * }} ActiveDocumentContext
 */

/**
 * @param {unknown} msg
 */
function fileAttachmentFromMessage(msg) {
  if (!msg || typeof msg !== 'object') return null
  const atts = /** @type {{ attachments?: unknown }} */ (msg).attachments
  if (!Array.isArray(atts)) return null
  for (const a of atts) {
    if (!a || typeof a !== 'object') continue
    const att = /** @type {Record<string, unknown>} */ (a)
    const kind = att.type === 'file' || att.kind === 'file'
    if (!kind) continue
    const fileId = typeof att.fileId === 'string' ? att.fileId.trim() : ''
    if (!isSafeOpenAiFileId(fileId)) continue
    return {
      fileId,
      filename:
        typeof att.name === 'string' && att.name.trim()
          ? att.name.trim().slice(0, 120)
          : typeof att.filename === 'string' && att.filename.trim()
            ? att.filename.trim().slice(0, 120)
            : 'document',
      mimeType: typeof att.mimeType === 'string' ? att.mimeType : 'application/pdf',
      size: typeof att.size === 'number' && Number.isFinite(att.size) ? att.size : 0,
      expiresAt:
        typeof att.expiresAt === 'number' && Number.isFinite(att.expiresAt)
          ? att.expiresAt
          : null,
    }
  }
  return null
}

/**
 * True when expiresAt (unix seconds) is in the past.
 * @param {number | null | undefined} expiresAt
 * @param {number} [nowMs]
 */
export function isDocumentFileExpired(expiresAt, nowMs = Date.now()) {
  if (expiresAt == null || !Number.isFinite(expiresAt)) return false
  // expiresAt from OpenAI is unix seconds
  const expMs = expiresAt > 1e12 ? expiresAt : expiresAt * 1000
  return expMs <= nowMs
}

/**
 * Select the most recent user file attachment as active document.
 * @param {Array<{ role?: string, content?: string, id?: string, attachments?: unknown }> | null | undefined} messages
 * @returns {ActiveDocumentContext | null}
 */
export function selectLatestActiveDocument(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return null
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i]
    if (msg?.role !== 'user') continue
    const file = fileAttachmentFromMessage(msg)
    if (!file) continue
    return {
      type: 'active_document',
      fileId: file.fileId,
      filename: file.filename,
      mimeType: file.mimeType,
      size: file.size,
      expiresAt: file.expiresAt,
      sourceTurnId: typeof msg.id === 'string' ? msg.id : null,
    }
  }
  return null
}

/**
 * Validate that a candidate fileId already appears in this conversation history
 * (prevents client injection of arbitrary foreign file IDs for reuse).
 * @param {unknown} messages
 * @param {string} fileId
 */
export function fileIdBelongsToConversation(messages, fileId) {
  if (!isSafeOpenAiFileId(fileId)) return false
  if (!Array.isArray(messages)) return false
  const want = fileId.trim()
  for (const msg of messages) {
    const file = fileAttachmentFromMessage(msg)
    if (file && file.fileId === want) return true
  }
  return false
}

/**
 * Safe metadata for logs / diag — never contents.
 * @param {ActiveDocumentContext | null | undefined} doc
 */
export function summarizeActiveDocumentForLog(doc) {
  if (!doc) return { hasActiveDocument: false }
  return {
    hasActiveDocument: true,
    fileIdPrefix: String(doc.fileId || '').slice(0, 12),
    filenameLen: String(doc.filename || '').length,
    mimeType: doc.mimeType || '',
    size: typeof doc.size === 'number' ? doc.size : 0,
    expired: isDocumentFileExpired(doc.expiresAt),
  }
}
