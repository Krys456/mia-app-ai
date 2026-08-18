/**
 * #303A — Next-open / missed reminder delivery regression.
 * Run: node --experimental-strip-types --test src/lib/dueReminderDelivery.test.mjs
 *
 * Scenario: reminder stays pending while app is closed past fire_at;
 * fresh mount + auth ready must surface it once; fetch ≠ delivered;
 * refresh must not duplicate.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'
import { pathToFileURL } from 'node:url'

const root = process.cwd()
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')

const dueModUrl = pathToFileURL(path.join(root, 'src/lib/dueReminderDelivery.ts')).href

describe('#303A next-open due delivery', () => {
  it('surfaces pending reminder after auth bootstrap on fresh mount (app was closed)', async () => {
    const {
      pollDueRemindersAfterAuth,
      mergeDueIntoQueue,
      shouldMarkDeliveredOnFetch,
      isEligibleForNextOpenSurface,
    } = await import(dueModUrl)

    const now = Date.parse('2026-08-18T12:00:00.000Z')
    const missed = {
      id: 'rem-missed-1',
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
      updatedAt: '2026-08-18T11:00:00.000Z',
      deliveredAt: null,
      completedAt: null,
      cancelledAt: null,
    }

    let authCalls = 0
    let listCalls = 0
    let sessionReady = false

    // Simulate cold open: first auth attempt has no JWT; bootstrap then succeeds.
    const ensureAuth = async () => {
      authCalls += 1
      if (!sessionReady) {
        sessionReady = true
        return { authorization: null }
      }
      return { authorization: 'Bearer tok-user-a' }
    }

    const listDue = async () => {
      listCalls += 1
      if (!sessionReady) {
        const err = new Error('unauthorized')
        err.status = 401
        throw err
      }
      return [missed]
    }

    assert.equal(shouldMarkDeliveredOnFetch(), false)
    assert.equal(isEligibleForNextOpenSurface(missed, now), true)

    const first = await pollDueRemindersAfterAuth({ ensureAuth, listDue })
    assert.equal(first.authUnavailable, false)
    assert.equal(first.reminders.length, 1)
    assert.equal(first.reminders[0].id, 'rem-missed-1')
    assert.equal(first.reminders[0].status, 'pending')
    assert.ok(authCalls >= 2, 'must await/retry auth bootstrap before treating as unavailable')
    assert.equal(listCalls, 1)

    // Queue after surface — still pending (not delivered on fetch).
    let queue = mergeDueIntoQueue([], first.reminders, new Set())
    assert.equal(queue.length, 1)

    // Refresh / focus must not duplicate.
    const second = await pollDueRemindersAfterAuth({ ensureAuth, listDue })
    queue = mergeDueIntoQueue(queue, second.reminders, new Set())
    assert.equal(queue.length, 1)

    // Simulate acknowledge → delivered transition is caller-owned, not fetch.
    const delivered = { ...missed, status: 'delivered', deliveredAt: '2026-08-18T12:00:05.000Z' }
    assert.equal(isEligibleForNextOpenSurface(delivered, now), false)
    queue = mergeDueIntoQueue(
      queue.filter((r) => r.id !== delivered.id),
      [],
      new Set([delivered.id]),
    )
    assert.equal(queue.length, 0)

    // Delivering set blocks re-queue of the same id.
    queue = mergeDueIntoQueue([], [missed], new Set(['rem-missed-1']))
    assert.equal(queue.length, 0)
  })

  it('retries listDue once after 401 when auth becomes ready', async () => {
    const { pollDueRemindersAfterAuth } = await import(dueModUrl)

    let listCalls = 0
    const ensureAuth = async () => ({ authorization: 'Bearer tok' })
    const listDue = async () => {
      listCalls += 1
      if (listCalls === 1) {
        const err = new Error('unauthorized')
        err.status = 401
        throw err
      }
      return [
        {
          id: 'rem-2',
          userId: 'user-a',
          title: 'Due',
          body: null,
          fireAt: '2026-08-18T11:00:00.000Z',
          timezone: 'UTC',
          status: 'pending',
          source: 'user',
          sourceRef: null,
          snoozeUntil: null,
          channels: ['in_app'],
          deliveryAttempts: 0,
          lastErrorCode: null,
          createdAt: '2026-08-18T10:00:00.000Z',
          updatedAt: '2026-08-18T10:00:00.000Z',
          deliveredAt: null,
          completedAt: null,
          cancelledAt: null,
        },
      ]
    }

    const result = await pollDueRemindersAfterAuth({ ensureAuth, listDue })
    assert.equal(result.authUnavailable, false)
    assert.equal(result.reminders[0].id, 'rem-2')
    assert.equal(listCalls, 2)
  })

  it('does not surface future / cancelled / completed / delivered rows', async () => {
    const { isEligibleForNextOpenSurface } = await import(dueModUrl)
    const now = Date.parse('2026-08-18T12:00:00.000Z')
    const base = {
      id: 'x',
      userId: 'u',
      title: 't',
      body: null,
      fireAt: '2026-08-18T13:00:00.000Z',
      timezone: 'UTC',
      status: 'pending',
      source: 'user',
      sourceRef: null,
      snoozeUntil: null,
      channels: ['in_app'],
      deliveryAttempts: 0,
      lastErrorCode: null,
      createdAt: '2026-08-18T10:00:00.000Z',
      updatedAt: '2026-08-18T10:00:00.000Z',
      deliveredAt: null,
      completedAt: null,
      cancelledAt: null,
    }

    assert.equal(isEligibleForNextOpenSurface(base, now), false) // future
    assert.equal(isEligibleForNextOpenSurface({ ...base, fireAt: '2026-08-18T11:00:00.000Z' }, now), true)
    assert.equal(
      isEligibleForNextOpenSurface({ ...base, fireAt: '2026-08-18T11:00:00.000Z', status: 'cancelled' }, now),
      false,
    )
    assert.equal(
      isEligibleForNextOpenSurface({ ...base, fireAt: '2026-08-18T11:00:00.000Z', status: 'completed' }, now),
      false,
    )
    assert.equal(
      isEligibleForNextOpenSurface({ ...base, fireAt: '2026-08-18T11:00:00.000Z', status: 'delivered' }, now),
      false,
    )
  })

  it('DueReminderHost + reminderApi await shared auth bootstrap (not raw getSession alone)', () => {
    const dueHost = read('src/components/DueReminderHost.tsx')
    const reminderApi = read('src/lib/reminderApi.ts')
    const delivery = read('src/lib/dueReminderDelivery.ts')

    assert.match(dueHost, /useAuthBootstrap/)
    assert.match(dueHost, /pollDueRemindersAfterAuth/)
    assert.match(dueHost, /auth\.status/)
    assert.match(dueHost, /markReminderDelivered/)
    assert.match(dueHost, /acknowledge/)

    assert.match(reminderApi, /resolveChatAuthForRequest/)
    assert.doesNotMatch(reminderApi, /auth\.getSession\(\)/)

    assert.match(delivery, /Never mark delivered on fetch|never mark delivered on fetch/i)
    assert.match(delivery, /pollDueRemindersAfterAuth/)
  })

  it('server listDueReminders keeps pending fire_at <= now (owner scoped)', async () => {
    const remindersJs = read('lib/server/reminders.js')
    assert.match(remindersJs, /\.eq\('status',\s*'pending'\)/)
    assert.match(remindersJs, /\.lte\('fire_at',\s*nowIso\)/)
    assert.match(remindersJs, /\.eq\('user_id',\s*userId\)/)
    assert.doesNotMatch(remindersJs, /status:\s*'delivered'[\s\S]{0,80}listDueReminders/)
  })
})
