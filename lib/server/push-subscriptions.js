/**
 * #303C — Owner-scoped push subscription persistence (service role).
 *
 * Never logs endpoint / p256dh / auth.
 */

import { getServiceSupabase } from './supabase.js'
import { ensureAuthUserRow } from './brain-memory.js'
import { PUSH_SUBSCRIPTION_LIMITS } from './push-field-limits.js'

const SELECT_COLS =
  'id, user_id, endpoint, created_at, updated_at, last_success_at, last_failure_at, disabled_at, last_error_code'

/**
 * @param {{ userId: string, requireExplicitUserId?: boolean }} scope
 */
function requireOwnerUserId(scope) {
  const userId = typeof scope?.userId === 'string' ? scope.userId.trim() : ''
  if (!userId || scope?.requireExplicitUserId !== true) {
    throw new Error('Explicit push subscription owner scope is required')
  }
  return userId
}

/**
 * @param {Record<string, unknown>} row
 */
function mapSubscriptionPublic(row) {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    // Never return endpoint/keys to client list responses by default — only id + status.
    hasEndpoint: Boolean(row.endpoint),
    disabledAt: row.disabled_at == null ? null : String(row.disabled_at),
    lastSuccessAt: row.last_success_at == null ? null : String(row.last_success_at),
    lastFailureAt: row.last_failure_at == null ? null : String(row.last_failure_at),
    lastErrorCode: row.last_error_code == null ? null : String(row.last_error_code),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }
}

/**
 * @typedef {{
 *   endpoint: string,
 *   p256dh: string,
 *   auth: string,
 *   userAgent: string | null,
 * }} PushSubscribeData
 *
 * @typedef {{ ok: true, data: PushSubscribeData } | { ok: false, errors: Record<string, string> }} PushSubscribeValidation
 */

/**
 * Validate subscribe payload. Ignores any user_id fields (caller must strip).
 * @param {Record<string, unknown>} input
 * @returns {PushSubscribeValidation}
 */
export function validatePushSubscribeInput(input) {
  /** @type {Record<string, string>} */
  const errors = {}

  const endpoint = typeof input.endpoint === 'string' ? input.endpoint.trim() : ''
  if (!endpoint) {
    errors.endpoint = 'endpoint is required'
  } else if (endpoint.length > PUSH_SUBSCRIPTION_LIMITS.endpoint) {
    errors.endpoint = 'endpoint too long'
  } else {
    try {
      const u = new URL(endpoint)
      if (u.protocol !== 'https:') {
        errors.endpoint = 'endpoint must be https'
      }
    } catch {
      errors.endpoint = 'endpoint must be a valid URL'
    }
  }

  const keys =
    input.keys && typeof input.keys === 'object' && !Array.isArray(input.keys)
      ? /** @type {Record<string, unknown>} */ (input.keys)
      : null

  const p256dhRaw = keys?.p256dh ?? input.p256dh
  const authRaw = keys?.auth ?? input.auth

  const p256dh = typeof p256dhRaw === 'string' ? p256dhRaw.trim() : ''
  const auth = typeof authRaw === 'string' ? authRaw.trim() : ''

  if (!p256dh) errors.p256dh = 'p256dh is required'
  else if (p256dh.length > PUSH_SUBSCRIPTION_LIMITS.p256dh) errors.p256dh = 'p256dh too long'

  if (!auth) errors.auth = 'auth is required'
  else if (auth.length > PUSH_SUBSCRIPTION_LIMITS.auth) errors.auth = 'auth too long'

  let userAgent = null
  if (input.user_agent != null || input.userAgent != null) {
    const raw = input.user_agent ?? input.userAgent
    if (raw != null && raw !== '' && typeof raw !== 'string') {
      errors.user_agent = 'user_agent must be a string'
    } else if (typeof raw === 'string') {
      const trimmed = raw.trim()
      if (trimmed.length > PUSH_SUBSCRIPTION_LIMITS.userAgent) {
        errors.user_agent = 'user_agent too long'
      } else {
        userAgent = trimmed || null
      }
    }
  }

  if (Object.keys(errors).length) return { ok: false, errors }

  return {
    ok: true,
    data: { endpoint, p256dh, auth, userAgent },
  }
}

