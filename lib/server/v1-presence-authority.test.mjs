#!/usr/bin/env node
/**
 * V1 presence / authority / refine regression tests (A–J).
 * Run: node lib/server/v1-presence-authority.test.mjs
 */

import { buildWriterDirectives, validateDraftAgainstDirectives } from './directive-authority.js'
import { buildConversationPlannerPlan } from './conversation-planner-engine.js'
import { analyzeConversationOwnershipDraft } from './conversation-ownership.js'
import { detectEmotionalTone } from './cognitive-engine.js'
import {
  detectConversationalRejection,
  gateApplicabilityForTurn,
  isGateSkipped,
  draftHasUnauthorizedConversationalQuestion,
  stripUnauthorizedQuestions,
  appendDirectiveRefineConstraints,
  isAssistantFillerTopic,
  extractExplicitUserTopic,
  resolveTopicHint,
  isPresenceRestraintTurn,
} from './v1-turn-authority.js'

let passed = 0
let failed = 0

function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(
      () => {
        passed += 1
        console.log(`  ok  — ${name}`)
      },
      (error) => {
        failed += 1
        console.error(`  FAIL — ${name}`)
        console.error(`        ${error instanceof Error ? error.message : String(error)}`)
      },
    )
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

function assertEqual(a, b, msg) {
  if (a !== b) throw new Error(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`)
}

async function main() {
  console.log('v1-presence-authority tests\n')

  await test('A. Greeting Ciao — Planner presence/wait/initiative=false remains authoritative downstream', () => {
    const planner = buildConversationPlannerPlan({ userMessage: 'Ciao', messages: [] })
    assertEqual(planner.plan.initiative, false, 'planner initiative')
    assertEqual(planner.plan.topicAction, 'wait', 'topicAction')
    assertEqual(planner.plan.responseMode, 'presence', 'responseMode')
    const d = buildWriterDirectives({
      userMessage: 'Ciao',
      messages: [],
      conversationPlanner: planner,
      socialConversation: { isSocial: true, forceNoQuestion: true, socialIntent: 'greeting' },
      conversationOwnership: { takeLead: true, active: true },
      warmConversation: { ownsOpening: true },
      welcome: { active: true },
    })
    assertEqual(d.leadConversation, false, 'leadConversation')
    assertEqual(d.initiative, 'low', 'initiative')
    assertEqual(d.askQuestion, false, 'askQuestion')
    assertEqual(d.continueCurrentTopic, false, 'continueCurrentTopic')
    assert(
      d.authorityResolution.overridesApplied.includes('leadConversation←planner'),
      'override recorded',
    )
  })

  await test('B. Greeting draft Ciao! allowed to PASS ownership / presence gates', () => {
    const planner = buildConversationPlannerPlan({ userMessage: 'Ciao', messages: [] })
    const gate = analyzeConversationOwnershipDraft({
      userMessage: 'Ciao',
      draft: 'Ciao!',
      conversationPlanner: planner.plan,
    })
    assertEqual(gate.needsRefine, false, 'no ownership refine')
    const app = gateApplicabilityForTurn(planner)
    assert(app.presenceRestraint, 'presence restraint')
    assert(isGateSkipped('opening_intelligence', app), 'OI skipped')
    assert(isGateSkipped('deep_thinking_writer', app), 'DTW skipped')
    assert(isGateSkipped('conversation_quality_gift', app), 'quality gift skipped')
  })

  await test('C. Come stai? — natural social; no forced high initiative', () => {
    const planner = buildConversationPlannerPlan({
      userMessage: 'Come stai?',
      messages: [
        { role: 'user', content: 'Ciao' },
        { role: 'assistant', content: 'Ciao!' },
      ],
    })
    assertEqual(planner.plan.initiative, false, 'planner initiative')
    assertEqual(planner.plan.responseMode, 'presence', 'presence')
    const d = buildWriterDirectives({
      userMessage: 'Come stai?',
      messages: [],
      conversationPlanner: planner,
      socialConversation: { isSocial: true, socialIntent: 'how_are_you', forceNoQuestion: true },
      conversationOwnership: { takeLead: true },
    })
    assertEqual(d.leadConversation, false, 'no lead')
    assertEqual(d.initiative, 'low', 'low initiative')
    assertEqual(d.askQuestion, false, 'no question')
  })

  await test('D. askQuestion=false — refine must not introduce conversational follow-up', () => {
    const bad =
      'Ciao! Ho pensato a un effetto psicologico interessante: l’effetto Zeigarnik. Vuoi scoprire come funziona?'
    assert(draftHasUnauthorizedConversationalQuestion(bad), 'detect unauthorized Q')
    const stripped = stripUnauthorizedQuestions(bad)
    assert(!draftHasUnauthorizedConversationalQuestion(stripped), 'stripped clean')
    const d = buildWriterDirectives({
      userMessage: 'Ciao',
      conversationPlanner: buildConversationPlannerPlan({ userMessage: 'Ciao' }),
      socialConversation: { isSocial: true, forceNoQuestion: true },
    })
    const v = validateDraftAgainstDirectives(bad, d)
    assertEqual(v.ok, false, 'validation fails')
    assert(v.failures.some((f) => /question/i.test(f)), 'question failure')
    const instructions = appendDirectiveRefineConstraints('Refine this.', d)
    assert(/askQuestion=false/.test(instructions), 'refine constraints include askQ')
  })

  await test('E. Substantive turn — substance gates still active', () => {
    const planner = buildConversationPlannerPlan({
      userMessage: 'Spiegami come funziona la fotosintesi in dettaglio',
      messages: [],
    })
    assert(!isPresenceRestraintTurn(planner), 'not presence restraint')
    const app = gateApplicabilityForTurn(planner)
    assert(!isGateSkipped('deep_thinking_writer', app), 'DTW active')
    assert(!isGateSkipped('reasoning_expansion', app), 'RE active')
  })

  await test('F. Rejection Non mi interessa after assistant topic → direction rejected', () => {
    const messages = [
      { role: 'user', content: 'Ciao' },
      { role: 'assistant', content: 'Vuoi parlare di psicologia cognitiva?' },
      { role: 'user', content: 'Non mi interessa' },
    ]
    const rej = detectConversationalRejection('Non mi interessa', messages)
    assert(rej.rejected, 'rejected')
    const planner = buildConversationPlannerPlan({
      userMessage: 'Non mi interessa',
      messages,
    })
    assertEqual(planner.plan.initiative, false, 'no initiative')
    assertEqual(planner.plan.topicAction, 'wait', 'wait')
    assert(/rifiuto|rejection|drop/i.test(planner.plan.goal), 'goal acknowledges rejection')
    const d = buildWriterDirectives({
      userMessage: 'Non mi interessa',
      messages,
      conversationPlanner: planner,
      conversationOwnership: { takeLead: true },
    })
    assertEqual(d.leadConversation, false, 'no lead after rejection')
    assertEqual(d.initiative, 'low', 'low initiative')
    assertEqual(d.continueCurrentTopic, false, 'do not continue rejected topic')
  })

  await test('G. Rejection does not become emotionalTone=curious', () => {
    assertEqual(detectEmotionalTone('Non mi interessa'), 'neutral', 'tone neutral')
    const planner = buildConversationPlannerPlan({ userMessage: 'Non mi interessa' })
    assertEqual(planner.plan.emotion, 'relaxed', 'desired feeling relaxed not curious')
  })

  await test('H. Explicit user topic Parliamo dei miei obiettivi', () => {
    const topic = extractExplicitUserTopic('Parliamo dei miei obiettivi')
    assertEqual(topic, 'miei obiettivi', 'topic extracted')
    const hint = resolveTopicHint({
      userMessage: 'Parliamo dei miei obiettivi',
      lastA: 'È davvero stimolante scambiare idee con te',
      lastU: 'Parliamo dei miei obiettivi',
    })
    assertEqual(hint.owner, 'user', 'owner user')
    assert(/obiettivi/i.test(String(hint.topicHint)), 'topic = goals')
    const planner = buildConversationPlannerPlan({
      userMessage: 'Parliamo dei miei obiettivi',
      messages: [],
    })
    assertEqual(planner.plan.topicAction, 'stay', 'stay on user topic')
  })

  await test('I. Assistant filler must not become authoritative topicHint', () => {
    assert(
      isAssistantFillerTopic('È davvero stimolante scambiare idee con te'),
      'filler detected',
    )
    const hint = resolveTopicHint({
      userMessage: 'Ciao',
      lastA: 'È davvero stimolante scambiare idee con te',
      lastU: 'Ciao',
    })
    assertEqual(hint.topicHint, null, 'no filler topic')
  })

  await test('J. Refine telemetry — simple valid presence can stay draft', () => {
    const planner = buildConversationPlannerPlan({ userMessage: 'Ciao' })
    const app = gateApplicabilityForTurn(planner)
    // With substance gates skipped, a short draft should not accumulate those refine briefs.
    const wouldFireSubstance =
      app.skipped.includes('opening_intelligence') &&
      app.skipped.includes('small_talk_intelligence') &&
      app.skipped.includes('conversation_ownership') &&
      app.skipped.includes('worth_reading') &&
      app.skipped.includes('conversation_quality_gift')
    assert(wouldFireSubstance, 'presence skips substance refine pressure')
    const ownership = analyzeConversationOwnershipDraft({
      userMessage: 'Ciao',
      draft: 'Ehi, ciao 😊',
      conversationPlanner: planner.plan,
    })
    assertEqual(ownership.needsRefine, false, 'short greeting draft passes')
    // Simulate outputSource=draft when no refine needed
    const outputSource = ownership.needsRefine ? 'refined' : 'draft'
    assertEqual(outputSource, 'draft', 'outputSource draft')
  })

  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
