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
})

export function getOpenAppTarget(id) {
  return OPEN_APP_TARGETS[id] || null
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
    ])
    if (!allowed.has(host)) return false
    // google.com maps path only
    if (host === 'www.google.com' || host === 'google.com') {
      return u.pathname.startsWith('/maps')
    }
    return true
  } catch {
    return false
  }
}
