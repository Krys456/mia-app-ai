/**
 * #334D1A — Durable morning-briefing pending intent (Cache API).
 * Accessible from the page and the service worker (same-origin).
 * No PII / tokens / user ids.
 */

export const MORNING_BRIEFING_DURABLE_CACHE = 'shinkaido-morning-intent-v1'
/** Synthetic same-origin URL key inside the cache (never fetched from network). */
export const MORNING_BRIEFING_DURABLE_URL = '/__shinkaido/morning-briefing-intent'
/** Conservative TTL — stale markers must not latent-trigger a briefing. */
export const MORNING_BRIEFING_DURABLE_TTL_MS = 5 * 60 * 1000

export type MorningBriefingDurableMarker = {
  type: 'morning_briefing'
  createdAt: number
}

export function isMorningBriefingDurableMarker(
  value: unknown,
  nowMs: number = Date.now(),
  ttlMs: number = MORNING_BRIEFING_DURABLE_TTL_MS,
): value is MorningBriefingDurableMarker {
  if (!value || typeof value !== 'object') return false
  const m = value as { type?: unknown; createdAt?: unknown }
  if (m.type !== 'morning_briefing') return false
  if (typeof m.createdAt !== 'number' || !Number.isFinite(m.createdAt)) return false
  if (m.createdAt > nowMs + 60_000) return false // reject far-future
  if (nowMs - m.createdAt > ttlMs) return false
  return true
}

export function buildMorningBriefingDurableMarker(
  createdAt: number = Date.now(),
): MorningBriefingDurableMarker {
  return { type: 'morning_briefing', createdAt }
}

type CacheLike = {
  put: (request: RequestInfo, response: Response) => Promise<void>
  match: (request: RequestInfo) => Promise<Response | undefined>
  delete: (request: RequestInfo) => Promise<boolean>
}

type CachesLike = {
  open: (name: string) => Promise<CacheLike>
  delete?: (name: string) => Promise<boolean>
}

function getCaches(): CachesLike | null {
  try {
    if (typeof caches === 'undefined') return null
    return caches as unknown as CachesLike
  } catch {
    return null
  }
}

/** Persist pending marker (SW notificationclick + tests). */
export async function writeMorningBriefingDurableIntent(
  marker: MorningBriefingDurableMarker = buildMorningBriefingDurableMarker(),
  cacheApi: CachesLike | null = getCaches(),
): Promise<boolean> {
  if (!cacheApi) return false
  try {
    const cache = await cacheApi.open(MORNING_BRIEFING_DURABLE_CACHE)
    const body = JSON.stringify(marker)
    await cache.put(
      MORNING_BRIEFING_DURABLE_URL,
      new Response(body, {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        },
      }),
    )
    return true
  } catch {
    return false
  }
}

/**
 * Read durable marker. Stale/invalid markers are deleted and return null.
 * Valid markers are left in place until successful handoff clears them.
 */
export async function readMorningBriefingDurableIntent(
  options?: {
    nowMs?: number
    ttlMs?: number
    cacheApi?: CachesLike | null
  },
): Promise<MorningBriefingDurableMarker | null> {
  const cacheApi = options?.cacheApi ?? getCaches()
  if (!cacheApi) return null
  const nowMs = options?.nowMs ?? Date.now()
  const ttlMs = options?.ttlMs ?? MORNING_BRIEFING_DURABLE_TTL_MS
  try {
    const cache = await cacheApi.open(MORNING_BRIEFING_DURABLE_CACHE)
    const res = await cache.match(MORNING_BRIEFING_DURABLE_URL)
    if (!res) return null
    let parsed: unknown = null
    try {
      parsed = await res.json()
    } catch {
      await cache.delete(MORNING_BRIEFING_DURABLE_URL)
      return null
    }
    if (!isMorningBriefingDurableMarker(parsed, nowMs, ttlMs)) {
      await cache.delete(MORNING_BRIEFING_DURABLE_URL)
      return null
    }
    return parsed
  } catch {
    return null
  }
}

/** Clear durable marker after successful sendMessage handoff (or discard). */
export async function clearMorningBriefingDurableIntent(
  cacheApi: CachesLike | null = getCaches(),
): Promise<void> {
  if (!cacheApi) return
  try {
    const cache = await cacheApi.open(MORNING_BRIEFING_DURABLE_CACHE)
    await cache.delete(MORNING_BRIEFING_DURABLE_URL)
  } catch {
    /* ignore */
  }
}
