#!/usr/bin/env node
/**
 * LAIfe V2 — Conversation Resume harness (experimental)
 *
 * Offline example conversations. Current-chat only — no LLM, no durable memory.
 * Pipeline wiring lives in Runtime (pipeline.js) + Planner gate.
 *
 * Usage:
 *   node lib/server/v2/eval/conversation-resume-harness.mjs
 */

import {
  CONVERSATION_RESUME_VERSION,
  resumeConversation,
} from '../brain/conversation-resume.js'

/** @type {{ name: string, messages: { role: string, content: string }[] }[]} */
const EXAMPLES = [
  {
    name: 'laife-continuity',
    messages: [
      {
        role: 'user',
        content:
          'Stiamo lavorando sullo sviluppo di LAIfe. L\'obiettivo è rendere V2 più naturale.',
      },
      {
        role: 'assistant',
        content:
          'Presence Recovery completato. Conversation Momentum aggiunto. Possiamo continuare sulla continuità.',
      },
      {
        role: 'user',
        content:
          'Decisione: non modificare più il Writer. Passare alla continuità della conversazione.',
      },
      {
        role: 'assistant',
        content: 'Ok: Writer freeze e focus su resume / continuity.',
      },
    ],
  },
  {
    name: 'open-question',
    messages: [
      { role: 'user', content: 'Come strutturo i test del resume engine?' },
      {
        role: 'assistant',
        content: 'Parti da conversazioni esempio e assert su goal, progress e decisioni.',
      },
      { role: 'user', content: 'Quando lo colleghiamo al Planner?' },
    ],
  },
  {
    name: 'emotional-support',
    messages: [
      { role: 'user', content: 'Sono frustrato: i refactor non finiscono mai.' },
      { role: 'assistant', content: 'Capisco. Restiamo su un pezzo alla volta.' },
      { role: 'user', content: 'Vorrei migliorare la chiarezza senza toccare tutto.' },
    ],
  },
  {
    name: 'learning-thread',
    messages: [
      { role: 'user', content: 'Voglio capire meglio Presence Recovery.' },
      {
        role: 'assistant',
        content: 'Presence Recovery ripristina tono e presenza dopo un draft grezzo.',
      },
      { role: 'user', content: 'Ok, Presence Recovery completato. Passiamo a Conversation Momentum.' },
      { role: 'assistant', content: 'Conversation Momentum aggiunto.' },
    ],
  },
  {
    name: 'empty',
    messages: [],
  },
]

/**
 * @param {string[]} items
 * @returns {string}
 */
function bullets(items) {
  if (!items.length) return '  (none)'
  return items.map((x) => `  - ${x}`).join('\n')
}

console.log(`LAIfe Conversation Resume harness (${CONVERSATION_RESUME_VERSION})`)
console.log('')

for (const example of EXAMPLES) {
  const resume = resumeConversation({ messages: example.messages })
  console.log(`=== ${example.name} ===`)
  console.log(`currentTopic:          ${resume.currentTopic}`)
  console.log(`currentGoal:           ${resume.currentGoal}`)
  console.log('progress:')
  console.log(bullets(resume.progress))
  console.log('unresolvedQuestions:')
  console.log(bullets(resume.unresolvedQuestions))
  console.log('importantDecisions:')
  console.log(bullets(resume.importantDecisions))
  console.log(`emotionalContext:      ${resume.emotionalContext}`)
  console.log(`suggestedResumeSentence:`)
  console.log(`  ${resume.suggestedResumeSentence}`)
  console.log('')
}
