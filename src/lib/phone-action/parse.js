/**
 * #315 — Parse / sanitize phone, email, SMS fields.
 * #330A2 — phone extraction is local / single-candidate; never concatenate
 * unrelated section numbers across a message.
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
 * Reject concatenations of unrelated short numeric groups (e.g. 280 280 1).
 * Allow normal phone grouping like 333 123 4567 or 376-116-5503.
 */
export function looksLikeUnrelatedNumberConcat(candidate) {
  const groups = String(candidate || '')
    .trim()
    .split(/[\s().-]+/)
    .filter(Boolean)
  if (groups.length < 3) return false
  // Three+ groups that are all tiny (≤3 digits) → section/build IDs, not a phone
  if (groups.every((g) => /^\d{1,3}$/.test(g))) return true
  if (
    groups.filter((g) => /^\d{1,3}$/.test(g)).length >= 3 &&
    groups.every((g) => /^\d{1,4}$/.test(g))
  ) {
    const total = groups.join('').replace(/\D/g, '').length
    if (total <= 9 && groups.length >= 3) return true
  }
  return false
}

function normalizePhoneCandidate(rawDigits, withPlus) {
  const digits = String(rawDigits || '').replace(/[^\d]/g, '')
  if (!digits) return null
  const normalized = withPlus ? `+${digits}` : digits
  return isValidPhone(normalized) ? normalized : null
}

/**
 * Extract first plausible E.164-ish or national number from a LOCAL region.
 * Does not invent numbers by joining unrelated groups across a long paste.
 * Returns digits with optional leading + , or null.
 */
export function extractPhoneNumber(raw) {
  const text = String(raw || '')
  if (!text.trim()) return null

  // Prefer +international (spaces/dashes/parens allowed within ONE candidate)
  const intl = text.match(/\+\s*(\d[\d\s().-]{5,28}\d)/)
  if (intl && !looksLikeUnrelatedNumberConcat(intl[1])) {
    const got = normalizePhoneCandidate(intl[1], true)
    if (got) return got
  }

  // Explicit "numero" / "number" / "tel" / "phone" label — still one candidate
  const labeled = text.match(
    /\b(?:numero|number|tel(?:efono)?|phone)\s*:?\s*(\+?\d[\d\s().-]{5,28}\d)/i,
  )
  if (labeled && !looksLikeUnrelatedNumberConcat(labeled[1].replace(/^\+/, ''))) {
    const withPlus = labeled[1].trim().startsWith('+')
    const got = normalizePhoneCandidate(labeled[1], withPlus)
    if (got) return got
  }

  // Contiguous national 7–15 digits (no spaces) — cannot be 280+280+1
  const contig = text.match(/(?<![\d+])(\d{7,15})(?!\d)/)
  if (contig) {
    const got = normalizePhoneCandidate(contig[1], false)
    if (got) return got
  }

  // One spaced/dashed phone token (groups mostly 2–4 digits), reject section-ID noise
  const spaced = text.match(/(?<![\d+])(\d{2,4}(?:[\s().-]+\d{2,4}){1,4})(?!\d)/)
  if (spaced && !looksLikeUnrelatedNumberConcat(spaced[1])) {
    const got = normalizePhoneCandidate(spaced[1], false)
    if (got) return got
  }

  return null
}

/**
 * Extract phone only from a bounded action clause (outer surface / local window).
 */
export function extractPhoneNumberLocal(clause, maxChars = 96) {
  const region = String(clause || '').slice(0, Math.max(16, maxChars))
  return extractPhoneNumber(region)
}

export function isValidPhone(normalized) {
  if (!normalized) return false
  const s = String(normalized)
  if (!/^\+?\d{7,15}$/.test(s)) return false
  const digits = s.replace(/\D/g, '')
  if (digits.length < 7 || digits.length > 15) return false
  if (/^(\d)\1+$/.test(digits)) return false
  return true
}

export function buildTelUri(phone) {
  if (!isValidPhone(phone)) return null
  return `tel:${phone}`
}

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
