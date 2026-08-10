#!/usr/bin/env node
/**
 * Isolated tests for LAIfe V2 Conversation Reviewer.
 * No OpenAI, no V1, no text generation, no pipeline wiring.
 *
 * Run: node lib/server/v2/brain/reviewer.test.mjs
 */

import {
  createReviewer,
  reviewConversation,
  isReviewResult,
  isRewriteHints,
  resolveThresholds,
  resolveWeights,
  DEFAULT_THRESHOLDS,
  DEFAULT_WEIGHTS,
  PROBLEM_CATEGORIES,
  categoryForMetric,
  scoreNaturalness,
  scoreSpecificity,
  scoreConversationMomentum,
  scoreEmotionalCalibration,
  scorePracticalValue,
  scoreRedundancy,
  scoreClicheDetection,
  scoreRespectOfPlanner,
  scoreResponseCompleteness,
  scoreDirectiveCompliance,
  scoreConversationDelight,
  scoreIdentityConsistency,
  evaluateHardConstraints,
  listHardConstraints,
  REVIEWER_VERSION,
} from './reviewer.js'

let passed = 0
let failed = 0

/**
 * @param {string} name
 * @param {() => void} fn
 */
function test(name, fn) {
  try {
    fn()
    passed += 1
    console.log(`  ok  — ${name}`)
  } catch (error) {
    failed += 1
    const message = error instanceof Error ? error.message : String(error)
    console.error(`  FAIL — ${name}`)
    console.error(`        ${message}`)
  }
}

/**
 * @param {unknown} condition
 * @param {string} message
 */
function assert(condition, message) {
  if (!condition) throw new Error(message)
}

/**
 * @param {unknown} actual
 * @param {unknown} expected
 * @param {string} label
 */
function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(
      `${label} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`,
    )
  }
}

function samplePlan(overrides = {}) {
  return {
    objective: 'connect__need_connection__one_spark',
    conversationPlan: {
      opening: { role: 'opening', kind: 'warm_presence', purpose: 'Open warmly.' },
      development: [
        { role: 'development', kind: 'presence_contribution', purpose: 'Contribute.' },
      ],
      closing: { role: 'closing', kind: 'one_spark', purpose: 'Spark.' },
      lengthBand: 'light',
      beatCount: 3,
    },
    writerBrief: {
      language: 'it',
      tone: 'warm',
      depth: 'light',
      strategy: 'connect',
      need: 'connection',
      moveSummary: 'strategy=connect | need=connection | coda=spark',
      must: ['Follow strategy="connect".'],
      mustNot: ['Do not ask a question.'],
      coda: 'spark',
      memoryHint: 'omit',
      teaching: false,
      comfort: false,
      challenge: false,
      continueTopic: false,
    },
    constraints: ['strategy:connect', 'need:connection', 'ask_question:no', 'hard:no_question'],
    confidence: 0.9,
    ...overrides,
  }
}

function sampleRequest(plan = samplePlan(), decisionOverrides = {}) {
  return {
    personalityFoundation: 'LAIfe is calm and warm.',
    decision: {
      need: 'connection',
      goal: plan.objective,
      strategy: plan.writerBrief?.strategy || 'connect',
      initiative: 'one_spark',
      emotionalTone: plan.writerBrief?.tone || 'warm',
      responseDepth: plan.writerBrief?.depth || 'light',
      shouldUseMemory: false,
      shouldContinueTopic: Boolean(plan.writerBrief?.continueTopic),
      shouldAskQuestion: plan.writerBrief?.coda === 'question',
      shouldTeach: Boolean(plan.writerBrief?.teaching),
      shouldComfort: Boolean(plan.writerBrief?.comfort),
      shouldChallenge: Boolean(plan.writerBrief?.challenge),
      confidence: 0.9,
      ...decisionOverrides,
    },
    plan,
    messages: [{ role: 'user', content: 'Ciao!' }],
    mode: 'draft',
  }
}

function reviewText(text, plan = samplePlan(), config = {}, decisionOverrides = {}) {
  const p = {
    ...plan,
    writerBrief: { ...samplePlan().writerBrief, ...plan.writerBrief },
    constraints: plan.constraints || samplePlan().constraints,
  }
  return reviewConversation(
    {
      writerRequest: sampleRequest(p, decisionOverrides),
      writerResponse: { text, finishReason: 'stop', usage: {}, model: 'fake', providerId: 'fake' },
      plan: p,
    },
    config,
  )
}

console.log(`Reviewer tests (${REVIEWER_VERSION})\n`)

test('1. returns ReviewResult shape', () => {
  const r = reviewText(
    'Che bella giornata per una chiacchierata leggera sulle piccole cose che ci sorprendono.',
  )
  assert(isReviewResult(r), 'shape')
  assert(r.decision === 'PASS' || r.decision === 'REWRITE', 'decision')
  assert(typeof r.summary === 'string' && r.summary.length > 0, 'summary')
  assert(Array.isArray(r.problems), 'problems')
  assert(isRewriteHints(r.rewriteHints), 'rewriteHints')
  assert(typeof r.score.overall === 'number', 'overall')
  assert(typeof r.score.threshold === 'number', 'threshold')
})

