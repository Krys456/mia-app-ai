/**
 * #303B — Reminder scheduler foundation (claim/lease interfaces).
 *
 * CLAIMED != DELIVERED. These helpers never mark reminder status delivered.
 * Live recurring cron remains OFF until #303C (or an explicit operator enable).
 *
 * No OpenAI. No Vercel /api/cron route. Service-role RPC only.
 */

import { getServiceSupabase } from './supabase.js'
import { logApiEvent } from './safe-log.js'

/** Default claim batch size for a future delivery worker. */
export const REMINDER_CLAIM_BATCH_LIMIT = 25

/** Hard ceiling matching SQL LEAST(..., 100). */
export const REMINDER_CLAIM_BATCH_MAX = 100

/** Default lease duration in seconds. */
export const REMINDER_CLAIM_LEASE_SECONDS = 120

/** Minimum / maximum lease bounds (match SQL). */
export const REMINDER_CLAIM_LEASE_MIN_SECONDS = 30
export const REMINDER_CLAIM_LEASE_MAX_SECONDS = 3600

/** RPC names (Postgres). */
export const CLAIM_DUE_REMINDERS_RPC = 'claim_due_reminders'
export const RELEASE_REMINDER_CLAIM_RPC = 'release_reminder_claim'
export const RUN_SCHEDULER_TICK_RPC = 'run_reminder_scheduler_tick'

/**
 * Clamp batch limit to SQL-safe bounds.
 * @param {unknown} limit
 */
export function clampClaimBatchLimit(limit) {
  const n = Number(limit)
  if (!Number.isFinite(n)) return REMINDER_CLAIM_BATCH_LIMIT
  return Math.min(Math.max(Math.trunc(n), 1), REMINDER_CLAIM_BATCH_MAX)
}

/**
 * Clamp lease seconds to SQL-safe bounds.
 * @param {unknown} seconds
 */
export function clampClaimLeaseSeconds(seconds) {
  const n = Number(seconds)
  if (!Number.isFinite(n)) return REMINDER_CLAIM_LEASE_SECONDS
  return Math.min(
    Math.max(Math.trunc(n), REMINDER_CLAIM_LEASE_MIN_SECONDS),
    REMINDER_CLAIM_LEASE_MAX_SECONDS,
  )
}

/**
 * Active lease: claim_expires_at > now.
 * @param {{ claimExpiresAt?: string | null, claim_expires_at?: string | null }} row
 * @param {Date | number} [now]
 */
export function isClaimLeaseActive(row, now = new Date()) {
  const raw = row?.claimExpiresAt ?? row?.claim_expires_at
  if (raw == null || raw === '') return false
  const expires = new Date(raw).getTime()
  if (!Number.isFinite(expires)) return false
  const nowMs = now instanceof Date ? now.getTime() : Number(now)
  return expires > nowMs
}

/**
 * Stale lease: claim_expires_at set and <= now (eligible for reclaim).
 * @param {{ claimExpiresAt?: string | null, claim_expires_at?: string | null }} row
 * @param {Date | number} [now]
 */
export function isClaimLeaseStale(row, now = new Date()) {
  const raw = row?.claimExpiresAt ?? row?.claim_expires_at
  if (raw == null || raw === '') return false
  return !isClaimLeaseActive(row, now)
}

/**
 * Pure eligibility mirror of claim_due_reminders SQL (unit-testable).
 * Does not mutate status. Terminal rows never eligible.
 *
 * @param {{
 *   status: string,
 *   fireAt?: string,
 *   fire_at?: string,
 *   snoozeUntil?: string | null,
 *   snooze_until?: string | null,
 *   claimExpiresAt?: string | null,
 *   claim_expires_at?: string | null,
 *   nextAttemptAt?: string | null,
 *   next_attempt_at?: string | null,
 * }} row
 * @param {Date | number} [now]
 */
