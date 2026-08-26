/**
 * #387C — Worker health alerting: incident transitions + safe payloads.
 *
 * Reuses #387B evaluateWorkerHeartbeat thresholds/states.
 * Does NOT widen public /api/health.
 */

import {
  WORKER_NAME_MORNING_BRIEFING,
  WORKER_NAME_REMINDER_PUSH,
  WORKER_NAMES,
  evaluateWorkerHeartbeat,
  isMorningBriefingWorkerExpected,
  isReminderPushWorkerExpected,
  resolvePublicEnvironment,
  staleThresholdMsForWorker,
} from './worker-health.js'
import { resolveServerBuildId } from './request-id.js'

export const ALERTABLE_HEALTH_STATES = Object.freeze(['stale', 'failed'])
export const NON_ALERT_HEALTH_STATES = Object.freeze(['healthy', 'disabled', 'unknown'])

/** Missing/unknown heartbeats: no alerts until this grace elapses (ms). */
export const UNKNOWN_GRACE_MS = 30 * 60 * 1000

/** Checker cadence documentation constant (not a magic scatter). */
export const WORKER_HEALTH_ALERT_CHECK_CADENCE_CRON = '*/5 * * * *'

export const WORKER_ALERT_STATE_COLUMNS = Object.freeze([
  'worker_name',
  'current_health',
  'incident_open',
  'incident_started_at',
  'last_alerted_at',
  'last_recovered_at',
  'last_observed_at',
  'last_run_id',
  'last_delivery_status',
  'last_delivery_error_code',
  'pending_alert_kind',
  'unknown_since',
  'updated_at',
])

