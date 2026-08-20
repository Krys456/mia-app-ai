/**
 * #325A — Transient response-style instructions must not become durable Memory.
 * Standing preference language may still create settings.reply_style.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  extractDurableFacts,
  hasDurableReplyStylePreferenceLanguage,
  isTransientResponseStyleInstruction,
} from './brain-memory.js'
import { computeConversationState } from './conversation-state.js'

function replyStyleFacts(message) {
  return extractDurableFacts(message).filter(
    (f) =>
      f.factKey === 'settings.reply_style' ||
      /^settings\.reply_style\b/.test(String(f.factKey || '')) ||
      /^context\.[^.]+\.reply_style\b/.test(String(f.factKey || '')) ||
      /^projects\.[^.]+\.reply_style\b/.test(String(f.factKey || '')) ||
      /Reply preference/i.test(String(f.title || '')) ||
      /prefers (?:detailed|concise) replies/i.test(String(f.content || '')),
  )
}

describe('#325A transient style → memory guard', () => {
  it('TEMPORARY: Ora spiegalo dettagliatamente → detailed turn, no durable preference memory', () => {
    const msg = 'Ora spiegalo dettagliatamente.'
    assert.equal(isTransientResponseStyleInstruction(msg), true)
    assert.equal(hasDurableReplyStylePreferenceLanguage(msg), false)
    assert.equal(replyStyleFacts(msg).length, 0)
    assert.equal(extractDurableFacts(msg).length, 0)

    const state = computeConversationState({ userMessage: msg, settings: {} })
    assert.equal(state.desiredDepth, 'detailed')
    assert.ok(state.explicitOverrides.includes('depth:detailed'))
  })

  it('PERSISTENT: Da ora in poi preferisco risposte dettagliate → durable reply_style', () => {
    const msg = 'Da ora in poi preferisco risposte dettagliate.'
    assert.equal(isTransientResponseStyleInstruction(msg), false)
    assert.equal(hasDurableReplyStylePreferenceLanguage(msg), true)
    const facts = replyStyleFacts(msg)
    assert.ok(facts.length >= 1)
    assert.equal(facts[0].factKey, 'settings.reply_style')
    assert.match(facts[0].content, /detailed/i)
  })

  it('TEMPORARY emoji this-turn vs PERSISTENT emoji preference', () => {
    const temporary = 'Non usare emoji in questa risposta.'
    assert.equal(isTransientResponseStyleInstruction(temporary), true)
    assert.equal(extractDurableFacts(temporary).length, 0)

    const persistent = 'Preferisco che tu non usi emoji.'
    assert.equal(hasDurableReplyStylePreferenceLanguage(persistent), true)
    const facts = extractDurableFacts(persistent)
    assert.ok(facts.length >= 1, 'eligible durable preference memory')
    assert.ok(
      facts.some(
        (f) =>
          /emoji/i.test(String(f.content || '')) ||
          f.factKey === 'settings.preferred' ||
          f.factKey === 'settings.reply_style',
      ),
    )
  })

  it('other temporary style cues do not create reply_style memory', () => {
    const temporary = [
      'Spiegalo semplice.',
      'Rispondi brevemente.',
      'Dammi solo la risposta.',
      'Vai dritto al punto.',
      'Usa qualche emoji.',
      'Non usare emoji.',
      'Fammi una lista.',
      'Spiegamelo come se non sapessi nulla.',
      'Per questa risposta sii più formale.',
      'Adesso fammelo più corto.',
      'Ora approfondisci.',
      'Questa volta sii sintetico.',
      'Be more detailed.',
      'Give a detailed answer.',
    ]
    for (const msg of temporary) {
      assert.equal(
        replyStyleFacts(msg).length,
        0,
        `must not save reply_style for: ${msg}`,
      )
    }
  })

  it('standing preference idioms still save reply_style', () => {
    const persistent = [
      'Ricordati che preferisco risposte brevi.',
      'Ricorda che preferisco risposte dettagliate',
      'I prefer concise replies.',
      'Keep answers brief.',
      'Preferisco risposte dettagliate.',
    ]
    for (const msg of persistent) {
      const facts = replyStyleFacts(msg)
      assert.ok(facts.length >= 1, `expected durable reply_style for: ${msg}`)
      assert.equal(facts[0].factKey, 'settings.reply_style')
    }
  })

  it('Conversation State short/emoji overrides still apply without Memory writes', () => {
    const brief = computeConversationState({
      userMessage: 'Rispondi brevemente.',
      settings: {},
    })
    assert.equal(brief.desiredDepth, 'short')
    assert.equal(replyStyleFacts('Rispondi brevemente.').length, 0)

    const noEmoji = computeConversationState({
      userMessage: 'Non usare emoji in questa risposta.',
      settings: {},
    })
    assert.equal(noEmoji.emojiLevel, 'none')
    assert.equal(extractDurableFacts('Non usare emoji in questa risposta.').length, 0)
  })
})
