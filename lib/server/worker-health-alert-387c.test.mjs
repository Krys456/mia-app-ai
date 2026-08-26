/**
 * #387C — Worker health alerting contracts.
 * Run: node --experimental-strip-types lib/server/worker-health-alert-387c.test.mjs
 */

import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  WORKER_NAME_MORNING_BRIEFING,
  WORKER_NAME_REMINDER_PUSH,
  UNKNOWN_GRACE_MS,
  WORKER_HEALTH_ALERT_CHECK_CADENCE_CRON,
  WORKER_ALERT_STATE_COLUMNS,
  WORKER_ALERT_FORBIDDEN_COLUMNS,
  assertOpsAlertPayloadSafe,
  buildOpsAlertPayload,
  createCaptureAlertSink,
  decideWorkerAlertTransition,
  deliverOpsAlertWebhook,
  evaluateWorkerForAlert,
  isAlertableHealth,
  runWorkerHealthAlertCheck,
} from './worker-health-alert.js'
import { buildPublicHealthPayload, evaluateWorkerHeartbeat } from './worker-health.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel) => readFileSync(join(root, rel), 'utf8')

const NOW = Date.parse('2026-08-26T12:00:00.000Z')
const MIN = 60_000

assert.equal(WORKER_HEALTH_ALERT_CHECK_CADENCE_CRON, '*/5 * * * *')
assert.equal(UNKNOWN_GRACE_MS, 30 * MIN)

// --- healthy → stale opens ---
{
  const t = decideWorkerAlertTransition({
    health: 'stale',
    previous: { incident_open: false, current_health: 'healthy' },
    now: NOW,
  })
  assert.equal(t.action, 'open')
  assert.equal(t.sendOpenAlert, true)
  assert.equal(t.incidentOpen, true)
}

// --- stale → stale dedupe ---
{
  const t = decideWorkerAlertTransition({
    health: 'stale',
    previous: { incident_open: true, current_health: 'stale', pending_alert_kind: null },
    now: NOW,
  })
  assert.equal(t.action, 'none')
  assert.equal(t.sendOpenAlert, false)
  assert.equal(t.incidentOpen, true)
}

// --- stale → failed same incident ---
{
  const t = decideWorkerAlertTransition({
    health: 'failed',
    previous: { incident_open: true, current_health: 'stale' },
    now: NOW,
  })
  assert.equal(t.action, 'none')
  assert.equal(t.sendOpenAlert, false)
  assert.equal(t.incidentOpen, true)
}

// --- stale → healthy recovery ---
{
  const t = decideWorkerAlertTransition({
    health: 'healthy',
    previous: { incident_open: true, current_health: 'stale' },
    now: NOW,
  })
  assert.equal(t.action, 'recovery')
  assert.equal(t.sendRecoveryAlert, true)
  assert.equal(t.incidentOpen, false)
}

// --- healthy → failed opens ---
{
  const t = decideWorkerAlertTransition({
    health: 'failed',
    previous: { incident_open: false, current_health: 'healthy' },
    now: NOW,
  })
  assert.equal(t.action, 'open')
  assert.equal(t.sendOpenAlert, true)
}

// --- disabled no incident ---
{
  const t = decideWorkerAlertTransition({
    health: 'disabled',
    previous: { incident_open: false },
    now: NOW,
  })
  assert.equal(t.sendOpenAlert, false)
  assert.equal(t.incidentOpen, false)
}

// --- unknown within grace ---
{
  assert.equal(isAlertableHealth('unknown', { unknownSince: null, now: NOW }), false)
  const t = decideWorkerAlertTransition({
    health: 'unknown',
    previous: null,
    now: NOW,
  })
  assert.equal(t.sendOpenAlert, false)
  assert.ok(typeof t.unknownSince === 'string')
}

// --- unknown after grace → alertable ---
{
  const since = new Date(NOW - UNKNOWN_GRACE_MS - 1000).toISOString()
  assert.equal(isAlertableHealth('unknown', { unknownSince: since, now: NOW }), true)
  const t = decideWorkerAlertTransition({
    health: 'unknown',
    previous: { incident_open: false, unknown_since: since },
    now: NOW,
  })
  assert.equal(t.action, 'open')
}