test('2. score.metrics includes all twelve metrics', () => {
  const r = reviewText('Una osservazione concreta: i gatti dormono spesso al sole del mattino.')
  const keys = [
    'naturalness',
    'specificity',
    'conversationMomentum',
    'emotionalCalibration',
    'practicalValue',
    'redundancy',
    'clicheDetection',
    'respectOfPlanner',
    'responseCompleteness',
    'directiveCompliance',
    'conversationDelight',
    'identityConsistency',
  ]
  for (const k of keys) {
    assert(typeof r.score.metrics[k] === 'number', k)
    assert(r.score.metrics[k] >= 0 && r.score.metrics[k] <= 1, `${k} range`)
  }
})

test('3. empty text tends to REWRITE', () => {
  const r = reviewText('')
  assertEqual(r.decision, 'REWRITE', 'rewrite')
  assert(r.problems.length > 0, 'problems')
  assert(r.rewriteHints.mustFix.length + r.rewriteHints.improve.length > 0, 'hints')
})

test('4. robotic opener lowers naturalness and may rewrite', () => {
  const good = scoreNaturalness(
    'Ieri ho notato come il caffè sa diverso se lo bevi in silenzio.',
  )
  const bad = scoreNaturalness('How can I help you today with your request?')
  assert(bad.score < good.score, 'naturalness drop')
  assert(bad.suggestions.includes('remove generic opening'), 'suggestion')
})

test('5. Italian helpdesk opener flagged', () => {
  const s = scoreNaturalness('Come posso aiutarti oggi?')
  assert(s.notes.includes('robotic_opener'), 'note')
})

test('6. AI self-reference flagged', () => {
  const s = scoreNaturalness('As an AI, I think cats are nice.')
  assert(s.notes.includes('ai_self_reference'), 'note')
})

test('7. specificity rewards examples and numbers', () => {
  const vague = scoreSpecificity('In many ways things are generally interesting.')
  const specific = scoreSpecificity(
    'Ad esempio, riduci la query da 1200ms a 80ms con un indice su user_id.',
  )
  assert(specific.score > vague.score, 'specific higher')
})

test('8. specificity suggests concrete example when vague', () => {
  const s = scoreSpecificity('Various factors matter in many ways generally speaking.')
  assert(s.suggestions.includes('add concrete example'), 'suggestion')
})

test('9. redundancy detects repeated phrases', () => {
  const s = scoreRedundancy(
    'This is a long repeated chunk. This is a long repeated chunk. Extra padding words here.',
  )
  assert(s.score < 0.7, 'low redundancy score means bad')
  assert(s.suggestions.includes('reduce repetition'), 'suggestion')
})

test('10. cliche detection catches stock phrases', () => {
  const s = scoreClicheDetection(
    'At the end of the day, in today\'s fast-paced world, we must think outside the box.',
  )
  assert(s.score < 0.6, 'low score')
  assert(s.suggestions.includes('remove cliché phrasing'), 'suggestion')
})

test('11. great question cliche flagged', () => {
  const s = scoreClicheDetection('That\'s a great question. Anyway.')
  assert(s.notes.includes('praise_cliche') || s.score < 0.85, 'flagged')
})

test('12. respect of planner: forbidden question fails', () => {
  const plan = samplePlan({
    writerBrief: {
      ...samplePlan().writerBrief,
      coda: 'none',
      mustNot: ['Do not ask a question.'],
    },
    constraints: ['ask_question:no', 'hard:no_question'],
  })
  const s = scoreRespectOfPlanner(
    'Tutto chiaro finora, cosa ne pensi?',
    plan,
    sampleRequest(plan),
  )
  assert(s.notes.includes('forbidden_question'), 'forbidden')
  assert(s.suggestions.includes('remove closing question'), 'suggestion')
})

test('13. respect of planner: required question missing', () => {
  const plan = samplePlan({
    writerBrief: {
      ...samplePlan().writerBrief,
      coda: 'question',
      strategy: 'guide',
    },
    constraints: ['ask_question:yes'],
  })
  const s = scoreRespectOfPlanner(
    'Il prossimo passo è verificare i log del servizio.',
    plan,
    sampleRequest(plan, { shouldAskQuestion: true }),
  )
  assert(s.notes.includes('missing_required_question'), 'missing q')
})

test('14. respect of planner: too many questions', () => {
  const plan = samplePlan({
    writerBrief: { ...samplePlan().writerBrief, coda: 'question' },
    constraints: ['ask_question:yes'],
  })
  const s = scoreRespectOfPlanner(
    'Vuoi A? Oppure B? Forse C?',
    plan,
    sampleRequest(plan, { shouldAskQuestion: true }),
  )
  assert(s.notes.includes('too_many_questions'), 'too many')
})

