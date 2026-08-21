/**
 * #334D1 — Supabase Edge Function: morning-briefing-dispatch
 *
 * Schedule-only dispatcher (no Calendar / Reminders / Weather / model):
 *   auth → PUSH_ENABLED → claim_due_morning_briefings → Web Push → finalize/clear
 *
 * Privacy-safe payload only. Does NOT reuse reminder claim RPCs.
 *
 * DO NOT schedule live cron from this PR — see README-334D1-MORNING-BRIEFING.md
 */

import { createClient } from 'npm:@supabase/supabase-js@2'
import * as webpush from 'jsr:@negrel/webpush@0.3'

const MAX_BATCH = 50
const WINDOW_MINUTES = 10

type ClaimRow = {
  user_id: string
  local_time: string
  days_of_week: number[]
  timezone: string
  local_date: string
  local_hhmm: string
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

function logSafe(fields: Record<string, unknown>) {
  console.log(
    JSON.stringify({
      route: 'morning-briefing-dispatch',
      ...fields,
    }),
  )
}

function authorize(req: Request): boolean {
  // Prefer dedicated secret; fall back to reminder worker secret for shared ops.
  const secret =
    env('MORNING_BRIEFING_WORKER_SECRET') || env('REMINDER_PUSH_WORKER_SECRET')
  if (!secret) return false
  const header = req.headers.get('authorization') || ''
  const bearer = header.toLowerCase().startsWith('bearer ')
    ? header.slice(7).trim()
    : ''
  const alt =
    (req.headers.get('x-morning-briefing-secret') || '').trim() ||
    (req.headers.get('x-reminder-push-secret') || '').trim()
  return timingSafeEqual(bearer, secret) || timingSafeEqual(alt, secret)
}

function buildPayload(localDate: string) {
  return {
    type: 'morning_briefing',
    title: 'ShinkAIdo',
    body: 'Il tuo briefing mattutino è pronto.',
    url: '/?briefing=morning',
    tag: `morning-briefing:${localDate}`,
    timestamp: Date.now(),
  }
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
  const pushEnabled = isTruthy(env('PUSH_ENABLED'))
  if (!pushEnabled && !manualSmoke) {
    logSafe({ runId, claimStatus: 'push_disabled', ok: true, durationMs: Date.now() - started })
    return json(200, { ok: true, skipped: 'push_disabled', runId })
  }

  const morningEnabled = isTruthy(env('MORNING_BRIEFING_DISPATCH_ENABLED'))
  if (!morningEnabled && !manualSmoke) {
    logSafe({
      runId,
      claimStatus: 'morning_dispatch_disabled',
      ok: true,
      durationMs: Date.now() - started,
    })
    return json(200, { ok: true, skipped: 'morning_dispatch_disabled', runId })
  }

  const supabaseUrl = env('SUPABASE_URL')
  const serviceKey = env('SUPABASE_SERVICE_ROLE_KEY')
  const vapidKeysJson = env('VAPID_KEYS_JSON')
  const vapidSubject = env('VAPID_SUBJECT') || 'mailto:ops@shinkaido.local'

  if (!supabaseUrl || !serviceKey || !vapidKeysJson) {
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
    logSafe({ runId, code: 'push_vapid_json_invalid', ok: false })
    return json(503, { error: 'misconfigured', code: 'push_vapid_json_invalid', runId })
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const claimOwner = `morning-edge:${runId}`
  const nowIso =
    typeof body.now === 'string' && body.now.trim() ? body.now.trim() : new Date().toISOString()

  const { data: claimed, error: claimErr } = await supabase.rpc('claim_due_morning_briefings', {
    p_now: nowIso,
    p_window_minutes: WINDOW_MINUTES,
    p_limit: MAX_BATCH,
    p_claim_owner: claimOwner,
  })

  if (claimErr) {
    logSafe({ runId, code: 'claim_failed', ok: false, detail: String(claimErr.message || '') })
    return json(500, { error: 'claim_failed', runId })
  }

  const rows = (Array.isArray(claimed) ? claimed : []) as ClaimRow[]
  logSafe({ runId, claimStatus: 'claimed', batchSize: rows.length, ok: true })

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
    const userId = row.user_id
    const localDate = String(row.local_date).slice(0, 10)
    try {
      const { data: subs } = await supabase
        .from('push_subscriptions')
        .select('id, endpoint, p256dh, auth')
        .eq('user_id', userId)
        .is('disabled_at', null)
        .limit(25)

      const active = Array.isArray(subs) ? subs : []
      if (active.length === 0) {
        await supabase.rpc('clear_morning_briefing_delivery_claim', {
          p_user_id: userId,
          p_claim_owner: claimOwner,
        })
        released += 1
        logSafe({ runId, userId, claimStatus: 'no_subscriptions', ok: true })
        continue
      }

      const payload = buildPayload(localDate)
      let anyAccepted = false

      for (const sub of active) {
        try {
          const subscription = {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          }
          const subscriber = appServer.subscribe(subscription)
          await subscriber.pushTextMessage(JSON.stringify(payload), {
            ttl: 60 * 60,
            urgency: 'normal',
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
            userId,
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
          logSafe({
            runId,
            userId,
            subscriptionId: sub.id,
            channel: 'web_push',
            code: classified.code,
            ok: false,
          })
        }
      }

      if (anyAccepted) {
        await supabase.rpc('finalize_morning_briefing_delivery', {
          p_user_id: userId,
          p_local_date: localDate,
          p_claim_owner: claimOwner,
        })
        pushed += 1
      } else {
        await supabase.rpc('clear_morning_briefing_delivery_claim', {
          p_user_id: userId,
          p_claim_owner: claimOwner,
        })
        failed += 1
        released += 1
      }
    } catch (_err) {
      await supabase.rpc('clear_morning_briefing_delivery_claim', {
        p_user_id: userId,
        p_claim_owner: claimOwner,
      })
      failed += 1
      released += 1
    }
  }

  logSafe({
    runId,
    ok: true,
    pushed,
    failed,
    released,
    durationMs: Date.now() - started,
  })

  return json(200, {
    ok: true,
    runId,
    claimed: rows.length,
    pushed,
    failed,
    released,
    durationMs: Date.now() - started,
  })
})
