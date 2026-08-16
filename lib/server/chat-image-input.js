/**
 * Server-side multimodal sanitization + Responses API mapping (#272 + #275).
 * Images: dataUrl. PDFs: OpenAI file_id only. Memory / LANGUAGE use caption text only.
 */

import { resolveVisionStickyLang } from './vision-task-shortcuts.js'
import {
  SERVER_MAX_RECENT_FILE_TURNS,
  isSafeOpenAiFileId,
  sanitizePdfFilename,
  summarizePdfForLog,
} from './chat-pdf-files.js'

export const SERVER_SUPPORTED_IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp']
export const SERVER_MAX_IMAGES_PER_MESSAGE = 1
export const SERVER_MAX_ATTACHMENTS_PER_MESSAGE = 1
export const SERVER_MAX_DATA_URL_CHARS = Math.floor(1.5 * 1024 * 1024)
export const SERVER_MAX_RECENT_IMAGE_TURNS = 2
export { SERVER_MAX_RECENT_FILE_TURNS }

export const IMAGE_ONLY_MODEL_NUDGE =
  'Analyze the attached image and respond helpfully.'

export const DOCUMENT_ONLY_MODEL_NUDGE =
  'Analyze the attached document and respond helpfully.'

/** @type {Record<string, string>} */
const IMAGE_ONLY_NUDGE_BY_LANG = {
  it: "Analizza l'immagine allegata e rispondi in modo utile.",
  en: IMAGE_ONLY_MODEL_NUDGE,
  es: 'Analiza la imagen adjunta y responde de forma útil.',
  fr: "Analyse l'image jointe et réponds de façon utile.",
  de: 'Analysiere das angehängte Bild und antworte hilfreich.',
}

/** @type {Record<string, string>} */
const DOCUMENT_ONLY_NUDGE_BY_LANG = {
  it: 'Analizza il documento allegato e rispondi in modo utile.',
  en: DOCUMENT_ONLY_MODEL_NUDGE,
  es: 'Analiza el documento adjunto y responde de forma útil.',
  fr: 'Analyse le document joint et réponds de façon utile.',
  de: 'Analysiere das angehängte Dokument und antworte hilfreich.',
}

/**
 * Server/model-only image-only nudge in the established conversation language.
 * Never shown in UI / Memory / LANGUAGE detector.
 * @param {Array<{ role?: string, content?: string }> | null | undefined} messages
 */
export function imageOnlyModelNudgeForMessages(messages) {
  const lang = resolveVisionStickyLang(messages, '')
  return IMAGE_ONLY_NUDGE_BY_LANG[lang] || IMAGE_ONLY_MODEL_NUDGE
}

/**
 * Server/model-only PDF-only nudge — sticky language, never Memory/LANGUAGE evidence.
 * @param {Array<{ role?: string, content?: string }> | null | undefined} messages
 */
export function documentOnlyModelNudgeForMessages(messages) {
  const lang = resolveVisionStickyLang(messages, '')
  return DOCUMENT_ONLY_NUDGE_BY_LANG[lang] || DOCUMENT_ONLY_MODEL_NUDGE
}

/**
 * @param {{ mimeType?: string, dataUrl?: string }} input
 */
export function summarizeImageForLog(input = {}) {
  const dataUrl = typeof input.dataUrl === 'string' ? input.dataUrl : ''
  const comma = dataUrl.indexOf(',')
  const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : ''
  return {
    mimeType: typeof input.mimeType === 'string' ? input.mimeType : 'unknown',
    dataUrlChars: dataUrl.length,
    approxBytes: b64 ? Math.floor((b64.length * 3) / 4) : 0,
    hasDataUrl: Boolean(dataUrl),
  }
}

/**
 * Strip attachment payloads from any value before logging.
 * @param {unknown} value
 */