test('15. emotional calibration comfort without ack scores lower', () => {
  const plan = samplePlan({
    writerBrief: {
      ...samplePlan().writerBrief,
      strategy: 'support',
      comfort: true,
      tone: 'supportive',
      coda: 'none',
    },
  })
  const cold = scoreEmotionalCalibration(
    'Ecco la soluzione: organizza meglio il calendario e basta.',
    plan,
    sampleRequest(plan, { shouldComfort: true, strategy: 'support' }),
  )
  const warm = scoreEmotionalCalibration(
    'Capisco, deve essere pesante. Possiamo guardare un piccolo passo per alleggerire la giornata.',
    plan,
    sampleRequest(plan, { shouldComfort: true, strategy: 'support' }),
  )
  assert(warm.score > cold.score, 'warm better')
})

test('16. momentum interview loop penalized', () => {
  const s = scoreConversationMomentum(
    'Come stai? Che fai? Dove vai? Perché?',
    samplePlan(),
    sampleRequest(),
  )
  assert(s.notes.includes('interview_loop'), 'interview')
  assert(s.suggestions.includes('reduce stacked questions'), 'suggestion')
})

test('17. momentum close with question penalized', () => {
  const plan = samplePlan({
    writerBrief: { ...samplePlan().writerBrief, strategy: 'close', coda: 'none' },
  })
  const s = scoreConversationMomentum(
    'A presto, ok? Vuoi altro?',
    plan,
    sampleRequest(plan, { strategy: 'close' }),
  )
  assert(s.notes.includes('reopened_after_close'), 'reopen')
})

test('18. practical value rewards actionable guide text', () => {
  const plan = samplePlan({
    writerBrief: {
      ...samplePlan().writerBrief,
      strategy: 'guide',
      depth: 'balanced',
      teaching: false,
      coda: 'none',
    },
  })
  const thin = scorePracticalValue('Ok.', plan, sampleRequest(plan, { strategy: 'guide' }))
  const rich = scorePracticalValue(
    'Prova questo passo: riavvia il worker e controlla i log per l\'errore timeout, perché spesso è una coda bloccata.',
    plan,
    sampleRequest(plan, { strategy: 'guide' }),
  )
  assert(rich.score > thin.score, 'richer better')
})

test('19. completeness deep depth with short text fails metric', () => {
  const plan = samplePlan({
    writerBrief: {
      ...samplePlan().writerBrief,
      strategy: 'explain',
      depth: 'deep',
      teaching: true,
      coda: 'none',
    },
  })
  const s = scoreResponseCompleteness('Breve.', plan, sampleRequest(plan, { shouldTeach: true }))
  assert(s.score < 0.55, 'incomplete')
  assert(s.suggestions.includes('complete the reply'), 'suggestion')
})

test('20. completeness placeholder TBD fails', () => {
  const s = scoreResponseCompleteness(
    'Ecco l\'idea principale… TBD',
    samplePlan(),
    sampleRequest(),
  )
  assert(s.notes.includes('truncated_or_placeholder'), 'placeholder')
})

test('21. overall PASS for solid respectful reply', () => {
  const r = reviewText(
    'Ieri il tramonto sul fiume aveva un arancio strano, quasi metallico. Mi ha fatto pensare a quanto bastano dettagli piccoli per cambiare l\'umore di una sera.',
  )
  assertEqual(r.decision, 'PASS', 'pass')
  assertEqual(r.rewriteHints.mustFix.length, 0, 'no mustFix on pass')
  assertEqual(r.rewriteHints.improve.length, 0, 'no improve on pass')
  assert(/^PASS:/.test(r.summary), 'summary')
  assert(r.score.overall >= r.score.threshold, 'above threshold')
})

test('22. overall REWRITE for helpdesk cliche + question against plan', () => {
  const r = reviewText(
    'How can I help you today? That\'s a great question, right?',
  )
  assertEqual(r.decision, 'REWRITE', 'rewrite')
  assert(r.problems.length > 0, 'has problems')
  assert(r.rewriteHints.mustFix.length + r.rewriteHints.improve.length > 0, 'has hints')
  assert(/^REWRITE:/.test(r.summary), 'summary')
})

