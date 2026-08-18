/**
 * #303C — Pure worker-auth + safe-gate helpers for the reminder-push-dispatch
 * Edge Function. Mirrors the Deno function's inline auth so the Production
 * contract can be unit-tested in Node (same pattern as reminder-push-protocol.js).
 *
 * No OpenAI. Never logs secrets. Never accepts arbitrary push targets.
 *
 * Production contract (platform verify_jwt=false, see supabase/config.toml):
 *   POST /functions/v1/reminder-push-dispatch
 *   Authorization: Bearer <REMINDER_PUSH_WORKER_SECRET>
 *   (or) x-reminder-push-secret: <REMINDER_PUSH_WORKER_SECRET>
 * No Supabase user/anon JWT is required for the cron worker.
 */

/**
 * Constant-time string compare (length-independent early return is acceptable
 * because the secret length is not itself a secret).
 * @param {string} a
 * @param {string} b
 */
export function timingSafeEqual(a, b) {
  const sa = String(a ?? '')
  const sb = String(b ?? '')
  if (sa.length !== sb.length) return false
  let out = 0
  for (let i = 0; i < sa.length; i += 1) out |= sa.charCodeAt(i) ^ sb.charCodeAt(i)
  return out === 0
}

/**
 * Read the presented worker secret from either supported header.
 * @param {Headers | Record<string, string> | undefined | null} headers
 * @returns {{ bearer: string, alt: string }}
 */
export function extractWorkerSecret(headers) {
  const get = (name) => {
    if (!headers) return ''
    if (typeof headers.get === 'function') return headers.get(name) || ''
    return headers[name] ?? headers[name.toLowerCase()] ?? ''
  }
  const authorization = String(get('authorization') || '')
  const bearer = authorization.toLowerCase().startsWith('bearer ')
    ? authorization.slice(7).trim()
    : ''
  const alt = String(get('x-reminder-push-secret') || '').trim()
  return { bearer, alt }
}

/**
 * Authorize a worker request against the configured secret. Accepts the secret
 * via `Authorization: Bearer <secret>` or `x-reminder-push-secret: <secret>`.
 * Fail-closed: an empty/undefined configured secret never authorizes.
 * @param {Headers | Record<string, string> | undefined | null} headers
 * @param {string | undefined | null} secret
 * @returns {boolean}
 */
export function authorizeWorkerRequest(headers, secret) {
  const configured = String(secret ?? '').trim()
  if (!configured) return false
  const { bearer, alt } = extractWorkerSecret(headers)
  return timingSafeEqual(bearer, configured) || timingSafeEqual(alt, configured)
}

const RELAY_KEYS = ['endpoint', 'payload', 'title', 'user_id', 'reminder_id']

/**
 * The worker is not a push relay: callers must not supply push targets/content.
 * @param {Record<string, unknown> | null | undefined} body
 */
export function isPushRelayAttempt(body) {
  if (!body || typeof body !== 'object') return false
  return RELAY_KEYS.some((k) => body[k] != null && body[k] !== '')
}

/**
 * PUSH_ENABLED truthiness (matches the Edge function's isTruthy).
 * @param {string | undefined | null} raw
 */
export function isPushEnabled(raw) {
  const v = String(raw ?? '').trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'yes'
}

/**
 * Evaluate the safe (no-DB) portion of the worker: method, auth, relay, and the
 * PUSH_ENABLED gate. Returns the terminal `{ status, body }` for those gates, or
 * `null` when the request is authorized AND push is enabled (proceed to claim).
 *
 * @param {object} args
 * @param {string} [args.method]
 * @param {Headers | Record<string, string>} args.headers
 * @param {Record<string, unknown>} [args.body]
 * @param {string} args.secret               configured REMINDER_PUSH_WORKER_SECRET
 * @param {string} args.pushEnabledRaw        raw PUSH_ENABLED value
 * @returns {{ status: number, body: Record<string, unknown> } | null}
 */
export function evaluateWorkerGate({ method = 'POST', headers, body = {}, secret, pushEnabledRaw }) {
  if (method !== 'POST') return { status: 405, body: { error: 'method_not_allowed' } }
  if (!authorizeWorkerRequest(headers, secret)) {
    return { status: 401, body: { error: 'unauthorized', code: 'worker_unauthorized' } }
  }
  if (isPushRelayAttempt(body)) {
    return { status: 400, body: { error: 'relay_forbidden', code: 'worker_not_a_push_relay' } }
  }
  if (!isPushEnabled(pushEnabledRaw)) {
    return { status: 200, body: { ok: true, skipped: 'push_disabled' } }
  }
  return null
}
