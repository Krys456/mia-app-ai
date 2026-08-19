/**
 * #310E — robust Italian Calendar intent (cos'ho, curly apostrophe, temporal+schedule).
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..')

const POSITIVE_EVENTS = [
  'Cosa ho domani?',
  "Cos'ho domani?",
  'Cos\u2019ho domani?', // curly apostrophe
  "Cosa c'è domani?",
  'Cosa c\u2019è domani?',
  'Che ho domani?',
  'Che cosa ho domani?',
  'Che impegni ho domani?',
  'Ho impegni domani?',
  'Ho qualcosa domani?',
  'Cosa devo fare domani?',
  'Quali appuntamenti ho domani?',
  'Quali eventi ho domani?',
  'Fammi vedere cosa ho domani',
  'Mostrami gli impegni di domani',
  'Cosa ho oggi?',
  "Cos'ho oggi?",
  'Cosa ho questa settimana?',
  // normalization stress
  'COS\'HO DOMANI?',
  "Cos'ho   domani?",
  'Cos\u00a0\'ho\u00a0domani?', // NBSP around tokens after normalize
  "Cos'\u200bho domani?", // ZWSP inside contraction
]

const NEGATIVE_NONE = [
  'Domani sarà una bella giornata?',
  'Cosa significa domani?',
  'Parliamo di domani',
  'Scrivi una storia ambientata domani',
  'Come sarà il tempo domani?',
  "Cos'è Google Calendar?",
  'Come stai?',
  'Ricordami domani di chiamare',
]

describe('#310E calendar intent robustness', () => {
  it('normalizes Cos\'ho → cosa ho (straight + curly)', async () => {
    const mod = await import(
      pathToFileURL(path.join(root, 'lib/server/calendar-chat-intent.js')).href
    )
    assert.equal(mod.normalizeCalendarIntentText("Cos'ho domani?"), 'cosa ho domani?')
    assert.equal(mod.normalizeCalendarIntentText('Cos\u2019ho domani?'), 'cosa ho domani?')
    assert.equal(mod.normalizeCalendarIntentText('Cosa\u200bho  domani?'), 'cosa ho domani?')
  })

  it('positive Italian schedule phrases → events', async () => {
    const mod = await import(
      pathToFileURL(path.join(root, 'lib/server/calendar-chat-intent.js')).href
    )
    for (const phrase of POSITIVE_EVENTS) {
      assert.equal(
        mod.detectCalendarChatIntent(phrase),
        'events',
        `expected events for ${JSON.stringify(phrase)} → ${JSON.stringify(mod.normalizeCalendarIntentText(phrase))}`,
      )
    }
  })

  it('negative non-schedule phrases → none', async () => {
    const mod = await import(
      pathToFileURL(path.join(root, 'lib/server/calendar-chat-intent.js')).href
    )
    for (const phrase of NEGATIVE_NONE) {
      assert.equal(
        mod.detectCalendarChatIntent(phrase),
        'none',
        `expected none for ${JSON.stringify(phrase)}`,
      )
    }
  })

  it('enrichment uses Cos\'ho as events (disabled gate still used=true)', async () => {
    const pack = await import(
      pathToFileURL(path.join(root, 'lib/server/calendar-chat-pack.js')).href
    )
    const enrichment = await pack.maybeBuildCalendarChatEnrichment({
      userMessage: "Cos'ho domani?",
      userId: '11111111-1111-1111-1111-111111111111',
      env: { CALENDAR_ENABLED: 'false' },
    })
    assert.equal(enrichment.intent, 'events')
    assert.equal(enrichment.used, true)
    assert.equal(enrichment.preGoogleFailureCode, 'calendar_disabled')
  })
})