test('22b. hard:no_question forces REWRITE even if overall would pass', () => {
  const plan = samplePlan({
    constraints: ['strategy:connect', 'ask_question:no', 'hard:no_question'],
    writerBrief: {
      ...samplePlan().writerBrief,
      coda: 'spark',
      mustNot: ['Do not ask a question.'],
    },
  })
  // Warm, specific, delightful text — but illegally asks a question
  const r = reviewText(
    'Ieri il tramonto sul fiume aveva un arancio strano, quasi metallico. Che ne pensi?',
    plan,
    {
      // Extremely low overall threshold so only hard constraint can force rewrite
      thresholds: { overallPass: 0.01 },
    },
  )
  assertEqual(r.decision, 'REWRITE', 'hard forces rewrite')
  assert(
    r.problems.some((p) => p.code.includes('hard_constraint_violated:hard:no_question')),
    'hard problem',
  )
  assert(
    r.problems.some((p) => p.category === 'plannerConstraint' && p.severity === 'mustFix'),
    'plannerConstraint mustFix',
  )
  assert(r.rewriteHints.mustFix.includes('remove closing question'), 'mustFix hint')
})

test('22c. hard:no_question ok when no question mark', () => {
  const hard = evaluateHardConstraints(
    'Ieri il tramonto sul fiume aveva un arancio strano.',
    samplePlan(),
    sampleRequest(),
  )
  assertEqual(hard.violated, false, 'ok')
  assert(listHardConstraints(samplePlan()).includes('hard:no_question'), 'listed')
})

test('23. configurable overallPass threshold forces REWRITE', () => {
  const text =
    'Una nota concreta: la pasta all\'aglio con limone funziona meglio con l\'acqua ben salata.'
  const pass = reviewText(text, samplePlan(), { thresholds: { overallPass: 0.1 } })
  const rewrite = reviewText(text, samplePlan(), { thresholds: { overallPass: 0.99 } })
  assertEqual(pass.decision, 'PASS', 'low threshold pass')
  assertEqual(rewrite.decision, 'REWRITE', 'high threshold rewrite')
})

test('24. resolveThresholds merges partials', () => {
  const t = resolveThresholds({ overallPass: 0.8, naturalness: 0.9 })
  assertEqual(t.overallPass, 0.8, 'overall')
  assertEqual(t.naturalness, 0.9, 'naturalness')
  assertEqual(t.specificity, DEFAULT_THRESHOLDS.specificity, 'default kept')
})

test('25. resolveWeights merges partials', () => {
  const w = resolveWeights({ respectOfPlanner: 3 })
  assertEqual(w.respectOfPlanner, 3, 'weight')
  assertEqual(w.naturalness, DEFAULT_WEIGHTS.naturalness, 'default')
})

test('26. higher respectOfPlanner weight impacts overall', () => {
  const plan = samplePlan()
  const badQ = 'How can I help you? What do you need from me?'
  const lowWeight = reviewText(badQ, plan, {
    thresholds: { overallPass: 0.5 },
    weights: { respectOfPlanner: 0.1, clicheDetection: 0.1, naturalness: 0.1 },
  })
  const highWeight = reviewText(badQ, plan, {
    thresholds: { overallPass: 0.5 },
    weights: { respectOfPlanner: 5, clicheDetection: 0.1, naturalness: 0.1 },
  })
  assert(
    highWeight.score.overall <= lowWeight.score.overall,
    'planner weight pulls overall down on violations',
  )
})

test('27. rewriteHints strings are unique and structured', () => {
  const r = reviewText(
    'How can I help? At the end of the day, in today\'s fast-paced world, how can I help?',
  )
  assertEqual(r.decision, 'REWRITE', 'rewrite')
  assert(isRewriteHints(r.rewriteHints), 'hints shape')
  const all = [...r.rewriteHints.mustFix, ...r.rewriteHints.improve, ...r.rewriteHints.keep]
  for (const s of all) {
    assert(typeof s === 'string' && s.length > 0, 'string hint')
  }
  assertEqual(new Set(r.rewriteHints.mustFix).size, r.rewriteHints.mustFix.length, 'unique mustFix')
})

test('28. does not mutate plan object', () => {
  const plan = samplePlan()
  const before = JSON.stringify(plan)
  reviewText('Testo decente con un dettaglio: tre minuti di cammino aiutano.', plan)
  assertEqual(JSON.stringify(plan), before, 'unchanged')
})

test('29. does not mutate writerRequest / writerResponse', () => {
  const plan = samplePlan()
  const req = sampleRequest(plan)
  const res = { text: 'Una sera quieta al mare basta a resettare la testa.', finishReason: 'stop', usage: {}, model: 'x', providerId: 'fake' }
  const rb = JSON.stringify(req)
  const sb = JSON.stringify(res)
  createReviewer().review({ writerRequest: req, writerResponse: res, plan })
  assertEqual(JSON.stringify(req), rb, 'req')
  assertEqual(JSON.stringify(res), sb, 'res')
})

test('30. createReviewer exposes thresholds and weights', () => {
  const reviewer = createReviewer({ thresholds: { overallPass: 0.7 } })
  assertEqual(reviewer.thresholds.overallPass, 0.7, 'threshold')
  assertEqual(reviewer.version, REVIEWER_VERSION, 'version')
  assert(reviewer.weights.respectOfPlanner > 0, 'weights')
})

