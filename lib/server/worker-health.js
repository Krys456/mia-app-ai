/**
 * #387B — Server-side worker / system health evaluation (not public).
 *
 * Reusable by future alerting. Do not expose detailed results from /api/health.
 * Privacy: operates on operational heartbeat metadata only.
 */

import { isPushEnabled } from './push-enabled.js'
import { resolveServerBuildId } from './request-id.js'

/** Stable worker identities — never derived from user input. */
export const WORKER_NAME_REMINDER_PUSH = 'reminder-push-dispatch'
export const WORKER_NAME_MORNING_BRIEFING = 'morning-briefing-dispatch'

export const WORKER_NAMES = Object.freeze([
  WORKER_NAME_REMINDER_PUSH,
  WORKER_NAME_MORNING_BRIEFING,
])

/**
 * Conservative freshness thresholds (ms since last_success_at).
 * Reminder cron ~1m → stale after 5m.
 * Morning cron ~5m → stale after 15m.
 */
export const WORKER_STALE_THRESHOLD_MS = Object.freeze({
  [WORKER_NAME_REMINDER_PUSH]: 5 * 60 * 1000,
  [WORKER_NAME_MORNING_BRIEFING]: 15 * 60 * 1000,
})

/** @typedef {'healthy' | 'stale' | 'failed' | 'disabled' | 'unknown'} WorkerHealthState */

export const WORKER_HEALTH_STATES = Object.freeze([
  'healthy',
  'stale',
  'failed',
  'disabled',
  'unknown',
])

/**
 * Columns allowed on worker_heartbeats (privacy contract).
 */
export const WORKER_HEARTBEAT_COLUMNS = Object.freeze([
  'worker_name',
  'last_started_at',
  'last_success_at',
  'last_failure_at',
  'last_status',
  'last_duration_ms',
  'last_run_id',
  'last_error_code',
  'updated_at',
])

/** Forbidden conceptual fields that must never appear as heartbeat columns. */
export const WORKER_HEARTBEAT_FORBIDDEN_COLUMNS = Object.freeze([
  'user_id',
  'userId',
  'email',
  'title',
  'endpoint',
  'payload',
  'prompt',
  'response',
  'token',
  'authorization',
  'p256dh',
  'auth',
  'calendar_event',
  'gmail_message',
  'briefing_content',
])

/**
 * Morning briefing Edge kill switch (semantic only — never expose raw secrets).
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env]
 */
export function isMorningBriefingDispatchEnabled(env = process.env) {
  const raw =
    typeof env.MORNING_BRIEFING_DISPATCH_ENABLED === 'string'
      ? env.MORNING_BRIEFING_DISPATCH_ENABLED.trim()
      : ''
  if (!raw) return false
  const v = raw.toLowerCase()
  return v === '1' || v === 'true' || v === 'yes'
}

/**
 * Whether the reminder-push worker is expected to run (env kill switch).
 * DB `scheduler_disabled` is reflected via heartbeat last_status=disabled.
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env]
 */
export function isReminderPushWorkerExpected(env = process.env) {
  return isPushEnabled(env)
}

/**
 * Whether the morning-briefing worker is expected to run.
 * Requires both PUSH_ENABLED and MORNING_BRIEFING_DISPATCH_ENABLED.
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env]
 */
export function isMorningBriefingWorkerExpected(env = process.env) {
  return isPushEnabled(env) && isMorningBriefingDispatchEnabled(env)
}

/**
 * @param {string} workerName
 * @returns {number}
 */
export function staleThresholdMsForWorker(workerName) {
  const n = WORKER_STALE_THRESHOLD_MS[workerName]
  return typeof n === 'number' ? n : 15 * 60 * 1000
}

/**
 * Deterministic worker health state from one heartbeat row + enabled flag.
 *
 * @param {string} workerName
 * @param {null | undefined | {
 *   last_success_at?: string | null,
 *   last_failure_at?: string | null,
 *   last_status?: string | null,
 * }} row
 * @param {{
 *   now?: number,
 *   enabled?: boolean,
 *   staleThresholdMs?: number,
 * }} [opts]
 * @returns {WorkerHealthState}
 */
