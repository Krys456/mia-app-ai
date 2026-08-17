/**
 * #292 Voice Mode — derive readable plain speech from assistant text.
 * Deterministic cleanup only. Never rewrites meaning via another model.
 */

export const TTS_MAX_INPUT_CHARS = 1200
export const TTS_MAX_OUTPUT_CHARS = 1400

/**
 * Strip presentation artifacts that should not be spoken aloud.
 * @param {unknown} raw
 * @param {{ maxChars?: number }} [opts]
 * @returns {string}
 */
export function prepareSpeechText(raw, opts = {}) {
  const max =
    typeof opts.maxChars === 'number' && opts.maxChars > 0
      ? opts.maxChars
      : TTS_MAX_INPUT_CHARS

  let text = typeof raw === 'string' ? raw : ''
  if (!text.trim()) return ''

  // Drop fenced code blocks (speak a short placeholder once).
  text = text.replace(/```[\s\S]*?```/g, ' ')

  // Inline code markers.
  text = text.replace(/`([^`]+)`/g, '$1')

  // Markdown links → label only (never speak raw URLs).
  text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/gi, '$1')

  // Bare URLs.
  text = text.replace(/https?:\/\/[^\s)\]>]+/gi, ' ')

  // Common markdown emphasis / headings / lists.
  text = text.replace(/^#{1,6}\s+/gm, '')
  text = text.replace(/^\s*[-*+]\s+/gm, '')
  text = text.replace(/^\s*\d+\.\s+/gm, '')
  text = text.replace(/\*\*([^*]+)\*\*/g, '$1')
  text = text.replace(/\*([^*]+)\*/g, '$1')
  text = text.replace(/__([^_]+)__/g, '$1')
  text = text.replace(/_([^_]+)_/g, '$1')

  // Drop a trailing Fonti / Sources section if present as plain text.
  text = text.replace(/\n+(Fonti|Sources|Citations)\s*:?\s*\n[\s\S]*$/i, '\n')

  text = text.replace(/\s+/g, ' ').trim()
  if (!text) return ''

  if (text.length <= max) return text
  // Prefer cutting at a sentence boundary near the limit.
  const slice = text.slice(0, max)
  const lastStop = Math.max(slice.lastIndexOf('. '), slice.lastIndexOf('! '), slice.lastIndexOf('? '))
  if (lastStop > max * 0.55) {
    return slice.slice(0, lastStop + 1).trim()
  }
  return `${slice.trim()}…`
}

/**
 * Validate TTS request body.
 * @param {unknown} body
 * @returns {{ ok: true, text: string, voice: string } | { ok: false, error: string, code: string }}
 */
export function sanitizeTtsRequest(body) {
  if (!body || typeof body !== 'object') {
    return { ok: false, error: 'Invalid JSON body', code: 'invalid_body' }
  }
  const raw = /** @type {Record<string, unknown>} */ (body)
  const prepared = prepareSpeechText(raw.text, { maxChars: TTS_MAX_INPUT_CHARS })
  if (!prepared) {
    return { ok: false, error: 'text is required', code: 'empty_text' }
  }
  const allowedVoices = new Set([
    'alloy',
    'ash',
    'ballad',
    'coral',
    'echo',
    'sage',
    'shimmer',
    'verse',
    'marin',
    'cedar',
  ])
  const voiceRaw = typeof raw.voice === 'string' ? raw.voice.trim().toLowerCase() : 'alloy'
  const voice = allowedVoices.has(voiceRaw) ? voiceRaw : 'alloy'
  return { ok: true, text: prepared, voice }
}

export const TTS_MODEL = 'gpt-4o-mini-tts'
export const TTS_RESPONSE_FORMAT = 'mp3'
export const TTS_CONTENT_TYPE = 'audio/mpeg'