test('31. reviewConversation one-shot equals createReviewer().review', () => {
  const plan = samplePlan()
  const input = {
    writerRequest: sampleRequest(plan),
    writerResponse: {
      text: 'Il caffè della macchinetta del terzo piano ha un retrogusto di nocciola.',
      finishReason: 'stop',
      usage: {},
      model: 'f',
      providerId: 'fake',
    },
    plan,
  }
  const a = JSON.stringify(reviewConversation(input))
  const b = JSON.stringify(createReviewer().review(input))
  assertEqual(a, b, 'deterministic parity')
})

test('32. pure function: same input → same output', () => {
  const input = {
    writerRequest: sampleRequest(),
    writerResponse: {
      text: 'Una frase specifica: la chiave USB rossa sulla scrivania destra.',
      finishReason: 'stop',
      usage: {},
      model: 'f',
      providerId: 'fake',
    },
    plan: samplePlan(),
  }
  assertEqual(
    JSON.stringify(reviewConversation(input)),
    JSON.stringify(reviewConversation(input)),
    'deterministic',
  )
})

test('33. uses plan from writerRequest if plan arg omitted', () => {
  const plan = samplePlan()
  const r = createReviewer().review({
    writerRequest: sampleRequest(plan),
    writerResponse: {
      text: 'Dettaglio utile: apri Settings > Privacy e spegni i suggerimenti.',
      finishReason: 'stop',
      usage: {},
      model: 'f',
      providerId: 'fake',
    },
  })
  assert(isReviewResult(r), 'ok')
})

test('34. extraCliches config is applied', () => {
  const s = scoreClicheDetection('This is totally a banana-split moment.', [
    'banana-split moment',
  ])
  assert(s.score < 0.9, 'custom cliche hits')
})

test('35. problems include metric below threshold codes on rewrite', () => {
  const r = reviewText('How can I help you?', samplePlan(), {
    thresholds: { overallPass: 0.95, naturalness: 0.9 },
  })
  assertEqual(r.decision, 'REWRITE', 'rewrite')
  assert(
    r.problems.some((p) => p.code.includes('below_threshold')),
    'threshold problem',
  )
  assert(/^REWRITE:/.test(r.summary), 'summary')
})

test('36. support plan with minimizing language rewrites', () => {
  const plan = samplePlan({
    writerBrief: {
      ...samplePlan().writerBrief,
      strategy: 'support',
      comfort: true,
      tone: 'supportive',
      coda: 'none',
      depth: 'light',
    },
    constraints: ['strategy:support', 'ask_question:no', 'comfort:yes'],
  })
  const r = reviewText(
    'Non esagerare, non è niente. Just get over it and move on.',
    plan,
    { thresholds: { overallPass: 0.7, emotionalCalibration: 0.6 } },
    { shouldComfort: true, strategy: 'support', shouldAskQuestion: false },
  )
  assertEqual(r.decision, 'REWRITE', 'rewrite')
  assert(
    r.score.metrics.emotionalCalibration < 0.5,
    'emotional metric low',
  )
})

test('37. explain teaching thin answer suggests expansion', () => {
  const plan = samplePlan({
    writerBrief: {
      ...samplePlan().writerBrief,
      strategy: 'explain',
      teaching: true,
      depth: 'balanced',
      coda: 'none',
      need: 'explanation',
    },
    constraints: ['strategy:explain', 'teach:yes', 'ask_question:no'],
  })
  const r = reviewText('È un server.', plan, {}, { shouldTeach: true, strategy: 'explain' })
  assertEqual(r.decision, 'REWRITE', 'rewrite')
  const hints = [...r.rewriteHints.mustFix, ...r.rewriteHints.improve]
  assert(
    hints.some((s) => /example|practical|complete|expand/i.test(s)) ||
      r.problems.some((p) => /example|practical|complete|expand/i.test(p.suggestion || '')),
    'actionable hint',
  )
})

test('38. good explain answer can PASS', () => {
  const plan = samplePlan({
    objective: 'explain__need_explanation',
    writerBrief: {
      ...samplePlan().writerBrief,
      strategy: 'explain',
      teaching: true,
      depth: 'balanced',
      coda: 'none',
      need: 'explanation',
      tone: 'calm',
    },
    constraints: ['strategy:explain', 'ask_question:no', 'teach:yes'],
  })
  const r = reviewText(
    'Un API gateway è un ingresso unico davanti ai servizi. Per esempio, riceve /login e instrada la richiesta al servizio auth, perché così centralizzi autenticazione e limiti di traffico.',
    plan,
    {},
    { shouldTeach: true, strategy: 'explain', shouldAskQuestion: false },
  )
  assertEqual(r.decision, 'PASS', 'pass')
})

