/**
 * #314 timer MVP tests.
 * Run: node lib/timer/timer.test.mjs
 */

import assert from 'node:assert/strict'
import { createRunningTimer, parseStoredTimer, remainingMs } from './active-context.js'
import { applyTimerIntent } from './controller.js'
import { formatCountdown, parseTimerDurationMs } from './duration.js'
import { detectTimerIntent, isAlarmNotTimer, isNonActionTimerTalk } from './intent.js'

assert.equal(parseTimerDurationMs('Timer di 20 minuti'), 20 * 60_000)
assert.equal(parseTimerDurationMs('Imposta un timer di 5 minuti'), 5 * 60_000)
assert.equal(parseTimerDurationMs('Avvia un timer da 30 secondi'), 30_000)
assert.equal(parseTimerDurationMs("Metti un timer di mezz'ora"), 30 * 60_000)
assert.equal(parseTimerDurationMs('Set a timer for 10 minutes'), 10 * 60_000)
assert.equal(parseTimerDurationMs('Start a 30 second timer'), 30_000)
assert.equal(parseTimerDurationMs('half an hour'), 30 * 60_000)
assert.equal(parseTimerDurationMs('Timer for half an hour'), 30 * 60_000)
assert.equal(parseTimerDurationMs('un minuto e mezzo'), 90_000)
assert.equal(parseTimerDurationMs('1 ora e 20 minuti'), 80 * 60_000)
assert.equal(parseTimerDurationMs('2 minuti e 30 secondi'), 150_000)
assert.equal(parseTimerDurationMs('1 hour and 20 minutes'), 80 * 60_000)
assert.equal(parseTimerDurationMs('half a minute'), 30_000)
assert.equal(parseTimerDurationMs('0 secondi'), null)
assert.equal(parseTimerDurationMs('100 ore'), null)
assert.equal(parseTimerDurationMs('2 seconds'), null)

assert.equal(detectTimerIntent('Timer di 20 minuti').kind, 'start')
assert.equal(detectTimerIntent('Timer di 20 minuti').durationMs, 20 * 60_000)
assert.equal(detectTimerIntent('Imposta un timer di 5 minuti').kind, 'start')
assert.equal(detectTimerIntent('Avvia un timer da 30 secondi').kind, 'start')
assert.equal(detectTimerIntent('Set a timer for 10 minutes').kind, 'start')
assert.equal(detectTimerIntent('Start a 30 second timer').kind, 'start')
assert.equal(detectTimerIntent('Conto alla rovescia di 10 minuti').kind, 'start')

assert.equal(isNonActionTimerTalk("Cos'è un timer?"), true)
assert.equal(detectTimerIntent("Cos'è un timer?").kind, 'none')
assert.equal(detectTimerIntent("Scrivi un'app timer").kind, 'none')
assert.equal(detectTimerIntent('Quanto dura normalmente un timer?').kind, 'none')
assert.equal(detectTimerIntent('Parlami del timer Pomodoro').kind, 'none')
assert.equal(detectTimerIntent('Ricordami di chiamare Marco alle 18').kind, 'none')

assert.equal(isAlarmNotTimer('Svegliami domani alle 7'), true)
assert.equal(detectTimerIntent('Svegliami domani alle 7').kind, 'alarm_honest')
assert.equal(detectTimerIntent('Set an alarm for 7').kind, 'alarm_honest')

assert.equal(detectTimerIntent('Quanto manca?', { hasActiveTimer: true }).kind, 'status')
assert.equal(
  detectTimerIntent('Quanto manca alla fine del film?', { hasActiveTimer: true }).kind,
  'none',
)
assert.equal(detectTimerIntent('Fermalo.', { hasActiveTimer: true }).kind, 'cancel')
assert.equal(detectTimerIntent('Stop the timer.', { hasActiveTimer: true }).kind, 'cancel')
assert.equal(detectTimerIntent('Aggiungi 5 minuti.', { hasActiveTimer: true }).kind, 'add')
assert.equal(detectTimerIntent('Aggiungi 5 minuti.', { hasActiveTimer: true }).addMs, 5 * 60_000)
assert.equal(detectTimerIntent('Add 2 minutes.', { hasActiveTimer: true }).kind, 'add')

{
  const r = applyTimerIntent({ text: 'Timer di 2 minuti', activeTimer: null, pendingReplace: null })
  assert.equal(r.handled, true)
  assert.equal(r.timer?.status, 'running')
  assert.equal(r.diag.timerStarted, true)
  assert.match(r.reply || '', /timer impostato|Timer set/i)

  const status = applyTimerIntent({
    text: 'Quanto manca?',
    activeTimer: r.timer,
    pendingReplace: null,
    nowMs: (r.timer?.startedAt || 0) + 18_000,
  })
  assert.equal(status.handled, true)
  assert.match(status.reply || '', /Restano|remaining/i)

  const cancel = applyTimerIntent({
    text: 'Fermalo.',
    activeTimer: r.timer,
    pendingReplace: null,
  })
  assert.equal(cancel.handled, true)
  assert.equal(cancel.timer?.status, 'cancelled')
  assert.equal(cancel.clearTimer, true)
}

{
  const first = createRunningTimer({ durationMs: 8 * 60_000, nowMs: 1_000_000 })
  const r = applyTimerIntent({
    text: 'Timer di 3 minuti',
    activeTimer: first,
    pendingReplace: null,
    nowMs: 1_000_000,
  })
  assert.equal(r.timer?.id, first.id)
  assert.ok(r.pendingReplace)
  assert.equal(r.pendingReplace?.durationMs, 3 * 60_000)
  assert.match(r.reply || '', /già attivo|already running/i)

  const confirm = applyTimerIntent({
    text: 'sì',
    activeTimer: first,
    pendingReplace: r.pendingReplace,
    nowMs: 1_000_100,
  })
  assert.equal(confirm.diag.timerStarted, true)
  assert.notEqual(confirm.timer?.id, first.id)
  assert.equal(confirm.timer?.durationMs, 3 * 60_000)
}

{
  const t = createRunningTimer({ durationMs: 60_000, nowMs: 5_000_000 })
  const expired = parseStoredTimer(t, 5_000_000 + 61_000)
  assert.equal(expired?.status, 'completed')
  assert.equal(remainingMs(t, 5_000_000 + 10_000), 50_000)
  assert.equal(formatCountdown(50_000), '00:50')
}

{
  const it = applyTimerIntent({
    text: 'Timer di 1 minuto',
    activeTimer: null,
    pendingReplace: null,
  })
  assert.match(it.reply || '', /impostato/)
  const en = applyTimerIntent({
    text: 'Set a timer for 1 minute',
    activeTimer: null,
    pendingReplace: null,
  })
  assert.match(en.reply || '', /Timer set/i)
}

console.log('timer.test.mjs: all assertions passed')
