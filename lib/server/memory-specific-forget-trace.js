/**
 * Preview-only diagnostics for Specific Forget (#260 Preview Test A forensic).
 * Never logs secrets. No product-behavior changes.
 *
 * Enabled when:
 *   VERCEL_ENV === 'preview'
 *   OR LAIFE_MEMORY_TRACE === '1'
 */

import { encodeFactKeyTag, readFactKeyFromTags } from './brain-memory.js'

/**
 * @returns {boolean}
 */
export function isSpecificForgetTraceEnabled() {
  if (String(process.env.LAIFE_MEMORY_TRACE || '').trim() === '1') return true
  return String(process.env.VERCEL_ENV || '').trim().toLowerCase() === 'preview'
}

/**
 * @param {string} url
 * @returns {string | null}
 */
export function extractSupabaseProjectRef(url) {
  const raw = typeof url === 'string' ? url.trim() : ''
  if (!raw) return null
  try {
    const host = new URL(raw).hostname || ''
    const m = host.match(/^([a-z0-9-]+)\.supabase\.co$/i)
    return m?.[1] || host || null
  } catch {
    return null
  }
}

/**
 * Server vs Vite URL project-ref consistency (no keys).
 */
export function getSpecificForgetProjectDiagnostics() {
  const serverUrl =
    (typeof process.env.SUPABASE_URL === 'string' && process.env.SUPABASE_URL.trim()) ||
    (typeof process.env.VITE_SUPABASE_URL === 'string' && process.env.VITE_SUPABASE_URL.trim()) ||
    ''
  const viteUrl =
    (typeof process.env.VITE_SUPABASE_URL === 'string' && process.env.VITE_SUPABASE_URL.trim()) ||
    ''
  const serverProjectRef = extractSupabaseProjectRef(serverUrl)
  const viteProjectRef = extractSupabaseProjectRef(viteUrl)
  let sameProject = null
  if (serverProjectRef && viteProjectRef) {
    sameProject = serverProjectRef === viteProjectRef
  }
  return {
    vercelEnv: typeof process.env.VERCEL_ENV === 'string' ? process.env.VERCEL_ENV : null,
    serverSupabaseUrlPresent: Boolean(serverUrl),
    viteSupabaseUrlPresent: Boolean(viteUrl),
    serverProjectRef,
    viteProjectRef,
    sameProject,
  }
}

/**
 * @param {string | null | undefined} userId
 * @returns {string | null}
 */
export function truncateOwnerId(userId) {
  const id = typeof userId === 'string' ? userId.trim() : ''
  if (!id) return null
  if (id.length <= 10) return id
  return `${id.slice(0, 6)}…${id.slice(-4)}`
}

/**
 * @param {any} row
 */
export function snapshotForgetRow(row) {
  const id = row?.id != null ? String(row.id) : null
  const factKey = readFactKeyFromTags(row?.tags || row?.Tags || []) || null
  const content = String(row?.content || row?.Content || '').slice(0, 240)
  const status = String(row?.status || row?.Status || '')
  return { id, factKey, content, status }
}

/**
 * @param {string} stage
 * @param {Record<string, unknown>} payload
 */
export function logSpecificForgetTrace(stage, payload = {}) {
  if (!isSpecificForgetTraceEnabled()) return
  const safe = payload && typeof payload === 'object' ? payload : {}
  console.info('[memory-control-forget] SPECIFIC_FORGET TRACE', {
    stage: String(stage || 'unknown'),
    ...safe,
  })
}

/**
 * Owner-scoped read of preference rows related to a value slug / "Naruto".
 * Includes ACTIVE and OBSOLETE — ground truth, not Recall ranking.
 *
 * @param {any} supabase
 * @param {string} userId
 * @param {{ valueSlug?: string, factKeys?: string[] }} [opts]
 */
export async function loadNarutoRelatedPreferenceRows(supabase, userId, opts = {}) {
  const uid = typeof userId === 'string' ? userId.trim() : ''
  if (!uid || !supabase) return { rows: [], error: 'missing userId/supabase' }

  const valueSlug = String(opts.valueSlug || 'naruto')
    .trim()
    .toLowerCase()
  const factKeys = Array.isArray(opts.factKeys)
    ? opts.factKeys
    : [
        `preferences.like.${valueSlug}`,
        `preferences.dislike.${valueSlug}`,
        `preferences.interest.${valueSlug}`,
        'preferences.favorite.anime',
      ]

  const { data, error } = await supabase
    .from('memories')
    .select('id, category, title, content, status, tags, updated_at')
    .eq('user_id', uid)
    .order('updated_at', { ascending: false })
    .limit(100)

  if (error) {
    return { rows: [], error: error.message || String(error) }
  }

  const wanted = new Set(factKeys.map(String))
  const rows = (data || [])
    .map((row) => {
      const factKey = readFactKeyFromTags(row.tags || []) || null
      const content = String(row.content || '')
      const status = String(row.status || '')
      const slugHit =
        factKey === `preferences.like.${valueSlug}` ||
        factKey === `preferences.dislike.${valueSlug}` ||
        factKey === `preferences.interest.${valueSlug}` ||
        (typeof factKey === 'string' &&
          factKey.startsWith('preferences.cofavorite.') &&
          factKey.endsWith(`.${valueSlug}`)) ||
        (factKey && wanted.has(factKey)) ||
        new RegExp(valueSlug.replace(/_/g, '[\\s_]*'), 'i').test(content)
      if (!slugHit && !(factKey && wanted.has(factKey))) return null
      // Always keep exact wanted keys even if content does not literal-match.
      if (factKey && wanted.has(factKey)) {
        return { id: row.id, factKey, content: content.slice(0, 240), status }
      }
      if (slugHit) {
        return { id: row.id, factKey, content: content.slice(0, 240), status }
      }
      return null
    })
    .filter(Boolean)

  return { rows, error: null }
}

/**
 * Direct exact-key read (any status) for one fact_key tag.
 * @param {any} supabase
 * @param {string} userId
 * @param {string} factKey
 */
export async function loadRowsForFactKeyAnyStatus(supabase, userId, factKey) {
  const uid = typeof userId === 'string' ? userId.trim() : ''
  const key = typeof factKey === 'string' ? factKey.trim() : ''
  if (!uid || !key || !supabase) return { rows: [], error: 'missing args' }
  const tag = encodeFactKeyTag(key)
  if (!tag) return { rows: [], error: 'no tag' }

  const { data, error } = await supabase
    .from('memories')
    .select('id, category, title, content, status, tags, updated_at')
    .eq('user_id', uid)
    .contains('tags', [tag])
    .order('updated_at', { ascending: false })
    .limit(20)

  if (error) return { rows: [], error: error.message || String(error) }
  return {
    rows: (data || []).map((row) => ({
      id: row.id,
      factKey: readFactKeyFromTags(row.tags || []) || key,
      content: String(row.content || '').slice(0, 240),
      status: String(row.status || ''),
    })),
    error: null,
  }
}