test('39. continueTopic abrupt reset lowers momentum', () => {
  const plan = samplePlan({
    writerBrief: {
      ...samplePlan().writerBrief,
      strategy: 'continue',
      continueTopic: true,
      coda: 'insight',
    },
  })
  const s = scoreConversationMomentum(
    'Cambiando argomento, parliamo di finanza.',
    plan,
    sampleRequest(plan, { shouldContinueTopic: true, strategy: 'continue' }),
  )
  assert(s.notes.includes('abrupt_topic_reset'), 'reset')
})

test('40. metric scores are independent functions', () => {
  const text = 'Ad esempio, tre passi: apri il file, modifica la riga 12, riesegui i test.'
  const a = scoreSpecificity(text).score
  const b = scoreRedundancy(text).score
  const c = scoreClicheDetection(text).score
  assert(a !== b || b !== c || a > 0.4, 'computed independently')
  assert(typeof a === 'number' && typeof b === 'number' && typeof c === 'number', 'numbers')
})

test('41. no text generation fields on result', () => {
  const r = reviewText('Una risposta naturale con un dettaglio: il semaforo lampeggia due volte.')
  assert(!Object.hasOwn(r, 'text'), 'no text')
  assert(!Object.hasOwn(r, 'finalText'), 'no finalText')
  assert(!Object.hasOwn(r, 'rewriteBrief'), 'no rewriteBrief draft')
  assert(!Object.hasOwn(r, 'draft'), 'no draft')
})

test('42. malformed input still returns ReviewResult', () => {
  const r = createReviewer().review(/** @type {any} */ (null))
  assert(isReviewResult(r), 'shape')
  assertEqual(r.decision, 'REWRITE', 'rewrite empty')
})

test('43. hard:no_reopen constraint respected', () => {
  const plan = samplePlan({
    writerBrief: { ...samplePlan().writerBrief, strategy: 'close', coda: 'none' },
    constraints: ['strategy:close', 'hard:no_reopen', 'ask_question:no'],
  })
  const s = scoreRespectOfPlanner(
    'A presto. Anyway, let\'s discuss your taxes next.',
    plan,
    sampleRequest(plan, { strategy: 'close' }),
  )
  assert(s.notes.includes('reopened_agenda'), 'reopen')
})

test('44. depth minimal with very long text lowers respect score', () => {
  const plan = samplePlan({
    writerBrief: { ...samplePlan().writerBrief, depth: 'minimal', coda: 'none' },
  })
  const long = 'Parola '.repeat(80) + 'fine.'
  const s = scoreRespectOfPlanner(long, plan, sampleRequest(plan, { responseDepth: 'minimal' }))
  assert(s.notes.includes('too_long_for_minimal'), 'too long')
})

test('45. PASS keeps mustFix/improve empty in rewriteHints', () => {
  const r = reviewText(
    'Il mercato sotto casa vende limoni con la foglia ancora attaccata: un dettaglio piccolo che rende tutto più vivo.',
  )
  if (r.decision === 'PASS') {
    assertEqual(r.rewriteHints.mustFix.length, 0, 'no mustFix')
    assertEqual(r.rewriteHints.improve.length, 0, 'no improve')
  } else {
    assert(isReviewResult(r), 'still valid')
  }
})

test('46. all metric thresholds individually configurable', () => {
  const t = resolveThresholds({
    naturalness: 0.11,
    specificity: 0.12,
    conversationMomentum: 0.13,
    emotionalCalibration: 0.14,
    practicalValue: 0.15,
    redundancy: 0.16,
    clicheDetection: 0.17,
    respectOfPlanner: 0.18,
    responseCompleteness: 0.19,
    directiveCompliance: 0.21,
    conversationDelight: 0.22,
    identityConsistency: 0.23,
    overallPass: 0.2,
  })
  assertEqual(t.naturalness, 0.11, 'n')
  assertEqual(t.responseCompleteness, 0.19, 'c')
  assertEqual(t.directiveCompliance, 0.21, 'd')
  assertEqual(t.conversationDelight, 0.22, 'delight')
  assertEqual(t.identityConsistency, 0.23, 'id')
  assertEqual(t.overallPass, 0.2, 'o')
})

test('47. reviewer does not import or need OpenAI globals', () => {
  assertEqual(typeof createReviewer, 'function', 'fn')
  assertEqual(typeof reviewConversation, 'function', 'fn2')
  const r = reviewText('Dettaglio: la sedia vicino alla finestra scricchiola al terzo movimento.')
  assert(isReviewResult(r), 'works offline')
})

test('48. multiple problem categories can co-occur on rewrite', () => {
  const r = reviewText(
    'How can I help you? At the end of the day this is important to remember. How can I help you?',
    samplePlan(),
    { thresholds: { overallPass: 0.85 } },
  )
  assertEqual(r.decision, 'REWRITE', 'rewrite')
  const cats = new Set(r.problems.map((p) => p.category))
  assert(cats.size >= 1, 'has categories')
  assert(
    r.rewriteHints.mustFix.length + r.rewriteHints.improve.length >= 2,
    'multiple hints',
  )
})