export function isEligibleForSchedulerClaim(row, now = new Date()) {
  const nowMs = now instanceof Date ? now.getTime() : Number(now)
  const status = String(row?.status || '')

  if (status === 'delivered' || status === 'completed' || status === 'cancelled') {
    return false
  }

  let due = false
  if (status === 'pending') {
    const fireAt = row.fireAt ?? row.fire_at
    due = fireAt != null && new Date(fireAt).getTime() <= nowMs
  } else if (status === 'snoozed') {
    const snoozeUntil = row.snoozeUntil ?? row.snooze_until
    due = snoozeUntil != null && new Date(snoozeUntil).getTime() <= nowMs
  } else {
    return false
  }
  if (!due) return false

  if (isClaimLeaseActive(row, nowMs)) return false

  const nextAttempt = row.nextAttemptAt ?? row.next_attempt_at
  if (nextAttempt != null && nextAttempt !== '') {
    if (new Date(nextAttempt).getTime() > nowMs) return false
  }

  // #303C: successful push already sent → do not re-claim (prevents minute spam).
  const pushSent = row.pushSentAt ?? row.push_sent_at
  if (pushSent != null && pushSent !== '') return false

  return true
}

/**
 * Simulate SKIP LOCKED atomic claim for overlapping-worker unit tests.
 * Assigns lease metadata; never changes status to delivered.
 *
 * @param {Array<Record<string, unknown>>} rows
 * @param {{ claimOwner: string, limit?: number, leaseSeconds?: number, now?: Date }} opts
 */
export function simulateAtomicClaimBatch(rows, opts) {
  const now = opts.now || new Date()
  const limit = clampClaimBatchLimit(opts.limit)
  const leaseSeconds = clampClaimLeaseSeconds(opts.leaseSeconds)
  const owner = String(opts.claimOwner || '').trim()
  if (!owner) throw new Error('claim_owner_required')

  const eligible = rows
    .filter((r) => isEligibleForSchedulerClaim(r, now))
    .sort((a, b) => {
      const aKey = String(a.snoozeUntil ?? a.snooze_until ?? a.fireAt ?? a.fire_at ?? '')
      const bKey = String(b.snoozeUntil ?? b.snooze_until ?? b.fireAt ?? b.fire_at ?? '')
      const cmp = aKey.localeCompare(bKey)
      if (cmp !== 0) return cmp
      return String(a.id).localeCompare(String(b.id))
    })
    .slice(0, limit)

  const claimedAt = now.toISOString()
  const claimExpiresAt = new Date(now.getTime() + leaseSeconds * 1000).toISOString()

  return eligible.map((row) => {
    // Mutate in place to simulate DB lock for overlapping workers.
    row.claim_owner = owner
    row.claimOwner = owner
    row.claimed_at = claimedAt
    row.claimedAt = claimedAt
    row.claim_expires_at = claimExpiresAt
    row.claimExpiresAt = claimExpiresAt
    // status untouched
    return {
      id: row.id,
      userId: row.userId ?? row.user_id,
      status: row.status,
      fireAt: row.fireAt ?? row.fire_at,
      snoozeUntil: row.snoozeUntil ?? row.snooze_until ?? null,
      timezone: row.timezone,
      channels: row.channels,
      deliveryAttempts: row.deliveryAttempts ?? row.delivery_attempts ?? 0,
      claimOwner: owner,
      claimedAt,
      claimExpiresAt,
      nextAttemptAt: row.nextAttemptAt ?? row.next_attempt_at ?? null,
    }
  })
}

/**
 * Map RPC claim row → worker-facing shape (no title/body).
 * @param {Record<string, unknown>} row
 */
export function mapClaimedReminder(row) {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    status: String(row.status),
    fireAt: String(row.fire_at),
    snoozeUntil: row.snooze_until == null ? null : String(row.snooze_until),
    timezone: String(row.timezone ?? ''),
    channels: Array.isArray(row.channels) ? row.channels.map(String) : ['in_app'],
    deliveryAttempts: Number(row.delivery_attempts) || 0,
    claimOwner: row.claim_owner == null ? null : String(row.claim_owner),
    claimedAt: row.claimed_at == null ? null : String(row.claimed_at),
    claimExpiresAt: row.claim_expires_at == null ? null : String(row.claim_expires_at),
    nextAttemptAt: row.next_attempt_at == null ? null : String(row.next_attempt_at),
  }
}

