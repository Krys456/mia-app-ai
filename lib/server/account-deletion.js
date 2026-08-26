/**
 * #386C — Account deletion orchestrator (service-role server only).
 *
 * Identity: verified JWT auth.uid() only — never trust client user_id.
 * Job table has NO FK to public.users so state survives CASCADE.
 * Auth identity deleted LAST via auth.admin.deleteUser.
 *
 * Never logs OAuth tokens, endpoints, or message content.
 */

import { getServiceSupabase } from './supabase.js'
import { decryptToken } from './calendar-token-crypto.js'
import { isAccountDeletionEnabled } from './account-deletion-enabled.js'
import {
  cancelStripeSubscriptionsForDeletion,
  findCancelableStripeSubscriptionIds,
} from './stripe-billing.js'
import { resolveBillingEnvironment } from './stripe-config.js'

/** Ordered steps; resume skips those already in last_completed_step chain. */
export const ACCOUNT_DELETION_STEPS = Object.freeze([
  'oauth_calendar',
  'oauth_gmail',
  'push',
  'briefing',
  'reminders',
  'memories',
  // #388B — CRITICAL Stripe cancel BEFORE local subscription wipe / auth delete.
  'stripe_cancel',
  'defensive_schema',
  'public_users',
  'aux',
  'auth_user',
])

/**
 * @param {string | null | undefined} lastCompleted
 * @param {string} step
 */
