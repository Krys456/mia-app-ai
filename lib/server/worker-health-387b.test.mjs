/**
 * #387B — Worker health evaluator + /api/health + heartbeat privacy contracts.
 * Run: node --experimental-strip-types lib/server/worker-health-387b.test.mjs
 */

import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sendJson } from './http.js'
import {
  WORKER_HEALTH_STATES,
  WORKER_HEARTBEAT_COLUMNS,
  WORKER_HEARTBEAT_FORBIDDEN_COLUMNS,
  WORKER_NAME_MORNING_BRIEFING,
  WORKER_NAME_REMINDER_PUSH,
  WORKER_STALE_THRESHOLD_MS,
  buildPublicHealthPayload,
  evaluateSystemHealth,
  evaluateWorkerHeartbeat,
  isMorningBriefingDispatchEnabled,
  isMorningBriefingWorkerExpected,
  isPublicHealthProbe,
  isReminderPushWorkerExpected,
  resolvePublicEnvironment,
  staleThresholdMsForWorker,
  writeWorkerHeartbeatSafe,
} from './worker-health.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel) => readFileSync(join(root, rel), 'utf8')

const NOW = Date.parse('2026-08-26T12:00:00.000Z')
const MIN = 60_000

// --- Thresholds centralized ---
assert.equal(WORKER_STALE_THRESHOLD_MS[WORKER_NAME_REMINDER_PUSH], 5 * MIN)
assert.equal(WORKER_STALE_THRESHOLD_MS[WORKER_NAME_MORNING_BRIEFING], 15 * MIN)
assert.equal(staleThresholdMsForWorker(WORKER_NAME_REMINDER_PUSH), 5 * MIN)
assert.equal(staleThresholdMsForWorker(WORKER_NAME_MORNING_BRIEFING), 15 * MIN)
assert.deepEqual([...WORKER_HEALTH_STATES].sort(), [
  'disabled',
  'failed',
  'healthy',
  'stale',
  'unknown',
])

// --- Fresh reminder → healthy ---
assert.equal(
  evaluateWorkerHeartbeat(
    WORKER_NAME_REMINDER_PUSH,
    { last_success_at: new Date(NOW - 2 * MIN).toISOString(), last_status: 'success' },
    { now: NOW, enabled: true },
  ),
  'healthy',
)

// --- Stale reminder → stale ---
assert.equal(
  evaluateWorkerHeartbeat(
    WORKER_NAME_REMINDER_PUSH,
    { last_success_at: new Date(NOW - 6 * MIN).toISOString(), last_status: 'success' },
    { now: NOW, enabled: true },
  ),
  'stale',
)

// --- Fresh morning → healthy ---
assert.equal(
  evaluateWorkerHeartbeat(
    WORKER_NAME_MORNING_BRIEFING,
    { last_success_at: new Date(NOW - 10 * MIN).toISOString(), last_status: 'success' },
    { now: NOW, enabled: true },
  ),
  'healthy',
)

// --- Stale morning → stale ---
assert.equal(
  evaluateWorkerHeartbeat(
    WORKER_NAME_MORNING_BRIEFING,
    { last_success_at: new Date(NOW - 16 * MIN).toISOString(), last_status: 'success' },
    { now: NOW, enabled: true },
  ),
  'stale',
)

// --- Missing row → unknown ---
assert.equal(
  evaluateWorkerHeartbeat(WORKER_NAME_REMINDER_PUSH, null, { now: NOW, enabled: true }),
  'unknown',
)

// --- Recent failure newer than success → failed ---
assert.equal(
  evaluateWorkerHeartbeat(
    WORKER_NAME_REMINDER_PUSH,
    {
      last_success_at: new Date(NOW - 2 * MIN).toISOString(),
      last_failure_at: new Date(NOW - 1 * MIN).toISOString(),
      last_status: 'failure',
      last_error_code: 'claim_failed',
    },
    { now: NOW, enabled: true },
  ),
  'failed',
)

// --- Disabled kill switch → disabled ---
assert.equal(
  evaluateWorkerHeartbeat(
    WORKER_NAME_REMINDER_PUSH,
    { last_success_at: new Date(NOW - 1 * MIN).toISOString(), last_status: 'success' },
    { now: NOW, enabled: false },
  ),
  'disabled',
)

assert.equal(
  evaluateWorkerHeartbeat(
    WORKER_NAME_MORNING_BRIEFING,
    { last_status: 'disabled', last_started_at: new Date(NOW).toISOString() },
    { now: NOW, enabled: true },
  ),
  'disabled',
)

// --- claimed=0 successful run (fresh success) → healthy ---
assert.equal(
  evaluateWorkerHeartbeat(
    WORKER_NAME_REMINDER_PUSH,
    {
      last_success_at: new Date(NOW - 30_000).toISOString(),
      last_status: 'success',
      last_duration_ms: 12,
      last_run_id: '00000000-0000-4000-8000-000000000001',
    },
    { now: NOW, enabled: true },
  ),
  'healthy',
)

