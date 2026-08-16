/**
 * #262 Dynamic response language adaptation
 * Run: node lib/server/language-awareness.test.mjs
 */

import assert from 'node:assert/strict'
import {
  buildCoreLanguageAppendix,
  buildLanguageAwarenessPlan,
  detectDominantLanguage,
  detectLanguageSignal,
  resolveControlReplyLanguage,
  stripTechnicalText,
} from './language-awareness.js'
import {
  ACK_SPECIFIC_FORGET_DE,
  ACK_SPECIFIC_FORGET_EN,
  ACK_SPECIFIC_FORGET_ES,
  ACK_SPECIFIC_FORGET_FR,
  ACK_SPECIFIC_FORGET_IT,
  detectForgetLanguage,
} from './memory-control-forget.js'
import { ackOverviewEmpty, detectOverviewLanguage } from './memory-control-overview.js'

function reply(userMessage, history = []) {
  const messages = [
    ...history.map((content) => ({ role: 'user', content })),
    { role: 'user', content: userMessage },
  ]
  return buildLanguageAwarenessPlan({ userMessage, messages }).replyLanguage
}

function detected(text) {
  return detectLanguageSignal(text)
}

// —— TEST 1–5 normal chat ——
assert.equal(reply('Ciao, come stai?'), 'it', 'TEST 1')
assert.equal(reply('How are you?'), 'en', 'TEST 2')
assert.equal(reply('¿Cómo estás?'), 'es', 'TEST 3')
assert.equal(reply('Comment ça va ?'), 'fr', 'TEST 4')
assert.equal(reply('Wie geht es dir?'), 'de', 'TEST 5')

// —— TEST 6–10 switching ——
assert.equal(reply('What is my main project?', ['Ciao, come stai?', 'Tutto bene grazie']), 'en', 'TEST 6')
assert.equal(
  reply('Qual è il mio progetto principale?', ['How are you?', 'What is my main project?']),
  'it',
  'TEST 7',
)

{
  const turns = [
    'Ciao come stai',
    'What is my main project?',
    '¿Cuál es mi proyecto principal?',
    'Qual è il mio progetto principale?',
  ]
  assert.equal(reply(turns[0]), 'it', 'TEST 8a')
  assert.equal(reply(turns[1], turns.slice(0, 1)), 'en', 'TEST 8b')
  assert.equal(reply(turns[2], turns.slice(0, 2)), 'es', 'TEST 8c')
  assert.equal(reply(turns[3], turns.slice(0, 3)), 'it', 'TEST 8d')
}

{
  const itHist = Array.from({ length: 20 }, (_, i) => `Ciao, questo è il messaggio italiano numero ${i + 1}`)
  assert.equal(reply('What do you remember about me?', itHist), 'en', 'TEST 9')
  const enHist = Array.from({ length: 20 }, (_, i) => `Hello, this is English message number ${i + 1}`)
  assert.equal(reply('Qual è il mio progetto principale?', enHist), 'it', 'TEST 10')
}

// —— TEST 11–14 short turns ——
assert.equal(reply('ok', ['Ciao, come stai?', 'Dimmi di più sul progetto']), 'it', 'TEST 11')
assert.equal(reply('ok', ['How are you?', 'Tell me about the project']), 'en', 'TEST 12')
assert.equal(reply('👍', ['¿Cómo estás?', '¿Cuál es mi anime preferido?']), 'es', 'TEST 13')
assert.equal(reply('Naruto', ['Comment ça va ?', 'Parlons de mes hobbies']), 'fr', 'TEST 14')

// —— grazie must not destroy English sticky ——
assert.equal(reply('grazie', ['How are you?', 'What is my main project?']), 'en', 'grazie sticky')
assert.equal(reply('thanks', ['Ciao come stai', 'Qual è il mio progetto']), 'it', 'thanks sticky')
assert.equal(reply('gracias', ['How are you?', 'What is my main project?']), 'en', 'gracias sticky')
assert.equal(reply('merci', ['How are you?', 'What is my main project?']), 'en', 'merci sticky')

// —— Spanish ≠ Italian ——
assert.equal(detectDominantLanguage('¿Cuál es mi proyecto principal?'), 'es', 'ES not IT')
assert.notEqual(detectDominantLanguage('¿Cuál es mi proyecto principal?'), 'it')

