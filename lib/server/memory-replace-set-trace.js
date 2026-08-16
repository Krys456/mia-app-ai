/**
 * Preview-only diagnostics for cofavorite replace_set (#257 forensic).
 * Never logs secrets. No product-behavior changes.
 *
 * Enabled when:
 *   VERCEL_ENV === 'preview'
 *   OR LAIFE_MEMORY_TRACE === '1'
 */

/**
 * @returns {boolean}
 */
export function isReplaceSetTraceEnabled() {
  if (String(process.env.LAIFE_MEMORY_TRACE || '').trim() === '1') return true
  return String(process.env.VERCEL_ENV || '').trim().toLowerCase() === 'preview'
}

/**
 * Extract Supabase project ref from a URL (hostname prefix). No secrets.
 * @param {string} url
 * @returns {string | null}
 */
export function extractSupabaseProjectRef(url) {
  const raw = typeof url === 'string' ? url.trim() : ''
  if (!raw) return null
  try {
    const host = new URL(raw).hostname || ''
    // {ref}.supabase.co
    const m = host.match(/^([a-z0-9-]+)\.supabase\.co$/i)
    return m?.[1] || host || null
  } catch {
    return null
  }
}

/**
 * Server vs Vite URL project-ref consistency (no keys).
 * @returns {{
 *   vercelEnv: string | null,
 *   serverSupabaseUrlPresent: boolean,
 *   viteSupabaseUrlPresent: boolean,
 *   serverProjectRef: string | null,
 *   viteProjectRef: string | null,
 *   sameProject: boolean | null,
 * }}
 */
export function getReplaceSetProjectDiagnostics() {
  const serverUrl =
    (typeof process.env.SUPABASE_URL === 'string' && process.env.SUPABASE_URL.trim()) ||
    (typeof process.env.VITE_SUPABASE_URL === 'string' && process.env.VITE_SUPABASE_URL.trim()) ||
    ''
  const viteUrl =
    (typeof process.env.VITE_SUPABASE_URL === 'string' && process.env.VITE_SUPABASE_URL.trim()) || ''
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
 * Compact row snapshot for diagnostics (no user PII beyond stored memory content).
 * @param {any} row
 * @param {(tags: unknown) => string | null} readFactKeyFromTags
 * @returns {{ id: string | null, factKey: string | null, content: string, status: string }}
 */
export function snapshotMemoryRow(row, readFactKeyFromTags) {
  const id = row?.id != null ? String(row.id) : null
  const factKey =
    typeof readFactKeyFromTags === 'function' ? readFactKeyFromTags(row?.tags) : null
  const content = String(row?.content || row?.Content || '').slice(0, 240)
  const status = String(row?.status || row?.Status || 'active')
  return { id, factKey, content, status }
}

/**
 * @param {any[]} rows
 * @param {(tags: unknown) => string | null} readFactKeyFromTags
 */
export function snapshotMemoryRows(rows, readFactKeyFromTags) {
  const list = Array.isArray(rows) ? rows : []
  return list.map((row) => snapshotMemoryRow(row, readFactKeyFromTags))
}

/**
 * Emit one structured replace_set diagnostic log line.
 * @param {string} stage
 * @param {Record<string, unknown>} payload
 */
export function logReplaceSetTrace(stage, payload = {}) {
  if (!isReplaceSetTraceEnabled()) return
  const safe = payload && typeof payload === 'object' ? payload : {}
  console.info('[brain-memory] REPLACE_SET TRACE', {
    stage: String(stage || 'unknown'),
    ...safe,
  })
}

/**
 * Emit swallowed-error diagnostic (Preview / LAIFE_MEMORY_TRACE only).
 * @param {{
 *   stage?: string,
 *   message?: string,
 *   operation?: string | null,
 *   subject?: string | null,
 * }} info
 */
export function logReplaceSetTraceError(info = {}) {
  if (!isReplaceSetTraceEnabled()) return
  console.warn('[brain-memory] REPLACE_SET TRACE ERROR', {
    stage: String(info.stage || 'unknown'),
    message: String(info.message || '').slice(0, 300),
    operation: info.operation != null ? String(info.operation) : null,
    subject: info.subject != null ? String(info.subject) : null,
  })
}

/**
 * Lightweight hint for error logs — does not import extractors (avoid cycles).
 * Detects high-confidence replace cue presence only.
 * @param {string} message
 * @returns {{ operation: string | null, subject: string | null }}
 */
export function extractCofavoriteReplaceHint(message) {
  const text = String(message || '').trim()
  if (!text) return { operation: null, subject: null }
  const looksReplace =
    /(?:^|\b)(?:adesso|ora)\b[\s\S]{0,80}\bpreferit/i.test(text) ||
    /\bpreferit[\s\S]{0,40}\b(?:adesso|ora|solo|soltanto)\b/i.test(text) ||
    /(?:^|\b)now\b[\s\S]{0,80}\bfavorite\b/i.test(text) ||
    /\bfavorite[\s\S]{0,40}\b(?:now|only)\b/i.test(text)
  if (!looksReplace) return { operation: null, subject: null }
  const it = text.match(
    /\bmi(?:ei|e)\s+([A-Za-zÀ-ÖØ-öø-ÿ][\wÀ-ÖØ-öø-ÿ'-]{1,40})\s+preferit/i,
  )
  const en = text.match(/\bfavorite\s+([A-Za-z][\w'-]{1,40})\b/i)
  return {
    operation: 'replace_set',
    subject: (it?.[1] || en?.[1] || null) && String(it?.[1] || en?.[1] || '').toLowerCase(),
  }
}
