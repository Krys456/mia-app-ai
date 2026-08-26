/**
 * #303C — Supabase Edge Function: reminder-push-dispatch
 *
 * Delivery consumer for due reminders:
 *   auth → PUSH_ENABLED → claim_due_reminders → Web Push → release/retry
 *
 * CLAIMED != PUSH SENT != DELIVERED
 * Never marks delivered. Never calls OpenAI.
 * Never accepts arbitrary endpoints/titles from the caller.
 *
 * Web Push library: jsr:@negrel/webpush (Deno/Web Crypto; Node `web-push` is unsuitable).
 *
 * DO NOT schedule live cron from this PR — see README-303C-PUSH.md
 */

import { createClient } from 'npm:@supabase/supabase-js@2'
import * as webpush from 'jsr:@negrel/webpush@0.3'
import {
  WORKER_NAME_REMINDER_PUSH,
  markWorkerDisabled,
  markWorkerFailure,
  markWorkerStarted,
  markWorkerSuccess,
} from '../_shared/worker-heartbeat.ts'

const MAX_BATCH = 25
const LEASE_SECONDS = 120
const MAX_ATTEMPTS = 5
const WORKER_NAME = WORKER_NAME_REMINDER_PUSH

type ClaimRow = {
  id: string
  user_id: string
  status: string
  fire_at: string
  snooze_until: string | null
  delivery_attempts: number
  claim_owner: string
  claim_expires_at: string
}

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

function classifyStatus(status: number | null, message = '') {
  const msg = message.toLowerCase()
  if (status === 404 || status === 410) {
    return {
      retryable: false,
      disable: true,
      code: status === 410 ? 'push_subscription_gone' : 'push_subscription_not_found',
    }
  }
  if (status === 401 || status === 403) {
    return { retryable: false, disable: false, code: 'push_vapid_or_auth_failed' }
  }
  if (status === 429) return { retryable: true, disable: false, code: 'push_throttled' }
  if (status != null && status >= 500) {
    return { retryable: true, disable: false, code: 'push_provider_5xx' }
  }
  if (status != null && status >= 200 && status < 300) {
    return { retryable: false, disable: false, code: 'push_accepted' }
  }
  if (/timeout|network|fetch failed/.test(msg)) {
    return { retryable: true, disable: false, code: 'push_network_error' }
  }
  return { retryable: true, disable: false, code: 'push_unknown_error' }
}

function retryDelaySeconds(attempt: number) {
  const n = Math.max(1, Math.min(attempt, 8))
  return Math.min(60 * 2 ** (n - 1), 32 * 60)
}

