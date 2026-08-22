/**
 * #324 — Deterministic Conversation State evaluation fixtures.
 * Run: node scripts/eval-conversation-state.mjs
 *
 * Tests STATE classification only (not model prose).
 */

import assert from 'node:assert/strict'
import { computeConversationState } from '../lib/server/conversation-state.js'

/** @type {Array<{
 *   id: string
 *   userMessage: string
 *   recentMessages?: Array<{role:string, content:string}>
 *   settings?: Record<string, unknown>
 *   expect: Record<string, unknown>
 * }>} */
const FIXTURES = [
  {
    id: 'casual-ciao',
    userMessage: 'Ciao',
    expect: {
      conversationMode: 'casual',
      responsePurpose: 'react',
      desiredDepth: 'short',
      questionNeeded: true, // #330 social reciprocal for greeting
      structurePreference: 'prose',
    },
  },
  {
    id: 'casual-come-va',
    userMessage: 'Come va?',
    expect: {
      conversationMode: 'casual',
      responsePurpose: 'react',
      desiredDepth: 'short',
      questionNeeded: true, // #330
    },
  },
  {
    id: 'exploration-mi-annoio',
    userMessage: 'Mi annoio',
    expect: {
      conversationMode: 'brainstorming',
      responsePurpose: 'brainstorm',
      questionNeeded: false,
    },
  },
  {
    id: 'casual-ahahah',
    userMessage: 'Ahahah',
    expect: {
      conversationMode: 'casual',
      responsePurpose: 'react',
      emotionalTone: 'playful',
    },
  },
  {
    id: 'excited-finalmente',
    userMessage: 'Finalmente funziona!!!',
    expect: {
      conversationMode: 'celebration',
      responsePurpose: 'react',
      desiredDepth: 'short',
      acknowledgementNeeded: true,
      questionNeeded: false,
      structurePreference: 'prose',
    },
  },
  {
    id: 'excited-figata',
    userMessage: 'Madonna che figata!',
    expect: {
      questionNeeded: false,
    },
  },
  {
    id: 'frustrated-debug',
    userMessage: 'Non funziona ancora.',
    recentMessages: [
      { role: 'user', content: 'Questa API restituisce 401' },
      { role: 'assistant', content: 'Controlla il token.' },
      { role: 'user', content: 'Non funziona ancora.' },
    ],
    expect: {
      conversationMode: 'debugging',
      questionNeeded: false,
    },
  },
  {
    id: 'frustrated-che-palle',
    userMessage: 'Che palle.',
    recentMessages: [
      { role: 'user', content: 'Il codice TypeScript dà errore' },
      { role: 'assistant', content: 'Vediamo il log.' },
      { role: 'user', content: 'Che palle.' },
    ],
    expect: {
      // Must not be emotional_support
      notMode: 'emotional_support',
    },
  },
  {
    id: 'factual-entropy',
    userMessage: "Cos'è l'entropia?",
    expect: {
      conversationMode: 'informational',
      responsePurpose: 'explain',
      desiredDepth: 'medium',
      initiativeLevel: 'low',
      questionNeeded: false,
    },
  },
  {
    id: 'teaching-eli5',
    userMessage: 'Spiegamelo come se non sapessi nulla.',
    expect: {
      conversationMode: 'teaching',
      responsePurpose: 'explain',
      questionNeeded: false,
    },
  },
  {
    id: 'technical-401',
    userMessage: 'Perché questa API restituisce 401?',
    expect: {
      conversationMode: 'debugging',
      questionNeeded: false,
    },
  },
  {
    id: 'brainstorm-app',
    userMessage: 'Vorrei creare una nuova app.',
    expect: {
      conversationMode: 'brainstorming',
      responsePurpose: 'brainstorm',
      initiativeLevel: 'high',
      questionNeeded: false,
    },
  },
  {
    id: 'decision-names',
    userMessage: 'Quale dei due nomi sceglieresti?',
    expect: {
      conversationMode: 'decision_support',
      responsePurpose: 'recommend',
      // Options not listed → clarifying question is appropriate
      questionNeeded: true,
    },
  },
  {
    id: 'decision-names-with-options',
    userMessage: 'Quale sceglieresti: Aurora o Nova?',
    expect: {
      conversationMode: 'decision_support',
      responsePurpose: 'recommend',
      questionNeeded: false,
    },
  },
  {
    id: 'correction-other',
    userMessage: "No, intendevo l'altro.",
    recentMessages: [
      { role: 'assistant', content: 'Intendevi Naruto?' },
      { role: 'user', content: "No, intendevo l'altro." },
    ],
    expect: {
      responsePurpose: 'continue',
      acknowledgementNeeded: true,
      questionNeeded: false,
    },
  },
  {
    id: 'continuity-continuiamo',
    userMessage: 'Continuiamo.',
    recentMessages: [
      { role: 'user', content: 'Debug 401' },
      { role: 'assistant', content: 'Passo 1 fatto.' },
      { role: 'user', content: 'Continuiamo.' },
    ],
    expect: {
      conversationMode: 'debugging',
      responsePurpose: 'continue',
    },
  },
  {
    id: 'continuity-e-poi',
    userMessage: 'E poi?',
    recentMessages: [
      { role: 'user', content: 'Dammi qualche idea' },
      { role: 'assistant', content: 'Idea A.' },
      { role: 'user', content: 'E poi?' },
    ],
    expect: {
      conversationMode: 'brainstorming',
    },
  },
  {
    id: 'continuity-quello',
    userMessage: 'Quello di prima.',
    recentMessages: [
      { role: 'user', content: 'Opzione uno o due?' },
      { role: 'assistant', content: 'Uno.' },
      { role: 'user', content: 'Quello di prima.' },
    ],
    expect: {
      // short follow-up, not a new essay mode
      desiredDepthIn: ['short', 'medium'],
    },
  },
]

let passed = 0
for (const fix of FIXTURES) {
  const state = computeConversationState({
    userMessage: fix.userMessage,
    recentMessages:
      fix.recentMessages || [{ role: 'user', content: fix.userMessage }],
    settings: fix.settings || {},
  })

  for (const [key, expected] of Object.entries(fix.expect)) {
    if (key === 'notMode') {
      assert.notEqual(
        state.conversationMode,
        expected,
        `${fix.id}: mode should not be ${expected}`,
      )
      continue
    }
    if (key === 'desiredDepthIn') {
      assert.ok(
        expected.includes(state.desiredDepth),
        `${fix.id}: depth ${state.desiredDepth} not in ${expected}`,
      )
      continue
    }
    assert.equal(
      state[key],
      expected,
      `${fix.id}: ${key} expected ${expected}, got ${state[key]}`,
    )
  }
  passed += 1
  console.log(`✓ ${fix.id}`, {
    mode: state.conversationMode,
    purpose: state.responsePurpose,
    depth: state.desiredDepth,
    q: state.questionNeeded,
  })
}

console.log(`eval-conversation-state: ${passed}/${FIXTURES.length} fixtures ok`)
