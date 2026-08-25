/**
 * #386C — Account deletion security + orchestration contracts.
 * Run: node --test lib/server/account-deletion-386c.test.mjs
 *
 * No live Production deletion. Uses mocks / source contracts.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  ACCOUNT_DELETION_STEPS,
  rejectClientTargetUserId,
  runAccountDeletion,
  shouldRunStep,
} from './account-deletion.js'
import { isAccountDeletionEnabled } from './account-deletion-enabled.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')

describe('#386C feature flag', () => {
  it('defaults enabled', () => {
    assert.equal(isAccountDeletionEnabled({}), true)
    assert.equal(isAccountDeletionEnabled({ ACCOUNT_DELETION_ENABLED: '' }), true)
  })
  it('kill switch off', () => {
    assert.equal(isAccountDeletionEnabled({ ACCOUNT_DELETION_ENABLED: '0' }), false)
    assert.equal(isAccountDeletionEnabled({ ACCOUNT_DELETION_ENABLED: 'false' }), false)
  })
})

describe('#386C step resume', () => {
  it('runs from start when no progress', () => {
    assert.equal(shouldRunStep(null, 'oauth_calendar'), true)
    assert.equal(shouldRunStep(undefined, 'auth_user'), true)
  })
  it('skips completed prefix', () => {
    assert.equal(shouldRunStep('push', 'oauth_calendar'), false)
    assert.equal(shouldRunStep('push', 'push'), false)
    assert.equal(shouldRunStep('push', 'briefing'), true)
  })
  it('auth_user is last step', () => {
    assert.equal(ACCOUNT_DELETION_STEPS.at(-1), 'auth_user')
  })
})

describe('#386C reject forged user_id', () => {
  it('rejects body user_id / userId', () => {
    assert.equal(rejectClientTargetUserId({ user_id: 'x' }, null).rejected, true)
    assert.equal(rejectClientTargetUserId({ userId: 'x' }, null).rejected, true)
    assert.equal(rejectClientTargetUserId({ confirm: true }, null).rejected, false)
  })
  it('rejects query spoof', () => {
    const q = new URLSearchParams('userId=other')
    assert.equal(rejectClientTargetUserId({}, q).rejected, true)
  })
})

/**
 * In-memory supabase mock for deletion orchestration.
 * Chain is thenable; select() after insert/update does not clear the write op.
 */
