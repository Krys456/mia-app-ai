/**
 * #292 client-side speech text cleanup (mirrors server tts-speech.js).
 * Deterministic only — never rewrites via another model.
 */

export const TTS_MAX_INPUT_CHARS = 1200

export function prepareSpeechText(
  raw: unknown,
  opts: { maxChars?: number } = {},
): string {
  const max =
    typeof opts.maxChars === 'number' && opts.maxChars > 0
      ? opts.maxChars
      : TTS_MAX_INPUT_CHARS

  let text = typeof raw === 'string' ? raw : ''
  if (!text.trim()) return ''

  text = text.replace(/```[\s\S]*?```/g, ' ')
  text = text.replace(/`([^`]+)`/g, '$1')
  text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/gi, '$1')
  text = text.replace(/https?:\/\/[^\s)\]>]+/gi, ' ')
  text = text.replace(/^#{1,6}\s+/gm, '')
  text = text.replace(/^\s*[-*+]\s+/gm, '')
  text = text.replace(/^\s*\d+\.\s+/gm, '')
  text = text.replace(/\*\*([^*]+)\*\*/g, '$1')
  text = text.replace(/\*([^*]+)\*/g, '$1')
  text = text.replace(/__([^_]+)__/g, '$1')
  text = text.replace(/_([^_]+)_/g, '$1')
  text = text.replace(/\n+(Fonti|Sources|Citations)\s*:?\s*\n[\s\S]*$/i, '\n')
  text = text.replace(/\s+/g, ' ').trim()
  if (!text) return ''

  if (text.length <= max) return text
  const slice = text.slice(0, max)
  const lastStop = Math.max(
    slice.lastIndexOf('. '),
    slice.lastIndexOf('! '),
    slice.lastIndexOf('? '),
  )
  if (lastStop > max * 0.55) {
    return slice.slice(0, lastStop + 1).trim()
  }
  return `${slice.trim()}…`
}
