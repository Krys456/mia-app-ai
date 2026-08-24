/**
 * #383F — Gmail write_unsupported precedence over Phone mailto compose.
 * Run: node --test src/lib/email-chat/email-phone-precedence-383f.test.mjs
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'
import { detectEmailIntent } from './intent.js'
import { applyEmailIntent } from './controller.js'
import { shouldDeferPhoneEmailComposeToGmailWrite } from './phone-write-precedence.js'
import { applyPhoneAction } from '../phone-action/controller.js'
import { detectPhoneActionIntent } from '../phone-action/intent.js'

const root = process.cwd()
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')

describe('#383F Gmail write_unsupported vs Phone mailto precedence', () => {
  it('wires ChatContext with the thin defer guard (not a global Phone skip)', () => {
    const ctx = read('src/context/ChatContext.tsx')
    assert.match(ctx, /shouldDeferPhoneEmailComposeToGmailWrite/)
    assert.match(ctx, /#383F/)
    assert.match(ctx, /write_unsupported/)
    assert.match(ctx, /skipPhoneEmailCompose/)
    assert.match(ctx, /detectPhoneActionIntent/)
    // Phone block still exists and still calls applyPhoneAction for non-compose
    assert.match(ctx, /applyPhoneAction/)
    assert.match(ctx, /#315 — deterministic Phone Actions/)
  })

  it('never opens mailto when write_unsupported defers Phone compose', () => {
    let mailtoOpened = 0
    const phrase = 'Send an email to marco@example.com'
    const email = detectEmailIntent(phrase, { languageHint: 'en' })
    assert.equal(email.queryType, 'write_unsupported')
    const phoneProbe = detectPhoneActionIntent(phrase, { languageHint: 'en' })
    assert.equal(phoneProbe.kind, 'email')
    const skip = shouldDeferPhoneEmailComposeToGmailWrite(email, {
      handled: true,
      action: 'email',
      diag: { phoneActionIntent: phoneProbe.kind },
    })
    assert.equal(skip, true)
    // ChatContext skips applyPhoneAction when skip — prove apply WOULD open mailto without skip
    applyPhoneAction({
      text: phrase,
      languageHint: 'en',
      env: {
        location: {
          href: '',
          assign: (url) => {
            mailtoOpened += 1
            assert.match(String(url), /^mailto:/i)
          },
        },
      },
    })
    assert.equal(mailtoOpened, 1, 'control: applyPhoneAction opens mailto without guard')
  })

  const writePhrases = [
    ['Send an email to Marco', 'en'],
    ['Send an email to marco@example.com', 'en'],
    ['Write an email to Marco', 'en'],
    ['Scrivi una mail a Marco', 'it'],
    ['Invia una mail a Marco', 'it'],
    ['Manda una email a marco@example.com', 'it'],
  ]

  for (const [phrase, lang] of writePhrases) {
    it(`Gmail write_unsupported wins for: ${phrase}`, async () => {
      const email = detectEmailIntent(phrase, { languageHint: lang })
      assert.equal(email.intent, 'email', phrase)
      assert.equal(email.queryType, 'write_unsupported', phrase)
      assert.equal(email.language, lang, phrase)

      const phoneIntent = detectPhoneActionIntent(phrase, { languageHint: lang })
      const phone = applyPhoneAction({
        text: phrase,
        languageHint: lang,
        env: {
          // Capture mailto attempts — must not fire when deferred
          assignLocation: (url) => {
            throw new Error(`mailto must not open: ${url}`)
          },
          openWindow: (url) => {
            throw new Error(`mailto must not open: ${url}`)
          },
        },
      })

      // Simulate ChatContext gate: defer only email-compose Phone claims
      const defer = shouldDeferPhoneEmailComposeToGmailWrite(email, phone)
      if (phoneIntent.kind === 'email' || phoneIntent.kind === 'email_needs_address') {
        assert.equal(phone.handled, true, phrase)
        assert.equal(defer, true, `must defer Phone compose for: ${phrase}`)
      } else {
        // Phone did not claim compose — Email still owns write_unsupported
        assert.equal(defer, false)
      }

      let apiCalls = 0
      const mail = await applyEmailIntent({
        text: phrase,
        languageHint: lang,
        requestFn: async () => {
          apiCalls += 1
          throw new Error('Gmail API must not be called for write_unsupported')
        },
      })
      assert.equal(mail.handled, true, phrase)
      assert.equal(apiCalls, 0, phrase)
      assert.equal(mail.diag.operation, 'write_unsupported', phrase)
      assert.equal(mail.diag.gmailApiCalls, 0, phrase)
      assert.equal(mail.diag.modelCalls, 0, phrase)
      assert.equal(mail.diag.terminatesLocally, true, phrase)
      if (lang === 'en') {
        assert.match(mail.reply, /can read/i)
        assert.match(mail.reply, /can.t send|can't send|cannot send/i)
      } else {
        assert.match(mail.reply, /Posso leggere|leggere/i)
        assert.match(mail.reply, /non posso ancora inviare/i)
      }
      assert.doesNotMatch(mail.reply, /valid email address|indirizzo email valido/i)
    })
  }

  it('Phone open_app still wins for Apri Gmail / Open Gmail', () => {
    for (const phrase of ['Apri Gmail', 'Open Gmail']) {
      const email = detectEmailIntent(phrase, { languageHint: 'en' })
      assert.equal(email.intent, 'none', phrase)

      const phoneIntent = detectPhoneActionIntent(phrase)
      assert.equal(phoneIntent.kind, 'open_app', phrase)
      assert.equal(phoneIntent.target, 'gmail', phrase)

      const phone = applyPhoneAction({ text: phrase, languageHint: 'it' })
      assert.equal(phone.handled, true, phrase)
      assert.equal(
        shouldDeferPhoneEmailComposeToGmailWrite(email, phone),
        false,
        `must NOT defer open_app for: ${phrase}`,
      )
      assert.ok(phone.action === 'open_app' || phone.diag?.phoneActionIntent === 'open_app')
    }
  })

  it('helper never defers non-email Phone actions', () => {
    const email = detectEmailIntent('Send an email to Marco', { languageHint: 'en' })
    assert.equal(
      shouldDeferPhoneEmailComposeToGmailWrite(email, {
        handled: true,
        action: 'open_app',
        diag: { phoneActionIntent: 'open_app' },
      }),
      false,
    )
    assert.equal(
      shouldDeferPhoneEmailComposeToGmailWrite(email, {
        handled: true,
        action: 'call',
        diag: { phoneActionIntent: 'call' },
      }),
      false,
    )
  })

  it('"Email Marco" remains a known limitation (today, not write_unsupported)', () => {
    const r = detectEmailIntent('Email Marco', { languageHint: 'en' })
    assert.equal(r.intent, 'email')
    assert.notEqual(r.queryType, 'write_unsupported')
    // Ambiguous verb-as-noun — do not over-broaden in #383F
    assert.equal(r.queryType, 'today')
  })
})