/**
 * Upsert by unique endpoint; reassigns ownership to current JWT user.
 * @param {PushSubscribeData} data
 * @param {{ userId: string, requireExplicitUserId?: boolean }} scope
 */
export async function upsertPushSubscription(data, scope) {
  const userId = requireOwnerUserId(scope)
  const supabase = await getServiceSupabase()
  await ensureAuthUserRow(supabase, userId)

  const { data: row, error } = await supabase
    .from('push_subscriptions')
    .upsert(
      {
        user_id: userId,
        endpoint: data.endpoint,
        p256dh: data.p256dh,
        auth: data.auth,
        user_agent: data.userAgent,
        disabled_at: null,
        last_error_code: null,
      },
      { onConflict: 'endpoint' },
    )
    .select(SELECT_COLS)
    .single()

  if (error) {
    throw new Error(`push_subscribe_failed:${error.code || 'unknown'}`)
  }
  return mapSubscriptionPublic(row)
}

/**
 * Soft-disable or hard-delete by endpoint for owner.
 * @param {string} endpoint
 * @param {{ userId: string, requireExplicitUserId?: boolean }} scope
 * @param {{ hardDelete?: boolean }} [opts]
 */
export async function unsubscribePushSubscription(endpoint, scope, opts = {}) {
  const userId = requireOwnerUserId(scope)
  const ep = typeof endpoint === 'string' ? endpoint.trim() : ''
  if (!ep) return { ok: false, code: 'endpoint_required' }
  const supabase = await getServiceSupabase()

  if (opts.hardDelete) {
    const { data, error } = await supabase
      .from('push_subscriptions')
      .delete()
      .eq('user_id', userId)
      .eq('endpoint', ep)
      .select('id')
      .maybeSingle()
    if (error) throw new Error(`push_unsubscribe_failed:${error.code || 'unknown'}`)
    return { ok: Boolean(data?.id), code: data?.id ? 'deleted' : 'not_found' }
  }

  const { data, error } = await supabase
    .from('push_subscriptions')
    .update({
      disabled_at: new Date().toISOString(),
      last_error_code: 'user_unsubscribed',
    })
    .eq('user_id', userId)
    .eq('endpoint', ep)
    .select(SELECT_COLS)
    .maybeSingle()

  if (error) throw new Error(`push_unsubscribe_failed:${error.code || 'unknown'}`)
  return {
    ok: Boolean(data?.id),
    code: data?.id ? 'disabled' : 'not_found',
    subscription: data ? mapSubscriptionPublic(data) : null,
  }
}

/**
 * List active (non-disabled) subscription summaries for owner (no secrets).
 * @param {{ userId: string, requireExplicitUserId?: boolean }} scope
 */
export async function listPushSubscriptions(scope) {
  const userId = requireOwnerUserId(scope)
  const supabase = await getServiceSupabase()
  const { data, error } = await supabase
    .from('push_subscriptions')
    .select(SELECT_COLS)
    .eq('user_id', userId)
    .is('disabled_at', null)
    .order('updated_at', { ascending: false })
    .limit(20)

  if (error) throw new Error(`push_list_failed:${error.code || 'unknown'}`)
  return (data || []).map(mapSubscriptionPublic)
}

/**
 * Worker helper — active subscriptions with secrets (service role only; never log).
 * @param {string} userId
 * @param {{ supabase?: { from: Function } }} [opts]
 */
export async function listActivePushSubscriptionsForWorker(userId, opts = {}) {
  const uid = typeof userId === 'string' ? userId.trim() : ''
  if (!uid) return []
  const supabase = opts.supabase || (await getServiceSupabase())
  const { data, error } = await supabase
    .from('push_subscriptions')
    .select('id, user_id, endpoint, p256dh, auth, disabled_at')
    .eq('user_id', uid)
    .is('disabled_at', null)
    .limit(25)

  if (error) throw new Error(`push_worker_list_failed:${error.code || 'unknown'}`)
  return data || []
}

export function pushSubscriptionOwnerScope(userId) {
  return { userId, requireExplicitUserId: true }
}
