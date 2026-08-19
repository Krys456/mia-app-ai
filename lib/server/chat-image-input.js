/**
 * Server-side multimodal sanitization + Responses API mapping (#272 + #275 + #276).
 * Images: dataUrl. Documents (PDF/TXT/DOCX): OpenAI file_id only.
 * Memory / LANGUAGE use caption text only.
 */

import { resolveVisionStickyLang } from './vision-task-shortcuts.js'
import {
  SERVER_DOCX_MIME,
  SERVER_MAX_DOCX_BYTES,
  SERVER_MAX_PDF_BYTES,
  SERVER_MAX_RECENT_FILE_TURNS,
  SERVER_MAX_TXT_BYTES,
  SERVER_PDF_MIME,
  SERVER_SUPPORTED_DOCUMENT_MIMES,
  SERVER_TXT_MIME,
  isSafeOpenAiFileId,
  sanitizeDocumentFilename,
  summarizePdfForLog,
} from './chat-pdf-files.js'
import { selectCoreConversationHistory } from './core-history-select.js'
import {
  SERVER_MAX_GENERATED_DATA_URL_CHARS,
  resolveImageArtifactSecret,
  verifyImageArtifact,
} from './image-artifact-proof.js'

export {
  MAX_HISTORY_MESSAGES,
  MAX_HISTORY_TEXT_CHARS,
  historyVisibleTextChars,
  selectCoreConversationHistory,
} from './core-history-select.js'

const SUPPORTED_DOCUMENT_MIME_SET = new Set(SERVER_SUPPORTED_DOCUMENT_MIMES)

export const SERVER_SUPPORTED_IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp']
export const SERVER_MAX_IMAGES_PER_MESSAGE = 1
export const SERVER_MAX_ATTACHMENTS_PER_MESSAGE = 1
export const SERVER_MAX_DATA_URL_CHARS = Math.floor(1.5 * 1024 * 1024)
export { SERVER_MAX_GENERATED_DATA_URL_CHARS }
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
 * @param {string | null | undefined} [browserLocale]
 */
export function imageOnlyModelNudgeForMessages(messages, browserLocale) {
  const lang = resolveVisionStickyLang(messages, browserLocale || '')
  return IMAGE_ONLY_NUDGE_BY_LANG[lang] || IMAGE_ONLY_NUDGE_BY_LANG.it
}

/**
 * Server/model-only PDF-only nudge — sticky language, never Memory/LANGUAGE evidence.
 * @param {Array<{ role?: string, content?: string }> | null | undefined} messages
 * @param {string | null | undefined} [browserLocale]
 */
export function documentOnlyModelNudgeForMessages(messages, browserLocale) {
  const lang = resolveVisionStickyLang(messages, browserLocale || '')
  return DOCUMENT_ONLY_NUDGE_BY_LANG[lang] || DOCUMENT_ONLY_NUDGE_BY_LANG.it
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
 * @param {number} [maxChars]
 */
function isValidImageDataUrl(value, maxChars = SERVER_MAX_DATA_URL_CHARS) {
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  // Length first — avoid catastrophic regex work on multi-MB payloads.
  if (!trimmed || trimmed.length > maxChars) return false
  return /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=\s]+$/i.test(trimmed)
}

/**
 * @param {unknown} raw
 * @param {{
 *   requireGeneratedSource?: boolean
 *   requireArtifactProof?: boolean
 *   maxDataUrlChars?: number
 *   artifactSecret?: string
 * }} [opts]
 * @returns {{
 *   type: 'image'
 *   mimeType: string
 *   dataUrl: string
 *   source?: 'generated' | 'edited' | 'uploaded'
 *   id?: string
 *   artifactProof?: string
 * } | null}
 */