export function shouldRunStep(lastCompleted, step) {
  if (!lastCompleted) return true
  const doneIdx = ACCOUNT_DELETION_STEPS.indexOf(lastCompleted)
  const stepIdx = ACCOUNT_DELETION_STEPS.indexOf(step)
  if (stepIdx < 0) return false
  if (doneIdx < 0) return true
  return stepIdx > doneIdx
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 */
function resolveSupabaseUrl(env = process.env) {
  const raw =
    (typeof env.SUPABASE_URL === 'string' && env.SUPABASE_URL.trim()) ||
    (typeof env.VITE_SUPABASE_URL === 'string' && env.VITE_SUPABASE_URL.trim()) ||
    ''
  return raw.replace(/\/+$/, '')
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 */
function resolveAnonKey(env = process.env) {
  return (
    (typeof env.SUPABASE_ANON_KEY === 'string' && env.SUPABASE_ANON_KEY.trim()) ||
    (typeof env.VITE_SUPABASE_ANON_KEY === 'string' && env.VITE_SUPABASE_ANON_KEY.trim()) ||
    ''
  )
}

/**
 * Best-effort Google token revoke. Never throws.
 * @param {string} token
 */
export async function revokeGoogleOAuthToken(token) {
  const t = typeof token === 'string' ? token.trim() : ''
  if (!t) return { ok: false, code: 'empty_token' }
  try {
    const res = await fetch('https://oauth2.googleapis.com/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: t }),
    })
    return { ok: res.ok || res.status === 400, code: res.ok ? 'revoked' : `http_${res.status}` }
  } catch {
    return { ok: false, code: 'network_error' }
  }
}

/**
 * Call existing Edge disconnect (reuses revoke + wipe). Best-effort.
 * @param {'calendar' | 'email'} kind
 * @param {string} accessToken user JWT
 * @param {NodeJS.ProcessEnv} [env]
 */
export async function callEdgeDisconnect(kind, accessToken, env = process.env) {
  const base = resolveSupabaseUrl(env)
  const anon = resolveAnonKey(env)
  const token = typeof accessToken === 'string' ? accessToken.trim() : ''
  if (!base || !anon || !token) {
    return { ok: false, code: 'edge_unavailable' }
  }
  const slug = kind === 'calendar' ? 'calendar-connection' : 'email-connection'
  try {
    const res = await fetch(`${base}/functions/v1/${slug}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: anon,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action: 'disconnect' }),
    })
    if (res.status === 404) return { ok: false, code: `${kind}_disabled` }
    if (!res.ok) {
      let code = 'disconnect_failed'
      try {
        const body = await res.json()
        if (typeof body?.code === 'string') code = body.code
      } catch {
        /* soft */
      }
      return { ok: false, code }
    }
    return { ok: true, code: 'disconnected' }
  } catch {
    return { ok: false, code: 'edge_network_error' }
  }
}

/**
 * Decrypt + revoke tokens from a connection row, then hard-delete rows.
 * Local credential destruction is CRITICAL even when revoke fails.
 *
 * @param {{
 *   supabase: { from: Function },
 *   userId: string,
 *   table: 'calendar_connections' | 'email_connections',
 *   encryptionKeyEnv: string | undefined,
 *   accessToken: string,
 *   kind: 'calendar' | 'email',
 *   env?: NodeJS.ProcessEnv,
 * }} opts
 */
export async function revokeAndWipeOAuthConnection(opts) {
  const {
    supabase,
    userId,
    table,
    encryptionKeyEnv,
    accessToken,
    kind,
    env = process.env,
  } = opts

  const edge = await callEdgeDisconnect(kind, accessToken, env)

  // Node-side revoke if Edge did not succeed and we still have ciphertext.
  let nodeRevokeOk = false
  if (!edge.ok && encryptionKeyEnv) {
    const { data: row } = await supabase
      .from(table)
      .select('access_token_enc, refresh_token_enc')
      .eq('user_id', userId)
      .eq('provider', 'google')
      .maybeSingle()

    if (row) {
      const enc =
        (typeof row.refresh_token_enc === 'string' && row.refresh_token_enc) ||
        (typeof row.access_token_enc === 'string' && row.access_token_enc) ||
        null
      if (enc) {
        const dec = await decryptToken(enc, encryptionKeyEnv)
        if (dec.ok) {
          const rev = await revokeGoogleOAuthToken(dec.plaintext)
          nodeRevokeOk = rev.ok
        }
      }
    }
  }

  // CRITICAL: destroy local encrypted credentials / metadata.
  const { error: delErr } = await supabase.from(table).delete().eq('user_id', userId)
  if (delErr) {
    // Fallback wipe if delete fails unexpectedly.
    await supabase
      .from(table)
      .update({
        access_token_enc: null,
        refresh_token_enc: null,
        token_expires_at: null,
        google_sub: null,
        account_email: null,
        scopes: [],
        status: 'disconnected',
        oauth_pending_nonce: null,
        oauth_pending_expires_at: null,
        disconnected_at: new Date().toISOString(),
      })
      .eq('user_id', userId)
  }

  if (edge.ok || nodeRevokeOk) return { status: 'ok' }
  // Local wipe happened; external revoke may have failed.
  return { status: 'wiped_local' }
}

/**
 * @param {{ from: Function }} supabase
 * @param {string} userId
 * @param {string} table
 */
async function hardDeleteByUserId(supabase, userId, table) {
  const { error } = await supabase.from(table).delete().eq('user_id', userId)
  if (error) throw new Error(`${table}_delete_failed`)
}

/**
 * Create or resume an open deletion job for auth_user_id.
 * @param {{ from: Function }} supabase
 * @param {string} authUserId
 */
export async function createOrResumeDeletionJob(supabase, authUserId) {
  const uid = String(authUserId || '').trim()
  if (!uid) throw new Error('auth_user_id_required')

  const { data: completed } = await supabase
    .from('account_deletion_jobs')
    .select('id, auth_user_id, status, last_completed_step, completed_at')
    .eq('auth_user_id', uid)
    .eq('status', 'completed')
    .order('completed_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (completed?.id) {
    return { job: completed, alreadyCompleted: true }
  }

  const { data: open } = await supabase
    .from('account_deletion_jobs')
    .select(
      'id, auth_user_id, status, last_completed_step, last_error_code, calendar_revoke_status, gmail_revoke_status, created_at, updated_at, completed_at',
    )
    .eq('auth_user_id', uid)
    .in('status', ['pending', 'in_progress', 'failed'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (open?.id) {
    const { data: resumed, error } = await supabase
      .from('account_deletion_jobs')
      .update({
        status: 'in_progress',
        last_error_code: null,
      })
      .eq('id', open.id)
      .select(
        'id, auth_user_id, status, last_completed_step, last_error_code, calendar_revoke_status, gmail_revoke_status, created_at, updated_at, completed_at',
      )
      .single()
    if (error) throw new Error('job_resume_failed')
    return { job: resumed, alreadyCompleted: false }
  }

  const { data: created, error: createErr } = await supabase
    .from('account_deletion_jobs')
    .insert({
      auth_user_id: uid,
      status: 'in_progress',
    })
    .select(
      'id, auth_user_id, status, last_completed_step, last_error_code, calendar_revoke_status, gmail_revoke_status, created_at, updated_at, completed_at',
    )
    .single()

  if (createErr) {
    // Race on unique open index — retry read.
    const { data: raced } = await supabase
      .from('account_deletion_jobs')
      .select(
        'id, auth_user_id, status, last_completed_step, last_error_code, calendar_revoke_status, gmail_revoke_status, created_at, updated_at, completed_at',
      )
      .eq('auth_user_id', uid)
      .in('status', ['pending', 'in_progress', 'failed', 'completed'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (raced?.status === 'completed') {
      return { job: raced, alreadyCompleted: true }
    }
    if (raced?.id) {
      return { job: raced, alreadyCompleted: false }
    }
    throw new Error('job_create_failed')
  }

  return { job: created, alreadyCompleted: false }
}

/**
 * @param {{ from: Function }} supabase
 * @param {string} jobId
 * @param {Record<string, unknown>} patch
 */
async function patchJob(supabase, jobId, patch) {
  const { data, error } = await supabase
    .from('account_deletion_jobs')
    .update(patch)
    .eq('id', jobId)
    .select(
      'id, auth_user_id, status, last_completed_step, last_error_code, calendar_revoke_status, gmail_revoke_status, created_at, updated_at, completed_at',
    )
    .single()
  if (error) throw new Error('job_patch_failed')
  return data
}

/**
 * Mark step complete and advance last_completed_step.
 * @param {{ from: Function }} supabase
 * @param {string} jobId
 * @param {string} step
 * @param {Record<string, unknown>} [extra]
 */
async function completeStep(supabase, jobId, step, extra = {}) {
  return patchJob(supabase, jobId, {
    last_completed_step: step,
    last_error_code: null,
    ...extra,
  })
}

/**
 * Run full deletion for verified owner.
 *
 * @param {{
 *   userId: string,
 *   accessToken: string,
 *   env?: NodeJS.ProcessEnv,
 *   getServiceSupabase?: typeof getServiceSupabase,
 *   cancelStripeSubscriptions?: typeof cancelStripeSubscriptionsForDeletion,
 * }} opts
 */
export async function runAccountDeletion(opts) {
  const env = opts.env ?? process.env
  if (!isAccountDeletionEnabled(env)) {
    return {
      ok: false,
      code: 'account_deletion_disabled',
      status: 404,
    }
  }

  const userId = typeof opts.userId === 'string' ? opts.userId.trim() : ''
  const accessToken = typeof opts.accessToken === 'string' ? opts.accessToken.trim() : ''
  if (!userId) {
    return { ok: false, code: 'unauthorized', status: 401 }
  }
  if (!accessToken) {
    return { ok: false, code: 'missing_token', status: 401 }
  }

  const getSb = opts.getServiceSupabase ?? getServiceSupabase
  const supabase = await getSb()
  const cancelStripe =
    opts.cancelStripeSubscriptions ?? cancelStripeSubscriptionsForDeletion

  let jobBundle
  try {
    jobBundle = await createOrResumeDeletionJob(supabase, userId)
  } catch {
    return { ok: false, code: 'job_unavailable', status: 503 }
  }

  if (jobBundle.alreadyCompleted) {
    return {
      ok: true,
      alreadyCompleted: true,
      jobId: jobBundle.job.id,
      code: 'already_deleted',
    }
  }

  let job = jobBundle.job
  const last = job.last_completed_step || null

  try {
    // 1) Calendar OAuth
    if (shouldRunStep(last, 'oauth_calendar')) {
      const cal = await revokeAndWipeOAuthConnection({
        supabase,
        userId,
        table: 'calendar_connections',
        encryptionKeyEnv: env.SHINKAIDO_CALENDAR_ENCRYPTION_KEY,
        accessToken,
        kind: 'calendar',
        env,
      })
      job = await completeStep(supabase, job.id, 'oauth_calendar', {
        calendar_revoke_status: cal.status,
      })
    }

    // 2) Gmail OAuth
    if (shouldRunStep(job.last_completed_step, 'oauth_gmail')) {
      const mail = await revokeAndWipeOAuthConnection({
        supabase,
        userId,
        table: 'email_connections',
        encryptionKeyEnv: env.SHINKAIDO_EMAIL_ENCRYPTION_KEY,
        accessToken,
        kind: 'email',
        env,
      })
      job = await completeStep(supabase, job.id, 'oauth_gmail', {
        gmail_revoke_status: mail.status,
      })
    }

    // 3) Push hard-delete
    if (shouldRunStep(job.last_completed_step, 'push')) {
      await hardDeleteByUserId(supabase, userId, 'push_subscriptions')
      job = await completeStep(supabase, job.id, 'push')
    }

    // 4) Morning briefing
    if (shouldRunStep(job.last_completed_step, 'briefing')) {
      await hardDeleteByUserId(supabase, userId, 'morning_briefing_schedules')
      job = await completeStep(supabase, job.id, 'briefing')
    }

    // 5) Reminders
    if (shouldRunStep(job.last_completed_step, 'reminders')) {
      await hardDeleteByUserId(supabase, userId, 'reminders')
      job = await completeStep(supabase, job.id, 'reminders')
    }

    // 6) Memories (HARD delete — not soft forget)
    if (shouldRunStep(job.last_completed_step, 'memories')) {
      await hardDeleteByUserId(supabase, userId, 'memories')
      job = await completeStep(supabase, job.id, 'memories')
    }

    // 6b) #388B CRITICAL: cancel Stripe subscriptions before local wipe.
    // Failure MUST block auth deletion / success so future charges cannot continue.
    if (shouldRunStep(job.last_completed_step, 'stripe_cancel')) {
      const { data: subRows, error: subErr } = await supabase
        .from('subscriptions')
        .select(
          'provider, environment, provider_customer_id, provider_subscription_id, status, plan_id',
        )
        .eq('user_id', userId)

      if (subErr) {
        throw Object.assign(new Error('stripe_subscription_lookup_failed'), {
          code: 'stripe_subscription_lookup_failed',
        })
      }

      const billingEnv = resolveBillingEnvironment(env)
      const cancelIds = findCancelableStripeSubscriptionIds(subRows || [], billingEnv)
      const cancelResult = await cancelStripe({
        subscriptionIds: cancelIds,
        env,
      })

      if (!cancelResult.ok) {
        throw Object.assign(new Error('stripe_cancel_failed'), {
          code: cancelResult.code || 'stripe_cancel_failed',
        })
      }

      job = await completeStep(supabase, job.id, 'stripe_cancel')
    }

    // 7) Defensive schema (unused tables may still hold rows)
    if (shouldRunStep(job.last_completed_step, 'defensive_schema')) {
      await hardDeleteByUserId(supabase, userId, 'messages')
      await hardDeleteByUserId(supabase, userId, 'conversations')
      await hardDeleteByUserId(supabase, userId, 'settings')
      // subscriptions CASCADE with users; delete early for clarity
      await hardDeleteByUserId(supabase, userId, 'subscriptions')
      job = await completeStep(supabase, job.id, 'defensive_schema')
    }

    // 8) public.users — CASCADE remaining; billing_events.user_id SET NULL
    if (shouldRunStep(job.last_completed_step, 'public_users')) {
      const { error } = await supabase.from('users').delete().eq('id', userId)
      if (error) throw new Error('public_users_delete_failed')
      job = await completeStep(supabase, job.id, 'public_users')
    }

    // 9) Auxiliary (best-effort — Upstash keys not required for success)
    if (shouldRunStep(job.last_completed_step, 'aux')) {
      job = await completeStep(supabase, job.id, 'aux')
    }

    // 10) auth.users LAST
    if (shouldRunStep(job.last_completed_step, 'auth_user')) {
      const { error: authErr } = await supabase.auth.admin.deleteUser(userId)
      if (authErr) {
        // If already gone, treat as success (idempotent retry).
        const msg = String(authErr.message || authErr).toLowerCase()
        const absent =
          /not\s*found|user\s*not\s*found|does\s*not\s*exist|404/.test(msg) ||
          authErr.status === 404
        if (!absent) {
          throw Object.assign(new Error('auth_user_delete_failed'), {
            code: 'auth_user_delete_failed',
          })
        }
      }
      job = await patchJob(supabase, job.id, {
        last_completed_step: 'auth_user',
        status: 'completed',
        completed_at: new Date().toISOString(),
        last_error_code: null,
      })
    } else if (job.status !== 'completed') {
      job = await patchJob(supabase, job.id, {
        status: 'completed',
        completed_at: new Date().toISOString(),
        last_error_code: null,
      })
    }

    return {
      ok: true,
      alreadyCompleted: false,
      jobId: job.id,
      code: 'deleted',
      calendarRevokeStatus: job.calendar_revoke_status || null,
      gmailRevokeStatus: job.gmail_revoke_status || null,
    }
  } catch (err) {
    const code =
      err && typeof err === 'object' && typeof err.code === 'string'
        ? err.code
        : err instanceof Error && err.message
          ? err.message.slice(0, 64)
          : 'deletion_failed'

    try {
      await patchJob(supabase, job.id, {
        status: 'failed',
        last_error_code: code,
      })
    } catch {
      /* soft */
    }

    return {
      ok: false,
      code: 'deletion_incomplete',
      detailCode: code,
      status: 500,
      jobId: job.id,
      retryable: true,
    }
  }
}

/**
 * Reject client-supplied target user ids in body/query.
 * @param {Record<string, unknown> | null | undefined} body
 * @param {URLSearchParams | null | undefined} query
 */
export function rejectClientTargetUserId(body, query) {
  if (body && typeof body === 'object') {
    if ('user_id' in body || 'userId' in body || 'auth_user_id' in body || 'targetUserId' in body) {
      return { rejected: true, code: 'user_id_spoof_rejected' }
    }
  }
  if (query) {
    if (
      query.has('user_id') ||
      query.has('userId') ||
      query.has('auth_user_id') ||
      query.has('targetUserId')
    ) {
      return { rejected: true, code: 'user_id_spoof_rejected' }
    }
  }
  return { rejected: false }
}