export const WORKER_ALERT_FORBIDDEN_COLUMNS = Object.freeze([
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
 * @param {string} health
 * @param {{ unknownSince?: string | null, now?: number, graceMs?: number }} [opts]
 * @returns {boolean}
 */
export function isAlertableHealth(health, opts = {}) {
  if (health === 'stale' || health === 'failed') return true
  if (health !== 'unknown') return false
  // Prolonged unknown after grace → alertable (missing worker after init).
  const since = parseTime(opts.unknownSince)
  if (since == null) return false
  const now = typeof opts.now === 'number' ? opts.now : Date.now()
  const grace = typeof opts.graceMs === 'number' ? opts.graceMs : UNKNOWN_GRACE_MS
  return now - since >= grace
}

/**
 * Deterministic incident transition.
 *
 * @param {{
 *   health: string,
 *   previous?: null | {
 *     incident_open?: boolean,
 *     current_health?: string | null,
 *     pending_alert_kind?: string | null,
 *     unknown_since?: string | null,
 *   },
 *   now?: number,
 *   graceMs?: number,
 * }} args
 */
export function decideWorkerAlertTransition(args) {
  const now = typeof args.now === 'number' ? args.now : Date.now()
  const nowIso = new Date(now).toISOString()
  const prev = args.previous && typeof args.previous === 'object' ? args.previous : null
  const wasOpen = Boolean(prev?.incident_open)
  const pending = prev?.pending_alert_kind || null

  let unknownSince = prev?.unknown_since || null
  if (args.health === 'unknown') {
    if (!unknownSince) unknownSince = nowIso
  } else {
    unknownSince = null
  }

  const alertable = isAlertableHealth(args.health, {
    unknownSince,
    now,
    graceMs: args.graceMs,
  })

  /** @type {'none' | 'open' | 'recovery' | 'retry_open' | 'retry_recovery'} */
  let action = 'none'
  let incidentOpen = wasOpen
  let incidentStartedAt = null
  let closeRecovery = false

  if (alertable) {
    if (!wasOpen) {
      action = 'open'
      incidentOpen = true
      incidentStartedAt = nowIso
    } else if (pending === 'open') {
      action = 'retry_open'
      incidentOpen = true
    } else {
      // still alertable; same incident; no new alert (incl. stale→failed)
      action = 'none'
      incidentOpen = true
    }
  } else {
    // healthy | disabled | unknown(within grace)
    if (wasOpen) {
      if (pending === 'recovery') {
        action = 'retry_recovery'
      } else {
        action = 'recovery'
      }
      incidentOpen = false
      closeRecovery = true
    } else if (pending === 'recovery') {
      action = 'retry_recovery'
      incidentOpen = false
      closeRecovery = true
    } else {
      action = 'none'
      incidentOpen = false
    }
  }

  return {
    health: args.health,
    alertable,
    action,
    incidentOpen,
    incidentStartedAt,
    closeRecovery,
    unknownSince,
    sendOpenAlert: action === 'open' || action === 'retry_open',
    sendRecoveryAlert: action === 'recovery' || action === 'retry_recovery',
  }
}

/**
 * Build privacy-safe alert body (plain object).
 * @param {{
 *   kind: 'open' | 'recovery',
 *   environment: string,
 *   workerName: string,
 *   health: string,
 *   now?: number,
 *   lastSuccessAt?: string | null,
 *   lastErrorCode?: string | null,
 *   runId?: string | null,
 *   buildId?: string | null,
 *   checkerRunId?: string | null,
 * }} p
 */
export function buildOpsAlertPayload(p) {
  const now = typeof p.now === 'number' ? p.now : Date.now()
  const successAt = parseTime(p.lastSuccessAt)
  const lastSuccessAgeSec =
    successAt != null ? Math.max(0, Math.floor((now - successAt) / 1000)) : null

  const summary =
    p.kind === 'recovery'
      ? `Worker recovered: ${p.workerName}`
      : `Worker incident: ${p.workerName}`

  const prefix =
    p.environment === 'production' ? 'ShinkAIdo Production' : `[ShinkAIdo ${capitalize(p.environment)}]`

  return {
    product: 'ShinkAIdo',
    environment: p.environment,
    kind: p.kind,
    summary: `${prefix} — ${summary}`,
    workerName: p.workerName,
    health: p.health,
    incident: p.kind === 'open' ? 'opened' : 'recovered',
    observedAt: new Date(now).toISOString(),
    lastSuccessAgeSec,
    lastErrorCode: sanitizeCode(p.lastErrorCode),
    runId: typeof p.runId === 'string' ? p.runId.slice(0, 64) : null,
    buildId: typeof p.buildId === 'string' ? p.buildId.slice(0, 16) : null,
    checkerRunId: typeof p.checkerRunId === 'string' ? p.checkerRunId.slice(0, 64) : null,
  }
}

/**
 * Assert payload has no forbidden keys / user content.
 * @param {Record<string, unknown>} payload
 */
export function assertOpsAlertPayloadSafe(payload) {
  for (const key of Object.keys(payload)) {
    if (WORKER_ALERT_FORBIDDEN_COLUMNS.includes(key)) {
      throw new Error(`forbidden alert field: ${key}`)
    }
  }
  const json = JSON.stringify(payload)
  if (/\buser_id\b|\buserId\b/i.test(json)) throw new Error('pii user id in alert')
  if (/eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/i.test(json)) throw new Error('jwt-like in alert')
  if (/https?:\/\/.+\/push/i.test(json)) throw new Error('push endpoint-like in alert')
  return true
}

/**
 * Webhook sink. Never throws. Never logs the URL.
 *
 * @param {string | undefined | null} webhookUrl
 * @param {Record<string, unknown>} payload
 * @param {{ fetchImpl?: typeof fetch, timeoutMs?: number }} [opts]
 * @returns {Promise<{ ok: boolean, status?: string, errorCode?: string }>}
 */
export async function deliverOpsAlertWebhook(webhookUrl, payload, opts = {}) {
  const url = typeof webhookUrl === 'string' ? webhookUrl.trim() : ''
  if (!url) {
    return { ok: true, status: 'noop' }
  }
  try {
    assertOpsAlertPayloadSafe(payload)
  } catch {
    return { ok: false, status: 'failed', errorCode: 'alert_payload_unsafe' }
  }
  const fetchImpl = opts.fetchImpl || fetch
  const timeoutMs = typeof opts.timeoutMs === 'number' ? opts.timeoutMs : 8000
  try {
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null
    const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: ctrl?.signal,
    })
    if (timer) clearTimeout(timer)
    if (!res || typeof res.status !== 'number') {
      return { ok: false, status: 'failed', errorCode: 'alert_sink_no_response' }
    }
    if (res.status >= 200 && res.status < 300) {
      return { ok: true, status: 'sent' }
    }
    return { ok: false, status: 'failed', errorCode: `alert_sink_http_${res.status}` }
  } catch {
    return { ok: false, status: 'failed', errorCode: 'alert_sink_exception' }
  }
}