export function redactAttachmentsForLog(value) {
  if (value == null) return value
  if (typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map((item) => redactAttachmentsForLog(item))
  /** @type {Record<string, unknown>} */
  const out = {}
  for (const [key, v] of Object.entries(value)) {
    if (key === 'dataUrl' || key === 'image_url' || key === 'previewUrl' || key === 'file_data') {
      out[key] = typeof v === 'string' ? `[redacted ${v.length} chars]` : '[redacted]'
      continue
    }
    if (key === 'attachments' && Array.isArray(v)) {
      out.attachments = v.map((att) => {
        if (!att || typeof att !== 'object') return att
        const a = /** @type {Record<string, unknown>} */ (att)
        if (a.type === 'file' || a.kind === 'file') {
          return summarizePdfForLog({
            name: typeof a.name === 'string' ? a.name : typeof a.filename === 'string' ? a.filename : '',
            size: typeof a.size === 'number' ? a.size : 0,
            mimeType: typeof a.mimeType === 'string' ? a.mimeType : '',
            fileId: typeof a.fileId === 'string' ? a.fileId : typeof a.file_id === 'string' ? a.file_id : '',
          })
        }
        return summarizeImageForLog(/** @type {{ mimeType?: string, dataUrl?: string }} */ (att))
      })
      continue
    }
    out[key] = redactAttachmentsForLog(v)
  }
  return out
}

/**
 * @param {unknown} value
 */
function isSupportedMime(value) {
  return typeof value === 'string' && SERVER_SUPPORTED_IMAGE_MIMES.includes(value)
}

/**
 * @param {unknown} value
 */
function isValidImageDataUrl(value) {
  return (
    typeof value === 'string' &&
    /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=\s]+$/i.test(value.trim()) &&
    value.trim().length <= SERVER_MAX_DATA_URL_CHARS
  )
}

/**
 * @param {unknown} raw
 * @returns {{ type: 'image', mimeType: string, dataUrl: string } | null}
 */
export function sanitizeImageAttachment(raw) {
  if (!raw || typeof raw !== 'object') return null
  const att = /** @type {Record<string, unknown>} */ (raw)
  if (att.type !== 'image' && att.kind !== 'image') return null
  const dataUrl = typeof att.dataUrl === 'string' ? att.dataUrl.trim() : ''
  if (!isValidImageDataUrl(dataUrl)) return null
  const mimeMatch = /^data:(image\/(?:jpeg|png|webp));base64,/i.exec(dataUrl)
  if (!mimeMatch) return null
  const mimeType =
    typeof att.mimeType === 'string' && isSupportedMime(att.mimeType)
      ? att.mimeType
      : mimeMatch[1].toLowerCase()
  if (!isSupportedMime(mimeType)) return null
  return { type: 'image', mimeType, dataUrl }
}

/**
 * @param {unknown} raw
 * @returns {{ type: 'file', fileId: string, name: string, mimeType: string, size: number } | null}
 */
export function sanitizeFileAttachment(raw) {
  if (!raw || typeof raw !== 'object') return null
  const att = /** @type {Record<string, unknown>} */ (raw)
  if (att.type !== 'file' && att.kind !== 'file') return null

  const fileIdRaw =
    typeof att.fileId === 'string'
      ? att.fileId
      : typeof att.file_id === 'string'
        ? att.file_id
        : ''
  const fileId = fileIdRaw.trim()
  if (!isSafeOpenAiFileId(fileId)) return null

  const mimeType =
    typeof att.mimeType === 'string' ? att.mimeType.trim().toLowerCase() : 'application/pdf'
  if (mimeType !== 'application/pdf') return null

  const name = sanitizePdfFilename(
    typeof att.name === 'string'
      ? att.name
      : typeof att.filename === 'string'
        ? att.filename
        : 'document.pdf',
  )
  if (!/\.pdf$/i.test(name)) return null

  const size = typeof att.size === 'number' && Number.isFinite(att.size) ? Math.max(0, att.size) : 0
  if (size > 10 * 1024 * 1024) return null

  // Reject any accidental byte payloads from clients.
  if (typeof att.dataUrl === 'string' || typeof att.file_data === 'string' || typeof att.bytes === 'string') {
    return null
  }

  return {
    type: 'file',
    fileId,
    name,
    mimeType: 'application/pdf',
    size,
  }
}

/**
 * @typedef {{
 *   role: 'user' | 'assistant' | 'system'
 *   content: string
 *   attachments?: Array<
 *     | { type: 'image', mimeType: string, dataUrl: string }
 *     | { type: 'file', fileId: string, name: string, mimeType: string, size: number }
 *   >
 * }} SanitizedChatMessage
 */

/**
 * @typedef {{
 *   ok: true
 *   messages: SanitizedChatMessage[]
 * } | {
 *   ok: false
 *   error: string
 *   code: string
 * }} SanitizeMessagesResult
 */

/**
 * Strict multimodal sanitize. Rejects unknown/oversized/unsupported attachments
 * instead of silently dropping them. MVP: max one attachment; image XOR file.
 * @param {unknown} raw
 * @returns {SanitizeMessagesResult}
 */