export function evaluateWorkerHeartbeat(workerName, row, opts = {}) {
  if (opts.enabled === false) return 'disabled'

  if (!row || typeof row !== 'object') return 'unknown'

  if (row.last_status === 'disabled') return 'disabled'

  const now = typeof opts.now === 'number' ? opts.now : Date.now()
  const failureAt = parseTime(row.last_failure_at)
  const successAt = parseTime(row.last_success_at)

  // Recent worker-level failure after last success (or failure with no success).
  if (
    row.last_status === 'failure' ||
    (failureAt != null && (successAt == null || failureAt > successAt))
  ) {
    return 'failed'
  }

  if (successAt == null) return 'unknown'

  const threshold =
    typeof opts.staleThresholdMs === 'number'
      ? opts.staleThresholdMs
      : staleThresholdMsForWorker(workerName)

  if (now - successAt > threshold) return 'stale'
  return 'healthy'
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function parseTime(value) {
  if (typeof value !== 'string' || !value.trim()) return null
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? ms : null
}

/**
 * Detect public /api/health probe (direct rewrite query or original path).
 * @param {{ url?: string, query?: Record<string, unknown> } | null | undefined} req
 */
export function isPublicHealthProbe(req) {
  try {
    const q = req?.query
    const probe = q && (q.probe ?? q['probe'])
    if (probe === 'public_health' || (Array.isArray(probe) && probe[0] === 'public_health')) {
      return true
    }
  } catch {
    /* soft */
  }
  try {
    const raw = typeof req?.url === 'string' ? req.url : ''
    if (!raw) return false
    const path = raw.startsWith('http') ? new URL(raw).pathname : raw.split('?')[0]
    return path === '/api/health'
  } catch {
    return false
  }
}

/**
 * Public environment label (safe).
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env]
 */
export function resolvePublicEnvironment(env = process.env) {
  const v = typeof env.VERCEL_ENV === 'string' ? env.VERCEL_ENV.trim() : ''
  if (v === 'production' || v === 'preview' || v === 'development') return v
  return 'development'
}

/**
 * Minimal public /api/health payload — intentionally no worker/supabase detail.
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env]
 */
export function buildPublicHealthPayload(env = process.env) {
  return {
    ok: true,
    status: 'ok',
    buildId: resolveServerBuildId(env),
    environment: resolvePublicEnvironment(env),
  }
}

/**
 * Safe upsert helper for tests / Node callers. Never throws.
 * Mirrors Edge `_shared/worker-heartbeat.ts` contract.
 *
 * @param {{
 *   from: (table: string) => {
 *     upsert: (values: Record<string, unknown>, opts?: { onConflict?: string }) =>
 *       Promise<{ error: unknown }>
 *   }
 * } | null | undefined} supabase
 * @param {Record<string, unknown>} patch
 * @param {(fields: Record<string, unknown>) => void} [logSafe]
 */
export async function writeWorkerHeartbeatSafe(supabase, patch, logSafe) {
  if (!supabase) {
    logSafe?.({ code: 'heartbeat_write_failed', reason: 'no_client', ok: false })
    return { ok: false }
  }
  try {
    const safe = {}
    for (const col of WORKER_HEARTBEAT_COLUMNS) {
      if (Object.prototype.hasOwnProperty.call(patch, col)) {
        safe[col] = patch[col]
      }
    }
    if (typeof safe.worker_name !== 'string' || !safe.worker_name) {
      logSafe?.({ code: 'heartbeat_write_failed', reason: 'missing_worker_name', ok: false })
      return { ok: false }
    }
    safe.updated_at = new Date().toISOString()
    const { error } = await supabase.from('worker_heartbeats').upsert(safe, {
      onConflict: 'worker_name',
    })
    if (error) {
      logSafe?.({ code: 'heartbeat_write_failed', reason: 'db_error', ok: false })
      return { ok: false }
    }
    return { ok: true }
  } catch {
    logSafe?.({ code: 'heartbeat_write_failed', reason: 'exception', ok: false })
    return { ok: false }
  }
}

/**
 * Internal system health evaluation (for future alerting — not public).
 *
 * @param {{
 *   env?: NodeJS.ProcessEnv | Record<string, string | undefined>,
 *   now?: number,
 *   probeSupabase?: () => Promise<'healthy' | 'failed' | 'unknown'>,
 *   loadHeartbeats?: () => Promise<Record<string, object | null>>,
 * }} [opts]
 */
export async function evaluateSystemHealth(opts = {}) {
  const env = opts.env || process.env
  const now = typeof opts.now === 'number' ? opts.now : Date.now()

  /** @type {'healthy' | 'failed' | 'unknown'} */
  let supabaseStatus = 'unknown'
  if (typeof opts.probeSupabase === 'function') {
    try {
      supabaseStatus = await opts.probeSupabase()
    } catch {
      supabaseStatus = 'failed'
    }
  }

  /** @type {Record<string, object | null>} */
  let rows = {
    [WORKER_NAME_REMINDER_PUSH]: null,
    [WORKER_NAME_MORNING_BRIEFING]: null,
  }
  if (typeof opts.loadHeartbeats === 'function') {
    try {
      rows = { ...rows, ...(await opts.loadHeartbeats()) }
    } catch {
      /* leave nulls → unknown workers */
    }
  }

  const workers = {
    [WORKER_NAME_REMINDER_PUSH]: evaluateWorkerHeartbeat(
      WORKER_NAME_REMINDER_PUSH,
      rows[WORKER_NAME_REMINDER_PUSH],
      { now, enabled: isReminderPushWorkerExpected(env) },
    ),
    [WORKER_NAME_MORNING_BRIEFING]: evaluateWorkerHeartbeat(
      WORKER_NAME_MORNING_BRIEFING,
      rows[WORKER_NAME_MORNING_BRIEFING],
      { now, enabled: isMorningBriefingWorkerExpected(env) },
    ),
  }

  return {
    api: /** @type {const} */ ('healthy'),
    supabase: supabaseStatus,
    workers,
    evaluatedAt: new Date(now).toISOString(),
  }
}