// --- end-to-end checker with capture sink ---
{
  const sink = createCaptureAlertSink()
  /** @type {Record<string, object>} */
  const alertStore = {}
  const env = {
    PUSH_ENABLED: 'true',
    MORNING_BRIEFING_DISPATCH_ENABLED: 'true',
    VERCEL_ENV: 'preview',
    VERCEL_GIT_COMMIT_SHA: 'abcdef0123456789',
  }

  const heartbeatsFresh = {
    [WORKER_NAME_REMINDER_PUSH]: {
      last_success_at: new Date(NOW - 60_000).toISOString(),
      last_status: 'success',
      last_run_id: 'run-fresh',
    },
    [WORKER_NAME_MORNING_BRIEFING]: {
      last_success_at: new Date(NOW - 60_000).toISOString(),
      last_status: 'success',
      last_run_id: 'run-m-fresh',
    },
  }

  await runWorkerHealthAlertCheck({
    now: NOW,
    env,
    checkerRunId: 'check-1',
    loadHeartbeats: async () => heartbeatsFresh,
    loadAlertStates: async () => ({ ...alertStore }),
    saveAlertState: async (row) => {
      alertStore[row.worker_name] = { ...row }
      return { ok: true }
    },
    deliverAlert: (p) => sink.deliver(p),
  })
  assert.equal(sink.sent.length, 0)
  assert.equal(alertStore[WORKER_NAME_REMINDER_PUSH].incident_open, false)
  assert.equal(alertStore[WORKER_NAME_REMINDER_PUSH].current_health, 'healthy')

  // B: stale reminder
  const staleHb = {
    ...heartbeatsFresh,
    [WORKER_NAME_REMINDER_PUSH]: {
      last_success_at: new Date(NOW - 6 * MIN).toISOString(),
      last_status: 'success',
      last_run_id: 'run-stale',
    },
  }
  await runWorkerHealthAlertCheck({
    now: NOW,
    env,
    checkerRunId: 'check-2',
    loadHeartbeats: async () => staleHb,
    loadAlertStates: async () => ({ ...alertStore }),
    saveAlertState: async (row) => {
      alertStore[row.worker_name] = { ...row }
      return { ok: true }
    },
    deliverAlert: (p) => sink.deliver(p),
  })
  assert.equal(sink.sent.length, 1)
  assert.equal(sink.sent[0].kind, 'open')
  assert.equal(sink.sent[0].workerName, WORKER_NAME_REMINDER_PUSH)
  assert.equal(sink.sent[0].health, 'stale')
  assert.match(String(sink.sent[0].summary), /\[ShinkAIdo Preview\]/)
  assert.equal(alertStore[WORKER_NAME_REMINDER_PUSH].incident_open, true)
  assertOpsAlertPayloadSafe(sink.sent[0])

  // C: still stale → no duplicate
  await runWorkerHealthAlertCheck({
    now: NOW + 60_000,
    env,
    checkerRunId: 'check-3',
    loadHeartbeats: async () => staleHb,
    loadAlertStates: async () => ({ ...alertStore }),
    saveAlertState: async (row) => {
      alertStore[row.worker_name] = { ...row }
      return { ok: true }
    },
    deliverAlert: (p) => sink.deliver(p),
  })
  assert.equal(sink.sent.length, 1)

  // D: stale → failed → no spam
  const failedHb = {
    ...staleHb,
    [WORKER_NAME_REMINDER_PUSH]: {
      last_success_at: new Date(NOW - 10 * MIN).toISOString(),
      last_failure_at: new Date(NOW - 1 * MIN).toISOString(),
      last_status: 'failure',
      last_error_code: 'claim_failed',
      last_run_id: 'run-fail',
    },
  }
  await runWorkerHealthAlertCheck({
    now: NOW + 120_000,
    env,
    checkerRunId: 'check-4',
    loadHeartbeats: async () => failedHb,
    loadAlertStates: async () => ({ ...alertStore }),
    saveAlertState: async (row) => {
      alertStore[row.worker_name] = { ...row }
      return { ok: true }
    },
    deliverAlert: (p) => sink.deliver(p),
  })
  assert.equal(sink.sent.length, 1)
  assert.equal(alertStore[WORKER_NAME_REMINDER_PUSH].current_health, 'failed')
  assert.equal(alertStore[WORKER_NAME_REMINDER_PUSH].incident_open, true)

  // E: recovery
  await runWorkerHealthAlertCheck({
    now: NOW + 180_000,
    env,
    checkerRunId: 'check-5',
    loadHeartbeats: async () => heartbeatsFresh,
    loadAlertStates: async () => ({ ...alertStore }),
    saveAlertState: async (row) => {
      alertStore[row.worker_name] = { ...row }
      return { ok: true }
    },
    deliverAlert: (p) => sink.deliver(p),
  })
  assert.equal(sink.sent.length, 2)
  assert.equal(sink.sent[1].kind, 'recovery')
  assert.equal(alertStore[WORKER_NAME_REMINDER_PUSH].incident_open, false)

  // F: morning stale
  const morningStale = {
    ...heartbeatsFresh,
    [WORKER_NAME_MORNING_BRIEFING]: {
      last_success_at: new Date(NOW - 16 * MIN).toISOString(),
      last_status: 'success',
      last_run_id: 'run-m-stale',
    },
  }
  await runWorkerHealthAlertCheck({
    now: NOW,
    env,
    checkerRunId: 'check-6',
    loadHeartbeats: async () => morningStale,
    loadAlertStates: async () => ({ ...alertStore }),
    saveAlertState: async (row) => {
      alertStore[row.worker_name] = { ...row }
      return { ok: true }
    },
    deliverAlert: (p) => sink.deliver(p),
  })
  assert.equal(sink.sent.length, 3)
  assert.equal(sink.sent[2].workerName, WORKER_NAME_MORNING_BRIEFING)
  assert.equal(sink.sent[2].health, 'stale')

  // G: disabled — no incident
  const disabledEnv = { ...env, PUSH_ENABLED: 'false' }
  const beforeDisabled = sink.sent.length
  await runWorkerHealthAlertCheck({
    now: NOW,
    env: disabledEnv,
    checkerRunId: 'check-7',
    loadHeartbeats: async () => morningStale,
    loadAlertStates: async () => ({ ...alertStore }),
    saveAlertState: async (row) => {
      alertStore[row.worker_name] = { ...row }
      return { ok: true }
    },
    deliverAlert: (p) => sink.deliver(p),
  })
  // closing open morning incident via disabled may send recovery — allowed (close incident)
  // Reminder/morning both disabled: if morning had open incident, recovery fires once
  assert.ok(sink.sent.length === beforeDisabled || sink.sent.length === beforeDisabled + 1)
  assert.equal(alertStore[WORKER_NAME_REMINDER_PUSH].current_health, 'disabled')
}