export function sanitizeMultimodalMessages(raw) {
  if (!Array.isArray(raw)) {
    return {
      ok: false,
      error: 'messages must be an array',
      code: 'invalid_messages',
    }
  }

  /** @type {SanitizedChatMessage[]} */
  const out = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const msg = /** @type {Record<string, unknown>} */ (item)
    const role = msg.role
    if (role !== 'user' && role !== 'assistant' && role !== 'system') {
      return {
        ok: false,
        error: 'Messaggio non valido: ruolo sconosciuto.',
        code: 'invalid_role',
      }
    }
    if (typeof msg.content !== 'string') {
      return {
        ok: false,
        error: 'Messaggio non valido: content deve essere una stringa.',
        code: 'invalid_content',
      }
    }
    const content = msg.content.trim()

    if (role === 'assistant' || role === 'system') {
      if (msg.attachments != null) {
        return {
          ok: false,
          error: 'Solo i messaggi utente possono includere allegati.',
          code: 'image_role_forbidden',
        }
      }
      if (!content) continue
      out.push({ role, content })
      continue
    }

    // user
    /** @type {NonNullable<SanitizedChatMessage['attachments']>} */
    const attachments = []
    if (msg.attachments != null) {
      if (!Array.isArray(msg.attachments)) {
        return {
          ok: false,
          error: 'Allegato non valido.',
          code: 'invalid_attachments',
        }
      }
      if (msg.attachments.length > SERVER_MAX_ATTACHMENTS_PER_MESSAGE) {
        return {
          ok: false,
          error: 'Puoi allegare un solo file o immagine per messaggio.',
          code: 'too_many_images',
        }
      }
      let sawImage = false
      let sawFile = false
      for (const rawAtt of msg.attachments) {
        if (!rawAtt || typeof rawAtt !== 'object') {
          return {
            ok: false,
            error: 'Allegato non valido.',
            code: 'invalid_attachment',
          }
        }
        const att = /** @type {Record<string, unknown>} */ (rawAtt)
        const isImage = att.type === 'image' || att.kind === 'image'
        const isFile = att.type === 'file' || att.kind === 'file'
        if (!isImage && !isFile) {
          return {
            ok: false,
            error: 'Tipo di allegato non supportato.',
            code: 'unsupported_attachment_type',
          }
        }
        if (isImage && isFile) {
          return {
            ok: false,
            error: 'Tipo di allegato non supportato.',
            code: 'unsupported_attachment_type',
          }
        }
        if (isImage) {
          if (sawFile) {
            return {
              ok: false,
              error: 'Non puoi allegare immagine e PDF insieme.',
              code: 'mixed_attachments',
            }
          }
          sawImage = true
          const cleaned = sanitizeImageAttachment(rawAtt)
          if (!cleaned) {
            const dataUrl = typeof att.dataUrl === 'string' ? att.dataUrl : ''
            const mime = typeof att.mimeType === 'string' ? att.mimeType : ''
            if (dataUrl.length > SERVER_MAX_DATA_URL_CHARS) {
              return {
                ok: false,
                error: 'Immagine troppo grande dopo la compressione.',
                code: 'image_too_large',
              }
            }
            if (mime && !isSupportedMime(mime)) {
              return {
                ok: false,
                error: 'Formato immagine non supportato. Usa JPEG, PNG o WebP.',
                code: 'unsupported_mime',
              }
            }
            return {
              ok: false,
              error: 'Immagine non valida o corrotta.',
              code: 'invalid_image',
            }
          }
          attachments.push(cleaned)
          continue
        }

        // file / PDF
        if (sawImage) {
          return {
            ok: false,
            error: 'Non puoi allegare immagine e PDF insieme.',
            code: 'mixed_attachments',
          }
        }
        sawFile = true
        const cleanedFile = sanitizeFileAttachment(rawAtt)
        if (!cleanedFile) {
          return {
            ok: false,
            error: 'Allegato PDF non valido.',
            code: 'invalid_file',
          }
        }
        attachments.push(cleanedFile)
      }
    }

    if (!content && attachments.length === 0) continue
    out.push({
      role: 'user',
      content,
      ...(attachments.length ? { attachments } : {}),
    })
  }

  return { ok: true, messages: out.slice(-40) }
}

/**
 * Visible caption for Memory / LANGUAGE / Forget — never image/PDF bytes or model nudge.
 * @param {SanitizedChatMessage | null | undefined} msg
 */
export function visibleUserText(msg) {
  if (!msg || msg.role !== 'user') return ''
  return typeof msg.content === 'string' ? msg.content.trim() : ''
}

/**
 * @param {SanitizedChatMessage} msg
 */
