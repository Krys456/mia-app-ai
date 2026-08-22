/**
 * #357B — Conversational reminders MVP contracts.
 * Run: node src/lib/reminder-chat/reminder-chat-357b.test.mjs
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, it } from 'node:test'

const root = process.cwd()
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')

const {
  detectReminderIntent,
  parseReminderDateTime,
  extractReminderTitle,
  applyReminderIntent,
  createRemindersContext,
  savePendingReminderProposal,
  loadPendingReminderProposal,
  clearPendingReminderProposal,
  failureReply,
} = await import(pathToFileURL(path.join(root, 'src/lib/reminder-chat/index.js')).href)

const { isReminderNotTimer } = await import(
  pathToFileURL(path.join(root, 'src/lib/timer/intent.js')).href
)
const { applyTimerIntent } = await import(
  pathToFileURL(path.join(root, 'src/lib/timer/controller.js')).href
)

function memStorage() {
  const map = new Map()
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  }
}

describe('reminder-chat-357b datetime', () => {
  const tz = 'Europe/Rome'
  const now = new Date('2026-08-22T10:00:00.000Z') // Saturday ~12:00 Rome (CEST)

  it('parses tra 20 minuti', () => {
    const r = parseReminderDateTime('Ricordami tra 20 minuti di bere', { timeZone: tz, now })
    assert.equal(r.ok, true)
    assert.ok(new Date(r.fireAtUtc).getTime() - now.getTime() >= 19 * 60_000)
  })

  it('parses domani alle 9', () => {
    const r = parseReminderDateTime('Ricordami domani alle 9 di chiamare Marco', {
      timeZone: tz,
      now,
    })
    assert.equal(r.ok, true)
    assert.equal(r.localTime, '09:00')
    assert.match(r.localDate, /^2026-08-23$/)
  })

  it('ambiguous without time', () => {
    const r = parseReminderDateTime('Ricordami domani di chiamare Marco', { timeZone: tz, now })
    assert.equal(r.ok, false)
    assert.equal(r.code, 'ambiguous_time')
  })

  it('stasera without clock is ambiguous', () => {
    const r = parseReminderDateTime('Ricordami stasera di prendere le medicine', {
      timeZone: tz,
      now,
    })
    assert.equal(r.ok, false)
    assert.equal(r.code, 'ambiguous_time')
  })

  it('recurrence unsupported', () => {
    const r = parseReminderDateTime('Ricordami ogni lunedì alle 9 di fare sport', {
      timeZone: tz,
      now,
    })
    assert.equal(r.ok, false)
    assert.equal(r.code, 'unsupported_recurrence')
  })

  it('extracts title', () => {
    assert.equal(
      extractReminderTitle('Ricordami domani alle 9 di chiamare Marco.'),
      'chiamare Marco',
    )
  })
})

describe('reminder-chat-357b intent', () => {
  it('create vs timer separation', () => {
    assert.equal(isReminderNotTimer('Ricordami tra 20 minuti di bere'), true)
    const timer = applyTimerIntent({
      text: 'Ricordami tra 20 minuti di bere',
      activeTimer: null,
      languageHint: 'it',
    })
    assert.equal(timer.handled, false)
    const rem = detectReminderIntent('Ricordami tra 20 minuti di bere', {
      timeZone: 'Europe/Rome',
      now: new Date('2026-08-22T10:00:00.000Z'),
    })
    assert.equal(rem.intent, 'reminder')
    assert.equal(rem.operation, 'create')
  })

  it('list intent', () => {
    const rem = detectReminderIntent('Che promemoria ho oggi?')
    assert.equal(rem.intent, 'reminder')
    assert.equal(rem.operation, 'list')
    assert.equal(rem.queryType, 'today')
  })

  it('recurrence create fails honestly', () => {
    const rem = detectReminderIntent('Ricordami ogni lunedì alle 9 di fare sport')
    assert.equal(rem.intent, 'reminder')
    assert.equal(rem.failureCode, 'unsupported_recurrence')
  })
})

describe('reminder-chat-357b propose/confirm', () => {
  it('propose does not call create API', async () => {
    let created = 0
    const storage = memStorage()
    const res = await applyReminderIntent({
      text: 'Ricordami domani alle 9 di chiamare Marco',
      languageHint: 'it',
      timeZone: 'Europe/Rome',
      now: new Date('2026-08-22T10:00:00.000Z'),
      storage,
      api: {
        createReminderFromProposal: async () => {
          created += 1
          throw new Error('should not create')
        },
        listUpcomingReminders: async () => [],
      },
    })
    assert.equal(res.handled, true)
    assert.equal(created, 0)
    assert.equal(res.diag.persisted, false)
    assert.match(res.reply, /Confermi|promemoria/i)
    assert.ok(res.reminderUi?.actions?.some((a) => a.id === 'confirm'))
    assert.ok(loadPendingReminderProposal(storage))
  })

  it('confirm persists then success copy', async () => {
    const storage = memStorage()
    savePendingReminderProposal(
      {
        title: 'chiamare Marco',
        fireAt: '2026-08-23T07:00:00.000Z',
        timezone: 'Europe/Rome',
        source: 'conversation',
        localDateLabel: '2026-08-23',
        localTimeLabel: '09:00',
      },
      storage,
    )
    let created = 0
    const res = await applyReminderIntent({
      text: 'conferma',
      languageHint: 'it',
      storage,
      hasRemindersContext: false,
      api: {
        createReminderFromProposal: async (p) => {
          created += 1
          return {
            id: 'r1',
            title: p.title,
            fireAt: p.fireAt,
            timezone: p.timezone,
            status: 'pending',
          }
        },
      },
    })
    // Need hasPendingProposal via storage — detect from storage
    assert.equal(created, 1)
    assert.equal(res.diag.persisted, true)
    assert.match(res.reply, /te lo ricorderò/i)
    assert.equal(loadPendingReminderProposal(storage), null)
  })

  it('never success copy without persist', async () => {
    const storage = memStorage()
    savePendingReminderProposal(
      {
        title: 'x',
        fireAt: '2026-08-23T07:00:00.000Z',
        timezone: 'Europe/Rome',
        source: 'conversation',
        localDateLabel: '2026-08-23',
        localTimeLabel: '09:00',
      },
      storage,
    )
    const res = await applyReminderIntent({
      text: 'conferma',
      languageHint: 'it',
      storage,
      api: {
        createReminderFromProposal: async () => {
          const err = new Error('fail')
          err.code = 'create_failed'
          throw err
        },
      },
    })
    assert.doesNotMatch(res.reply, /te lo ricorderò/i)
    assert.match(res.reply, /salvare|riprova/i)
  })
})

describe('reminder-chat-357b list/complete/cancel', () => {
  it('lists today and sets context', async () => {
    const storage = memStorage()
    const res = await applyReminderIntent({
      text: 'Che promemoria ho oggi?',
      languageHint: 'it',
      timeZone: 'Europe/Rome',
      now: new Date('2026-08-22T10:00:00.000Z'),
      storage,
      api: {
        listUpcomingReminders: async () => [
          {
            id: 'a',
            title: 'Chiamare Marco',
            fireAt: '2026-08-22T13:00:00.000Z',
            timezone: 'Europe/Rome',
            status: 'pending',
          },
          {
            id: 'b',
            title: 'Latte',
            fireAt: '2026-08-23T16:00:00.000Z',
            timezone: 'Europe/Rome',
            status: 'pending',
          },
        ],
      },
    })
    assert.match(res.reply, /Hai 1 promemoria per oggi/)
    assert.match(res.reply, /Chiamare Marco/)
    assert.doesNotMatch(res.reply, /Latte/)
    assert.equal(res.remindersContext.reminders.length, 1)
  })

  it('complete first', async () => {
    const storage = memStorage()
    const ctx = createRemindersContext({
      queryType: 'today',
      reminders: [
        {
          id: 'a',
          title: 'Uno',
          fireAt: '2026-08-22T13:00:00.000Z',
          timezone: 'Europe/Rome',
          status: 'pending',
          localTimeLabel: '15:00',
        },
        {
          id: 'b',
          title: 'Due',
          fireAt: '2026-08-22T16:00:00.000Z',
          timezone: 'Europe/Rome',
          status: 'pending',
          localTimeLabel: '18:00',
        },
      ],
    })
    let completed = null
    const res = await applyReminderIntent({
      text: 'Segna il primo come fatto.',
      languageHint: 'it',
      remindersContext: ctx,
      storage,
      api: {
        completeReminder: async (id) => {
          completed = id
          return { id, status: 'completed' }
        },
      },
    })
    assert.equal(completed, 'a')
    assert.match(res.reply, /fatto/i)
  })

  it('cancel second', async () => {
    const storage = memStorage()
    const ctx = createRemindersContext({
      queryType: 'upcoming',
      reminders: [
        {
          id: 'a',
          title: 'Uno',
          fireAt: '2026-08-22T13:00:00.000Z',
          timezone: 'Europe/Rome',
          status: 'pending',
        },
        {
          id: 'b',
          title: 'Due',
          fireAt: '2026-08-22T16:00:00.000Z',
          timezone: 'Europe/Rome',
          status: 'pending',
        },
      ],
    })
    let cancelled = null
    const res = await applyReminderIntent({
      text: 'Cancella il secondo.',
      languageHint: 'it',
      remindersContext: ctx,
      storage,
      api: {
        cancelReminder: async (id) => {
          cancelled = id
          return { id, status: 'cancelled' }
        },
      },
    })
    assert.equal(cancelled, 'b')
    assert.match(res.reply, /annullato/i)
  })
})

describe('reminder-chat-357b wiring / budget', () => {
  it('ChatContext terminates locally; 0 new vercel; freezes', () => {
    const chat = read('src/context/ChatContext.tsx')
    const vercel = read('vercel.json')
    assert.match(chat, /applyReminderIntent/)
    assert.match(chat, /detectReminderIntent/)
    assert.match(chat, /LOCAL_EXCHANGE/)
    assert.doesNotMatch(chat, /modality:\s*['"]voice['"]/)
    const fns = [...vercel.matchAll(/"api\/[^"]+\.ts"/g)]
    assert.equal(fns.length, 11)
    assert.doesNotMatch(read('src/lib/calendar-chat/intent.js'), /357B/)
    assert.doesNotMatch(read('src/lib/email-chat/intent.js'), /357B/)
    assert.doesNotMatch(read('src/lib/places-chat/intent.js'), /357B/)
    assert.match(read('src/components/chat/ReminderUi.tsx'), /Conferma/)
    assert.match(failureReply('ambiguous_time', 'it'), /ora/i)
  })

  it('Memory skips ricordami', () => {
    const brain = read('lib/server/brain-memory.js')
    assert.match(brain, /ricordami/)
  })
})

console.log('ok: #357B reminder chat contracts')