export function sanitizeImageAttachment(raw, opts = {}) {
  if (!raw || typeof raw !== 'object') return null
  const att = /** @type {Record<string, unknown>} */ (raw)
  if (att.type !== 'image' && att.kind !== 'image') return null
  const dataUrl = typeof att.dataUrl === 'string' ? att.dataUrl.trim() : ''
  const maxChars = opts.maxDataUrlChars ?? SERVER_MAX_DATA_URL_CHARS
  if (!isValidImageDataUrl(dataUrl, maxChars)) return null
  const mimeMatch = /^data:(image\/(?:jpeg|png|webp));base64,/i.exec(dataUrl)
  if (!mimeMatch) return null
  const mimeType =
    typeof att.mimeType === 'string' && isSupportedMime(att.mimeType)
      ? att.mimeType
      : mimeMatch[1].toLowerCase()
  if (!isSupportedMime(mimeType)) return null

  const sourceRaw = typeof att.source === 'string' ? att.source.trim().toLowerCase() : ''
  /** @type {'generated' | 'edited' | 'uploaded' | undefined} */
  let source
  if (sourceRaw === 'generated' || sourceRaw === 'edited' || sourceRaw === 'uploaded') {
    source = sourceRaw
  }

  const id = typeof att.id === 'string' && att.id.trim() ? att.id.trim().slice(0, 120) : undefined
  const artifactProof =
    typeof att.artifactProof === 'string' && att.artifactProof.trim()
      ? att.artifactProof.trim().slice(0, 128)
      : undefined

  // Assistant history replay: require a server-issued HMAC proof.
  // `source` alone is client-spoofable and is NOT a trust boundary.
  if (opts.requireArtifactProof) {
    if (source !== 'generated' && source !== 'edited') return null
    if (!id || !artifactProof) return null
    const secret = opts.artifactSecret || resolveImageArtifactSecret()
    if (
      !verifyImageArtifact(
        { id, source, dataUrl, artifactProof },
        secret,
      )
    ) {
      return null
    }
  } else if (opts.requireGeneratedSource) {
    // Legacy path — prefer requireArtifactProof for assistant replay.
    if (source !== 'generated' && source !== 'edited') return null
  }

  /** @type {{
   *   type: 'image'
   *   mimeType: string
   *   dataUrl: string
   *   source?: 'generated' | 'edited' | 'uploaded'
   *   id?: string
   *   artifactProof?: string
   * }} */
  const out = { type: 'image', mimeType, dataUrl }
  if (source) out.source = source
  if (id) out.id = id
  if (artifactProof) out.artifactProof = artifactProof
  return out
}

/**
 * Sanitize image attachments on an assistant message (session replay of
 * server-sealed generated/edited images only).
 * @param {unknown} rawList
 * @param {{ artifactSecret?: string }} [opts]
 * @returns {{
 *   ok: true
 *   attachments: NonNullable<SanitizedChatMessage['attachments']>
 * } | {
 *   ok: false
 *   error: string
 *   code: string
 * }}
 */
export function sanitizeAssistantImageAttachments(rawList, opts = {}) {
  if (rawList == null) {
    return { ok: true, attachments: [] }
  }
  if (!Array.isArray(rawList)) {
    return {
      ok: false,
      error: 'Allegato non valido.',
      code: 'invalid_attachments',
    }
  }
  if (rawList.length > SERVER_MAX_ATTACHMENTS_PER_MESSAGE) {
    return {
      ok: false,
      error: 'Puoi allegare un solo file o immagine per messaggio.',
      code: 'too_many_images',
    }
  }
  /** @type {NonNullable<SanitizedChatMessage['attachments']>} */
  const attachments = []
  for (const rawAtt of rawList) {
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
    if (!isImage || isFile) {
      // Assistant messages may only carry sealed generated/edited images — never PDFs.
      return {
        ok: false,
        error: 'Solo i messaggi utente possono includere allegati arbitrari.',
        code: 'image_role_forbidden',
      }
    }

    const dataUrl = typeof att.dataUrl === 'string' ? att.dataUrl.trim() : ''
    if (dataUrl.length > SERVER_MAX_GENERATED_DATA_URL_CHARS) {
      return {
        ok: false,
        error: 'Immagine generata troppo grande per la cronologia di sessione.',
        code: 'assistant_image_too_large',
      }
    }

    const cleaned = sanitizeImageAttachment(rawAtt, {
      requireArtifactProof: true,
      maxDataUrlChars: SERVER_MAX_GENERATED_DATA_URL_CHARS,
      artifactSecret: opts.artifactSecret,
    })
    if (!cleaned) {
      return {
        ok: false,
        error: 'Allegato assistente non valido o non autorizzato.',
        code: 'assistant_image_forbidden',
      }
    }
    attachments.push(cleaned)
  }
  return { ok: true, attachments }
}