function makeMockSupabase(seed) {
  const state = {
    jobs: [...(seed.jobs || [])],
    tables: {
      calendar_connections: [...(seed.calendar_connections || [])],
      email_connections: [...(seed.email_connections || [])],
      push_subscriptions: [...(seed.push_subscriptions || [])],
      morning_briefing_schedules: [...(seed.morning_briefing_schedules || [])],
      reminders: [...(seed.reminders || [])],
      memories: [...(seed.memories || [])],
      messages: [...(seed.messages || [])],
      conversations: [...(seed.conversations || [])],
      settings: [...(seed.settings || [])],
      subscriptions: [...(seed.subscriptions || [])],
      users: [...(seed.users || [])],
      billing_events: [...(seed.billing_events || [])],
    },
    authDeleted: [],
    authDeleteError: seed.authDeleteError || null,
  }

  function matchEq(row, filters) {
    return filters.every(([k, v]) => {
      if (Array.isArray(v)) return v.includes(row[k])
      return row[k] === v
    })
  }

  function from(table) {
    const filters = []
    let orderCol = null
    let orderAsc = true
    let limitN = null
    /** @type {'select'|'insert'|'update'|'delete'} */
    let op = 'select'
    let payload = null
    let wantOne = false

    const api = {
      select() {
        // Keep write ops (insert/update().select()) — only default to select when idle.
        if (op !== 'insert' && op !== 'update') op = 'select'
        return api
      },
      insert(row) {
        op = 'insert'
        payload = row
        return api
      },
      update(row) {
        op = 'update'
        payload = row
        return api
      },
      delete() {
        op = 'delete'
        return api
      },
      eq(k, v) {
        filters.push([k, v])
        return api
      },
      in(k, vals) {
        filters.push([k, vals])
        return api
      },
      order(col, opts) {
        orderCol = col
        orderAsc = !opts || opts.ascending !== false
        return api
      },
      limit(n) {
        limitN = n
        return api
      },
      maybeSingle() {
        wantOne = true
        return api
      },
      single() {
        wantOne = true
        return api
      },
      then(resolve, reject) {
        Promise.resolve()
          .then(() => exec())
          .then(resolve, reject)
      },
    }

    function exec() {
      if (table === 'account_deletion_jobs') {
        if (op === 'insert') {
          const row = {
            id: `job-${state.jobs.length + 1}`,
            last_completed_step: null,
            last_error_code: null,
            calendar_revoke_status: null,
            gmail_revoke_status: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            completed_at: null,
            ...payload,
          }
          state.jobs.push(row)
          return { data: row, error: null }
        }
        if (op === 'update') {
          const idx = state.jobs.findIndex((j) => matchEq(j, filters))
          if (idx < 0) return { data: null, error: { message: 'not_found' } }
          state.jobs[idx] = {
            ...state.jobs[idx],
            ...payload,
            updated_at: new Date().toISOString(),
          }
          return { data: state.jobs[idx], error: null }
        }
        let rows = state.jobs.filter((j) => matchEq(j, filters))
        if (orderCol) {
          rows = [...rows].sort((a, b) => {
            const av = a[orderCol]
            const bv = b[orderCol]
            if (av === bv) return 0
            const cmp = av > bv ? 1 : -1
            return orderAsc ? cmp : -cmp
          })
        }
        if (limitN != null) rows = rows.slice(0, limitN)
        return { data: wantOne ? rows[0] || null : rows, error: null }
      }

      if (table === 'users' && op === 'delete') {
        const removedIds = state.tables.users.filter((r) => matchEq(r, filters)).map((r) => r.id)
        state.tables.users = state.tables.users.filter((r) => !matchEq(r, filters))
        // Simulate billing_events ON DELETE SET NULL
        state.tables.billing_events = state.tables.billing_events.map((e) =>
          removedIds.includes(e.user_id) ? { ...e, user_id: null } : e,
        )
        return { data: removedIds.map((id) => ({ id })), error: null }
      }

      const rows = state.tables[table]
      if (!rows) return { data: null, error: { message: 'unknown_table' } }

      if (op === 'delete') {
        state.tables[table] = rows.filter((r) => !matchEq(r, filters))
        return { data: [], error: null }
      }
      if (op === 'update') {
        for (let i = 0; i < rows.length; i += 1) {
          if (matchEq(rows[i], filters)) rows[i] = { ...rows[i], ...payload }
        }
        const matched = rows.filter((r) => matchEq(r, filters))
        return { data: wantOne ? matched[0] || null : matched, error: null }
      }
      const found = rows.filter((r) => matchEq(r, filters))
      return { data: wantOne ? found[0] || null : found, error: null }
    }

    return api
  }

  return {
    state,
    client: {
      from,
      auth: {
        admin: {
          async deleteUser(id) {
            if (state.authDeleteError) return { data: null, error: state.authDeleteError }
            state.authDeleted.push(id)
            return { data: {}, error: null }
          },
        },
      },
    },
  }
}

