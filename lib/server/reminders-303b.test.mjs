/**
 * #303B — Background reminder scheduler foundation contracts.
 * Run: node --experimental-strip-types --test lib/server/reminders-303b.test.mjs
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'
import { pathToFileURL } from 'node:url'

const root = process.cwd()
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')

const migration = read('supabase/migrations/20260818100000_reminders_scheduler_303b.sql')
const readme = read('supabase/migrations/README-303B-SCHEDULER.md')
const migration303a = read('supabase/migrations/20260818053000_reminders_303a.sql')
const remindersJs = read('lib/server/reminders.js')
const schedulerJs = read('lib/server/reminder-scheduler.js')
const vercel = JSON.parse(read('vercel.json'))
const vercelignore = read('.vercelignore')
const apiIndex = read('api/reminders/index.ts')
const apiId = read('api/reminders/[id].ts')
const chatApi = read('api/chat.ts')
const coreParams = read('lib/server/core-responses-params.js')
const dueDelivery = read('src/lib/dueReminderDelivery.ts')
const dueHost = read('src/components/DueReminderHost.tsx')
const envExample = read('.env.example')

const deployedFunctions = Object.keys(vercel.functions || {})

describe('#303B additive migration + RLS', () => {
  it('adds lease columns without changing statuses or removing #303A fields', () => {
    assert.match(migration, /ADD COLUMN IF NOT EXISTS claim_owner TEXT NULL/)
    assert.match(migration, /ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ NULL/)
    assert.match(migration, /ADD COLUMN IF NOT EXISTS claim_expires_at TIMESTAMPTZ NULL/)
    assert.match(migration, /ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ NULL/)
    assert.doesNotMatch(migration, /DROP COLUMN/)
    assert.doesNotMatch(migration, /CONSTRAINT reminders_status_valid/)
    assert.match(migration303a, /pending.*delivered.*completed.*cancelled.*snoozed/s)
    // OUT-of-scope mentioned in comments only — no CREATE for push tables/packages.
    assert.doesNotMatch(migration, /CREATE TABLE[\s\S]*push_subscriptions/i)
    assert.doesNotMatch(migration, /CREATE EXTENSION|web-push/i)
  })

  it('keeps RLS enabled with zero client policies on reminders', () => {
    assert.match(migration, /ALTER TABLE public\.reminders ENABLE ROW LEVEL SECURITY/)
    assert.match(migration, /Intentionally NO CREATE POLICY on public\.reminders/)
    assert.doesNotMatch(migration, /^\s*CREATE POLICY/m)
    assert.match(migration, /ALTER TABLE public\.reminder_scheduler_config ENABLE ROW LEVEL SECURITY/)
  })

  it('adds only claim-justified indexes', () => {
    assert.match(migration, /reminders_claim_pending_due_idx/)
    assert.match(migration, /reminders_claim_snoozed_due_idx/)
    assert.match(migration, /reminders_claim_expires_at_idx/)
  })
})

describe('#303B RPC security + atomicity contracts', () => {
  it('claim/release/tick are SECURITY DEFINER with fixed search_path', () => {
    assert.match(migration, /CREATE OR REPLACE FUNCTION public\.claim_due_reminders/)
    assert.match(migration, /CREATE OR REPLACE FUNCTION public\.release_reminder_claim/)
    assert.match(migration, /CREATE OR REPLACE FUNCTION public\.run_reminder_scheduler_tick/)
    assert.match(migration, /SECURITY DEFINER/)
    assert.match(migration, /SET search_path = public/)
    assert.match(migration, /FOR UPDATE OF r SKIP LOCKED/)
  })

  it('revokes anon/authenticated/PUBLIC execute; grants service_role', () => {
    for (const fn of [
      'claim_due_reminders',
      'release_reminder_claim',
      'run_reminder_scheduler_tick',
    ]) {
      assert.match(migration, new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}[\\s\\S]*?FROM PUBLIC`))
      assert.match(migration, new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}[\\s\\S]*?FROM anon`))
      assert.match(
        migration,
        new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}[\\s\\S]*?FROM authenticated`),
      )
      assert.match(
        migration,
        new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}[\\s\\S]*?TO service_role`),
      )
    }
  })

  it('claim does not mark delivered and omits title/body from return shape', () => {
    assert.match(migration, /CLAIMED != DELIVERED|status intentionally unchanged/i)
    assert.doesNotMatch(migration, /status\s*=\s*'delivered'/)
    const returnsBlock = migration.slice(
      migration.indexOf('CREATE OR REPLACE FUNCTION public.claim_due_reminders'),
      migration.indexOf('CREATE OR REPLACE FUNCTION public.release_reminder_claim'),
    )
    assert.doesNotMatch(returnsBlock, /\btitle\b/)
    assert.doesNotMatch(returnsBlock, /\bbody\b/)
  })

  it('scheduler kill switch defaults OFF; no live cron.schedule', () => {
    assert.match(migration, /enabled BOOLEAN NOT NULL DEFAULT false/)
    assert.match(migration, /enabled IS TRUE/)
    // Docs may mention cron.schedule as future SQL; migration must not invoke it.
    assert.doesNotMatch(migration, /SELECT\s+cron\.schedule|PERFORM\s+cron\.schedule/i)
    assert.match(migration, /intentionally NOT scheduled/i)
    assert.match(readme, /DO NOT ENABLE|remain OFF|must remain OFF/i)
    assert.match(readme, /job presence\/absence/i)
    assert.doesNotMatch(envExample, /REMINDER_SCHEDULER_ENABLED/)
    assert.match(readme, /cannot[\s*]*read Vercel/i)
  })
})

describe('#303B eligibility + lease simulation', () => {
  it('selects due pending/snoozed; excludes future/terminal/active lease', async () => {
    const mod = await import(pathToFileURL(path.join(root, 'lib/server/reminder-scheduler.js')).href)
    const now = new Date('2026-08-18T12:00:00.000Z')

    assert.equal(
      mod.isEligibleForSchedulerClaim(
        { id: '1', status: 'pending', fire_at: '2026-08-18T11:00:00.000Z' },
        now,
      ),
      true,
    )
    assert.equal(
      mod.isEligibleForSchedulerClaim(
        { id: '2', status: 'pending', fire_at: '2026-08-18T13:00:00.000Z' },
        now,
      ),
      false,
    )
    assert.equal(
      mod.isEligibleForSchedulerClaim(
        { id: '3', status: 'delivered', fire_at: '2026-08-18T11:00:00.000Z' },
        now,
      ),
      false,
    )
    assert.equal(
      mod.isEligibleForSchedulerClaim(
        { id: '4', status: 'completed', fire_at: '2026-08-18T11:00:00.000Z' },
        now,
      ),
      false,
    )
    assert.equal(
      mod.isEligibleForSchedulerClaim(
        { id: '5', status: 'cancelled', fire_at: '2026-08-18T11:00:00.000Z' },
        now,
      ),
      false,
    )
    assert.equal(
      mod.isEligibleForSchedulerClaim(
        {
          id: '6',
          status: 'snoozed',
          fire_at: '2026-08-18T10:00:00.000Z',
          snooze_until: '2026-08-18T13:00:00.000Z',
        },
        now,
      ),
      false,
    )
    assert.equal(
      mod.isEligibleForSchedulerClaim(
        {
          id: '7',
          status: 'snoozed',
          fire_at: '2026-08-18T10:00:00.000Z',
          snooze_until: '2026-08-18T11:30:00.000Z',
        },
        now,
      ),
      true,
    )
    assert.equal(
      mod.isEligibleForSchedulerClaim(
        {
          id: '8',
          status: 'pending',
          fire_at: '2026-08-18T11:00:00.000Z',
          claim_expires_at: '2026-08-18T12:05:00.000Z',
        },
        now,
      ),
      false,
    )
    assert.equal(
      mod.isEligibleForSchedulerClaim(
        {
          id: '9',
          status: 'pending',
          fire_at: '2026-08-18T11:00:00.000Z',
          claim_expires_at: '2026-08-18T11:59:00.000Z',
        },
        now,
      ),
      true,
    )
    assert.equal(
      mod.isEligibleForSchedulerClaim(
        {
          id: '10',
          status: 'pending',
          fire_at: '2026-08-18T11:00:00.000Z',
          next_attempt_at: '2026-08-18T12:30:00.000Z',
        },
        now,
      ),
      false,
    )
  })

  it('stale claim reclaim + batch limit + overlapping workers (SKIP LOCKED sim)', async () => {
    const mod = await import(pathToFileURL(path.join(root, 'lib/server/reminder-scheduler.js')).href)
    const now = new Date('2026-08-18T12:00:00.000Z')
    const rows = [
      {
        id: 'a',
        user_id: 'u1',
        status: 'pending',
        fire_at: '2026-08-18T11:00:00.000Z',
        timezone: 'UTC',
        channels: ['in_app'],
        delivery_attempts: 0,
      },
      {
        id: 'b',
        user_id: 'u1',
        status: 'pending',
        fire_at: '2026-08-18T11:01:00.000Z',
        timezone: 'UTC',
        channels: ['in_app'],
        delivery_attempts: 0,
      },
      {
        id: 'c',
        user_id: 'u2',
        status: 'pending',
        fire_at: '2026-08-18T11:02:00.000Z',
        timezone: 'UTC',
        channels: ['in_app'],
        delivery_attempts: 0,
        claim_expires_at: '2026-08-18T11:50:00.000Z',
        claim_owner: 'old-worker',
      },
      {
        id: 'd',
        user_id: 'u2',
        status: 'pending',
        fire_at: '2026-08-18T11:03:00.000Z',
        timezone: 'UTC',
        channels: ['in_app'],
        delivery_attempts: 0,
      },
    ]

    const first = mod.simulateAtomicClaimBatch(rows, {
      claimOwner: 'worker-1',
      limit: 2,
      leaseSeconds: 120,
      now,
    })
    assert.equal(first.length, 2)
    assert.deepEqual(
      first.map((r) => r.id),
      ['a', 'b'],
    )
    assert.equal(first[0].status, 'pending')
    assert.ok(mod.isClaimLeaseActive(rows[0], now))

    const second = mod.simulateAtomicClaimBatch(rows, {
      claimOwner: 'worker-2',
      limit: 10,
      leaseSeconds: 120,
      now,
    })
    assert.deepEqual(
      second.map((r) => r.id),
      ['c', 'd'],
    )
    assert.equal(second[0].claimOwner, 'worker-2')
    assert.equal(rows[2].status, 'pending')
  })

  it('claim path never transitions to delivered', async () => {
    const mod = await import(pathToFileURL(path.join(root, 'lib/server/reminder-scheduler.js')).href)
    const now = new Date('2026-08-18T12:00:00.000Z')
    const row = {
      id: 'x',
      status: 'pending',
      fire_at: '2026-08-18T11:00:00.000Z',
      timezone: 'UTC',
      channels: ['in_app'],
    }
    const claimed = mod.simulateAtomicClaimBatch([row], { claimOwner: 'w', now })
    assert.equal(claimed[0].status, 'pending')
    assert.equal(row.status, 'pending')
    assert.match(schedulerJs, /claimedDoesNotMeanDelivered:\s*true/)
    assert.match(migration, /status intentionally unchanged/)
  })
})

describe('#303B cancellation / edit races', () => {
  it('terminal and rescheduled rows are not actionable via stale lease metadata', async () => {
    const mod = await import(pathToFileURL(path.join(root, 'lib/server/reminder-scheduler.js')).href)
    const now = new Date('2026-08-18T12:00:00.000Z')
    const leased = {
      claim_expires_at: '2026-08-18T12:05:00.000Z',
      claim_owner: 'w',
    }

    assert.equal(
      mod.isEligibleForSchedulerClaim(
        { ...leased, id: '1', status: 'cancelled', fire_at: '2026-08-18T11:00:00.000Z' },
        now,
      ),
      false,
    )
    assert.equal(
      mod.isEligibleForSchedulerClaim(
        { ...leased, id: '2', status: 'completed', fire_at: '2026-08-18T11:00:00.000Z' },
        now,
      ),
      false,
    )
    assert.equal(
      mod.isEligibleForSchedulerClaim(
        {
          ...leased,
          id: '3',
          status: 'pending',
          fire_at: '2026-08-19T11:00:00.000Z',
        },
        now,
      ),
      false,
    )
    assert.equal(
      mod.isEligibleForSchedulerClaim(
        {
          id: '4',
          status: 'snoozed',
          fire_at: '2026-08-18T10:00:00.000Z',
          snooze_until: '2026-08-19T12:00:00.000Z',
          claim_expires_at: '2026-08-18T12:05:00.000Z',
        },
        now,
      ),
      false,
    )
  })

  it('owner API clears lease fields on terminal transitions', () => {
    assert.match(remindersJs, /claim_owner = null/)
    assert.match(remindersJs, /claimed_at = null/)
    assert.match(remindersJs, /claim_expires_at = null/)
    assert.match(remindersJs, /patch\.status === 'cancelled'/)
  })
})

describe('#303A next-open survives lease fields', () => {
  it('listDueReminders does not filter on claim columns', () => {
    assert.match(remindersJs, /Do not filter on claim_owner/)
    assert.match(remindersJs, /CLAIMED != DELIVERED/)
    const dueFn = remindersJs.slice(
      remindersJs.indexOf('export async function listDueReminders'),
      remindersJs.indexOf('export async function getReminderById'),
    )
    assert.doesNotMatch(dueFn, /\.(eq|neq|gt|gte|lt|lte|is|in|filter)\(\s*['"]claim_/)
    assert.doesNotMatch(dueFn, /\.(eq|neq|gt|gte|lt|lte|is|in|filter)\(\s*['"]next_attempt_at['"]/)
    assert.match(dueFn, /\.eq\('status',\s*'pending'\)/)
    assert.match(dueFn, /\.eq\('status',\s*'snoozed'\)/)
  })

  it('leased pending due reminder remains eligible for next-open surface', async () => {
    const dueMod = await import(
      pathToFileURL(path.join(root, 'src/lib/dueReminderDelivery.ts')).href
    )
    const now = Date.parse('2026-08-18T12:00:00.000Z')
    const leasedDue = {
      id: 'rem-leased',
      userId: 'user-a',
      title: 'Chiamare Marco',
      body: null,
      fireAt: '2026-08-18T11:55:00.000Z',
      timezone: 'Europe/Rome',
      status: 'pending',
      source: 'user',
      sourceRef: null,
      snoozeUntil: null,
      channels: ['in_app'],
      deliveryAttempts: 0,
      lastErrorCode: null,
      createdAt: '2026-08-18T11:00:00.000Z',
      updatedAt: '2026-08-18T11:50:00.000Z',
      deliveredAt: null,
      completedAt: null,
      cancelledAt: null,
      // lease metadata must not affect client eligibility helper
      claimOwner: 'worker-1',
      claimedAt: '2026-08-18T11:50:00.000Z',
      claimExpiresAt: '2026-08-18T12:10:00.000Z',
    }
    assert.equal(dueMod.shouldMarkDeliveredOnFetch(), false)
    assert.equal(dueMod.isEligibleForNextOpenSurface(leasedDue, now), true)
    assert.match(dueHost, /pollDueRemindersAfterAuth/)
    assert.match(dueHost, /markReminderDelivered/)
    assert.match(dueDelivery, /Never mark delivered on fetch alone/)
  })
})

describe('#303B deploy / cost / protected contracts', () => {
  it('keeps 8 Vercel functions and no /api/cron/reminders', () => {
    assert.equal(deployedFunctions.length, 8)
    assert.ok(deployedFunctions.includes('api/reminders/index.ts'))
    assert.ok(deployedFunctions.includes('api/reminders/[id].ts'))
    assert.ok(!deployedFunctions.some((f) => f.includes('cron')))
    assert.ok(!deployedFunctions.includes('api/memory-test.ts'))
    assert.match(vercelignore, /api\/memory-test\.ts/)
    assert.equal(fs.existsSync(path.join(root, 'api/cron')), false)
  })

  it('scheduler foundation has no OpenAI dependency (LLM COST = $0)', () => {
    assert.doesNotMatch(schedulerJs, /from ['"]openai['"]|responses\.create/)
    assert.doesNotMatch(migration, /from ['"]openai['"]|responses\.create/)
    assert.doesNotMatch(apiIndex, /reminder-scheduler|claim_due_reminders/)
    assert.doesNotMatch(apiId, /claim_due_reminders/)
    assert.match(readme, /LLM COST = \$0/)
    assert.match(schedulerJs, /No OpenAI|LLM COST|No LLM/i)
  })

  it('owner reminder API routes unchanged in auth posture', () => {
    assert.match(apiIndex, /requireMemoryApiUser/)
    assert.match(apiId, /requireMemoryApiUser/)
    assert.match(apiIndex, /listDueReminders/)
  })

  it('does not touch Core / Memory chat invariants', () => {
    assert.equal((chatApi.match(/\.responses\.create\(/g) || []).length, 1)
    assert.match(chatApi, /maxDuration:\s*120/)
    assert.match(coreParams, /stream:\s*false/)
    assert.match(coreParams, /effort:\s*['"]none['"]/)
    assert.doesNotMatch(chatApi, /reminder-scheduler|claim_due_reminders/)
  })

  it('observability allows only safe metadata', () => {
    assert.match(schedulerJs, /logReminderSchedulerEvent/)
    assert.match(schedulerJs, /reminderId/)
    assert.match(schedulerJs, /claimOwner/)
    assert.match(schedulerJs, /batchSize/)
    assert.match(schedulerJs, /durationMs/)
    assert.doesNotMatch(schedulerJs, /console\.(log|info|warn|error)\([^)]*title/)
    assert.doesNotMatch(schedulerJs, /console\.(log|info|warn|error)\([^)]*body/)
  })

  it('documents #303C boundary without implementing Push', () => {
    assert.match(schedulerJs, /REMINDER_303C_DELIVERY_CONTRACT/)
    assert.match(readme, /Web Push adapter/)
    assert.doesNotMatch(schedulerJs, /web-push|PushManager|serviceWorker/)
  })
})

describe('#303B JS RPC wrappers', () => {
  it('claimDueReminders / releaseReminderClaim call RPCs without status mutation helpers', async () => {
    const mod = await import(pathToFileURL(path.join(root, 'lib/server/reminder-scheduler.js')).href)
    const calls = []
    const supabase = {
      async rpc(name, args) {
        calls.push({ name, args })
        if (name === 'claim_due_reminders') {
          return {
            data: [
              {
                id: '11111111-1111-1111-1111-111111111111',
                user_id: '22222222-2222-2222-2222-222222222222',
                status: 'pending',
                fire_at: '2026-08-18T11:00:00.000Z',
                snooze_until: null,
                timezone: 'Europe/Rome',
                channels: ['in_app'],
                delivery_attempts: 0,
                claim_owner: 'worker-x',
                claimed_at: '2026-08-18T12:00:00.000Z',
                claim_expires_at: '2026-08-18T12:02:00.000Z',
                next_attempt_at: null,
              },
            ],
            error: null,
          }
        }
        return { data: true, error: null }
      },
    }

    const claimed = await mod.claimDueReminders({
      claimOwner: 'worker-x',
      limit: 5,
      leaseSeconds: 90,
      supabase,
    })
    assert.equal(claimed.length, 1)
    assert.equal(claimed[0].status, 'pending')
    assert.equal(claimed[0].title, undefined)
    assert.equal(calls[0].name, 'claim_due_reminders')
    assert.equal(calls[0].args.p_claim_owner, 'worker-x')
    assert.equal(calls[0].args.p_limit, 5)

    const released = await mod.releaseReminderClaim({
      reminderId: claimed[0].id,
      claimOwner: 'worker-x',
      outcome: 'retry',
      errorCode: 'push_unavailable',
      nextAttemptAt: '2026-08-18T12:10:00.000Z',
      incrementAttempt: true,
      supabase,
    })
    assert.equal(released, true)
    assert.equal(calls[1].name, 'release_reminder_claim')
    assert.equal(calls[1].args.p_outcome, 'retry')
    assert.equal(calls[1].args.p_error_code, 'push_unavailable')
  })

  it('clamp helpers respect SQL bounds', async () => {
    const mod = await import(pathToFileURL(path.join(root, 'lib/server/reminder-scheduler.js')).href)
    assert.equal(mod.clampClaimBatchLimit(0), 1)
    assert.equal(mod.clampClaimBatchLimit(999), 100)
    assert.equal(mod.clampClaimLeaseSeconds(1), 30)
    assert.equal(mod.clampClaimLeaseSeconds(99999), 3600)
  })
})

console.log('ok: #303B reminder scheduler foundation contracts')