test('49. score.threshold equals configured overallPass', () => {
  const r = reviewText('Una risposta con dettaglio utile: spegni le notifiche dopo le 21.', samplePlan(), {
    thresholds: { overallPass: 0.77 },
  })
  assertEqual(r.score.threshold, 0.77, 'threshold echoed')
})

test('50. emotional calibration playful mismatch note', () => {
  const plan = samplePlan({
    writerBrief: { ...samplePlan().writerBrief, tone: 'playful', coda: 'none' },
  })
  const s = scoreEmotionalCalibration(
    'This is an urgent critical failure in production.',
    plan,
    sampleRequest(plan, { emotionalTone: 'playful' }),
  )
  assert(s.notes.includes('tone_mismatch_playful'), 'mismatch')
})

test('51. naturalness varied rhythm gets a small boost path', () => {
  const s = scoreNaturalness(
    'Stop. Poi una frase media che spiega il punto con calma. Infine una conclusione più lunga che chiude il pensiero senza fretta e senza filler da sportello.',
  )
  assert(s.score > 0.7, 'healthy naturalness')
})

test('52. decision PASS vs REWRITE boundary documented via overall comparison', () => {
  const reviewer = createReviewer({ thresholds: { overallPass: DEFAULT_THRESHOLDS.overallPass } })
  const good = reviewer.review({
    writerRequest: sampleRequest(),
    writerResponse: {
      text: 'Ho notato che il pane del forno in angolo ha la crosta più sottile il martedì: strano, ma affidabile.',
      finishReason: 'stop',
      usage: {},
      model: 'f',
      providerId: 'fake',
    },
    plan: samplePlan(),
  })
  const bad = reviewer.review({
    writerRequest: sampleRequest(),
    writerResponse: {
      text: 'How can I help?',
      finishReason: 'stop',
      usage: {},
      model: 'f',
      providerId: 'fake',
    },
    plan: samplePlan(),
  })
  assert(good.score.overall > bad.score.overall, 'ordering')
  assertEqual(bad.decision, 'REWRITE', 'bad rewrite')
})

test('53. no V1 leakage in rewrite contract vocabulary', () => {
  const r = reviewText('How can I help you today?')
  const blob = JSON.stringify(r)
  assert(!/cognitive-engine|directive-authority|openai/i.test(blob), 'no V1/vendor')
})

test('54. challenge against comfort lowers respect score', () => {
  const plan = samplePlan({
    writerBrief: {
      ...samplePlan().writerBrief,
      comfort: true,
      challenge: false,
      strategy: 'support',
      coda: 'none',
    },
  })
  const s = scoreRespectOfPlanner(
    'Capisco, però hai torto e that\'s silly.',
    plan,
    sampleRequest(plan, { shouldComfort: true, shouldChallenge: false }),
  )
  assert(s.notes.includes('challenge_against_comfort'), 'violation')
})

test('55. isReviewResult rejects partial objects', () => {
  assertEqual(isReviewResult(null), false, 'null')
  assertEqual(isReviewResult({ decision: 'PASS' }), false, 'partial')
  assertEqual(
    isReviewResult({
      decision: 'PASS',
      summary: 'PASS: ok',
      problems: [],
      rewriteHints: { mustFix: [], improve: [], keep: [], targetScore: 0.7 },
      score: { overall: 1, metrics: {}, threshold: 0.5 },
    }),
    true,
    'full',
  )
})

test('56. directiveCompliance penalizes forbidden question', () => {
  const plan = samplePlan()
  const bad = scoreDirectiveCompliance(
    'Tutto bene, vero?',
    plan,
    sampleRequest(plan),
  )
  const good = scoreDirectiveCompliance(
    'Il caffè del mattino ha un aroma di nocciola quando la macinatura è fine.',
    plan,
    sampleRequest(plan),
  )
  assert(bad.notes.includes('directive_forbidden_question'), 'flag')
  assert(good.score > bad.score, 'good higher')
})

test('57. conversationDelight rewards concrete spark over helpdesk', () => {
  const plan = samplePlan()
  const flat = scoreConversationDelight('How can I help you today?', plan, sampleRequest(plan))
  const spark = scoreConversationDelight(
    'Il caffè del mattino ha un aroma di nocciola quando la luce entra di lato.',
    plan,
    sampleRequest(plan),
  )
  assert(spark.score > flat.score, 'spark higher')
  assert(flat.notes.includes('delight_killed_by_helpdesk'), 'helpdesk kills delight')
})

test('58. identityConsistency flags AI disclaimer and corporate tone', () => {
  const plan = samplePlan()
  const broken = scoreIdentityConsistency(
    'As an AI, please be advised that I can assist with your request.',
    plan,
    sampleRequest(plan),
  )
  const stable = scoreIdentityConsistency(
    'Mi piace quando una conversazione parte da un dettaglio piccolo e vero.',
    plan,
    sampleRequest(plan),
  )
  assert(broken.notes.includes('ai_disclaimer'), 'ai')
  assert(broken.score < stable.score, 'stable higher')
})