/**
 * @param {string} mimeType
 * @returns {'.pdf'|'.txt'|'.docx'}
 */
function fallbackExtForMime(mimeType) {
  if (mimeType === SERVER_TXT_MIME) return '.txt'
  if (mimeType === SERVER_DOCX_MIME) return '.docx'
  return '.pdf'
}

/**
 * @param {string} mimeType
 */
function maxBytesForMime(mimeType) {
  if (mimeType === SERVER_TXT_MIME) return SERVER_MAX_TXT_BYTES
  if (mimeType === SERVER_DOCX_MIME) return SERVER_MAX_DOCX_BYTES
  return SERVER_MAX_PDF_BYTES
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
    typeof att.mimeType === 'string' ? att.mimeType.trim().toLowerCase() : SERVER_PDF_MIME
  if (!SUPPORTED_DOCUMENT_MIME_SET.has(mimeType)) return null

  const fallbackExt = fallbackExtForMime(mimeType)
  const name = sanitizeDocumentFilename(
    typeof att.name === 'string'
      ? att.name
      : typeof att.filename === 'string'
        ? att.filename
        : `document${fallbackExt}`,
    fallbackExt,
  )
  if (mimeType === SERVER_PDF_MIME && !/\.pdf$/i.test(name)) return null
  if (mimeType === SERVER_TXT_MIME && !/\.txt$/i.test(name)) return null
  if (mimeType === SERVER_DOCX_MIME && !/\.docx$/i.test(name)) return null

  const size = typeof att.size === 'number' && Number.isFinite(att.size) ? Math.max(0, att.size) : 0
  if (size <= 0 || size > maxBytesForMime(mimeType)) return null

  // Reject any accidental byte payloads from clients.
  if (typeof att.dataUrl === 'string' || typeof att.file_data === 'string' || typeof att.bytes === 'string') {
    return null
  }

  return {
    type: 'file',
    fileId,
    name,
    mimeType,
    size,
  }
}

/**
 * @typedef {{
 *   role: 'user' | 'assistant' | 'system'
 *   content: string
 *   attachments?: Array<
 *     | {
 *         type: 'image'
 *         mimeType: string
 *         dataUrl: string
 *         source?: 'generated' | 'edited' | 'uploaded'
 *         id?: string
 *         artifactProof?: string
 *       }
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

    if (role === 'system') {
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

    if (role === 'assistant') {
      // #289: allow session replay of server-generated/edited images only.
      if (msg.attachments != null) {
        const asstAtts = sanitizeAssistantImageAttachments(msg.attachments)
        if (!asstAtts.ok) {
          return {
            ok: false,
            error: asstAtts.error,
            code: asstAtts.code,
          }
        }
        if (!content && asstAtts.attachments.length === 0) continue
        out.push({
          role: 'assistant',
          content,
          ...(asstAtts.attachments.length ? { attachments: asstAtts.attachments } : {}),
        })
        continue
      }
      if (!content) continue
      out.push({ role: 'assistant', content })
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

  return { ok: true, messages: selectCoreConversationHistory(out) }
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
 * Image turns include user uploads AND assistant generated/edited images (#289)
 * so conversational edits stay grounded without serializing the full history.
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
    if (!msg.attachments?.length) return msg

    if (isImageAttachmentMsg(msg)) {
      if (remainingImages > 0) {
        remainingImages -= 1
        return msg
      }
      // Strip image bytes; keep text (assistant may be image-only → empty content ok).
      if (msg.role === 'assistant') {
        return { role: /** @type {'assistant'} */ ('assistant'), content: msg.content }
      }
      if (msg.role === 'user') {
        return { role: /** @type {'user'} */ ('user'), content: msg.content }
      }
      return msg
    }

    if (msg.role === 'user' && isFileAttachmentMsg(msg)) {
      if (remainingFiles > 0) {
        remainingFiles -= 1
        return msg
      }
      return { role: /** @type {'user'} */ ('user'), content: msg.content }
    }

    // Unknown attachment kinds — drop payload.
    if (msg.role === 'user') {
      return { role: /** @type {'user'} */ ('user'), content: msg.content }
    }
    if (msg.role === 'assistant') {
      return { role: /** @type {'assistant'} */ ('assistant'), content: msg.content }
    }
    return msg
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
 * Collect prior image payloads (newest-first scan, oldest-first return)
 * for edit / reference context on a text-only user turn.
 * @param {SanitizedChatMessage[]} messages
 * @param {number} beforeIndex
 * @param {number} [max]
 */