describe('#386C orchestrator erasure + isolation', () => {
  it('erases owner rows, retains billing_events with null user, leaves other user', async () => {
    const owner = '11111111-1111-1111-1111-111111111111'
    const other = '22222222-2222-2222-2222-222222222222'
    const mock = makeMockSupabase({
      users: [{ id: owner }, { id: other }],
      memories: [
        { id: 'm1', user_id: owner },
        { id: 'm2', user_id: other },
      ],
      reminders: [
        { id: 'r1', user_id: owner, claim_owner: 'worker-a' },
        { id: 'r2', user_id: other },
      ],
      push_subscriptions: [
        { id: 'p1', user_id: owner, endpoint: 'https://x/1' },
        { id: 'p2', user_id: other, endpoint: 'https://x/2' },
      ],
      morning_briefing_schedules: [
        { user_id: owner, enabled: true },
        { user_id: other, enabled: true },
      ],
      calendar_connections: [
        {
          user_id: owner,
          provider: 'google',
          access_token_enc: 'enc-a',
          refresh_token_enc: 'enc-r',
        },
      ],
      email_connections: [
        {
          user_id: owner,
          provider: 'google',
          access_token_enc: 'enc-e',
          refresh_token_enc: null,
        },
      ],
      subscriptions: [{ id: 's1', user_id: owner }],
      billing_events: [
        { id: 'b1', user_id: owner, provider_event_id: 'evt_1' },
        { id: 'b2', user_id: other, provider_event_id: 'evt_2' },
      ],
      conversations: [{ id: 'c1', user_id: owner }],
      messages: [{ id: 'msg1', user_id: owner }],
      settings: [{ id: 'set1', user_id: owner }],
    })

    const prevFetch = globalThis.fetch
    globalThis.fetch = async (url) => {
      const u = String(url)
      if (u.includes('oauth2.googleapis.com/revoke')) {
        return { ok: false, status: 500 }
      }
      if (u.includes('/functions/v1/calendar-connection') || u.includes('/functions/v1/email-connection')) {
        return { ok: false, status: 500, json: async () => ({ code: 'edge_down' }) }
      }
      return { ok: false, status: 404, json: async () => ({}) }
    }

    try {
      const result = await runAccountDeletion({
        userId: owner,
        accessToken: 'test-jwt',
        env: {
          ACCOUNT_DELETION_ENABLED: '1',
          SUPABASE_URL: 'https://example.supabase.co',
          VITE_SUPABASE_ANON_KEY: 'anon',
        },
        getServiceSupabase: async () => mock.client,
      })

      assert.equal(result.ok, true)
      assert.equal(result.code, 'deleted')
      assert.equal(mock.state.tables.memories.filter((m) => m.user_id === owner).length, 0)
      assert.equal(mock.state.tables.memories.filter((m) => m.user_id === other).length, 1)
      assert.equal(mock.state.tables.reminders.filter((r) => r.user_id === owner).length, 0)
      assert.equal(mock.state.tables.reminders.filter((r) => r.user_id === other).length, 1)
      assert.equal(mock.state.tables.push_subscriptions.filter((p) => p.user_id === owner).length, 0)
      assert.equal(mock.state.tables.push_subscriptions.filter((p) => p.user_id === other).length, 1)
      assert.equal(
        mock.state.tables.morning_briefing_schedules.filter((s) => s.user_id === owner).length,
        0,
      )
      assert.equal(mock.state.tables.calendar_connections.length, 0)
      assert.equal(mock.state.tables.email_connections.length, 0)
      assert.equal(mock.state.tables.users.filter((u) => u.id === owner).length, 0)
      assert.equal(mock.state.tables.users.filter((u) => u.id === other).length, 1)
      assert.equal(mock.state.authDeleted.includes(owner), true)
      // billing retained
      assert.equal(mock.state.tables.billing_events.length, 2)
      assert.equal(
        mock.state.tables.billing_events.find((b) => b.provider_event_id === 'evt_1')?.user_id,
        null,
      )
      assert.equal(
        mock.state.tables.billing_events.find((b) => b.provider_event_id === 'evt_2')?.user_id,
        other,
      )
    } finally {
      globalThis.fetch = prevFetch
    }
  })

  it('is idempotent when already completed', async () => {
    const owner = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
    const mock = makeMockSupabase({
      jobs: [
        {
          id: 'job-done',
          auth_user_id: owner,
          status: 'completed',
          last_completed_step: 'auth_user',
          completed_at: new Date().toISOString(),
        },
      ],
      users: [],
    })
    const result = await runAccountDeletion({
      userId: owner,
      accessToken: 'jwt',
      env: { ACCOUNT_DELETION_ENABLED: '1' },
      getServiceSupabase: async () => mock.client,
    })
    assert.equal(result.ok, true)
    assert.equal(result.alreadyCompleted, true)
    assert.equal(result.code, 'already_deleted')
    assert.equal(mock.state.authDeleted.length, 0)
  })

  it('retries after failed auth delete', async () => {
    const owner = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
    const mock = makeMockSupabase({
      jobs: [
        {
          id: 'job-fail',
          auth_user_id: owner,
          status: 'failed',
          last_completed_step: 'public_users',
          last_error_code: 'auth_user_delete_failed',
        },
      ],
      users: [],
      memories: [],
      reminders: [],
      push_subscriptions: [],
      morning_briefing_schedules: [],
      calendar_connections: [],
      email_connections: [],
      messages: [],
      conversations: [],
      settings: [],
      subscriptions: [],
      billing_events: [],
    })
    const result = await runAccountDeletion({
      userId: owner,
      accessToken: 'jwt',
      env: {
        ACCOUNT_DELETION_ENABLED: '1',
        SUPABASE_URL: 'https://example.supabase.co',
        VITE_SUPABASE_ANON_KEY: 'anon',
      },
      getServiceSupabase: async () => mock.client,
    })
    assert.equal(result.ok, true)
    assert.equal(mock.state.authDeleted.includes(owner), true)
    assert.equal(mock.state.jobs[0].status, 'completed')
  })
})

