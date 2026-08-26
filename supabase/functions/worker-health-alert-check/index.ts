/**
 * #387C — Supabase Edge Function: worker-health-alert-check
 *
 * Independent checker (not Reminder/Morning themselves):
 *   auth → load heartbeats → evaluate #387B health → incident dedupe → webhook sink
 *
 * Cadence (Preview/Production cutover later): every 5 minutes — SEPARATE cron.
 * Does NOT modify reminders-push-dispatch / morning-briefing-dispatch-5m.
 *
 * Alert sink: OPS_ALERT_WEBHOOK_URL (optional). Missing URL → noop delivery + durable state.
 */

import { createClient } from 'npm:@supabase/supabase-js@2'
import {
  WORKER_NAMES,
  buildOpsAlertPayload,
  decideWorkerAlertTransition,
  deliverOpsAlertWebhook,
  evaluateWorkerHeartbeat,
  workerExpected,
} from '../_shared/worker-health-alert.ts'

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function env(name: string): string {
  return (Deno.env.get(name) || '').trim()
}

function isTruthy(raw: string): boolean {
  const v = raw.toLowerCase()
  return v === '1' || v === 'true' || v === 'yes'
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let out = 0
  for (let i = 0; i < a.length; i += 1) out |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return out === 0
}

function logSafe(fields: Record<string, unknown>) {
  console.log(JSON.stringify({ route: 'worker-health-alert-check', ...fields }))
}

function authorize(req: Request): boolean {
  const secret =
    env('WORKER_HEALTH_ALERT_SECRET') || env('REMINDER_PUSH_WORKER_SECRET')
  if (!secret) return false
  const header = req.headers.get('authorization') || ''
  const bearer = header.toLowerCase().startsWith('bearer ')
    ? header.slice(7).trim()
    : ''
  const alt = (req.headers.get('x-worker-health-alert-secret') || '').trim()
  return timingSafeEqual(bearer, secret) || timingSafeEqual(alt, secret)
}

function resolveEnvironment(): string {
  const v = env('VERCEL_ENV') || env('SHINKAIDO_RUNTIME_ENV') || ''
  if (v === 'production' || v === 'preview' || v === 'development') return v
  return 'preview'
}

