/**
 * #289 Image generation + conversational editing via Responses API
 * hosted `image_generation` tool (specialized GPT Image — not a second brain).
 *
 * Verified on production model gpt-5.6-sol with reasoning.effort none.
 * Session-scoped artifacts only — no Storage / DB migration.
 */

import { isGpt56FamilyModel } from './core-responses-params.js'
import { SERVER_SUPPORTED_IMAGE_MIMES } from './chat-image-input.js'

/** MVP: one generated/edited image per assistant turn. */
export const MAX_GENERATED_IMAGES_PER_TURN = 1

/** Conservative MVP defaults — size auto; quality low for latency/cost. */
export const IMAGE_GENERATION_TOOL_DEFAULTS = Object.freeze({
  type: 'image_generation',
  quality: 'low',
  size: 'auto',
  output_format: 'png',
  // action defaults to auto (generate vs edit) — model chooses from intent.
})

/**
 * Models verified / expected to accept the hosted image_generation tool
 * without abandoning reasoning.none on GPT-5.6.
 * @param {string} model
 */
export function modelSupportsImageGenerationTool(model) {
  const id = String(model || '')
    .trim()
    .toLowerCase()
  if (!id) return false
  // Live-probed: gpt-5.6-sol. Broader 5.6 family shares the same Responses path.
  if (isGpt56FamilyModel(id)) return true
  return false
}

/**
 * Tool list for Core responses.create — empty when unsupported (no silent model switch).
 * @param {string} model
 * @returns {Array<Record<string, unknown>>}
 */
export function buildImageGenerationTools(model) {
  if (!modelSupportsImageGenerationTool(model)) return []
  return [{ ...IMAGE_GENERATION_TOOL_DEFAULTS }]
}

/**
 * Ephemeral guidance for when the tool is attached.
 * LANGUAGE isolation: revised_prompt / provider metadata are NEVER reply-language evidence.
 * @returns {string}
 */
export function buildImageGenerationAppendix() {
  return [
    'IMAGE GENERATION / EDITING (hosted tool — specialized capability, not a second conversational brain):',
    '- Use the image_generation tool only when the user clearly wants a new image or an edit of an available image.',
    '- Do NOT generate when the user only asks to describe, explain, brainstorm, or discuss how an image would look (e.g. "Descrivimi…", "Come creeresti…", "Cosa vedi?").',
    '- Prefer at most one image_generation call per turn. No batches.',
    '- For edits ("rendila più scura", "togli il testo", "fallo quadrato"), edit the latest grounded source image when clear; if multiple candidates are ambiguous ("questa"/"quella" without antecedent), ask a concise clarification instead of guessing.',
    '- If no source image is available for an edit request, say so briefly — do not invent an edit.',
    '- Optional short caption text is fine alongside a generated/edited image.',
    '- Never claim you created or edited an image unless the image_generation tool actually produced a result in this turn.',
    '- Provider safety refusals: respond with normal conversational refusal text; never fabricate an image.',
    '- LANGUAGE: reply language follows the conversation (LANGUAGE appendix). English revised_prompt / tool metadata / internal provider fields are NOT language evidence and must never switch the reply language.',
    '- Memory: transient edit instructions are not durable preferences by themselves. Never treat image bytes, base64, or provider call IDs as Memory facts.',
  ].join('\n')
}

/**
 * @param {unknown} value
 * @returns {value is 'generated' | 'edited'}
 */
export function isImageGenerationSource(value) {
  return value === 'generated' || value === 'edited'
}

/**
 * Infer mime from tool output_format / data sniff; default png.
 * @param {unknown} format
 * @param {string} [b64]
 */
export function mimeTypeForGeneratedImage(format, b64 = '') {
  const f = String(format || '')
    .trim()
    .toLowerCase()
  if (f === 'jpeg' || f === 'jpg') return 'image/jpeg'
  if (f === 'webp') return 'image/webp'
  if (f === 'png') return 'image/png'
  // Sniff common prefixes when format omitted.
  if (typeof b64 === 'string' && b64.startsWith('/9j/')) return 'image/jpeg'
  if (typeof b64 === 'string' && b64.startsWith('UklGR')) return 'image/webp'
  return 'image/png'
}

/**
 * @param {string} mimeType
 * @param {string} b64
 */
export function buildGeneratedDataUrl(mimeType, b64) {
  const mime = SERVER_SUPPORTED_IMAGE_MIMES.includes(mimeType) ? mimeType : 'image/png'
  const cleaned = String(b64 || '').replace(/\s+/g, '')
  return `data:${mime};base64,${cleaned}`
}