// --- Kill switch helpers ---
assert.equal(isReminderPushWorkerExpected({}), false)
assert.equal(isReminderPushWorkerExpected({ PUSH_ENABLED: 'true' }), true)
assert.equal(isMorningBriefingDispatchEnabled({}), false)
assert.equal(isMorningBriefingDispatchEnabled({ MORNING_BRIEFING_DISPATCH_ENABLED: '1' }), true)
assert.equal(
  isMorningBriefingWorkerExpected({
    PUSH_ENABLED: 'true',
    MORNING_BRIEFING_DISPATCH_ENABLED: 'true',
  }),
  true,
)
assert.equal(
  isMorningBriefingWorkerExpected({
    PUSH_ENABLED: 'true',
    MORNING_BRIEFING_DISPATCH_ENABLED: 'false',
  }),
  false,
)

// --- System evaluator wires kill switches ---
{
  const result = await evaluateSystemHealth({
    now: NOW,
    env: { PUSH_ENABLED: 'false', MORNING_BRIEFING_DISPATCH_ENABLED: 'false' },
    probeSupabase: async () => 'healthy',
    loadHeartbeats: async () => ({
      [WORKER_NAME_REMINDER_PUSH]: {
        last_success_at: new Date(NOW - MIN).toISOString(),
        last_status: 'success',
      },
      [WORKER_NAME_MORNING_BRIEFING]: {
        last_success_at: new Date(NOW - MIN).toISOString(),
        last_status: 'success',
      },
    }),
  })
  assert.equal(result.api, 'healthy')
  assert.equal(result.supabase, 'healthy')
  assert.equal(result.workers[WORKER_NAME_REMINDER_PUSH], 'disabled')
  assert.equal(result.workers[WORKER_NAME_MORNING_BRIEFING], 'disabled')
}

// --- Heartbeat write failure does not throw / returns ok:false ---
{
  const logs = []
  const throwingClient = {
    from() {
      return {
        async upsert() {
          throw new Error('db down')
        },
      }
    },
  }
  const out = await writeWorkerHeartbeatSafe(
    throwingClient,
    {
      worker_name: WORKER_NAME_REMINDER_PUSH,
      last_status: 'success',
      user_id: 'MUST_NOT_BE_WRITTEN',
      email: 'leak@example.com',
      title: 'secret reminder',
    },
    (f) => logs.push(f),
  )
  assert.equal(out.ok, false)
  assert.equal(logs[0]?.code, 'heartbeat_write_failed')
}

{
  /** @type {Record<string, unknown>[]} */
  const upserts = []
  const client = {
    from(table) {
      assert.equal(table, 'worker_heartbeats')
      return {
        async upsert(values) {
          upserts.push(values)
          return { error: null }
        },
      }
    },
  }
  const out = await writeWorkerHeartbeatSafe(client, {
    worker_name: WORKER_NAME_REMINDER_PUSH,
    last_status: 'success',
    last_success_at: new Date(NOW).toISOString(),
    last_run_id: 'run-1',
    user_id: 'should-strip',
    endpoint: 'https://evil.example/push',
  })
  assert.equal(out.ok, true)
  assert.equal(upserts.length, 1)
  assert.equal(upserts[0].worker_name, WORKER_NAME_REMINDER_PUSH)
  assert.equal(upserts[0].user_id, undefined)
  assert.equal(upserts[0].endpoint, undefined)
  for (const forbidden of WORKER_HEARTBEAT_FORBIDDEN_COLUMNS) {
    assert.equal(Object.prototype.hasOwnProperty.call(upserts[0], forbidden), false)
  }
}

// --- Public payload privacy ---
{
  const payload = buildPublicHealthPayload({
    VERCEL_ENV: 'preview',
    VERCEL_GIT_COMMIT_SHA: 'abcdef0123456789',
    SUPABASE_URL: 'https://zqoqvspjccsrwrmoxweb.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'secret-must-not-appear',
  })
  assert.equal(payload.ok, true)
  assert.equal(payload.status, 'ok')
  assert.equal(payload.buildId, 'abcdef0')
  assert.equal(payload.environment, 'preview')
  const json = JSON.stringify(payload)
  assert.doesNotMatch(json, /zqoqvspjccsrwrmoxweb|scrvnhwlkorgxbmmsrmv|secret|worker_heartbeats|supabase/i)
  assert.equal('workers' in payload, false)
  assert.equal('supabase' in payload, false)
}

assert.equal(resolvePublicEnvironment({ VERCEL_ENV: 'production' }), 'production')
assert.equal(resolvePublicEnvironment({}), 'development')

assert.equal(isPublicHealthProbe({ query: { probe: 'public_health' }, url: '/api/subscription' }), true)
assert.equal(isPublicHealthProbe({ query: {}, url: '/api/health' }), true)
assert.equal(isPublicHealthProbe({ query: {}, url: '/api/subscription' }), false)