export function collectPriorImagesForEditContext(messages, beforeIndex, max = SERVER_MAX_RECENT_IMAGE_TURNS) {
  /** @type {Array<{ type: 'image', mimeType: string, dataUrl: string }>} */
  const found = []
  for (let i = beforeIndex - 1; i >= 0 && found.length < max; i -= 1) {
    const msg = messages[i]
    const atts = msg?.attachments
    if (!atts?.length) continue
    for (let j = atts.length - 1; j >= 0 && found.length < max; j -= 1) {
      const att = atts[j]
      if (att && att.type === 'image' && att.dataUrl) {
        found.push({ type: 'image', mimeType: att.mimeType, dataUrl: att.dataUrl })
      }
    }
  }
  return found.reverse()
}

/**
 * Map sanitized LAIfe messages → Responses API input items.
 * Image-only / PDF-only add a server/model-only sticky-language nudge.
 * Assistant generated images are re-injected as input_image on later user
 * turns (when that turn has no own image) so edits stay grounded (#289).
 * @param {SanitizedChatMessage[]} messages
 * @param {{ browserLocale?: string | null }} [opts]
 */
export function mapMessagesToResponsesInput(messages, opts = {}) {
  const limited = applyRecentAttachmentHistoryLimit(messages)
  const locale = typeof opts.browserLocale === 'string' ? opts.browserLocale : ''
  const imageOnlyNudge = imageOnlyModelNudgeForMessages(limited, locale)
  const documentOnlyNudge = documentOnlyModelNudgeForMessages(limited, locale)
  return limited.map((msg, idx) => {
    if (msg.role === 'assistant') {
      // Responses input: assistant messages are text; images are carried onto later user turns.
      return {
        type: 'message',
        role: 'assistant',
        content: msg.content || '',
      }
    }

    if (msg.role !== 'user' || !msg.attachments?.length) {
      // Text-only user (or system): may still need prior images for edit/reference on last turns.
      if (msg.role === 'user') {
        const prior = collectPriorImagesForEditContext(limited, idx)
        if (prior.length) {
          /** @type {Array<Record<string, unknown>>} */
          const parts = []
          const caption = msg.content.trim()
          parts.push({
            type: 'input_text',
            text: caption || imageOnlyNudge,
          })
          for (const img of prior) {
            parts.push({
              type: 'input_image',
              detail: 'high',
              image_url: img.dataUrl,
            })
          }
          return {
            type: 'message',
            role: 'user',
            content: parts,
          }
        }
      }
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
    const hasOwnImage = isImageAttachmentMsg(msg)
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
        // PDF keeps detail:'low'; TXT/DOCX omit detail.
        if (att.mimeType === SERVER_PDF_MIME) {
          parts.push({
            type: 'input_file',
            file_id: att.fileId,
            detail: 'low',
          })
        } else {
          parts.push({
            type: 'input_file',
            file_id: att.fileId,
          })
        }
      }
    }
    // When the user already attached an image, do not also dump prior images
    // (preserves analysis/edit focus on the uploaded source).
    if (!hasOwnImage && !hasFile) {
      const prior = collectPriorImagesForEditContext(limited, idx)
      for (const img of prior) {
        parts.push({
          type: 'input_image',
          detail: 'high',
          image_url: img.dataUrl,
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
