/**
 * #337B — Gmail chat MVP contracts + intent/render/controller probes.
 * Run: node --test src/lib/email-chat/email-chat-337b.test.mjs
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'
import { detectEmailIntent, detectEmailFollowUp } from './intent.js'
import { foldEmailText } from './normalize.js'
import { renderEmailList, renderFollowUp, extractiveSummary, failureReply } from './render.js'
import { applyEmailIntent } from './controller.js'
import { createEmailContext } from './active-context.js'

const root = process.cwd()
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')

describe('email-chat-337b infrastructure', () => {
  it('does not create a new Vercel function for email', () => {
    assert.ok(!fs.existsSync(path.join(root, 'api/email.ts')))
    const fnCount = Object.keys(JSON.parse(read('vercel.json')).functions).length
    assert.equal(fnCount, 11)
  })

  it('does not modify Calendar chat files and wires ChatContext as a pure insertion', () => {
    // Calendar chat package files stay present, unmodified in shape (still export the
    // same public Calendar API #337B does not touch).
    const calendarIndex = read('src/lib/calendar-chat/index.js')
    assert.match(calendarIndex, /applyCalendarIntent/)
    assert.match(calendarIndex, /detectCalendarIntent/)
    for (const rel of [
      'src/lib/calendar-chat/intent.js',
      'src/lib/calendar-chat/controller.js',
      'src/lib/calendar-chat/render.js',
      'src/lib/calendar-chat/active-context.js',
      'src/lib/calendar-chat/api.js',
      'src/lib/calendar-chat/free-time.js',
      'src/lib/calendar-chat/range.js',
      'src/lib/calendar-chat/normalize.js',
      'src/components/CalendarIntegrationsSettings.tsx',
      'src/lib/calendarApi.ts',
      'src/lib/calendarToggleModel.ts',
    ]) {
      assert.ok(fs.existsSync(path.join(root, rel)), `${rel} must still exist`)
    }

    const ctx = read('src/context/ChatContext.tsx')
    assert.match(ctx, /detectCalendarIntent/)
    assert.match(ctx, /applyCalendarIntent/)
    assert.match(ctx, /#336B/)
    assert.match(ctx, /detectEmailIntent/)
    assert.match(ctx, /applyEmailIntent/)
    assert.match(ctx, /#337B/)

    // Email block must be inserted AFTER Calendar's own "return true", and BEFORE
    // Daily Briefing — Calendar behavior/order is unchanged.
    const calIdx = ctx.indexOf('#336B — Calendar chat')
    const emailIdx = ctx.indexOf('#337B — Gmail read-only chat')
    const briefingIdx = ctx.indexOf('#321/#334C — Daily Briefing')
    assert.ok(calIdx > 0)
    assert.ok(emailIdx > calIdx)
    assert.ok(briefingIdx > emailIdx)
  })

  it('does not create api/email.ts and does not import Gmail read into /api/chat', () => {
    assert.ok(!fs.existsSync(path.join(root, 'api/email.ts')))
    const chat = read('api/chat.ts')
    assert.doesNotMatch(chat, /listMessages|gmail-http|email-read|email_query/)
  })

  it('wires SettingsDrawer with Email below Calendar under Integrazioni', () => {
    const drawer = read('src/components/SettingsDrawer.tsx')
    assert.match(drawer, /EmailIntegrationsSettings/)
    const calIdx = drawer.indexOf('<CalendarIntegrationsSettings')
    const emailIdx = drawer.indexOf('<EmailIntegrationsSettings')
    assert.ok(calIdx > 0)
    assert.ok(emailIdx > calIdx)
  })

  it('EmailIntegrationsSettings does not auto-start OAuth and calls consumeEmailReturnQuery on mount', () => {
    const ui = read('src/components/EmailIntegrationsSettings.tsx')
    assert.match(ui, /consumeEmailReturnQuery/)
    assert.match(ui, /useEffect/)
    assert.doesNotMatch(ui, /useEffect\(\(\)\s*=>\s*\{\s*void\s*startGoogleGmailOAuth/)
    assert.match(ui, /sola lettura|Sola lettura/i)
    assert.match(ui, /Memoria/)
    assert.match(ui, /Calendar/)
  })
})

describe('email-chat-337b ↔ Supabase Edge contract (when present)', () => {
  const gmailHttpPath = path.join(root, 'supabase/functions/_shared/email-gmail.ts')
  const hasBackend = fs.existsSync(gmailHttpPath)

  it('client queryType values match the Edge query-builder switch', { skip: !hasBackend }, () => {
    const gmail = read('supabase/functions/_shared/email-gmail.ts')
    // Every fresh-query queryType this client can send must be a case the
    // Edge query builder actually understands.
    for (const qt of ['today', 'unread', 'latest', 'sender', 'time_window', 'summary', 'body_one']) {
      assert.match(gmail, new RegExp(`case '${qt}':`))
    }
  })

  it('single-message follow-up uses body_one + bodyText (never a made-up shape)', { skip: !hasBackend }, () => {
    const gmail = read('supabase/functions/_shared/email-gmail.ts')
    assert.match(gmail, /bodyText\?:\s*string/)
    const controller = read('src/lib/email-chat/controller.js')
    assert.match(controller, /queryType:\s*'body_one'/)
    assert.doesNotMatch(controller, /queryType:\s*'summary',\s*\n?\s*messageId/)
  })

  it('email-query Edge status enum matches the client EmailQueryStatus union', { skip: !hasBackend }, () => {
    const edgeFn = read('supabase/functions/email-query/index.ts')
    const clientApi = read('src/lib/emailApi.ts')
    for (const status of [
      'ok',
      'empty',
      'disabled',
      'disconnected',
      'reconnect_required',
      'timeout',
      'error',
      'no_sender_match',
    ]) {
      assert.match(edgeFn, new RegExp(`'${status}'`), `edge missing ${status}`)
      assert.match(clientApi, new RegExp(`'${status}'`), `client missing ${status}`)
    }
  })
})

describe('email-chat-337b intents (Italian-first)', () => {
  const positives = [
    'Che email ho ricevuto oggi?',
    'Ho nuove email?',
    'Ho email non lette?',
    "Qual è l'ultima email?",
    'ultima mail?',
    'Ho ricevuto qualcosa da Amazon?',
    'Che email ho ricevuto da Marco?',
    'Riassumimi le email di stamattina',
    'Riassumimi le email di oggi',
    'Ho posta?',
  ]

  for (const phrase of positives) {
    it(`detects: ${phrase}`, () => {
      const r = detectEmailIntent(phrase)
      assert.equal(r.intent, 'email', phrase)
    })
  }

  it('maps queryType per required phrase', () => {
    assert.equal(detectEmailIntent('Che email ho ricevuto oggi?').queryType, 'today')
    assert.equal(detectEmailIntent('Ho nuove email?').queryType, 'unread')
    assert.equal(detectEmailIntent('Ho email non lette?').queryType, 'unread')
    assert.equal(detectEmailIntent("Qual è l'ultima email?").queryType, 'latest')
    assert.equal(detectEmailIntent('ultima mail?').queryType, 'latest')
    const amazon = detectEmailIntent('Ho ricevuto qualcosa da Amazon?')
    assert.equal(amazon.queryType, 'sender')
    assert.equal(amazon.sender, 'Amazon')
    const marco = detectEmailIntent('Che email ho ricevuto da Marco?')
    assert.equal(marco.queryType, 'sender')
    assert.equal(marco.sender, 'Marco')
    const summaryMorning = detectEmailIntent('Riassumimi le email di stamattina')
    assert.equal(summaryMorning.queryType, 'summary')
    assert.equal(summaryMorning.timeWindow, 'morning')
    const summaryToday = detectEmailIntent('Riassumimi le email di oggi')
    assert.equal(summaryToday.queryType, 'summary')
    assert.equal(summaryToday.timeWindow, 'today')
  })

  const negatives = [
    'Apri Gmail',
    'Cosa ho domani?',
    'Che tempo fa?',
    'Timer 20 minuti',
    'Come stai?',
    'Buongiorno',
  ]

  for (const phrase of negatives) {
    it(`does not hijack: ${phrase}`, () => {
      const r = detectEmailIntent(phrase)
      assert.equal(r.intent, 'none', phrase)
    })
  }

  it('ambiguous "Cosa mi ha scritto Marco?" without email/mail/posta never claims', () => {
    const withoutContext = detectEmailIntent('Cosa mi ha scritto Marco?', {
      hasEmailContext: false,
    })
    assert.equal(withoutContext.intent, 'none')

    const withContext = detectEmailIntent('Cosa mi ha scritto Marco?', {
      hasEmailContext: true,
    })
    // Either a loose follow-up or "none" is acceptable — it must never be treated
    // as a fresh, confident sender/today/etc. query without an email keyword.
    assert.ok(withContext.intent === 'none' || withContext.followUp === true)
  })

  it('follow-ups only fire when hasEmailContext is true', () => {
    const withoutContext = detectEmailIntent('la prima', { hasEmailContext: false })
    assert.equal(withoutContext.intent, 'none')

    const withContext = detectEmailIntent('la prima', { hasEmailContext: true })
    assert.equal(withContext.intent, 'email')
    assert.equal(withContext.followUp, true)
    assert.equal(withContext.followUpKind, 'ordinal')
    assert.equal(withContext.ordinalIndex, 0)
  })

  it('detects the full follow-up vocabulary with context', () => {
    const cases = [
      ['prima', 'ordinal'],
      ['seconda', 'ordinal'],
      ['terza', 'ordinal'],
      ['quella dopo', 'next_after'],
      ['precedente', 'previous'],
      ['quando', 'when'],
      ['chi', 'who'],
      ['oggetto', 'subject'],
      ['non letta', 'unread_status'],
      ['riassumila', 'summarize'],
    ]
    for (const [phrase, kind] of cases) {
      const r = detectEmailIntent(phrase, { hasEmailContext: true })
      assert.equal(r.intent, 'email', phrase)
      assert.equal(r.followUpKind, kind, phrase)
    }
  })

  it('natural trigger words: email, mail, posta', () => {
    assert.equal(detectEmailIntent('Ho ricevuto email oggi?').intent, 'email')
    assert.equal(detectEmailIntent('Ho ricevuto mail oggi?').intent, 'email')
    assert.equal(detectEmailIntent('Ho ricevuto posta oggi?').intent, 'email')
  })

  it('normalizes accents/apostrophes', () => {
    assert.match(foldEmailText("Qual è l'ultima email?"), /qual e l'ultima email/)
  })
})

describe('email-chat-337b renderer', () => {
  it('renders failure copy (Italian-first)', () => {
    assert.match(failureReply('disabled', 'it'), /Email non è attiva/)
    assert.match(failureReply('disconnected', 'it'), /Collega Gmail.*vedere le tue email/)
    assert.match(failureReply('reconnect_required', 'it'), /Ricollega Gmail/)
    assert.match(failureReply('timeout', 'it'), /troppo a rispondere/)
    assert.match(failureReply('error', 'it'), /Non riesco a leggere Gmail/)
    assert.match(failureReply('empty', 'it'), /Non risultano email per questa ricerca/)
    assert.match(failureReply('no_sender_match', 'it'), /Non trovo email recenti/)
  })

  it('renders empty / single / multiple lists', () => {
    assert.match(
      renderEmailList([], 'today', { language: 'it', timeWindow: 'today' }),
      /Non risultano email/,
    )
    const msgs = [
      {
        id: '1',
        from: 'Amazon',
        subject: 'Il tuo ordine è in arrivo',
        receivedAt: '2026-08-22T08:00:00.000Z',
        unread: true,
      },
    ]
    assert.match(
      renderEmailList(msgs, 'sender', { language: 'it', sender: 'Amazon' }),
      /Amazon/,
    )
    const many = [
      ...msgs,
      {
        id: '2',
        from: 'Marco',
        subject: 'Riunione di domani',
        receivedAt: '2026-08-22T09:00:00.000Z',
        unread: false,
      },
    ]
    const multi = renderEmailList(many, 'today', { language: 'it', timeWindow: 'today' })
    assert.match(multi, /Amazon/)
    assert.match(multi, /Marco/)
  })

  it('extractive summary never invents content beyond message fields', () => {
    const msgs = [
      {
        id: '1',
        from: 'Marco',
        subject: 'Fattura di agosto',
        snippet: 'In allegato trovi la fattura del mese di agosto.',
        receivedAt: '2026-08-22T07:30:00.000Z',
        unread: true,
      },
    ]
    const summary = extractiveSummary(msgs, { language: 'it', timeWindow: 'morning' })
    assert.match(summary, /Marco/)
    assert.match(summary, /Fattura di agosto/)
    assert.match(summary, /In allegato trovi la fattura/)
    assert.doesNotMatch(summary, /probabilmente|potrebbe essere|immagino/i)
  })

  it('renders follow-up answers from context', () => {
    const ctx = {
      language: 'it',
      timezone: 'UTC',
      focusIndex: 0,
      messages: [
        {
          id: '1',
          from: 'Marco',
          subject: 'Fattura di agosto',
          receivedAt: '2026-08-22T07:30:00.000Z',
          unread: true,
        },
        {
          id: '2',
          from: 'Amazon',
          subject: 'Spedizione in corso',
          receivedAt: '2026-08-22T09:15:00.000Z',
          unread: false,
        },
      ],
    }
    assert.match(renderFollowUp('who', ctx), /Marco/)
    assert.match(renderFollowUp('subject', ctx), /Fattura di agosto/)
    assert.match(renderFollowUp('unread_status', ctx), /non letta/)
    assert.match(renderFollowUp('next_after', ctx), /Amazon/)
    assert.match(renderFollowUp('ordinal', ctx, { ordinalIndex: 1 }), /Amazon/)
  })
})

describe('email-chat-337b controller', () => {
  it('applyEmailIntent uses pack and zero model calls', async () => {
    const result = await applyEmailIntent({
      text: 'Che email ho ricevuto oggi?',
      languageHint: 'it',
      timeZone: 'UTC',
      requestFn: async () => ({
        status: 'ok',
        messages: [
          {
            id: 'm1',
            from: 'Marco',
            subject: 'Ciao',
            receivedAt: '2026-08-22T09:00:00.000Z',
            unread: true,
          },
        ],
        fetchedAt: new Date().toISOString(),
        timeZone: 'UTC',
      }),
    })
    assert.equal(result.handled, true)
    assert.match(result.reply, /Marco/)
    assert.equal(result.diag.modelCalls, 0)
    assert.ok(result.emailContext)
  })

  it('follow-up ordinal reuses context with zero model calls', async () => {
    const ctx = createEmailContext({
      timezone: 'UTC',
      messages: [
        { id: '1', from: 'Uno', subject: 'Primo', receivedAt: '2026-08-22T09:00:00.000Z', unread: true },
        { id: '2', from: 'Due', subject: 'Secondo', receivedAt: '2026-08-22T14:00:00.000Z', unread: false },
      ],
      focusIndex: 0,
      queryType: 'today',
      status: 'ok',
      language: 'it',
    })
    const result = await applyEmailIntent({
      text: 'la seconda',
      languageHint: 'it',
      emailContext: ctx,
      timeZone: 'UTC',
    })
    assert.equal(result.handled, true)
    assert.match(result.reply, /Due/)
    assert.equal(result.diag.modelCalls, 0)
  })

  it('riassumila requests one message body, falls back to snippet on failure', async () => {
    const ctx = createEmailContext({
      timezone: 'UTC',
      messages: [
        {
          id: '1',
          from: 'Marco',
          subject: 'Fattura',
          snippet: 'Fattura di agosto in allegato.',
          receivedAt: '2026-08-22T09:00:00.000Z',
          unread: true,
        },
      ],
      focusIndex: 0,
      queryType: 'today',
      status: 'ok',
      language: 'it',
    })

    const failing = await applyEmailIntent({
      text: 'riassumila',
      languageHint: 'it',
      emailContext: ctx,
      timeZone: 'UTC',
      requestFn: async () => ({ status: 'error', messages: [], fetchedAt: new Date().toISOString() }),
    })
    assert.equal(failing.handled, true)
    assert.match(failing.reply, /Fattura di agosto in allegato/)
    assert.equal(failing.diag.modelCalls, 0)

    let capturedPayload = null
    const succeeding = await applyEmailIntent({
      text: 'riassumila',
      languageHint: 'it',
      emailContext: ctx,
      timeZone: 'UTC',
      requestFn: async (payload) => {
        capturedPayload = payload
        return {
          status: 'ok',
          messages: [{ id: '1', bodyText: 'Testo completo della fattura di agosto.' }],
          fetchedAt: new Date().toISOString(),
        }
      },
    })
    assert.equal(succeeding.handled, true)
    assert.match(succeeding.reply, /Testo completo della fattura/)
    assert.equal(succeeding.diag.modelCalls, 0)
    // Matches the real backend contract: single-message body fetch uses
    // queryType 'body_one' + messageId + includeBody (never 'summary').
    assert.equal(capturedPayload.queryType, 'body_one')
    assert.equal(capturedPayload.messageId, '1')
    assert.equal(capturedPayload.includeBody, true)
  })

  it('disconnected returns specific copy + settings action', async () => {
    const result = await applyEmailIntent({
      text: 'Ho email non lette?',
      languageHint: 'it',
      timeZone: 'UTC',
      requestFn: async () => ({ status: 'disconnected', messages: [], fetchedAt: new Date().toISOString() }),
    })
    assert.match(result.reply, /Collega Gmail/)
    assert.equal(result.emailUi?.actions?.[0]?.id, 'open_settings')
  })
})

describe('email-chat-337b no Core fallthrough (matched Email intents terminate locally)', () => {
  it('ChatContext returns before /api/chat for Email claim, after Calendar', () => {
    const ctx = read('src/context/ChatContext.tsx')
    const emailIdx = ctx.indexOf('#337B — Gmail read-only chat')
    const chatIdx = ctx.indexOf('runAssistantCompletion(history')
    assert.ok(emailIdx > 0)
    assert.ok(chatIdx > emailIdx)
    assert.match(ctx, /Never fall through to \/api\/chat — including disabled\/disconnected\/error\. Calendar/)
    const block = ctx.slice(emailIdx, chatIdx)
    assert.match(block, /intent === 'email'/)
    assert.match(block, /return true/)
  })

  const terminalStatuses = [
    'disabled',
    'disconnected',
    'reconnect_required',
    'timeout',
    'error',
    'no_sender_match',
    'empty',
    'ok',
  ]

  for (const status of terminalStatuses) {
    it(`matched intent + ${status} terminates locally (no Core)`, async () => {
      const result = await applyEmailIntent({
        text: 'Che email ho ricevuto oggi?',
        languageHint: 'it',
        timeZone: 'UTC',
        requestFn: async () => ({
          status,
          messages:
            status === 'ok'
              ? [
                  {
                    id: '1',
                    from: 'Marco',
                    subject: 'Ciao',
                    receivedAt: '2026-08-22T09:00:00.000Z',
                    unread: true,
                  },
                ]
              : [],
          fetchedAt: new Date().toISOString(),
        }),
      })
      assert.equal(result.handled, true)
      assert.ok(result.reply)
      assert.equal(result.diag.modelCalls, 0)
      assert.equal(result.diag.terminatesLocally, true)
    })
  }

  it('never sends, replies to, or deletes — no such affordances exist in the package', () => {
    for (const rel of [
      'src/lib/email-chat/api.js',
      'src/lib/email-chat/controller.js',
      'src/lib/email-chat/render.js',
      'src/lib/emailApi.ts',
    ]) {
      const src = read(rel)
      assert.doesNotMatch(src, /\bsendMessage\b|\breply\.send\b|messages\.delete|trash\b/i)
    }
  })
})

describe('emailToggleModel source contracts (#337B)', () => {
  it('wires Settings toggle to OAuth start / disconnect (not local preference)', () => {
    const ui = read('src/components/EmailIntegrationsSettings.tsx')
    assert.match(ui, /resolveEmailToggleModel/)
    assert.match(ui, /memory-toggle/)
    assert.match(ui, />\s*ON\s*</)
    assert.match(ui, />\s*OFF\s*</)
    assert.match(ui, /startGoogleGmailOAuth/)
    assert.match(ui, /disconnectGoogleGmail/)
    assert.match(ui, /fetchEmailConnectionStatus/)
    assert.match(ui, /Sola lettura/)
    assert.match(ui, /Non disponibile/)
    assert.doesNotMatch(ui, /localStorage/)
    assert.doesNotMatch(ui, /access_token|refresh_token/)
  })

  it('has the expected pure export surface', () => {
    const src = read('src/lib/emailToggleModel.ts')
    assert.match(src, /export function resolveEmailToggleModel/)
    assert.match(src, /EmailToggleVisual/)
    assert.match(src, /EmailServiceState/)
    assert.match(src, /EmailUiPhase/)
  })
})

console.log('email-chat-337b: ok')
