/**
 * Server-side multimodal image sanitization + Responses API mapping (#272).
 * Keep Memory / LANGUAGE on visible caption text only.
 */

import { resolveVisionStickyLang } from './vision-task-shortcuts.js'

export const SERVER_SUPPORTED_IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp']
export const SERVER_MAX_IMAGES_PER_MESSAGE = 1
export const SERVER_MAX_DATA_URL_CHARS = Math.floor(1.5 * 1024 * 1024)
export const SERVER_MAX_RECENT_IMAGE_TURNS = 2

export const IMAGE_ONLY_MODEL_NUDGE =
  'Analyze the attached image and respond helpfully.'

/** @type {Record<string, string>} */
const IMAGE_ONLY_NUDGE_BY_LANG = {
  it: "Analizza l'immagine allegata e rispondi in modo utile.",
  en: IMAGE_ONLY_MODEL_NUDGE,
  es: 'Analiza la imagen adjunta y responde de forma útil.',
  fr: "Analyse l'image jointe et réponds de façon utile.",
  de: 'Analysiere das angehängte Bild und antworte hilfreich.',
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
    if (key === 'dataUrl' || key === 'image_url' || key === 'previewUrl') {
      out[key] = typeof v === 'string' ? `[redacted ${v.length} chars]` : '[redacted]'
      continue
    }
    if (key === 'attachments' && Array.isArray(v)) {
      out.attachments = v.map((att) =>
        att && typeof att === 'object'
          ? summarizeImageForLog(/** @type {{ mimeType?: string, dataUrl?: string }} */ (att))
          : att,
      )
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
 * @typedef {{
 *   role: 'user' | 'assistant' | 'system'
 *   content: string
 *   attachments?: Array<{ type: 'image', mimeType: string, dataUrl: string }>
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
 * instead of silently dropping them.
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
          error: 'Solo i messaggi utente possono includere immagini.',
          code: 'image_role_forbidden',
        }
      }
      if (!content) continue
      out.push({ role, content })
      continue
    }

    // user
    /** @type {Array<{ type: 'image', mimeType: string, dataUrl: string }>} */
    const attachments = []
    if (msg.attachments != null) {
      if (!Array.isArray(msg.attachments)) {
        return {
          ok: false,
          error: 'Allegato non valido.',
          code: 'invalid_attachments',
        }
      }
      if (msg.attachments.length > SERVER_MAX_IMAGES_PER_MESSAGE) {
        return {
          ok: false,
          error: 'Puoi allegare una sola immagine per messaggio.',
          code: 'too_many_images',
        }
      }
      for (const rawAtt of msg.attachments) {
        if (!rawAtt || typeof rawAtt !== 'object') {
          return {
            ok: false,
            error: 'Allegato immagine non valido.',
            code: 'invalid_attachment',
          }
        }
        const att = /** @type {Record<string, unknown>} */ (rawAtt)
        if (att.type !== 'image' && att.kind !== 'image') {
          return {
            ok: false,
            error: 'Tipo di allegato non supportato.',
            code: 'unsupported_attachment_type',
          }
        }
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
 * Visible caption for Memory / LANGUAGE / Forget — never image bytes or model nudge.
 * @param {SanitizedChatMessage | null | undefined} msg
 */
export function visibleUserText(msg) {
  if (!msg || msg.role !== 'user') return ''
  return typeof msg.content === 'string' ? msg.content.trim() : ''
}

/**
 * Keep multimodal form for the most recent N image-bearing user turns only.
 * @param {SanitizedChatMessage[]} messages
 * @param {number} [maxImageTurns]
 * @returns {SanitizedChatMessage[]}
 */
export function applyRecentImageHistoryLimit(
  messages,
  maxImageTurns = SERVER_MAX_RECENT_IMAGE_TURNS,
) {
  let remaining = maxImageTurns
  const reversed = [...messages].reverse().map((msg) => {
    if (msg.role !== 'user' || !msg.attachments?.length) return msg
    if (remaining > 0) {
      remaining -= 1
      return msg
    }
    // Degrade to caption-only
    return { role: /** @type {'user'} */ ('user'), content: msg.content }
  })
  return reversed.reverse()
}

/**
 * Map sanitized LAIfe messages → Responses API input items.
 * Image-only adds a server/model-only nudge that is NOT stored as user content.
 * @param {SanitizedChatMessage[]} messages
 */
export function mapMessagesToResponsesInput(messages) {
  const limited = applyRecentImageHistoryLimit(messages)
  const imageOnlyNudge = imageOnlyModelNudgeForMessages(limited)
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
    if (caption) {
      parts.push({ type: 'input_text', text: caption })
    } else {
      parts.push({ type: 'input_text', text: imageOnlyNudge })
    }
    for (const att of msg.attachments) {
      parts.push({
        type: 'input_image',
        detail: 'high',
        image_url: att.dataUrl,
      })
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
 * Conservative allowlist — unknown models reject images with a clear error.
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