/**
 * Privacy-safe scheduler log (#298C philosophy). Never title/body/JWT/keys.
 * @param {Record<string, unknown>} fields
 */
export function logReminderSchedulerEvent(fields) {
  const allowed = {
    route: 'reminder-scheduler',
    reminderId: typeof fields.reminderId === 'string' ? fields.reminderId : undefined,
    claimOwner: typeof fields.claimOwner === 'string' ? fields.claimOwner : undefined,
    claimStatus: typeof fields.claimStatus === 'string' ? fields.claimStatus : undefined,
    attemptNumber:
      typeof fields.attemptNumber === 'number' && Number.isFinite(fields.attemptNumber)
        ? fields.attemptNumber
        : undefined,
    batchSize:
      typeof fields.batchSize === 'number' && Number.isFinite(fields.batchSize)
        ? fields.batchSize
        : undefined,
    durationMs:
      typeof fields.durationMs === 'number' && Number.isFinite(fields.durationMs)
        ? fields.durationMs
        : undefined,
    code: typeof fields.code === 'string' ? fields.code : undefined,
    ok: typeof fields.ok === 'boolean' ? fields.ok : undefined,
  }
  /** @type {Record<string, unknown>} */
  const safe = {}
  for (const [k, v] of Object.entries(allowed)) {
    if (v !== undefined) safe[k] = v
  }
  logApiEvent(safe)
}

/**
 * Atomically claim due reminder work via service-role RPC.
 * Does not mark delivered. Intended for a future #303C delivery consumer.
 *
 * @param {{
 *   claimOwner: string,
 *   limit?: number,
 *   leaseSeconds?: number,
 *   supabase?: { rpc: Function },
 * }} opts
 */
export async function claimDueReminders(opts) {
  const claimOwner = typeof opts?.claimOwner === 'string' ? opts.claimOwner.trim() : ''
  if (!claimOwner) {
    throw new Error('claim_owner_required')
  }
  const limit = clampClaimBatchLimit(opts.limit)
  const leaseSeconds = clampClaimLeaseSeconds(opts.leaseSeconds)
  const started = Date.now()
  const supabase = opts.supabase || (await getServiceSupabase())

  const { data, error } = await supabase.rpc(CLAIM_DUE_REMINDERS_RPC, {
    p_claim_owner: claimOwner,
    p_limit: limit,
    p_lease_seconds: leaseSeconds,
  })

  if (error) {
    logReminderSchedulerEvent({
      claimOwner,
      claimStatus: 'claim_failed',
      batchSize: 0,
      durationMs: Date.now() - started,
      code: error.code || 'claim_rpc_failed',
      ok: false,
    })
    throw new Error(`reminder_claim_failed:${error.code || 'unknown'}`)
  }

  const rows = Array.isArray(data) ? data.map(mapClaimedReminder) : []
  logReminderSchedulerEvent({
    claimOwner,
    claimStatus: 'claimed',
    batchSize: rows.length,
    durationMs: Date.now() - started,
    ok: true,
  })
  return rows
}

/**
 * Release or retry a lease. Never marks delivered.
 *
 * @param {{
 *   reminderId: string,
 *   claimOwner: string,
 *   outcome?: 'release' | 'retry',
 *   errorCode?: string | null,
 *   nextAttemptAt?: string | Date | null,
 *   incrementAttempt?: boolean,
 *   supabase?: { rpc: Function },
 * }} opts
 */