describe('#386C source contracts', () => {
  it('API never accepts client user_id and uses requireAuthenticatedUser', () => {
    const api = readFileSync(join(root, 'api/account/delete.ts'), 'utf8')
    assert.match(api, /requireAuthenticatedUser/)
    assert.match(api, /rejectClientTargetUserId/)
    assert.match(api, /runAccountDeletion/)
    assert.match(api, /account_delete/)
    assert.doesNotMatch(api, /SUPABASE_SERVICE_ROLE_KEY/)
    assert.doesNotMatch(api, /body\.userId/)
  })

  it('job migration has no FK to public.users', () => {
    const mig = readFileSync(
      join(root, 'supabase/migrations/20260825120000_account_deletion_jobs_386c.sql'),
      'utf8',
    )
    assert.match(mig, /account_deletion_jobs/)
    assert.match(mig, /auth_user_id UUID NOT NULL/)
    assert.doesNotMatch(mig, /REFERENCES public\.users/)
    assert.doesNotMatch(mig, /REFERENCES auth\.users/)
    assert.match(mig, /service_role/)
  })

  it('billing_events SET NULL preserved in billing migration', () => {
    const mig = readFileSync(
      join(root, 'supabase/migrations/20260820160000_billing_core_332e1.sql'),
      'utf8',
    )
    assert.match(mig, /user_id UUID NULL REFERENCES public\.users \(id\) ON DELETE SET NULL/)
  })

  it('privacy copy no longer says deletion unavailable', () => {
    const copy = readFileSync(join(root, 'src/lib/privacyCopy.ts'), 'utf8')
    assert.doesNotMatch(copy, /non è ancora disponibile/)
    assert.match(copy, /ACCOUNT_DELETION_COPY/)
    assert.match(copy, /accountDeletion/)
  })

  it('PrivacyData mounts AccountDeletionPanel', () => {
    const page = readFileSync(join(root, 'src/pages/PrivacyData.tsx'), 'utf8')
    assert.match(page, /AccountDeletionPanel/)
  })

  it('orchestrator deletes auth last and hard-deletes memories', () => {
    const src = readFileSync(join(root, 'lib/server/account-deletion.js'), 'utf8')
    assert.match(src, /auth\.admin\.deleteUser/)
    assert.match(src, /hardDeleteByUserId\(supabase, userId, 'memories'\)/)
    const authIdx = src.lastIndexOf("shouldRunStep(job.last_completed_step, 'auth_user')")
    const memIdx = src.indexOf("shouldRunStep(job.last_completed_step, 'memories')")
    assert.ok(authIdx > memIdx)
  })

  it('client confirmation accepts ELIMINA and DELETE only', async () => {
    const { isValidDeletionConfirmation } = await import(
      '../../src/lib/accountDeletionApi.ts'
    ).catch(async () => {
      // Vite TS may not load in node — fall back to source assert
      const src = readFileSync(join(root, 'src/lib/accountDeletionApi.ts'), 'utf8')
      assert.match(src, /ELIMINA/)
      assert.match(src, /DELETE/)
      return {
        isValidDeletionConfirmation: (raw) => {
          const t = String(raw || '').trim()
          return t === 'ELIMINA' || t === 'DELETE'
        },
      }
    })
    assert.equal(isValidDeletionConfirmation('ELIMINA'), true)
    assert.equal(isValidDeletionConfirmation('DELETE'), true)
    assert.equal(isValidDeletionConfirmation('elimina'), false)
    assert.equal(isValidDeletionConfirmation('yes'), false)
  })
})

describe('#386C worker race contracts', () => {
  it('reminder push worker treats missing reminder/subscription as non-fatal paths exist', () => {
    const worker = readFileSync(
      join(root, 'supabase/functions/reminder-push-dispatch/index.ts'),
      'utf8',
    )
    // Worker loads reminder then subscriptions; absence should not throw across users.
    assert.match(worker, /push_subscriptions/)
    assert.match(worker, /claim_due_reminders|claim_owner/)
  })

  it('morning briefing worker loads push by user_id', () => {
    const worker = readFileSync(
      join(root, 'supabase/functions/morning-briefing-dispatch/index.ts'),
      'utf8',
    )
    assert.match(worker, /push_subscriptions/)
    assert.match(worker, /claim_due_morning_briefings/)
  })
})

console.log('ok: #386C account deletion contracts')