/**
 * Evaluate one worker for alerting given heartbeat + prior alert state.
 *
 * @param {{
 *   workerName: string,
 *   heartbeat: object | null | undefined,
 *   alertState: object | null | undefined,
 *   enabled: boolean,
 *   now?: number,
 *   environment?: string,
 *   buildId?: string,
 *   checkerRunId?: string,
 * }} args
 */
export function evaluateWorkerForAlert(args) {
  const now = typeof args.now === 'number' ? args.now : Date.now()
  const health = evaluateWorkerHeartbeat(args.workerName, args.heartbeat, {
    now,
    enabled: args.enabled,
  })
  const transition = decideWorkerAlertTransition({
    health,
    previous: args.alertState,
    now,
  })

  const successAt =
    args.heartbeat && typeof args.heartbeat.last_success_at === 'string'
      ? args.heartbeat.last_success_at
      : null
  const errorCode =
    args.heartbeat && typeof args.heartbeat.last_error_code === 'string'
      ? args.heartbeat.last_error_code
      : null
  const runId =
    args.heartbeat && typeof args.heartbeat.last_run_id === 'string'
      ? args.heartbeat.last_run_id
      : null

  const openPayload = transition.sendOpenAlert
    ? buildOpsAlertPayload({
        kind: 'open',
        environment: args.environment || 'development',
        workerName: args.workerName,
        health,
        now,
        lastSuccessAt: successAt,
        lastErrorCode: errorCode,
        runId,
        buildId: args.buildId || null,
        checkerRunId: args.checkerRunId || null,
      })
    : null

  const recoveryPayload = transition.sendRecoveryAlert
    ? buildOpsAlertPayload({
        kind: 'recovery',
        environment: args.environment || 'development',
        workerName: args.workerName,
        health,
        now,
        lastSuccessAt: successAt,
        lastErrorCode: errorCode,
        runId,
        buildId: args.buildId || null,
        checkerRunId: args.checkerRunId || null,
      })
    : null

  return { health, transition, openPayload, recoveryPayload }
}

/**
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env]
 */
export function isWorkerExpected(workerName, env = process.env) {
  if (workerName === WORKER_NAME_REMINDER_PUSH) return isReminderPushWorkerExpected(env)
  if (workerName === WORKER_NAME_MORNING_BRIEFING) return isMorningBriefingWorkerExpected(env)
  return false
}

/**
 * Capture sink for unit tests.
 */
export function createCaptureAlertSink() {
  /** @type {Record<string, unknown>[]} */
  const sent = []
  return {
    sent,
    async deliver(payload) {
      sent.push(payload)
      return { ok: true, status: 'sent' }
    },
  }
}

/**
 * Run checker loop with injectable IO (unit-testable).
 *
 * @param {{
 *   now?: number,
 *   env?: NodeJS.ProcessEnv | Record<string, string | undefined>,
 *   checkerRunId?: string,
 *   loadHeartbeats: () => Promise<Record<string, object | null>>,
 *   loadAlertStates: () => Promise<Record<string, object | null>>,
 *   saveAlertState: (row: Record<string, unknown>) => Promise<{ ok: boolean }>,
 *   deliverAlert: (payload: Record<string, unknown>) => Promise<{ ok: boolean, status?: string, errorCode?: string }>,
 *   workerNames?: string[],
 * }} deps
 */
