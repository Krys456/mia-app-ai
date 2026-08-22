/**
 * #326 — Anti-template / style variety MVP tests
 * Run: node --test lib/server/style-variety-326.test.mjs
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  SESSION_STYLE_CAPS,
  STYLE_AVOID_APPENDIX_MAX_CHARS,
  STYLE_VARIETY_BUILD,
  buildStyleAvoidAppendix,
  buildStyleVarietyDiagPayload,
  classifyEndingType,
  classifyStructureType,
  collectSessionStyleFingerprints,
  computeConversationState,
  createEmptySessionStyleState,
  normalizeFirstPhraseFingerprint,
  rollbackLastSessionStyleFingerprint,
  sanitizeSessionStyleState,
} from './conversation-state.js'
import { extractDurableFacts } from './brain-memory.js'
import {
  NATURAL_RESPONSE_POLICY_MAX_CHARS,
  buildNaturalResponsePolicyAppendix,
} from './natural-response-policy.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const chatSrc = readFileSync(join(root, 'api/chat.ts'), 'utf8')
const ctxSrc = readFileSync(join(root, 'src/context/ChatContext.tsx'), 'utf8')
const apiSrc = readFileSync(join(root, 'src/lib/chatApi.ts'), 'utf8')

describe('#326 style variety', () => {
  it('collector: opening / ack / emoji / ending / structure / length / first phrase', () => {
    const empty = createEmptySessionStyleState()
    assert.equal(empty.recentFirstPhrases.length, 0)
    assert.equal(empty.recentEndingTypes.length, 0)
    assert.equal(empty.recentStructureTypes.length, 0)

    const a = collectSessionStyleFingerprints(
      'Certo! Ecco il piano.\n\n1. Uno\n2. Due 🎉',
      empty,
    )
    assert.equal(a.recentOpeningTypes.at(-1), 'filler_ack')
    assert.equal(a.recentAcknowledgementTypes.at(-1), 'certo')
    assert.ok(a.recentFirstPhrases.at(-1)?.startsWith('certo'))
    assert.equal(a.recentEndingTypes.at(-1), 'clean_stop')
    assert.equal(a.recentStructureTypes.at(-1), 'list')
    assert.ok(a.recentEmojis.includes('🎉'))
    assert.equal(a.lastEndingWasQuestion, false)
    assert.ok(['short', 'medium', 'long'].includes(a.lastResponseLengthBucket))

    const b = collectSessionStyleFingerprints('Che ne pensi di questo approccio?', a)
    assert.equal(b.recentEndingTypes.at(-1), 'question')
    assert.equal(b.lastEndingWasQuestion, true)
  })

  it('first-phrase normalization', () => {
    assert.equal(
      normalizeFirstPhraseFingerprint('Finalmente davvero!!! 🎉 Stavolta...'),
      'finalmente davvero stavolta',
    )
    assert.equal(normalizeFirstPhraseFingerprint('Ah, capito. Allora...'), 'ah capito allora')
    assert.equal(normalizeFirstPhraseFingerprint('🎉 Ciao!'), 'ciao')
  })

  it('ending + structure classifiers', () => {
    assert.equal(classifyEndingType('Fatto.'), 'clean_stop')
    assert.equal(classifyEndingType('Che ne pensi?'), 'question')
    assert.equal(classifyEndingType('Vuoi che lo faccia io?'), 'service_offer')
    assert.equal(classifyEndingType('Io sceglierei Nova.'), 'recommendation')
    assert.equal(classifyStructureType('Solo prosa qui.'), 'prose')
    assert.equal(classifyStructureType('- a\n- b'), 'list')
    assert.equal(classifyStructureType('## Titolo\n\ntesto'), 'headings')
  })

  it('window caps + sanitization', () => {
    let s = createEmptySessionStyleState()
    for (let i = 0; i < 10; i++) {
      s = collectSessionStyleFingerprints(`Certo risposta numero ${i} con dettagli extra.`, s)
    }
    assert.ok(s.recentOpeningTypes.length <= SESSION_STYLE_CAPS.openings)
    assert.ok(s.recentFirstPhrases.length <= SESSION_STYLE_CAPS.firstPhrases)
    assert.ok(s.recentEndingTypes.length <= SESSION_STYLE_CAPS.endings)

    const dirty = sanitizeSessionStyleState({
      recentFirstPhrases: ['x'.repeat(200), 12, null, 'ok phrase'],
      recentEmojis: Array.from({ length: 20 }, () => '🔥'),
      lastResponseLengthBucket: 'nope',
      lastEndingWasQuestion: 'yes',
    })
    assert.equal(dirty.lastResponseLengthBucket, null)
    assert.equal(dirty.lastEndingWasQuestion, null)
    assert.ok(dirty.recentFirstPhrases.every((p) => p.length <= 48))
    assert.ok(dirty.recentEmojis.length <= SESSION_STYLE_CAPS.emojis)
  })

  it('STYLE_AVOID appendix empty vs populated + question strengthen', () => {
    assert.equal(buildStyleAvoidAppendix(createEmptySessionStyleState()), '')
    const styled = collectSessionStyleFingerprints(
      'Capisco. Ecco una nota?',
      createEmptySessionStyleState(),
    )
    const state = computeConversationState({
      userMessage: 'Ok continua',
      settings: {},
    })
    assert.equal(state.questionNeeded, false)
    const avoid = buildStyleAvoidAppendix(styled, state)
    assert.ok(avoid.startsWith('RECENT STYLE — SOFT AVOID'))
    assert.ok(avoid.length <= STYLE_AVOID_APPENDIX_MAX_CHARS)
    assert.ok(/Stronger:.*question/i.test(avoid))
    assert.ok(/Soft-avoid|soft avoid|equally natural/i.test(avoid))
  })

  it('NRP mentions soft recent style; stays compact', () => {
    const nrp = buildNaturalResponsePolicyAppendix()
    assert.ok(/Recent style|recent-style|STYLE_AVOID/i.test(nrp))
    assert.ok(/soft avoid|soft negative|Emotion|emotion\/clarity/i.test(nrp))
    assert.ok(nrp.length <= NATURAL_RESPONSE_POLICY_MAX_CHARS)
  })

  it('api/chat wires sessionStyle sanitize + STYLE_AVOID before NRP', () => {
    assert.ok(chatSrc.includes('sanitizeSessionStyleState'))
    assert.ok(chatSrc.includes('buildStyleAvoidAppendix'))
    const stateIdx = chatSrc.indexOf(
      'const conversationStateAppendix = buildConversationStateAppendix',
    )
    const avoidIdx = chatSrc.indexOf('const styleAvoidAppendix = buildStyleAvoidAppendix')
    const nrpIdx = chatSrc.indexOf(
      'const naturalResponsePolicyAppendix = buildNaturalResponsePolicyAppendix',
    )
    assert.ok(stateIdx > 0 && avoidIdx > stateIdx && nrpIdx > avoidIdx)
    assert.ok(!/runCognitiveEngine|conversation-diversity-engine|conversation-opening-engine/.test(chatSrc))
  })

  it('client Core-only update; LOCAL_EXCHANGE does not call style update', () => {
    assert.ok(ctxSrc.includes('applyCoreAssistantStyleUpdate'))
    assert.ok(ctxSrc.includes('sessionStyle: applyCoreAssistantStyleUpdate'))
    assert.ok(ctxSrc.includes('ASSISTANT_FINISH'))
    // LOCAL_EXCHANGE block must not call applyCoreAssistantStyleUpdate
    const localIdx = ctxSrc.indexOf("case 'LOCAL_EXCHANGE'")
    const finishIdx = ctxSrc.indexOf("case 'ASSISTANT_FINISH'")
    assert.ok(localIdx > 0 && finishIdx > localIdx)
    const localBlock = ctxSrc.slice(localIdx, finishIdx)
    assert.ok(!localBlock.includes('applyCoreAssistantStyleUpdate'))
    assert.ok(ctxSrc.includes('rollbackSessionStyle'))
    assert.ok(ctxSrc.includes('clearSessionStyleStorage'))
    assert.ok(apiSrc.includes('sessionStyle'))
  })

  it('regenerate rollback removes last fingerprint', () => {
    let s = createEmptySessionStyleState()
    s = collectSessionStyleFingerprints('Certo uno.', s)
    s = collectSessionStyleFingerprints('Capisco due.', s)
    assert.equal(s.recentAcknowledgementTypes.at(-1), 'capisco')
    const rolled = rollbackLastSessionStyleFingerprint(s)
    assert.equal(rolled.recentAcknowledgementTypes.at(-1), 'certo')
    assert.ok(rolled.recentFirstPhrases.length === 1)
  })

  it('Memory boundary: style fingerprints never become durable facts', () => {
    const probes = [
      'recentFirstPhrases filler_ack certo',
      'recentEmojis 🎉 opening types',
      'lastResponseLengthBucket medium',
    ]
    for (const msg of probes) {
      assert.equal(extractDurableFacts(msg).length, 0, msg)
    }
    // #325A still intact
    assert.equal(extractDurableFacts('Ora spiegalo dettagliatamente.').length, 0)
    assert.ok(
      extractDurableFacts('Da ora in poi preferisco risposte dettagliate.').some(
        (f) => f.factKey === 'settings.reply_style',
      ),
    )
  })

  it('diag payload has counts only (no full phrases / messages)', () => {
    const styled = collectSessionStyleFingerprints('Certo! 🎉', createEmptySessionStyleState())
    const diag = buildStyleVarietyDiagPayload(styled, {
      sessionStyleReceived: true,
      styleAvoidChars: 120,
    })
    assert.equal(diag.diagBuild, STYLE_VARIETY_BUILD)
    assert.equal(diag.sessionStyleReceived, true)
    assert.equal(typeof diag.recentFirstPhraseCount, 'number')
    assert.ok(!('recentFirstPhrases' in diag))
    assert.ok(!('userMessage' in diag))
    assert.ok(!('memory' in diag))
  })
})
