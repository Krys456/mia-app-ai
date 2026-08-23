/**
 * #370B — Playful rhythm, banter continuity, soft closers, topic return.
 * Run: node lib/server/playful-rhythm-370b.test.mjs
 */
import assert from 'node:assert/strict'
import {
  CONVERSATION_STATE_BUILD,
  computeConversationState,
  looksLikeCompletionCue,
  looksLikeLaughCue,
  looksLikePlayfulBanterBeat,
  looksLikeSoftDiscourseParticle,
  looksLikeSoftStopClose,
  looksLikeSubstantiveQuestion,
  looksLikeTopicReturnCue,
  looksLikeHarmDistressCue,
  priorAssistantOfferedSelectableAlternatives,
} from './conversation-state.js'

assert.equal(CONVERSATION_STATE_BUILD, '371b-1')

function stateFor(userMessage, recentMessages = []) {
  return computeConversationState({ userMessage, recentMessages })
}

function assertBanter(label, s) {
  assert.equal(s.conversationMode, 'casual', `${label}: mode`)
  assert.equal(s.responsePurpose, 'react', `${label}: purpose`)
  assert.equal(s.desiredDepth, 'short', `${label}: depth`)
  assert.equal(s.structurePreference, 'prose', `${label}: prose`)
  assert.equal(s.emotionalTone, 'playful', `${label}: tone`)
  assert.equal(s.questionNeeded, false, `${label}: question`)
  assert.equal(s.initiativeLevel, 'low', `${label}: initiative`)
  assert.notEqual(s.responsePurpose, 'explain', `${label}: not explain`)
}

// —— A banter sequence ——
{
  const hist = [
    { role: 'user', content: 'Finalmente funziona!!!' },
    { role: 'assistant', content: 'Grandeee 🎉🔥' },
    { role: 'user', content: 'Era ora 😂' },
    { role: 'assistant', content: 'Decisamente 😂' },
  ]
  const s = stateFor('Ci ha messo solo 47 tentativi 😂', hist)
  assertBanter('A', s)
  assert.equal(s.playfulBanterDetected, true)
}

// —— B Era ora playful ——
{
  const s = stateFor('Era ora 😂', [
    { role: 'user', content: 'Finalmente funziona!!!' },
    { role: 'assistant', content: 'Grande!' },
  ])
  assert.equal(s.emotionalTone, 'playful')
  assert.equal(s.responsePurpose, 'react')
  assert.equal(looksLikeLaughCue('Era ora 😂'), true)
}

// —— C emoji-only ——
{
  const s = stateFor('😂😂😂', [
    { role: 'user', content: 'Finalmente funziona!!!' },
    { role: 'assistant', content: 'Yay' },
  ])
  assertBanter('C', s)
}

// —— D Adesso sicuramente si rompe ——
{
  const s = stateFor('Adesso sicuramente si rompe 😂', [
    { role: 'user', content: 'Finalmente funziona!!!' },
    { role: 'assistant', content: 'Grande' },
    { role: 'user', content: 'Era ora 😂' },
    { role: 'assistant', content: 'Eh sì' },
  ])
  assertBanter('D', s)
}

// —— E real question with 😂 ——
{
  const s = stateFor('Perché OAuth usa i token? 😂')
  assert.equal(looksLikeSubstantiveQuestion('Perché OAuth usa i token? 😂'), true)
  assert.equal(looksLikePlayfulBanterBeat('Perché OAuth usa i token? 😂', {}), false)
  assert.ok(
    s.conversationMode === 'informational' ||
      s.conversationMode === 'teaching' ||
      s.conversationMode === 'quick_answer',
  )
  assert.ok(s.responsePurpose === 'explain' || s.responsePurpose === 'answer')
  assert.notEqual(s.responsePurpose, 'react')
}

// —— F harm distress override ——
{
  assert.equal(looksLikeHarmDistressCue('Mi sono fatto male 😂'), true)
  const s = stateFor('Mi sono fatto male 😂')
  assert.equal(s.emotionalTone, 'serious')
  assert.notEqual(s.emotionalTone, 'playful')
  assert.equal(s.playfulBanterDetected, false)
}

// —— G/H/I soft closers after merge ——
{
  const mergeHist = [
    {
      role: 'user',
      content: 'CI è verde, Preview Ready, nessun conflitto. Faccio merge?',
    },
    { role: 'assistant', content: 'Sì, farei merge.' },
  ]
  for (const u of ['Vabbè', 'Boh', 'Daje', 'Mah', 'Interessante', 'Ok dai']) {
    assert.equal(looksLikeSoftDiscourseParticle(u), true, `particle:${u}`)
    const s = stateFor(u, mergeHist)
    assert.notEqual(s.conversationMode, 'decision_support', `${u} not decision`)
    assert.equal(s.conversationMode, 'casual', `${u} casual`)
    assert.equal(s.responsePurpose, 'react', `${u} react`)
    assert.equal(s.desiredDepth, 'short', `${u} short`)
    assert.equal(s.initiativeLevel, 'low', `${u} low`)
  }
}