Deno.serve(async (req) => {
  const started = Date.now()
  const checkerRunId = crypto.randomUUID()

  if (req.method !== 'POST') {
    return json(405, { error: 'method_not_allowed', checkerRunId })
  }

  if (!authorize(req)) {
    logSafe({ checkerRunId, code: 'worker_unauthorized', ok: false })
    return json(401, { error: 'unauthorized', code: 'worker_unauthorized', checkerRunId })
  }

  if (!isTruthy(env('WORKER_HEALTH_ALERT_ENABLED'))) {
    logSafe({ checkerRunId, code: 'alert_checker_disabled', ok: true })
    return json(200, { ok: true, skipped: 'alert_checker_disabled', checkerRunId })
  }

  const supabaseUrl = env('SUPABASE_URL')
  const serviceKey = env('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceKey) {
    logSafe({ checkerRunId, code: 'alert_misconfigured', ok: false })
    return json(503, { error: 'misconfigured', code: 'alert_misconfigured', checkerRunId })
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const now = Date.now()
  const nowIso = new Date(now).toISOString()
  const environment = resolveEnvironment()
  const buildId = (env('VERCEL_GIT_COMMIT_SHA') || env('VITE_BUILD_ID') || 'dev').slice(0, 7)
  const webhookUrl = env('OPS_ALERT_WEBHOOK_URL')

  const { data: hbRows, error: hbErr } = await supabase.from('worker_heartbeats').select('*')
  if (hbErr) {
    logSafe({ checkerRunId, code: 'heartbeat_load_failed', ok: false })
    return json(500, { error: 'heartbeat_load_failed', checkerRunId })
  }

  const { data: stRows, error: stErr } = await supabase.from('worker_alert_states').select('*')
  if (stErr) {
    logSafe({ checkerRunId, code: 'alert_state_load_failed', ok: false })
    return json(500, { error: 'alert_state_load_failed', checkerRunId })
  }

  const heartbeats: Record<string, Record<string, unknown>> = {}
  for (const row of Array.isArray(hbRows) ? hbRows : []) {
    if (row && typeof row.worker_name === 'string') heartbeats[row.worker_name] = row
  }
  const states: Record<string, Record<string, unknown>> = {}
  for (const row of Array.isArray(stRows) ? stRows : []) {
    if (row && typeof row.worker_name === 'string') states[row.worker_name] = row
  }

  const results: Record<string, unknown>[] = []

  for (const workerName of WORKER_NAMES) {
    const hb = heartbeats[workerName] || null
    const prev = states[workerName] || null
    const enabled = workerExpected(workerName, env)
    const health = evaluateWorkerHeartbeat(workerName, hb, { now, enabled })
    const transition = decideWorkerAlertTransition({ health, previous: prev, now })

    const nextRow: Record<string, unknown> = {
      worker_name: workerName,
      current_health: health,
      incident_open: transition.incidentOpen,
      incident_started_at: transition.incidentOpen
        ? transition.incidentStartedAt || prev?.incident_started_at || nowIso
        : null,
      last_observed_at: nowIso,
      last_run_id: typeof hb?.last_run_id === 'string' ? hb.last_run_id : prev?.last_run_id || null,
      unknown_since: transition.unknownSince,
      last_alerted_at: prev?.last_alerted_at || null,
      last_recovered_at: prev?.last_recovered_at || null,
      last_delivery_status: prev?.last_delivery_status || null,
      last_delivery_error_code: prev?.last_delivery_error_code || null,
      pending_alert_kind: null,
      updated_at: nowIso,
    }

    const basePayload = {
      environment,
      workerName,
      health,
      now,
      lastSuccessAt: typeof hb?.last_success_at === 'string' ? hb.last_success_at : null,
      lastErrorCode: typeof hb?.last_error_code === 'string' ? hb.last_error_code : null,
      runId: typeof hb?.last_run_id === 'string' ? hb.last_run_id : null,
      buildId,
      checkerRunId,
    }

    let deliveryStatus = 'skipped'
    let deliveryError: string | null = null

    if (transition.sendOpenAlert) {
      nextRow.pending_alert_kind = 'open'
      await supabase.from('worker_alert_states').upsert(nextRow, { onConflict: 'worker_name' })
      const payload = buildOpsAlertPayload({ kind: 'open', ...basePayload })
      const delivery = await deliverOpsAlertWebhook(webhookUrl, payload)
      if (delivery.ok) {
        nextRow.pending_alert_kind = null
        nextRow.last_alerted_at = nowIso
        nextRow.last_delivery_status = delivery.status
        nextRow.last_delivery_error_code = null
        deliveryStatus = delivery.status
      } else {
        nextRow.last_delivery_status = 'failed'
        nextRow.last_delivery_error_code = delivery.errorCode || 'alert_sink_failed'
        nextRow.pending_alert_kind = 'open'
        deliveryStatus = 'failed'
        deliveryError = delivery.errorCode || 'alert_sink_failed'
      }
      await supabase.from('worker_alert_states').upsert(nextRow, { onConflict: 'worker_name' })
    } else if (transition.sendRecoveryAlert) {
      nextRow.pending_alert_kind = 'recovery'
      nextRow.last_recovered_at = nowIso
      await supabase.from('worker_alert_states').upsert(nextRow, { onConflict: 'worker_name' })
      const payload = buildOpsAlertPayload({ kind: 'recovery', ...basePayload })
      const delivery = await deliverOpsAlertWebhook(webhookUrl, payload)
      if (delivery.ok) {
        nextRow.pending_alert_kind = null
        nextRow.last_alerted_at = nowIso
        nextRow.last_delivery_status = delivery.status
        nextRow.last_delivery_error_code = null
        deliveryStatus = delivery.status
      } else {
        nextRow.last_delivery_status = 'failed'
        nextRow.last_delivery_error_code = delivery.errorCode || 'alert_sink_failed'
        nextRow.pending_alert_kind = 'recovery'
        deliveryStatus = 'failed'
        deliveryError = delivery.errorCode || 'alert_sink_failed'
      }
      await supabase.from('worker_alert_states').upsert(nextRow, { onConflict: 'worker_name' })
    } else {
      if (transition.closeRecovery) nextRow.last_recovered_at = nowIso
      await supabase.from('worker_alert_states').upsert(nextRow, { onConflict: 'worker_name' })
    }

    logSafe({
      checkerRunId,
      worker: workerName,
      health,
      action: transition.action,
      incidentOpen: transition.incidentOpen,
      deliveryStatus,
      deliveryErrorCode: deliveryError,
      ok: true,
    })

    results.push({
      worker: workerName,
      health,
      action: transition.action,
      incidentOpen: transition.incidentOpen,
      deliveryStatus,
    })
  }

  logSafe({
    checkerRunId,
    ok: true,
    durationMs: Date.now() - started,
    workers: results.length,
  })

  return json(200, {
    ok: true,
    checkerRunId,
    environment,
    results,
    durationMs: Date.now() - started,
  })
})