function sanitizeTitle(title: string) {
  return String(title || '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 200) || 'Promemoria'
}

function logSafe(fields: Record<string, unknown>) {
  console.log(
    JSON.stringify({
      route: 'reminder-push-dispatch',
      ...fields,
    }),
  )
}

function authorize(req: Request): boolean {
  const secret = env('REMINDER_PUSH_WORKER_SECRET')
  if (!secret) return false
  const header = req.headers.get('authorization') || ''
  const bearer = header.toLowerCase().startsWith('bearer ')
    ? header.slice(7).trim()
    : ''
  const alt = (req.headers.get('x-reminder-push-secret') || '').trim()
  return timingSafeEqual(bearer, secret) || timingSafeEqual(alt, secret)
}

Deno.serve(async (req) => {
  const started = Date.now()
  const runId = crypto.randomUUID()

  if (req.method !== 'POST') {
    return json(405, { error: 'method_not_allowed', runId })
  }

  if (!authorize(req)) {
    logSafe({ runId, code: 'worker_unauthorized', ok: false })
    return json(401, { error: 'unauthorized', code: 'worker_unauthorized', runId })
  }

  // Caller must NOT supply arbitrary push targets/content.
  let body: Record<string, unknown> = {}
  try {
    const text = await req.text()
    if (text) body = JSON.parse(text)
  } catch {
    return json(400, { error: 'invalid_json', runId })
  }
  if (body.endpoint || body.payload || body.title || body.user_id || body.reminder_id) {
    return json(400, {
      error: 'relay_forbidden',
      code: 'worker_not_a_push_relay',
      runId,
    })
  }

  const manualSmoke = body.mode === 'manual_smoke'
  const supabaseUrl = env('SUPABASE_URL')
  const serviceKey = env('SUPABASE_SERVICE_ROLE_KEY')
  const supabase =
    supabaseUrl && serviceKey
      ? createClient(supabaseUrl, serviceKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        })
      : null

  const pushEnabled = isTruthy(env('PUSH_ENABLED'))
  if (!pushEnabled) {
    await markWorkerDisabled(supabase, WORKER_NAME, runId, Date.now() - started, logSafe)
    logSafe({ runId, claimStatus: 'push_disabled', ok: true, durationMs: Date.now() - started })
    return json(200, { ok: true, skipped: 'push_disabled', runId })
  }

  const vapidKeysJson = env('VAPID_KEYS_JSON')
  const vapidSubject = env('VAPID_SUBJECT') || 'mailto:ops@shinkaido.local'

  if (!supabaseUrl || !serviceKey || !vapidKeysJson || !supabase) {
    await markWorkerFailure(
      supabase,
      WORKER_NAME,
      runId,
      Date.now() - started,
      'push_misconfigured',
      logSafe,
    )
    logSafe({ runId, code: 'push_misconfigured', ok: false })
    return json(503, { error: 'misconfigured', code: 'push_misconfigured', runId })
  }

  let vapidExported: { publicKey: JsonWebKey; privateKey: JsonWebKey }
  try {
    vapidExported = JSON.parse(vapidKeysJson)
    if (!vapidExported?.publicKey || !vapidExported?.privateKey) {
      throw new Error('invalid_vapid_json')
    }
  } catch {
    await markWorkerFailure(
      supabase,
      WORKER_NAME,
      runId,
      Date.now() - started,
      'push_vapid_json_invalid',
      logSafe,
    )
    logSafe({ runId, code: 'push_vapid_json_invalid', ok: false })
    return json(503, { error: 'misconfigured', code: 'push_vapid_json_invalid', runId })
  }

  // Preview/Production guard: optional explicit allowlist.
  const allowEnv = env('REMINDER_PUSH_ALLOW_ENV') // e.g. production
  const runtimeEnv = env('VERCEL_ENV') || env('SHINKAIDO_RUNTIME_ENV') || ''
  if (allowEnv && runtimeEnv && allowEnv !== runtimeEnv && !manualSmoke) {
    await markWorkerDisabled(supabase, WORKER_NAME, runId, Date.now() - started, logSafe)
    logSafe({ runId, claimStatus: 'env_blocked', code: 'push_env_blocked', ok: true })
    return json(200, { ok: true, skipped: 'env_blocked', runId })
  }

  await markWorkerStarted(supabase, WORKER_NAME, runId, logSafe)

  if (!manualSmoke) {
    const { data: cfg, error: cfgErr } = await supabase
      .from('reminder_scheduler_config')
      .select('enabled')
      .eq('id', 1)
      .maybeSingle()
    if (cfgErr) {
      await markWorkerFailure(
        supabase,
        WORKER_NAME,
        runId,
        Date.now() - started,
        'scheduler_config_error',
        logSafe,
      )
      logSafe({ runId, code: 'scheduler_config_error', ok: false })
      return json(500, { error: 'config_error', runId })
    }
    if (!cfg?.enabled) {
      await markWorkerDisabled(supabase, WORKER_NAME, runId, Date.now() - started, logSafe)
      logSafe({ runId, claimStatus: 'scheduler_disabled', ok: true, durationMs: Date.now() - started })
      return json(200, { ok: true, skipped: 'scheduler_disabled', runId })
    }
  }

  const claimOwner = `edge:${runId}`
  const { data: claimed, error: claimErr } = await supabase.rpc('claim_due_reminders', {
    p_claim_owner: claimOwner,
    p_limit: MAX_BATCH,
    p_lease_seconds: LEASE_SECONDS,
  })

  if (claimErr) {
    await markWorkerFailure(
      supabase,
      WORKER_NAME,
      runId,
      Date.now() - started,
      'claim_failed',
      logSafe,
    )
    logSafe({ runId, code: 'claim_failed', ok: false })
    return json(500, { error: 'claim_failed', runId })
  }

  const rows = (Array.isArray(claimed) ? claimed : []) as ClaimRow[]
  logSafe({ runId, claimStatus: 'claimed', batchSize: rows.length, ok: true })

  // Import VAPID once per invocation (JWK from negrel generate-vapid-keys).
  const vapidKeys = await webpush.importVapidKeys(vapidExported)
  const appServer = await webpush.ApplicationServer.new({
    contactInformation: vapidSubject.startsWith('mailto:')
      ? vapidSubject
      : `mailto:${vapidSubject}`,
    vapidKeys,
  })

  let pushed = 0
  let failed = 0
  let released = 0

  for (const row of rows) {
    const reminderId = row.id
    try {
      // Content only after claim — lease-scoped fetch (no claim RPC title/body expansion).
      const { data: full, error: fullErr } = await supabase
        .from('reminders')
        .select('id, user_id, title, status, claim_owner, claim_expires_at, push_sent_at, delivery_attempts')
        .eq('id', reminderId)
        .eq('claim_owner', claimOwner)
        .maybeSingle()

      if (fullErr || !full) {
        failed += 1
        continue
      }
      if (full.push_sent_at) {
        await supabase.rpc('release_reminder_claim', {
          p_reminder_id: reminderId,
          p_claim_owner: claimOwner,
          p_outcome: 'release',
        })
        released += 1
        continue
      }
      if (full.status !== 'pending' && full.status !== 'snoozed') {
        await supabase.rpc('release_reminder_claim', {
          p_reminder_id: reminderId,
          p_claim_owner: claimOwner,
          p_outcome: 'release',
        })
        released += 1
        continue
      }

      const { data: subs } = await supabase
        .from('push_subscriptions')
        .select('id, endpoint, p256dh, auth')
        .eq('user_id', full.user_id)
        .is('disabled_at', null)
        .limit(25)

      const active = Array.isArray(subs) ? subs : []
      if (active.length === 0) {
        // No subs — release; keep pending for next-open.
        await supabase.rpc('release_reminder_claim', {
          p_reminder_id: reminderId,
          p_claim_owner: claimOwner,
          p_outcome: 'release',
        })
        released += 1
        logSafe({
          runId,
          reminderId,
          claimStatus: 'no_subscriptions',
          ok: true,
        })
        continue
      }

      const payload = {
        reminderId,
        title: sanitizeTitle(String(full.title || '')),
        body: '',
        url: `/?reminder=${encodeURIComponent(reminderId)}`,
        tag: reminderId,
        timestamp: Date.now(),
      }

      let anyAccepted = false
      let retryableFailure = false
      let lastCode = 'push_unknown_error'
      const attempts = Number(full.delivery_attempts) || 0

      for (const sub of active) {
        try {
          const subscription = {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          }
          const subscriber = appServer.subscribe(subscription)
          // #380G — high urgency for time-sensitive due reminders (Android/FCM Doze).
          // @negrel/webpush Urgency.High === "high" → Urgency header.
          // Do not use high for morning-briefing or other push domains.
          await subscriber.pushTextMessage(JSON.stringify(payload), {
            ttl: 60 * 60,
            urgency: 'high',
          })
          anyAccepted = true
          await supabase
            .from('push_subscriptions')
            .update({
              last_success_at: new Date().toISOString(),
              last_error_code: null,
            })
            .eq('id', sub.id)
          logSafe({
            runId,
            reminderId,
            subscriptionId: sub.id,
            channel: 'web_push',
            code: 'push_accepted',
            ok: true,
          })
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          const statusMatch = message.match(/\b(4\d\d|5\d\d)\b/)
          const status = statusMatch ? Number(statusMatch[1]) : null
          const classified = classifyStatus(status, message)
          lastCode = classified.code
          if (classified.disable) {
            await supabase
              .from('push_subscriptions')
              .update({
                disabled_at: new Date().toISOString(),
                last_failure_at: new Date().toISOString(),
                last_error_code: classified.code,
              })
              .eq('id', sub.id)
          } else {
            await supabase
              .from('push_subscriptions')
              .update({
                last_failure_at: new Date().toISOString(),
                last_error_code: classified.code,
              })
              .eq('id', sub.id)
          }
          if (classified.retryable) retryableFailure = true
          logSafe({
            runId,
            reminderId,
            subscriptionId: sub.id,
            channel: 'web_push',
            code: classified.code,
            ok: false,
          })
        }
      }

      if (anyAccepted) {
        // PUSH SENT — still NOT delivered.
        await supabase
          .from('reminders')
          .update({
            push_sent_at: new Date().toISOString(),
            delivery_attempts: attempts + 1,
            last_error_code: null,
          })
          .eq('id', reminderId)
          .eq('claim_owner', claimOwner)

        await supabase.rpc('release_reminder_claim', {
          p_reminder_id: reminderId,
          p_claim_owner: claimOwner,
          p_outcome: 'release',
        })
        pushed += 1
        released += 1
      } else if (retryableFailure && attempts + 1 < MAX_ATTEMPTS) {
        const delay = retryDelaySeconds(attempts + 1)
        const next = new Date(Date.now() + delay * 1000).toISOString()
        await supabase.rpc('release_reminder_claim', {
          p_reminder_id: reminderId,
          p_claim_owner: claimOwner,
          p_outcome: 'retry',
          p_error_code: lastCode,
          p_next_attempt_at: next,
          p_increment_attempt: true,
        })
        failed += 1
        released += 1
      } else {
        // Exhausted or non-retryable — release, keep pending for next-open.
        await supabase.rpc('release_reminder_claim', {
          p_reminder_id: reminderId,
          p_claim_owner: claimOwner,
          p_outcome: 'retry',
          p_error_code: lastCode,
          p_next_attempt_at: null,
          p_increment_attempt: true,
        })
        // Far-future next_attempt would block forever; leave null after max so
        // claim still excludes via attempts? Actually claim doesn't check attempts.
        // Set next_attempt far only if we want to stop push retries but allow reclaim...
        // Spec: after terminal push failure, keep pending for next-open; don't spam.
        // Set push_sent_at? NO — that would block and imply success.
        // Set next_attempt_at to null and use a high delivery_attempts; worker should
        // skip when attempts >= MAX even if claimed... Claim still picks them up.
        // Fix: set next_attempt_at far in the future to stop reclaim spam.
        if (attempts + 1 >= MAX_ATTEMPTS) {
          const far = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString()
          await supabase
            .from('reminders')
            .update({ next_attempt_at: far, last_error_code: lastCode })
            .eq('id', reminderId)
        }
        failed += 1
        released += 1
      }
    } catch (_err) {
      failed += 1
      try {
        await supabase.rpc('release_reminder_claim', {
          p_reminder_id: reminderId,
          p_claim_owner: claimOwner,
          p_outcome: 'retry',
          p_error_code: 'push_worker_exception',
          p_next_attempt_at: new Date(Date.now() + 120_000).toISOString(),
          p_increment_attempt: true,
        })
        released += 1
      } catch {
        /* ignore */
      }
    }
  }

  const durationMs = Date.now() - started
  // claimed=0 (idle) is still a successful healthy worker run.
  await markWorkerSuccess(supabase, WORKER_NAME, runId, durationMs, logSafe)

  logSafe({
    runId,
    claimStatus: 'tick_done',
    batchSize: rows.length,
    pushed,
    failed,
    released,
    durationMs,
    ok: true,
  })

  return json(200, {
    ok: true,
    runId,
    claimed: rows.length,
    pushed,
    failed,
    released,
    durationMs,
  })
})