// —— J selectable alternative preserved ——
{
  const hist = [
    { role: 'user', content: 'Non so quale scegliere.' },
    { role: 'assistant', content: 'Preferisci A o B?' },
  ]
  assert.equal(priorAssistantOfferedSelectableAlternatives(hist), true)
  const s = stateFor('B', hist)
  assert.equal(s.conversationMode, 'decision_support')
}

// —— K soft STOP ——
{
  assert.equal(looksLikeSoftStopClose('Lasciamo perdere'), true)
  const s = stateFor('Lasciamo perdere')
  assert.equal(s.stopSignalDetected, true)
  assert.equal(s.responsePurpose, 'react')
  assert.equal(s.initiativeLevel, 'low')
  assert.equal(s.questionNeeded, false)
}

// —— L pivot not STOP ——
{
  assert.equal(
    looksLikeSoftStopClose('Lasciamo perdere OAuth e parliamo di Calendar'),
    false,
  )
  const s = stateFor('Lasciamo perdere OAuth e parliamo di Calendar')
  assert.equal(s.stopSignalDetected, false)
}

// —— M still open ——
{
  assert.equal(looksLikeSoftStopClose('Va bene così, ma perché?'), false)
  assert.equal(looksLikeCompletionCue('Va bene così, ma perché?'), false)
  const s = stateFor('Va bene così, ma perché succede?')
  assert.equal(s.stopSignalDetected, false)
  assert.equal(s.completionCueDetected, false)
}

// —— N/O topic return ——
{
  assert.equal(looksLikeTopicReturnCue('Torniamo a OAuth'), true)
  assert.equal(looksLikeTopicReturnCue('Torniamo a quello di prima'), true)
  const oauthHist = [
    { role: 'user', content: "Cos'è OAuth?" },
    { role: 'assistant', content: 'OAuth è un protocollo…' },
    { role: 'user', content: 'Ok grazie' },
    { role: 'assistant', content: '👍' },
    { role: 'user', content: 'Che tempo fa?' },
    { role: 'assistant', content: 'Sole.' },
  ]
  const s = stateFor('Torniamo a OAuth', oauthHist)
  assert.equal(s.responsePurpose, 'continue')
  assert.equal(s.topicReturnDetected, true)
  // prior substantive teaching/informational preferred over casual digression
  assert.ok(
    s.conversationMode === 'teaching' ||
      s.conversationMode === 'informational' ||
      s.conversationMode === 'casual',
  )
}

// —— Q comunque sul 3×6 ——
{
  assert.equal(looksLikeTopicReturnCue('Comunque, sul 3×6…'), true)
  const s = stateFor('Comunque, sul 3×6…', [
    { role: 'user', content: 'Oggi ho fatto 3×6 di squat' },
    { role: 'assistant', content: 'Solido.' },
    { role: 'user', content: 'Poi cardio' },
    { role: 'assistant', content: 'Ok.' },
  ])
  assert.equal(s.responsePurpose, 'continue')
}

// —— R serious with laugh ——
{
  const s = stateFor('Seriamente però: mi sono fatto male 😂')
  assert.equal(s.emotionalTone, 'serious')
  assert.equal(s.playfulBanterDetected, false)
}

// —— S English banter ——
{
  const s = stateFor('Only took 47 attempts 😂', [
    { role: 'user', content: 'Finally it works.' },
    { role: 'assistant', content: 'Awesome!' },
  ])
  assertBanter('S', s)
}

// —— T English real question with 😂 ——
{
  const s = stateFor('Why does OAuth use tokens? 😂')
  assert.equal(looksLikeSubstantiveQuestion('Why does OAuth use tokens? 😂'), true)
  assert.ok(s.responsePurpose === 'explain' || s.responsePurpose === 'answer')
  assert.notEqual(s.playfulBanterDetected, true)
}

// —— Preserve #369B merge evidence ——
{
  const s = stateFor('CI è verde, Preview Ready, nessun conflitto. Faccio merge?')
  assert.equal(s.conversationMode, 'decision_support')
  assert.equal(s.confidence, 'high')
  assert.equal(s.threadEvidence.completeGo, true)
}
{
  const s = stateFor('Faccio merge?', [
    { role: 'user', content: 'CI è verde.' },
    { role: 'assistant', content: 'Ok.' },
    { role: 'user', content: 'Aspetta, Preview fallisce.' },
    { role: 'assistant', content: 'Capito.' },
  ])
  assert.equal(s.threadEvidence.blocking, true)
}
{
  const s = stateFor('Credo che i test siano verdi. Faccio merge?')
  assert.equal(s.confidence, 'low')
}

// —— Preserve #367B/#369B micro ——
{
  const s = stateFor('Aaaahhh allora ho capito')
  assert.equal(s.completionCueDetected, true)
  assert.equal(s.responsePurpose, 'react')
  assert.equal(s.initiativeLevel, 'low')
}
{
  const s = stateFor('Ok')
  assert.equal(s.completionCueDetected, true)
}
{
  const s = stateFor('Non ho capito')
  assert.equal(s.conversationMode, 'teaching')
}

// —— Vabbè così completion ——
{
  assert.equal(looksLikeCompletionCue('Vabbè così'), true)
  const s = stateFor('Vabbè così')
  assert.equal(s.completionCueDetected || s.stopSignalDetected, true)
}

console.log('playful-rhythm-370b.test.mjs: ok')