function isImageAttachmentMsg(msg) {
  return Boolean(msg.attachments?.some((a) => a.type === 'image'))
}

/**
 * @param {SanitizedChatMessage} msg
 */
function isFileAttachmentMsg(msg) {
  return Boolean(msg.attachments?.some((a) => a.type === 'file'))
}

/**
 * Keep multimodal form for recent image / file turns separately.
 * @param {SanitizedChatMessage[]} messages
 * @param {{ maxImageTurns?: number, maxFileTurns?: number }} [limits]
 * @returns {SanitizedChatMessage[]}
 */
export function applyRecentAttachmentHistoryLimit(
  messages,
  limits = {},
) {
  const maxImageTurns = limits.maxImageTurns ?? SERVER_MAX_RECENT_IMAGE_TURNS
  const maxFileTurns = limits.maxFileTurns ?? SERVER_MAX_RECENT_FILE_TURNS
  let remainingImages = maxImageTurns
  let remainingFiles = maxFileTurns
  const reversed = [...messages].reverse().map((msg) => {
    if (msg.role !== 'user' || !msg.attachments?.length) return msg
    if (isImageAttachmentMsg(msg)) {
      if (remainingImages > 0) {
        remainingImages -= 1
        return msg
      }
      return { role: /** @type {'user'} */ ('user'), content: msg.content }
    }
    if (isFileAttachmentMsg(msg)) {
      if (remainingFiles > 0) {
        remainingFiles -= 1
        return msg
      }
      return { role: /** @type {'user'} */ ('user'), content: msg.content }
    }
    return { role: /** @type {'user'} */ ('user'), content: msg.content }
  })
  return reversed.reverse()
}

/**
 * @deprecated use applyRecentAttachmentHistoryLimit
 * @param {SanitizedChatMessage[]} messages
 * @param {number} [maxImageTurns]
 */
export function applyRecentImageHistoryLimit(
  messages,
  maxImageTurns = SERVER_MAX_RECENT_IMAGE_TURNS,
) {
  return applyRecentAttachmentHistoryLimit(messages, { maxImageTurns })
}

/**
 * Map sanitized LAIfe messages → Responses API input items.
 * Image-only / PDF-only add a server/model-only sticky-language nudge.
 * @param {SanitizedChatMessage[]} messages
 */
export function mapMessagesToResponsesInput(messages) {
  const limited = applyRecentAttachmentHistoryLimit(messages)
  const imageOnlyNudge = imageOnlyModelNudgeForMessages(limited)
  const documentOnlyNudge = documentOnlyModelNudgeForMessages(limited)
  return limited.map((msg) => {
    if (msg.role !== 'user' || !msg.attachments?.length) {
      return {
        type: 'message',
        role: msg.role,
        content: msg.content,
      }
    }

    /** @type {Array<Record<string, unknown>>} */
    const parts = []
    const caption = msg.content.trim()
    const hasFile = isFileAttachmentMsg(msg)
    if (caption) {
      parts.push({ type: 'input_text', text: caption })
    } else {
      parts.push({
        type: 'input_text',
        text: hasFile ? documentOnlyNudge : imageOnlyNudge,
      })
    }
    for (const att of msg.attachments) {
      if (att.type === 'image') {
        parts.push({
          type: 'input_image',
          detail: 'high',
          image_url: att.dataUrl,
        })
      } else if (att.type === 'file') {
        // Responses API: file_id is mutually exclusive with filename/file_data/file_url.
        // Keep filename only in LAIfe UI/metadata — never alongside file_id here.
        parts.push({
          type: 'input_file',
          file_id: att.fileId,
          detail: 'low',
        })
      }
    }
    return {
      type: 'message',
      role: 'user',
      content: parts,
    }
  })
}

/**
 * Models known to accept image inputs on Responses API.
 * @param {string} model
 */
export function modelSupportsImageInput(model) {
  const id = String(model || '')
    .trim()
    .toLowerCase()
  if (!id) return false
  if (/^gpt-4o\b/.test(id)) return true
  if (/^gpt-4\.1\b/.test(id)) return true
  if (/^gpt-5(\b|\.|-)/.test(id)) return true
  if (/^o[0-9]/.test(id)) return true
  if (/^computer-use/.test(id)) return true
  return false
}

/**
 * PDF input_file requires vision-capable models for page images (GPT-4o+ / GPT-5.x).
 * Same allowlist as images for MVP.
 * @param {string} model
 */
export function modelSupportsFileInput(model) {
  return modelSupportsImageInput(model)
}
