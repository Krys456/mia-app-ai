#!/usr/bin/env node
/**
 * Phase 5 — Contract-Faithful Delivery QA tests (A–O).
 * Run: node lib/server/v2/brain/contract-evaluator.test.mjs
 */

import {
  evaluateContractFidelity,
  serializeContractEvaluationDebug,
  checkVerbosityCompliance,
  checkStockOpener,
  checkEmojiPolicy,
  checkQuestionPolicy,
  normalizeOpener,
  extractStockOpenerKey,
  CONTRACT_EVALUATOR_VERSION,
} from './contract-evaluator.js'
import { createPipeline } from './pipeline.js'
import { createWriter } from './writer.js'

let passed = 0
let failed = 0

function test(name, fn) {
  try {
    const result = fn()
    if (result && typeof result.then === 'function') {
      return result
        .then(() => {
          passed += 1
          console.log(`  ok  — ${name}`)
        })
        .catch((error) => {
          failed += 1
          const message = error instanceof Error ? error.message : String(error)
          console.error(`  FAIL — ${name}`)
          console.error(`        ${message}`)
        })
    }
    passed += 1
    console.log(`  ok  — ${name}`)
    return Promise.resolve()
  } catch (error) {
    failed += 1
    const message = error instanceof Error ? error.message : String(error)
    console.error(`  FAIL — ${name}`)
    console.error(`        ${message}`)
    return Promise.resolve()
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

function profile(overrides = {}) {
  return {
    tone: {
      warmth: 0.5,
      formality: 0.4,
      humor: 0.2,
      directness: 0.5,
      technicality: 0.4,
      ...(overrides.tone || {}),
    },
    depth: overrides.depth || 'normal',
    verbosity: overrides.verbosity || 'medium',
    energy: overrides.energy || 'medium',
    emojiPolicy: overrides.emojiPolicy || 'rare',
    structure: overrides.structure,
    version: '1.0.0-adaptive-response',
  }
}

function planWith(briefOverrides = {}, profileOverrides = null) {
  const responseProfile = profileOverrides === null ? profile() : profile(profileOverrides)
  return {
    objective: briefOverrides.conversationalMove || 'default',
    writerBrief: {
      conversationalMove: 'default',
      shouldAskQuestion: false,
      shouldContinue: true,
      forceMinimalAck: false,
      activeTopic: 'test-topic',
      responseProfile,
      ...briefOverrides,
      responseProfile:
        briefOverrides.responseProfile !== undefined
          ? briefOverrides.responseProfile
          : responseProfile,
    },
    responseProfile,
  }
}

console.log(`Contract Evaluator tests (${CONTRACT_EVALUATOR_VERSION})\n`)

const queue = []

queue.push(
  test('schema helpers', () => {
    assertEqual(normalizeOpener('Capisco. Poi spiego.'), 'capisco', 'normalize')
    assertEqual(extractStockOpenerKey('Certamente! Ecco.'), 'certamente', 'stock key')
    assert(checkVerbosityCompliance('minimal', 200), 'verbosity helper')
  }),
)

queue.push(
  test('A. No illegal question when shouldAskQuestion=false', () => {
    const ev = evaluateContractFidelity({
      responseText: 'Questo è il motivo. Vuoi che approfondisca?',
      plan: planWith({ shouldAskQuestion: false, conversationalMove: 'answer' }),
      userMessage: 'Perché succede?',
    })
    assert(
      ev.hardViolations.some((v) => v.code === 'illegal_followup_question') ||
        ev.violations.some((v) => v.code === 'illegal_followup_question'),
      'illegal followup',
    )
    assert(ev.needsRewrite, 'rewrite required')
    assert(/shouldAskQuestion=false/.test(String(ev.rewriteBrief)), 'ask in brief')
  }),
)

queue.push(
  test('B. Allowed question when shouldAskQuestion=true', () => {
    const ev = evaluateContractFidelity({
      responseText: 'Intendi il ponte H del driver o della potenza?',
      plan: planWith({ shouldAskQuestion: true, conversationalMove: 'clarify_uncertain' }),
      userMessage: 'Il ponte H?',
    })
    assertEqual(ev.ok, true, 'ok')
    assertEqual(ev.needsRewrite, false, 'no rewrite')
    assert(
      !ev.violations.some((v) => v.code === 'illegal_followup_question'),
      'no illegal',
    )
  }),
)

queue.push(
  test('C. Minimal verbosity violation', () => {
    const long = Array.from({ length: 80 }, (_, i) => `parola${i}`).join(' ')
    const ev = evaluateContractFidelity({
      responseText: long,
      plan: planWith(
        { conversationalMove: 'answer', shouldAskQuestion: false },
        { verbosity: 'minimal', depth: 'short' },
      ),
      userMessage: 'Ok',
    })
    assert(
      ev.softViolations.some((v) => v.code === 'verbosity_too_long'),
      'verbosity too long',
    )
  }),
)

queue.push(
  test('D. Long verbosity under-delivery', () => {
    const ev = evaluateContractFidelity({
      responseText: 'Boh, dipende.',
      plan: planWith(
        { conversationalMove: 'answer', shouldAskQuestion: false, activeTopic: 'inverter' },
        { verbosity: 'long', depth: 'detailed', tone: { technicality: 0.7 } },
      ),
      userMessage: 'Approfondisci molto gli inverter trifase.',
    })
    assert(
      ev.softViolations.some(
        (v) => v.code === 'verbosity_under_delivery' || v.code === 'depth_under_delivery',
      ),
      'under-delivery flagged',
    )
  }),
)

queue.push(
  test('E. Repeated stock opener', () => {
    const ev = evaluateContractFidelity({
      responseText: 'Capisco. L’entropia misura il disordine.',
      plan: planWith(
        { conversationalMove: 'answer', shouldAskQuestion: false },
        { depth: 'normal', verbosity: 'medium' },
      ),
      userMessage: "Cos'è l'entropia?",
      recentOpeners: ['capisco', 'capisco'],
      conversationState: { conversationMode: 'learning', recentOpeners: ['capisco'] },
    })
    assert(
      ev.softViolations.some(
        (v) => v.code === 'repeated_stock_opener' || v.code === 'generic_opener',
      ),
      'stock opener flagged',
    )
  }),
)

queue.push(
  test('F. Appropriate empathy opener not auto-flagged', () => {
    const ev = evaluateContractFidelity({
      responseText: 'Capisco. Possiamo prendere un pezzo alla volta.',
      plan: planWith(
        { conversationalMove: 'comfort', shouldAskQuestion: false },
        { tone: { warmth: 0.8, formality: 0.2, humor: 0.1 }, energy: 'low' },
      ),
      userMessage: 'Mi sento triste e ansioso oggi.',
      conversationState: { conversationMode: 'emotional_support' },
    })
    assert(
      !ev.softViolations.some(
        (v) => v.code === 'generic_opener' || v.code === 'repeated_stock_opener',
      ),
      'empathy allowed',
    )
  }),
)

queue.push(
  test('G. Emoji none violation', () => {
    const hit = checkEmojiPolicy('none', 'Ecco la risposta 😊')
    assert(hit && hit.code === 'emoji_forbidden', 'emoji forbidden')
    const ev = evaluateContractFidelity({
      responseText: 'Ecco la risposta 😊',
      plan: planWith({}, { emojiPolicy: 'none' }),
      userMessage: 'Dimmi.',
    })
    assert(ev.softViolations.some((v) => v.code === 'emoji_forbidden'), 'soft emoji')
  }),
)

queue.push(
  test('H. Casual occasional emoji passes', () => {
    const ev = evaluateContractFidelity({
      responseText: 'Ahah vero, è assurdo 😂',
      plan: planWith(
        { conversationalMove: 'entertain', shouldAskQuestion: false },
        {
          emojiPolicy: 'occasional',
          energy: 'high',
          tone: { formality: 0.15, humor: 0.55, warmth: 0.7 },
          depth: 'short',
          verbosity: 'short',
        },
      ),
      userMessage: 'Ahahah è assurdo 😂',
      conversationState: { conversationMode: 'social' },
    })
    assertEqual(ev.ok, true, 'ok')
    assert(
      !ev.softViolations.some((v) => v.code.startsWith('emoji_')),
      'emoji ok',
    )
  }),
)

queue.push(
  test('I. Serious tone mismatch', () => {
    const ev = evaluateContractFidelity({
      responseText: 'Brooo 😂😂 che roba assurda!!!',
      plan: planWith(
        { conversationalMove: 'answer', shouldAskQuestion: false },
        {
          tone: { formality: 0.7, humor: 0.1, warmth: 0.3 },
          energy: 'low',
          emojiPolicy: 'none',
          depth: 'normal',
          verbosity: 'medium',
        },
      ),
      userMessage: 'Spiegazione professionale del rischio.',
    })
    assert(
      ev.softViolations.some(
        (v) =>
          v.code === 'tone_mismatch_formal' ||
          v.code === 'energy_mismatch_high' ||
          v.code === 'emoji_forbidden',
      ),
      'tone/energy flagged',
    )
  }),
)

queue.push(
  test('J. Technicality mismatch (vague vs expert)', () => {
    const vague =
      'In pratica è una cosa che serve a far funzionare meglio il sistema in generale e basta.'
    const ev = evaluateContractFidelity({
      responseText: vague,
      plan: planWith(
        { conversationalMove: 'explain', shouldAskQuestion: false, activeTopic: 'inverter' },
        {
          depth: 'expert',
          verbosity: 'medium',
          tone: { technicality: 0.85, formality: 0.5, humor: 0.1, directness: 0.7, warmth: 0.3 },
        },
      ),
      userMessage: 'Descrivi SPWM, dead-time e switching losses in un inverter trifase.',
    })
    assert(
      ev.softViolations.some(
        (v) =>
          v.code === 'technicality_under_delivery' ||
          v.code === 'depth_under_delivery' ||
          v.code === 'verbosity_under_delivery',
      ),
      'technical under-delivery',
    )
  }),
)

queue.push(
  test('K. Plain structure vs heavy headings', () => {
    const draft = [
      '## Introduzione',
      'Testo.',
      '## Dettagli',
      'Altro testo.',
      '## Conclusione',
      'Fine.',
    ].join('\n')
    const ev = evaluateContractFidelity({
      responseText: draft,
      plan: planWith(
        { conversationalMove: 'answer', shouldAskQuestion: false },
        {
          structure: 'plain',
          depth: 'short',
          verbosity: 'short',
          tone: { formality: 0.2, warmth: 0.6, humor: 0.3, directness: 0.4, technicality: 0.2 },
        },
      ),
      userMessage: 'Dimmi qualcosa di leggero.',
      conversationState: { conversationMode: 'social' },
    })
    assert(
      ev.softViolations.some((v) => v.code === 'structure_over_formatted'),
      'structure flagged',
    )
  }),
)

queue.push(
  test('L. Rewrite brief preserves Planner WHAT', () => {
    const ev = evaluateContractFidelity({
      responseText: 'Va bene.',
      plan: planWith({
        conversationalMove: 'execute_pending_proposal',
        shouldAskQuestion: false,
        shouldContinue: true,
        activeTopic: 'buchi neri',
      }),
      conversationState: { conversationPhase: 'executing', activeTopic: 'buchi neri' },
    })
    assert(ev.needsRewrite, 'needs rewrite')
    const brief = String(ev.rewriteBrief)
    assert(/conversationalMove=execute_pending_proposal/.test(brief), 'move')
    assert(/activeTopic=buchi neri/.test(brief), 'topic')
    assert(/shouldAskQuestion=false/.test(brief), 'ask')
    assert(/objective=/.test(brief), 'objective')
    assert(/conversationPhase=executing/.test(brief), 'phase')
    assert(/responseProfile:/.test(brief), 'profile')
  }),
)

queue.push(
  test('M. No dead-end acknowledgement on execute', () => {
    const ev = evaluateContractFidelity({
      responseText: 'Va bene.',
      plan: planWith({
        conversationalMove: 'execute_pending_proposal',
        shouldAskQuestion: false,
        activeTopic: 'squali',
      }),
    })
    assertEqual(ev.ok, false, 'not ok')
    assert(ev.hardViolations.some((v) => v.code === 'collapsed_execute_continue'), 'hard')
  }),
)

queue.push(
  test('N. Closing state reopen is hard violation', () => {
    const ev = evaluateContractFidelity({
      responseText:
        'Ok a presto. Vuoi che ripartiamo dai buchi neri la prossima volta?',
      plan: planWith({
        conversationalMove: 'stop',
        shouldAskQuestion: false,
        activeTopic: 'buchi neri',
      }),
      conversationState: { conversationPhase: 'closing' },
    })
    assert(
      ev.hardViolations.some(
        (v) =>
          v.code === 'reopened_closing' ||
          v.code === 'illegal_followup_question' ||
          v.code === 'unexpected_question',
      ),
      'closing reopen',
    )
    assert(ev.needsRewrite, 'rewrite')
  }),
)

queue.push(
  test('O. One rewrite maximum (final check never rewrites)', () => {
    const bad = evaluateContractFidelity({
      responseText: 'Va bene.',
      plan: planWith({
        conversationalMove: 'execute_pending_proposal',
        shouldAskQuestion: false,
        activeTopic: 'buchi neri',
      }),
    })
    assert(bad.needsRewrite, 'initial needs rewrite')
    assert(bad.rewriteBrief, 'has brief')

    const finalCheck = evaluateContractFidelity({
      responseText: 'Va bene.',
      plan: planWith({
        conversationalMove: 'execute_pending_proposal',
        shouldAskQuestion: false,
        activeTopic: 'buchi neri',
      }),
      isFinalCheck: true,
    })
    assertEqual(finalCheck.needsRewrite, false, 'final never needs rewrite')
    assertEqual(finalCheck.rewriteRequired, false, 'rewriteRequired false')
    assertEqual(finalCheck.rewriteBrief, null, 'no brief on final')
    // Still reports the hard violation for diagnostics.
    assertEqual(finalCheck.ok, false, 'still not ok')
    assert(finalCheck.hardViolations.length > 0, 'hard still listed')

    const debug = serializeContractEvaluationDebug({
      ...bad,
      rewritten: true,
      hardViolations: bad.hardViolations,
      softViolations: bad.softViolations,
    })
    assert(debug && debug.rewritten === true, 'debug rewritten')
    assert(Array.isArray(debug.hardViolations), 'hard list')
    assert(Array.isArray(debug.softViolations), 'soft list')
  }),
)

queue.push(
  test('O2. Pipeline performs at most one contract rewrite', async () => {
    let writeCount = 0
    const fake = {
      id: 'fake-phase5',
      capabilities: {
        streaming: false,
        tools: false,
        jsonMode: false,
        systemMessages: true,
      },
      async complete() {
        writeCount += 1
        // First delivery collapses; rewrite delivers content.
        const text =
          writeCount === 1
            ? 'Va bene.'
            : 'I buchi neri assorbono anche la luce oltre l’orizzonte degli eventi.'
        return {
          text,
          finishReason: 'stop',
          usage: { inputTokens: 1, outputTokens: 8 },
          model: 'fake',
        }
      },
    }
    const writer = createWriter({
      providers: { 'fake-phase5': fake },
      defaultProviderId: 'fake-phase5',
    })
    const pipeline = createPipeline({ writer, enableContractEvaluator: true })
    const result = await pipeline.runConversation({
      userMessage: 'ok',
      messages: [
        {
          role: 'assistant',
          content: 'Vuoi che ti racconti una curiosità sui buchi neri?',
        },
        { role: 'user', content: 'ok' },
      ],
      previousConversationState: {
        activeTopic: 'buchi neri',
        conversationPhase: 'exploring',
        pendingProposal: {
          type: 'tell_curiosity',
          topic: 'buchi neri',
          status: 'open',
          source: 'assistant_offer',
          idleTurns: 0,
          openedTurn: 1,
        },
        shortReply: { intent: null, confidence: null },
        continuity: { shouldResume: false, resumeTopic: null, resumePoint: null },
        references: { unresolved: [] },
      },
    })
    assert(writeCount >= 1, 'wrote')
    assert(writeCount <= 3, `at most draft+identity+contract (${writeCount})`)
    assert(result.contractEvaluation, 'evaluation present')
    if (result.contractEvaluation.needsRewrite || result.contractEvaluation.rewritten) {
      assert(
        result.contractEvaluation.rewritten === true ||
          result.contractEvaluation.rewriteFailed === true,
        'rewrite attempted at most once path',
      )
    }
    if (result.contractEvaluation.postRewrite) {
      assertEqual(
        result.contractEvaluation.postRewrite.needsRewrite,
        false,
        'postRewrite never requests another rewrite',
      )
    }
  }),
)

queue.push(
  test('Rhetorical question inside explanation is not illegal followup', () => {
    const qs = checkQuestionPolicy(
      'Perché succede? Perché il PWM limita la corrente media.',
      false,
      'explain',
      'deepening',
    )
    // Trailing ? absent → only if ends with ?
    assert(
      !qs.some((v) => v.code === 'illegal_followup_question'),
      'no illegal followup on mid-text perché',
    )
  }),
)

queue.push(
  test('Stock opener helper respects empathy context', () => {
    const hit = checkStockOpener('Capisco. Andiamo per gradi.', {
      userMessage: 'Mi sento triste.',
      conversationMode: 'emotional_support',
      recentOpeners: [],
    })
    assertEqual(hit, null, 'no flag')
  }),
)

await queue.reduce((p, t) => p.then(() => t), Promise.resolve())

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