export async function releaseReminderClaim(opts) {
  const reminderId = typeof opts?.reminderId === 'string' ? opts.reminderId.trim() : ''
  const claimOwner = typeof opts?.claimOwner === 'string' ? opts.claimOwner.trim() : ''
  if (!reminderId) throw new Error('reminder_id_required')
  if (!claimOwner) throw new Error('claim_owner_required')

  const outcome = opts.outcome === 'retry' ? 'retry' : 'release'
  const started = Date.now()
  const supabase = opts.supabase || (await getServiceSupabase())

  let nextAttemptAt = null
  if (opts.nextAttemptAt != null && opts.nextAttemptAt !== '') {
    nextAttemptAt =
      opts.nextAttemptAt instanceof Date
        ? opts.nextAttemptAt.toISOString()
        : String(opts.nextAttemptAt)
  }

  const { data, error } = await supabase.rpc(RELEASE_REMINDER_CLAIM_RPC, {
    p_reminder_id: reminderId,
    p_claim_owner: claimOwner,
    p_outcome: outcome,
    p_error_code: opts.errorCode ?? null,
    p_next_attempt_at: nextAttemptAt,
    p_increment_attempt: Boolean(opts.incrementAttempt),
  })

  if (error) {
    logReminderSchedulerEvent({
      reminderId,
      claimOwner,
      claimStatus: 'release_failed',
      durationMs: Date.now() - started,
      code: error.code || 'release_rpc_failed',
      ok: false,
    })
    throw new Error(`reminder_release_failed:${error.code || 'unknown'}`)
  }

  const ok = data === true
  logReminderSchedulerEvent({
    reminderId,
    claimOwner,
    claimStatus: outcome === 'retry' ? 'retry_scheduled' : 'released',
    durationMs: Date.now() - started,
    code: typeof opts.errorCode === 'string' ? opts.errorCode : undefined,
    ok,
  })
  return ok
}

/**
 * Cron-facing tick via kill-switch wrapper. Returns [] when scheduler disabled.
 * Do not wire to a live cron from this PR.
 *
 * @param {{
 *   claimOwner?: string,
 *   limit?: number,
 *   leaseSeconds?: number,
 *   supabase?: { rpc: Function },
 * }} [opts]
 */
export async function runReminderSchedulerTick(opts = {}) {
  const claimOwner =
    typeof opts.claimOwner === 'string' && opts.claimOwner.trim()
      ? opts.claimOwner.trim()
      : 'pg_cron'
  const limit = clampClaimBatchLimit(opts.limit)
  const leaseSeconds = clampClaimLeaseSeconds(opts.leaseSeconds)
  const started = Date.now()
  const supabase = opts.supabase || (await getServiceSupabase())

  const { data, error } = await supabase.rpc(RUN_SCHEDULER_TICK_RPC, {
    p_claim_owner: claimOwner,
    p_limit: limit,
    p_lease_seconds: leaseSeconds,
  })

  if (error) {
    logReminderSchedulerEvent({
      claimOwner,
      claimStatus: 'tick_failed',
      batchSize: 0,
      durationMs: Date.now() - started,
      code: error.code || 'tick_rpc_failed',
      ok: false,
    })
    throw new Error(`reminder_scheduler_tick_failed:${error.code || 'unknown'}`)
  }

  const rows = Array.isArray(data) ? data.map(mapClaimedReminder) : []
  logReminderSchedulerEvent({
    claimOwner,
    claimStatus: rows.length ? 'tick_claimed' : 'tick_idle',
    batchSize: rows.length,
    durationMs: Date.now() - started,
    ok: true,
  })
  return rows
}

/**
 * #303C boundary contract (documentation helper — no Push).
 * due → claim → delivery consumer → persist result → release/update lease
 */
export const REMINDER_303C_DELIVERY_CONTRACT = Object.freeze({
  steps: [
    'due_reminder_eligible',
    'atomic_claim',
    'delivery_consumer_receives_claim',
    'web_push_adapter',
    'persist_delivery_result',
    'release_or_update_lease',
  ],
  claimedDoesNotMeanDelivered: true,
  pushOutOfScopeIn303B: true,
})

/** Lease columns cleared on terminal owner-API transitions. */
export const REMINDER_LEASE_CLEAR_ON_TERMINAL = Object.freeze([
  'claim_owner',
  'claimed_at',
  'claim_expires_at',
])