export async function runWorkerHealthAlertCheck(deps) {
  const now = typeof deps.now === 'number' ? deps.now : Date.now()
  const env = deps.env || process.env
  const checkerRunId = deps.checkerRunId || `check-${now}`
  const environment = resolvePublicEnvironment(env)
  const buildId = resolveServerBuildId(env)
  const names = deps.workerNames || [...WORKER_NAMES]

  const heartbeats = await deps.loadHeartbeats()
  const states = await deps.loadAlertStates()

  /** @type {object[]} */
  const results = []

  for (const workerName of names) {
    const hb = heartbeats[workerName] || null
    const prev = states[workerName] || null
    const evaluated = evaluateWorkerForAlert({
      workerName,
      heartbeat: hb,
      alertState: prev,
      enabled: isWorkerExpected(workerName, env),
      now,
      environment,
      buildId,
      checkerRunId,
    })

    const { transition, health, openPayload, recoveryPayload } = evaluated
    const nowIso = new Date(now).toISOString()

    /** @type {Record<string, unknown>} */
    const nextRow = {
      worker_name: workerName,
      current_health: health,
      incident_open: transition.incidentOpen,
      incident_started_at: transition.incidentOpen
        ? transition.incidentStartedAt || prev?.incident_started_at || nowIso
        : null,
      last_observed_at: nowIso,
      last_run_id: hb && typeof hb.last_run_id === 'string' ? hb.last_run_id : prev?.last_run_id || null,
      unknown_since: transition.unknownSince,
      last_alerted_at: prev?.last_alerted_at || null,
      last_recovered_at: prev?.last_recovered_at || null,
      last_delivery_status: prev?.last_delivery_status || null,
      last_delivery_error_code: prev?.last_delivery_error_code || null,
      pending_alert_kind: null,
    }

    let delivery = { ok: true, status: 'skipped' }

    if (transition.sendOpenAlert && openPayload) {
      nextRow.pending_alert_kind = 'open'
      await deps.saveAlertState(nextRow)
      delivery = await deps.deliverAlert(openPayload)
      if (delivery.ok) {
        nextRow.pending_alert_kind = null
        nextRow.last_alerted_at = nowIso
        nextRow.last_delivery_status = delivery.status || 'sent'
        nextRow.last_delivery_error_code = null
      } else {
        nextRow.last_delivery_status = 'failed'
        nextRow.last_delivery_error_code = delivery.errorCode || 'alert_sink_failed'
        nextRow.pending_alert_kind = 'open'
      }
      await deps.saveAlertState(nextRow)
    } else if (transition.sendRecoveryAlert && recoveryPayload) {
      nextRow.pending_alert_kind = 'recovery'
      nextRow.last_recovered_at = nowIso
      await deps.saveAlertState(nextRow)
      delivery = await deps.deliverAlert(recoveryPayload)
      if (delivery.ok) {
        nextRow.pending_alert_kind = null
        nextRow.last_alerted_at = nowIso
        nextRow.last_delivery_status = delivery.status || 'sent'
        nextRow.last_delivery_error_code = null
      } else {
        nextRow.last_delivery_status = 'failed'
        nextRow.last_delivery_error_code = delivery.errorCode || 'alert_sink_failed'
        nextRow.pending_alert_kind = 'recovery'
      }
      await deps.saveAlertState(nextRow)
    } else {
      // Persist observation / closed state without alert
      if (transition.closeRecovery && !transition.sendRecoveryAlert) {
        nextRow.last_recovered_at = nowIso
      }
      await deps.saveAlertState(nextRow)
    }

    results.push({
      workerName,
      health,
      action: transition.action,
      incidentOpen: transition.incidentOpen,
      deliveryStatus: nextRow.last_delivery_status,
      pendingAlertKind: nextRow.pending_alert_kind,
    })
  }

  return {
    checkerRunId,
    environment,
    buildId,
    evaluatedAt: new Date(now).toISOString(),
    results,
  }
}

export {
  WORKER_NAME_REMINDER_PUSH,
  WORKER_NAME_MORNING_BRIEFING,
  WORKER_NAMES,
  staleThresholdMsForWorker,
}

// —— internals ——

/** @param {unknown} value */
function parseTime(value) {
  if (typeof value !== 'string' || !value.trim()) return null
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? ms : null
}

/** @param {unknown} code */
function sanitizeCode(code) {
  if (typeof code !== 'string' || !code.trim()) return null
  return code.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 64)
}

/** @param {string} s */
function capitalize(s) {
  if (!s) return 'Preview'
  return s.charAt(0).toUpperCase() + s.slice(1)
}