// --- /api/health handler contracts (Hobby-safe rewrite into subscription) ---
{
  const api = read('api/subscription.ts')
  const vercel = read('vercel.json')
  assert.match(api, /buildPublicHealthPayload/)
  assert.match(api, /isPublicHealthProbe/)
  assert.match(api, /Cache-Control.*no-store/)
  assert.match(api, /method_not_allowed/)
  assert.match(api, /sendJson/)
  assert.match(api, /ensureRequestContext/)
  assert.match(vercel, /"source":\s*"\/api\/health"/)
  assert.match(vercel, /probe=public_health/)
  assert.doesNotMatch(vercel, /api\/health\.ts/)
  assert.equal(existsSync(join(root, 'api/health.ts')), false)
  assert.doesNotMatch(api, /evaluateSystemHealth|worker_heartbeats|SUPABASE_SERVICE_ROLE/)
  assert.doesNotMatch(api, /Sentry|OpenTelemetry|analytics/i)
}

// --- sendJson + no-store simulation for GET health ---
{
  const req = { url: '/api/health', headers: {} }
  /** @type {Record<string, string>} */
  const headers = {}
  let statusCode = 0
  /** @type {Record<string, unknown> | null} */
  let body = null
  const res = {
    setHeader(k, v) {
      headers[String(k).toLowerCase()] = String(v)
    },
    status(code) {
      statusCode = code
      return {
        json(payload) {
          body = payload
          return this
        },
      }
    },
  }
  res.setHeader('Cache-Control', 'no-store')
  sendJson(res, 200, buildPublicHealthPayload({ VERCEL_ENV: 'production', VERCEL_GIT_COMMIT_SHA: 'deadbeef' }), req)
  assert.equal(statusCode, 200)
  assert.equal(headers['cache-control'], 'no-store')
  assert.ok(typeof headers['x-request-id'] === 'string' && headers['x-request-id'].length > 10)
  assert.equal(body?.ok, true)
  assert.equal(body?.status, 'ok')
  assert.equal(body?.environment, 'production')
  assert.ok(typeof body?.buildId === 'string')
  assert.equal(body?.requestId, undefined) // success body stays minimal
  for (const key of Object.keys(body || {})) {
    assert.ok(['ok', 'status', 'buildId', 'environment'].includes(key), `unexpected field ${key}`)
  }
}

// --- Migration privacy + RLS ---
{
  const mig = read('supabase/migrations/20260826120000_worker_heartbeats_387b.sql')
  assert.match(mig, /CREATE TABLE IF NOT EXISTS public\.worker_heartbeats/)
  assert.match(mig, /ENABLE ROW LEVEL SECURITY/)
  assert.match(mig, /REVOKE ALL ON TABLE public\.worker_heartbeats FROM anon/)
  assert.match(mig, /REVOKE ALL ON TABLE public\.worker_heartbeats FROM authenticated/)
  assert.match(mig, /GRANT ALL ON TABLE public\.worker_heartbeats TO service_role/)
  assert.match(mig, /reminder-push-dispatch/)
  assert.match(mig, /morning-briefing-dispatch/)
  for (const col of WORKER_HEARTBEAT_COLUMNS) {
    if (col === 'updated_at') continue
    assert.match(mig, new RegExp(col))
  }
  for (const bad of ['user_id', 'email', 'title', 'endpoint', 'prompt', 'token']) {
    assert.doesNotMatch(mig, new RegExp(`\\b${bad}\\b`, 'i'))
  }
}

// --- Edge instrumentation ---
{
  const reminder = read('supabase/functions/reminder-push-dispatch/index.ts')
  const morning = read('supabase/functions/morning-briefing-dispatch/index.ts')
  const shared = read('supabase/functions/_shared/worker-heartbeat.ts')
  assert.match(shared, /writeWorkerHeartbeatSafe/)
  assert.match(shared, /heartbeat_write_failed/)
  assert.match(shared, /sanitizeHeartbeatPatch/)
  assert.match(reminder, /markWorkerSuccess/)
  assert.match(reminder, /markWorkerFailure/)
  assert.match(reminder, /markWorkerDisabled/)
  assert.match(reminder, /claimed=0/)
  assert.match(morning, /markWorkerSuccess/)
  assert.match(morning, /markWorkerDisabled/)
  assert.match(morning, /WORKER_NAME_MORNING_BRIEFING/)
  // Heartbeat failure must not abort primary path (safe helper + await without throw).
  assert.match(shared, /Never throws|never throw/i)
}

// --- vercel.json keeps Hobby 12; health is a rewrite ---
{
  const vercel = JSON.parse(read('vercel.json'))
  assert.equal(Object.keys(vercel.functions).length, 12)
  assert.ok(vercel.functions['api/subscription.ts'])
  assert.ok(
    (vercel.rewrites || []).some(
      (r) => r.source === '/api/health' && String(r.destination).includes('probe=public_health'),
    ),
  )
}

assert.equal(existsSync(join(root, 'lib/server/worker-health.js')), true)

console.log('worker-health-387b.test.mjs: ok')
