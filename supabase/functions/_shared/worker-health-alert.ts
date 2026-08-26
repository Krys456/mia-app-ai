/**
 * #387C — Edge shared: worker health alert transitions + webhook sink.
 * Mirrors lib/server/worker-health-alert.js (Node tests are source of truth).
 */

export const WORKER_NAME_REMINDER_PUSH = 'reminder-push-dispatch'
export const WORKER_NAME_MORNING_BRIEFING = 'morning-briefing-dispatch'
export const WORKER_NAMES = [WORKER_NAME_REMINDER_PUSH, WORKER_NAME_MORNING_BRIEFING] as const

export const WORKER_STALE_THRESHOLD_MS: Record<string, number> = {
  [WORKER_NAME_REMINDER_PUSH]: 5 * 60 * 1000,
  [WORKER_NAME_MORNING_BRIEFING]: 15 * 60 * 1000,
}

export const UNKNOWN_GRACE_MS = 30 * 60 * 1000

function parseTime(value: unknown): number | null {
  if (typeof value !== 'string' || !value.trim()) return null
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? ms : null
}

function isTruthy(raw: string): boolean {
  const v = raw.toLowerCase()
  return v === '1' || v === 'true' || v === 'yes'
}

export function evaluateWorkerHeartbeat(
  workerName: string,
  row: Record<string, unknown> | null | undefined,
  opts: { now?: number; enabled?: boolean } = {},
): string {
  if (opts.enabled === false) return 'disabled'
  if (!row || typeof row !== 'object') return 'unknown'
  if (row.last_status === 'disabled') return 'disabled'
  const now = typeof opts.now === 'number' ? opts.now : Date.now()
  const failureAt = parseTime(row.last_failure_at)
  const successAt = parseTime(row.last_success_at)
  if (
    row.last_status === 'failure' ||
    (failureAt != null && (successAt == null || failureAt > successAt))
  ) {
    return 'failed'
  }
  if (successAt == null) return 'unknown'
  const threshold = WORKER_STALE_THRESHOLD_MS[workerName] ?? 15 * 60 * 1000
  if (now - successAt > threshold) return 'stale'
  return 'healthy'
}

export function isAlertableHealth(
  health: string,
  opts: { unknownSince?: string | null; now?: number; graceMs?: number } = {},
): boolean {
  if (health === 'stale' || health === 'failed') return true
  if (health !== 'unknown') return false
  const since = parseTime(opts.unknownSince)
  if (since == null) return false
  const now = typeof opts.now === 'number' ? opts.now : Date.now()
  const grace = typeof opts.graceMs === 'number' ? opts.graceMs : UNKNOWN_GRACE_MS
  return now - since >= grace
}

export function decideWorkerAlertTransition(args: {
  health: string
  previous?: Record<string, unknown> | null
  now?: number
  graceMs?: number
}) {
  const now = typeof args.now === 'number' ? args.now : Date.now()
  const nowIso = new Date(now).toISOString()
  const prev = args.previous && typeof args.previous === 'object' ? args.previous : null
  const wasOpen = Boolean(prev?.incident_open)
  const pending = typeof prev?.pending_alert_kind === 'string' ? prev.pending_alert_kind : null

  let unknownSince =
    typeof prev?.unknown_since === 'string' ? prev.unknown_since : null
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

  let action: 'none' | 'open' | 'recovery' | 'retry_open' | 'retry_recovery' = 'none'
  let incidentOpen = wasOpen
  let incidentStartedAt: string | null = null
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
      action = 'none'
      incidentOpen = true
    }
  } else {
    if (wasOpen) {
      action = pending === 'recovery' ? 'retry_recovery' : 'recovery'
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

function sanitizeCode(code: unknown): string | null {
  if (typeof code !== 'string' || !code.trim()) return null
  return code.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 64)
}

export function buildOpsAlertPayload(p: {
  kind: 'open' | 'recovery'
  environment: string
  workerName: string
  health: string
  now?: number
  lastSuccessAt?: string | null
  lastErrorCode?: string | null
  runId?: string | null
  buildId?: string | null
  checkerRunId?: string | null
}) {
  const now = typeof p.now === 'number' ? p.now : Date.now()
  const successAt = parseTime(p.lastSuccessAt)
  const lastSuccessAgeSec =
    successAt != null ? Math.max(0, Math.floor((now - successAt) / 1000)) : null
  const summary =
    p.kind === 'recovery'
      ? `Worker recovered: ${p.workerName}`
      : `Worker incident: ${p.workerName}`
  const envLabel = p.environment || 'preview'
  const prefix =
    envLabel === 'production'
      ? 'ShinkAIdo Production'
      : `[ShinkAIdo ${envLabel.charAt(0).toUpperCase()}${envLabel.slice(1)}]`

  return {
    product: 'ShinkAIdo',
    environment: envLabel,
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

export async function deliverOpsAlertWebhook(
  webhookUrl: string,
  payload: Record<string, unknown>,
): Promise<{ ok: boolean; status: string; errorCode?: string }> {
  const url = (webhookUrl || '').trim()
  if (!url) return { ok: true, status: 'noop' }
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (res.status >= 200 && res.status < 300) return { ok: true, status: 'sent' }
    return { ok: false, status: 'failed', errorCode: `alert_sink_http_${res.status}` }
  } catch {
    return { ok: false, status: 'failed', errorCode: 'alert_sink_exception' }
  }
}

export function workerExpected(workerName: string, envGet: (k: string) => string): boolean {
  const push = isTruthy(envGet('PUSH_ENABLED'))
  if (workerName === WORKER_NAME_REMINDER_PUSH) return push
  if (workerName === WORKER_NAME_MORNING_BRIEFING) {
    return push && isTruthy(envGet('MORNING_BRIEFING_DISPATCH_ENABLED'))
  }
  return false
}