// --- sink failure: pending retry, no duplicate open ---
{
  const alertStore = {}
  let failOnce = true
  const deliveries = []
  const env = {
    PUSH_ENABLED: 'true',
    MORNING_BRIEFING_DISPATCH_ENABLED: 'true',
    VERCEL_ENV: 'preview',
  }
  const staleHb = {
    [WORKER_NAME_REMINDER_PUSH]: {
      last_success_at: new Date(NOW - 6 * MIN).toISOString(),
      last_status: 'success',
    },
    [WORKER_NAME_MORNING_BRIEFING]: {
      last_success_at: new Date(NOW - MIN).toISOString(),
      last_status: 'success',
    },
  }
  await runWorkerHealthAlertCheck({
    now: NOW,
    env,
    loadHeartbeats: async () => staleHb,
    loadAlertStates: async () => ({ ...alertStore }),
    saveAlertState: async (row) => {
      alertStore[row.worker_name] = { ...row }
      return { ok: true }
    },
    deliverAlert: async (p) => {
      deliveries.push(p)
      if (failOnce) {
        failOnce = false
        return { ok: false, status: 'failed', errorCode: 'alert_sink_http_500' }
      }
      return { ok: true, status: 'sent' }
    },
    workerNames: [WORKER_NAME_REMINDER_PUSH],
  })
  assert.equal(alertStore[WORKER_NAME_REMINDER_PUSH].incident_open, true)
  assert.equal(alertStore[WORKER_NAME_REMINDER_PUSH].pending_alert_kind, 'open')
  assert.equal(alertStore[WORKER_NAME_REMINDER_PUSH].last_delivery_status, 'failed')
  assert.equal(deliveries.length, 1)

  await runWorkerHealthAlertCheck({
    now: NOW + 60_000,
    env,
    loadHeartbeats: async () => staleHb,
    loadAlertStates: async () => ({ ...alertStore }),
    saveAlertState: async (row) => {
      alertStore[row.worker_name] = { ...row }
      return { ok: true }
    },
    deliverAlert: async (p) => {
      deliveries.push(p)
      return { ok: true, status: 'sent' }
    },
    workerNames: [WORKER_NAME_REMINDER_PUSH],
  })
  assert.equal(deliveries.length, 2)
  assert.equal(alertStore[WORKER_NAME_REMINDER_PUSH].pending_alert_kind, null)
  assert.equal(alertStore[WORKER_NAME_REMINDER_PUSH].last_delivery_status, 'sent')
}

