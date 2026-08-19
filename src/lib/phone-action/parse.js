/**
 * #315 — Parse / sanitize phone, email, SMS fields.
 */

export function normalizeTimerText(raw) {
  return String(raw || '')
    .normalize('NFKC')
    .replace(/[\u2018\u2019\u02BC\u0060\u00B4]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

export function fold(raw) {
  return normalizeTimerText(raw)
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
}

/**
 * Extract first plausible E.164-ish or national number from text.
 * Returns digits with optional leading + , or null.
 */
export function extractPhoneNumber(raw) {
  const text = String(raw || '')
  // Prefer +international (spaces/dashes/parens allowed between digits)
  const intl = text.match(/\+\s*(\d[\d\s().-]{6,28}\d)/)
  if (intl) {
    const digits = ('+' + intl[1]).replace(/[^\d+]/g, '')
    if (isValidPhone(digits)) return digits
  }
  // Explicit "numero" / "number" nearby or bare long digit run
  const bare = text.match(/(?:numero|number|tel(?:efono)?|phone)?\s*:?\s*(\d[\d\s().-]{6,18}\d)/i)
  if (bare) {
    const digits = bare[1].replace(/[^\d]/g, '')
    if (isValidPhone(digits)) return digits
  }
  return null
}

export function isValidPhone(normalized) {
  if (!normalized) return false
  const s = String(normalized)
  if (!/^\+?\d{7,15}$/.test(s)) return false
  // Block obviously fake / short after strip
  const digits = s.replace(/\D/g, '')
  if (digits.length < 7 || digits.length > 15) return false
  // Reject all-same digits
  if (/^(\d)\1+$/.test(digits)) return false
  return true
}

export function buildTelUri(phone) {
  if (!isValidPhone(phone)) return null
  return `tel:${phone}`
}

/**
 * sms: URI. Prefer sms:+39...?body= for broad mobile support.
 */
export function buildSmsUri(phone, body) {
  if (!isValidPhone(phone)) return null
  const cleanBody = sanitizeSmsBody(body)
  if (cleanBody) {
    return `sms:${phone}?body=${encodeURIComponent(cleanBody)}`
  }
  return `sms:${phone}`
}

export function sanitizeSmsBody(body) {
  if (body == null) return ''
  let s = String(body)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .trim()
  if (s.length > 600) s = s.slice(0, 600)
  return s
}

export function extractEmail(raw) {
  const text = String(raw || '')
  const m = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/)
  if (!m) return null
  const email = m[0].toLowerCase()
  if (!isValidEmail(email)) return null
  return email
}

export function isValidEmail(email) {
  if (!email || email.length > 254) return false
  if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(email)) return false
  if (/^(javascript|data):/i.test(email)) return false
  return true
}

export function buildMailtoUri(email, { subject = '', body = '' } = {}) {
  if (!isValidEmail(email)) return null
  const params = []
  const sub = sanitizeMailField(subject, 120)
  const bod = sanitizeMailField(body, 2000)
  if (sub) params.push(`subject=${encodeURIComponent(sub)}`)
  if (bod) params.push(`body=${encodeURIComponent(bod)}`)
  const q = params.length ? `?${params.join('&')}` : ''
  return `mailto:${email}${q}`
}

function sanitizeMailField(s, max) {
  return String(s || '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .trim()
    .slice(0, max)
}

/** Mask for diagnostics — never log full PII. */
export function maskPhone(phone) {
  const d = String(phone || '').replace(/\D/g, '')
  if (d.length < 4) return '***'
  return `***${d.slice(-4)}`
}

export function maskEmail(email) {
  const s = String(email || '')
  const at = s.indexOf('@')
  if (at < 1) return '***'
  return `${s[0]}***${s.slice(at)}`
}
