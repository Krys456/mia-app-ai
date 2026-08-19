/**
 * Shared browser geolocation (gesture-gated; no background).
 * Used by Weather (#317) and reusable by Places (#316) without provider coupling.
 * Precise coordinates are transient only — never persist to Memory / Supabase.
 */

export const GEO_OPTIONS = Object.freeze({
  enableHighAccuracy: true,
  timeout: 12000,
  maximumAge: 60000,
})

/**
 * @param {{
 *   geolocation?: Geolocation | null
 *   options?: PositionOptions
 * }} [opts]
 * @returns {Promise<{ ok: true, latitude: number, longitude: number, accuracy?: number } | { ok: false, code: string }>}
 */
export function getBrowserPosition(opts = {}) {
  const geo =
    opts.geolocation !== undefined
      ? opts.geolocation
      : typeof navigator !== 'undefined'
        ? navigator.geolocation
        : null

  if (!geo || typeof geo.getCurrentPosition !== 'function') {
    return Promise.resolve({ ok: false, code: 'unsupported' })
  }

  const options = { ...GEO_OPTIONS, ...(opts.options || {}) }

  return new Promise((resolve) => {
    try {
      geo.getCurrentPosition(
        (pos) => {
          const latitude = Number(pos?.coords?.latitude)
          const longitude = Number(pos?.coords?.longitude)
          if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
            resolve({ ok: false, code: 'unavailable' })
            return
          }
          const accuracy =
            typeof pos.coords.accuracy === 'number' ? pos.coords.accuracy : undefined
          resolve({ ok: true, latitude, longitude, accuracy })
        },
        (err) => {
          const code = err?.code
          if (code === 1) resolve({ ok: false, code: 'denied' })
          else if (code === 2) resolve({ ok: false, code: 'unavailable' })
          else if (code === 3) resolve({ ok: false, code: 'timeout' })
          else resolve({ ok: false, code: 'unavailable' })
        },
        options,
      )
    } catch {
      resolve({ ok: false, code: 'unsupported' })
    }
  })
}