// —— Mixed language ——
assert.equal(reply("Ok, let's talk about Naruto."), 'en', 'mixed EN')
assert.equal(reply('Yes, però preferisco Itachi.'), 'it', 'mixed IT')

// —— Memory independence (language from user turn, not pack gloss) ——
assert.equal(reply('Qual è il mio anime preferito?'), 'it', 'TEST 15')
assert.equal(reply('¿Cuál es mi anime preferido?'), 'es', 'TEST 16')
assert.equal(reply('What is my favorite anime about Naruto and Itachi?'), 'en', 'TEST 17')

// —— Technical filtering ——
{
  const logs = [
    'Error: Failed to compile.',
    'at Module.build (/vercel/path0/node_modules/webpack/lib/Compiler.js:1:1)',
    'GET https://api.vercel.com/v1/deployments timeout',
    '{"status":"error","message":"BUILD_FAILED"}',
    '',
    'Cosa significa questo errore?',
  ].join('\n')
  const plan = buildLanguageAwarenessPlan({ userMessage: logs, messages: [{ role: 'user', content: logs }] })
  assert.equal(plan.replyLanguage, 'it', 'TEST 19')
  assert.ok(stripTechnicalText(logs).includes('Cosa significa'))
  assert.ok(!stripTechnicalText(logs).includes('https://api.vercel.com'))
}

{
  const msg = '```\nconst x = 1;\nconsole.log("hello world from english code");\n```\nWhat does this mean?'
  assert.equal(reply(msg), 'en', 'TEST 20')
}

{
  const msg = '{"foo":"bar","error":"something went wrong in english"}\n¿Qué significa este error?'
  assert.equal(reply(msg), 'es', 'TEST 21')
}

// —— Core appendix contract ——
{
  const appendix = buildCoreLanguageAppendix({
    userMessage: 'How are you?',
    messages: [{ role: 'user', content: 'How are you?' }],
  })
  assert.ok(appendix.includes('Respond in the language of the user'))
  assert.ok(appendix.includes('response language: en'))
  assert.ok(appendix.includes('Do not let:'))
  assert.ok(appendix.includes('memory-pack language'))
}

{
  const appendix = buildCoreLanguageAppendix({
    userMessage: 'ok',
    messages: [
      { role: 'user', content: 'Ciao, come stai?' },
      { role: 'user', content: 'ok' },
    ],
  })
  assert.ok(appendix.includes('current turn language: uncertain'))
  assert.ok(appendix.includes('response language: it'))
}

// —— Control paths ——
assert.equal(detectForgetLanguage("Forget that I like Naruto"), 'en')
assert.equal(detectForgetLanguage('Dimentica che mi piace Naruto'), 'it')
assert.equal(detectForgetLanguage('Olvida que me gusta Naruto'), 'es')
assert.equal(detectForgetLanguage('Oublie que j’aime Naruto'), 'fr')
assert.equal(detectForgetLanguage('Vergiss dass ich Naruto mag'), 'de')

assert.equal(detectOverviewLanguage('What do you remember about me?'), 'en')
assert.equal(detectOverviewLanguage('Cosa ricordi di me?'), 'it')
assert.equal(detectOverviewLanguage('¿Qué sabes de mí?'), 'es')

assert.equal(resolveControlReplyLanguage('¿Cómo estás?'), 'es')
assert.notEqual(ackOverviewEmpty('es'), ackOverviewEmpty('it'))
assert.ok(!ackOverviewEmpty('es').includes('Al momento'))
assert.equal(
  detectForgetLanguage('Olvida Naruto') === 'es' || detectForgetLanguage('Olvida Naruto') !== 'it',
  true,
)

// Ack strings present
assert.ok(ACK_SPECIFIC_FORGET_IT.includes('dimenticato'))
assert.ok(ACK_SPECIFIC_FORGET_EN.includes('forgotten'))
assert.ok(ACK_SPECIFIC_FORGET_ES.includes('olvidado'))
assert.ok(ACK_SPECIFIC_FORGET_FR.includes('oublié'))
assert.ok(ACK_SPECIFIC_FORGET_DE.includes('vergessen'))

console.log('ok: language-awareness #262 tests passed')