// --- webhook noop without URL ---
{
  const r = await deliverOpsAlertWebhook('', { product: 'ShinkAIdo', kind: 'open' })
  assert.equal(r.status, 'noop')
  assert.equal(r.ok, true)
}

// --- payload builder privacy ---
{
  const p = buildOpsAlertPayload({
    kind: 'open',
    environment: 'preview',
    workerName: WORKER_NAME_REMINDER_PUSH,
    health: 'stale',
    now: NOW,
    lastSuccessAt: new Date(NOW - 10 * MIN).toISOString(),
    lastErrorCode: 'claim_failed',
    runId: 'abc',
    buildId: 'deadbee',
    checkerRunId: 'chk',
  })
  assertOpsAlertPayloadSafe(p)
  assert.equal(p.lastSuccessAgeSec, 600)
  assert.equal('userId' in p, false)
}

// --- public /api/health unchanged ---
{
  const payload = buildPublicHealthPayload({
    VERCEL_ENV: 'production',
    VERCEL_GIT_COMMIT_SHA: '0827e513',
  })
  assert.deepEqual(Object.keys(payload).sort(), ['buildId', 'environment', 'ok', 'status'])
  const sub = read('api/subscription.ts')
  const vercel = read('vercel.json')
  assert.match(vercel, /"source":\s*"\/api\/health"/)
  assert.match(sub, /isPublicHealthProbe/)
  assert.doesNotMatch(sub, /worker_alert_states|incident_open/)
}

// --- evaluator regression ---
assert.equal(
  evaluateWorkerHeartbeat(
    WORKER_NAME_REMINDER_PUSH,
    { last_success_at: new Date(NOW - 2 * MIN).toISOString(), last_status: 'success' },
    { now: NOW, enabled: true },
  ),
  'healthy',
)

// --- migration + edge contracts ---
{
  const mig = read('supabase/migrations/20260826140000_worker_alert_states_387c.sql')
  assert.match(mig, /worker_alert_states/)
  assert.match(mig, /ENABLE ROW LEVEL SECURITY/)
  assert.match(mig, /REVOKE ALL ON TABLE public\.worker_alert_states FROM anon/)
  assert.match(mig, /GRANT ALL ON TABLE public\.worker_alert_states TO service_role/)
  for (const bad of ['user_id', 'email', 'endpoint', 'prompt', 'token']) {
    assert.doesNotMatch(mig, new RegExp(`\\b${bad}\\b`, 'i'))
  }
  for (const col of WORKER_ALERT_STATE_COLUMNS) {
    if (col === 'updated_at') continue
    assert.match(mig, new RegExp(col))
  }
  for (const f of WORKER_ALERT_FORBIDDEN_COLUMNS.slice(0, 5)) {
    assert.ok(!WORKER_ALERT_STATE_COLUMNS.includes(f))
  }

  const edge = read('supabase/functions/worker-health-alert-check/index.ts')
  assert.match(edge, /WORKER_HEALTH_ALERT_ENABLED/)
  assert.match(edge, /OPS_ALERT_WEBHOOK_URL/)
  assert.match(edge, /worker_alert_states/)
  assert.match(edge, /decideWorkerAlertTransition/)
  assert.doesNotMatch(edge, /from ['"]openai['"]/)

  const cfg = read('supabase/config.toml')
  assert.match(cfg, /\[functions\.worker-health-alert-check\]/)
  assert.match(cfg, /verify_jwt\s*=\s*false/)
}

assert.equal(existsSync(join(root, 'lib/server/worker-health-alert.js')), true)
assert.equal(existsSync(join(root, 'api/health.ts')), false)

console.log('worker-health-alert-387c.test.mjs: ok')