test('59. hard:no_challenge_with_comfort forces REWRITE', () => {
  const plan = samplePlan({
    writerBrief: {
      ...samplePlan().writerBrief,
      comfort: true,
      challenge: false,
      strategy: 'support',
      coda: 'none',
      tone: 'supportive',
    },
    constraints: [
      'strategy:support',
      'ask_question:no',
      'hard:no_question',
      'hard:no_challenge_with_comfort',
    ],
  })
  const r = reviewText(
    'Capisco che sia dura, però hai torto e that\'s silly.',
    plan,
    { thresholds: { overallPass: 0.01 } },
    { shouldComfort: true, shouldChallenge: false, shouldAskQuestion: false },
  )
  assertEqual(r.decision, 'REWRITE', 'rewrite')
  assert(
    r.problems.some((p) =>
      p.code.includes('hard_constraint_violated:hard:no_challenge_with_comfort'),
    ),
    'hard problem',
  )
})

test('60. hard:no_reopen forces REWRITE on close strategy', () => {
  const plan = samplePlan({
    writerBrief: { ...samplePlan().writerBrief, strategy: 'close', coda: 'none' },
    constraints: ['strategy:close', 'hard:no_reopen', 'ask_question:no', 'hard:no_question'],
  })
  const r = reviewText(
    'A presto. Anyway, let\'s discuss your taxes next.',
    plan,
    { thresholds: { overallPass: 0.01 } },
    { strategy: 'close', shouldAskQuestion: false },
  )
  assertEqual(r.decision, 'REWRITE', 'rewrite')
  assert(
    r.problems.some((p) => p.code.includes('hard_constraint_violated:hard:no_reopen')),
    'hard reopen',
  )
})

test('61. defaults are more rigorous than the first reviewer cut', () => {
  assert(DEFAULT_THRESHOLDS.overallPass >= 0.7, 'overall raised')
  assert(DEFAULT_THRESHOLDS.respectOfPlanner >= 0.75, 'respect raised')
  assert(DEFAULT_WEIGHTS.directiveCompliance >= 1.5, 'directive weight')
  assert(typeof DEFAULT_THRESHOLDS.conversationDelight === 'number', 'delight threshold')
  assert(typeof DEFAULT_THRESHOLDS.identityConsistency === 'number', 'identity threshold')
})

test('62. rewrite contract includes categorized problems', () => {
  const r = reviewText(
    'How can I help you today? That is a great question, right?',
  )
  assertEqual(r.decision, 'REWRITE', 'rewrite')
  assert(r.problems.length > 0, 'problems')
  for (const p of r.problems) {
    assert(PROBLEM_CATEGORIES.includes(p.category), `category ${p.category}`)
    assert(p.severity === 'mustFix' || p.severity === 'improve', 'severity')
    assert(typeof p.code === 'string' && p.code, 'code')
    assert(typeof p.message === 'string' && p.message, 'message')
  }
})

test('63. categoryForMetric maps planner and delight metrics', () => {
  assertEqual(categoryForMetric('respectOfPlanner'), 'plannerConstraint', 'planner')
  assertEqual(categoryForMetric('conversationMomentum'), 'conversationDelight', 'delight')
  assertEqual(categoryForMetric('clicheDetection'), 'naturalness', 'naturalness')
  assertEqual(categoryForMetric('practicalValue'), 'specificity', 'specificity')
})

test('64. PASS rewriteHints keep targetScore and empty fix lists', () => {
  const r = reviewText(
    'Ieri il tramonto sul fiume aveva un arancio strano, quasi metallico. Un dettaglio piccolo basta a cambiare l\'umore.',
  )
  assertEqual(r.decision, 'PASS', 'pass')
  assert(isRewriteHints(r.rewriteHints), 'hints')
  assertEqual(r.rewriteHints.mustFix.length, 0, 'mustFix empty')
  assertEqual(r.rewriteHints.improve.length, 0, 'improve empty')
  assertEqual(r.rewriteHints.targetScore, DEFAULT_THRESHOLDS.overallPass, 'target')
})

test('65. PROBLEM_CATEGORIES exports the eight rewrite categories', () => {
  assertEqual(PROBLEM_CATEGORIES.length, 8, 'eight')
  assert(PROBLEM_CATEGORIES.includes('plannerConstraint'), 'planner')
  assert(PROBLEM_CATEGORIES.includes('conversationDelight'), 'delight')
  assert(PROBLEM_CATEGORIES.includes('emotionalCalibration'), 'emotion')
})


console.log('')
if (failed > 0) {
  console.error(`FAILED: ${failed}  passed: ${passed}`)
  process.exit(1)
}
console.log(`All ${passed} tests passed.`)
process.exit(0)
