/**
 * #315 — Hard allowlist of Phone Action destinations (HTTPS only).
 * URLs are constructed here — never from model/document content.
 */

export const OPEN_APP_TARGETS = Object.freeze({
  spotify: {
    id: 'spotify',
    url: 'https://open.spotify.com/',
    labelIt: 'Spotify',
    labelEn: 'Spotify',
  },
  youtube: {
    id: 'youtube',
    url: 'https://www.youtube.com/',
    labelIt: 'YouTube',
    labelEn: 'YouTube',
  },
  google_maps: {
    id: 'google_maps',
    url: 'https://maps.google.com/',
    labelIt: 'Google Maps',
    labelEn: 'Google Maps',
  },
  /** Browser/app handoff only — not #311 Gmail API integration. */
  gmail: {
    id: 'gmail',
    url: 'https://mail.google.com/',
    labelIt: 'Gmail',
    labelEn: 'Gmail',
  },
  /** Open WhatsApp Web/app — compose uses buildWhatsAppComposeUrl. */
  whatsapp: {
    id: 'whatsapp',
    url: 'https://web.whatsapp.com/',
    labelIt: 'WhatsApp',
    labelEn: 'WhatsApp',
  },
})

export function getOpenAppTarget(id) {
  return OPEN_APP_TARGETS[id] || null
}

/**
 * Build wa.me compose URL from normalized E.164 phone (+digits) + body.
 * Number on wa.me must be digits only (no +). Never accept a raw user URL.
 */
export function buildWhatsAppComposeUrl(phone, body = '') {
  const raw = String(phone || '').trim()
  if (!raw) return null
  // Reject if caller tried to pass a full URL
  if (/^https?:\/\//i.test(raw) || /wa\.me/i.test(raw)) return null
  const digits = raw.replace(/\D/g, '')
  if (digits.length < 7 || digits.length > 15) return null
  if (/^(\d)\1+$/.test(digits)) return null
  const text = String(body || '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 600)
  if (text) {
    return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`
  }
  return `https://wa.me/${digits}`
}

/** Build Maps directions URL — destination only (no geolocation required). */
export function buildMapsDirectionsUrl(destination) {
  const dest = String(destination || '').trim()
  if (!dest || dest.length > 300) return null
  // Reject scheme-like injections in destination text.
  if (/^(javascript|data|vbscript|file|intent):/i.test(dest)) return null
  if (/[\u0000-\u001f\u007f]/.test(dest)) return null
  const encoded = encodeURIComponent(dest)
  return `https://www.google.com/maps/dir/?api=1&destination=${encoded}`
}

export function isAllowedHttpsUrl(url) {
  try {
    const u = new URL(String(url || ''))
    if (u.protocol !== 'https:') return false
    const host = u.hostname.toLowerCase()
    const allowed = new Set([
      'open.spotify.com',
      'www.youtube.com',
      'youtube.com',
      'm.youtube.com',
      'maps.google.com',
      'www.google.com',
      'google.com',
      'mail.google.com',
      'wa.me',
      'web.whatsapp.com',
      'api.whatsapp.com',
    ])
    if (!allowed.has(host)) return false
    // google.com maps path only (not arbitrary google.com)
    if (host === 'www.google.com' || host === 'google.com') {
      return u.pathname.startsWith('/maps')
    }
    // wa.me: only /<digits> optionally with ?text=
    if (host === 'wa.me') {
      if (!/^\/\d{7,15}$/.test(u.pathname)) return false
      // Only allow text query key
      for (const key of u.searchParams.keys()) {
        if (key !== 'text') return false
      }
      return true
    }
    if (host === 'web.whatsapp.com') {
      return u.pathname === '/' || u.pathname === ''
    }
    if (host === 'api.whatsapp.com') {
      return u.pathname.startsWith('/send')
    }
    return true
  } catch {
    return false
  }
}