/**
 * @typedef {{
 *   id: string
 *   mimeType: string
 *   dataUrl: string
 *   source: 'generated' | 'edited'
 *   providerCallId?: string
 *   width?: number
 *   height?: number
 * }} GeneratedChatImage
 */

/**
 * Parse Responses API output for image_generation_call items.
 * Returns at most MAX_GENERATED_IMAGES_PER_TURN successful images.
 * Does not invent success when result bytes are missing.
 *
 * @param {unknown} response
 * @returns {{
 *   images: GeneratedChatImage[]
 *   safetyRefused: boolean
 *   technicalFailure: boolean
 *   failureDetail?: string
 * }}
 */
export function parseImageGenerationCalls(response) {
  /** @type {GeneratedChatImage[]} */
  const images = []
  let safetyRefused = false
  let technicalFailure = false
  /** @type {string | undefined} */
  let failureDetail

  const output = response && typeof response === 'object' ? /** @type {{ output?: unknown }} */ (response).output : null
  if (!Array.isArray(output)) {
    return { images, safetyRefused, technicalFailure }
  }

  for (const item of output) {
    if (!item || typeof item !== 'object') continue
    const call = /** @type {Record<string, unknown>} */ (item)
    if (call.type !== 'image_generation_call') continue

    const status = typeof call.status === 'string' ? call.status.toLowerCase() : ''
    const callId = typeof call.id === 'string' ? call.id : undefined
    const action =
      typeof call.action === 'string'
        ? call.action.toLowerCase()
        : typeof call.output_format === 'string'
          ? ''
          : ''

    // Incomplete / refused / failed calls — no fake image.
    if (status && status !== 'completed' && status !== 'succeeded') {
      const errText = typeof call.error === 'string' ? call.error : ''
      const combined = `${status} ${errText}`.toLowerCase()
      if (/safety|moderation|policy|refuse|blocked|content_filter/.test(combined)) {
        safetyRefused = true
      } else {
        technicalFailure = true
      }
      if (errText) failureDetail = errText.slice(0, 180)
      continue
    }

    const rawResult =
      typeof call.result === 'string'
        ? call.result
        : typeof call.b64_json === 'string'
          ? call.b64_json
          : ''
    const b64 = rawResult.replace(/\s+/g, '')
    if (!b64 || b64.length < 32) {
      technicalFailure = true
      failureDetail = failureDetail || 'empty_image_result'
      continue
    }
    // Basic base64 sanity — reject obvious garbage.
    if (!/^[A-Za-z0-9+/]+=*$/.test(b64.slice(0, 64)) && !/^[A-Za-z0-9+/]+/.test(b64)) {
      technicalFailure = true
      failureDetail = failureDetail || 'malformed_base64'
      continue
    }

    const mimeType = mimeTypeForGeneratedImage(call.output_format, b64)
    const dataUrl = buildGeneratedDataUrl(mimeType, b64)
    // Prefer explicit action when present; default to generated.
    const resolvedSource = action === 'edit' ? 'edited' : 'generated'

    /** @type {GeneratedChatImage} */
    const image = {
      id: callId || `img-gen-${images.length + 1}`,
      mimeType,
      dataUrl,
      source: resolvedSource,
    }
    if (callId) image.providerCallId = callId

    images.push(image)
    if (images.length >= MAX_GENERATED_IMAGES_PER_TURN) break
  }

  return {
    images: images.slice(0, MAX_GENERATED_IMAGES_PER_TURN),
    safetyRefused,
    technicalFailure,
    ...(failureDetail ? { failureDetail } : {}),
  }
}

/**
 * Wire-safe images[] for /api/chat success payload (no revised_prompt).
 * @param {GeneratedChatImage[]} images
 */
export function toChatApiImages(images) {
  return images.map((img) => {
    /** @type {Record<string, unknown>} */
    const out = {
      id: img.id,
      mimeType: img.mimeType,
      dataUrl: img.dataUrl,
      source: img.source,
    }
    if (img.providerCallId) out.providerCallId = img.providerCallId
    if (typeof img.width === 'number') out.width = img.width
    if (typeof img.height === 'number') out.height = img.height
    return out
  })
}

/**
 * Detect false "I created an image" claims when no payload exists.
 * @param {string} content
 * @param {number} imageCount
 */
export function contentClaimsImageWithoutPayload(content, imageCount) {
  if (imageCount > 0) return false
  const t = String(content || '').trim()
  if (!t) return false
  return (
    /\b(ho creato|ho generato|here's (the|your) image|i('ve| have) (created|generated|made) (an |the |your )?image)\b/i.test(
      t,
    ) || /\b(immagine (è stata )?generata|image (has been |was )?generated)\b/i.test(t)
  )
}
