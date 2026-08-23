/**
 * #371B — Long-thread rhythm: late tease, topic-return depth, tech frustration, micro completion.
 * Run: node --test lib/server/long-thread-rhythm-371b.test.mjs
 *   or: node lib/server/long-thread-rhythm-371b.test.mjs
 */
import assert from 'node:assert/strict'
import {
  CONVERSATION_STATE_BUILD,
  computeConversationState,
  looksLikeCompletionCue,
  looksLikeExplicitReteachDetail,
  looksLikePlayfulBanterBeat,
  looksLikePlayfulTeaseInvitation,
  looksLikeSubstantiveQuestion,
  looksLikeTechnicalFrustration,
  looksLikeTopicReturnCue,
} from './conversation-state.js'

assert.equal(CONVERSATION_STATE_BUILD, '371c-1')

function stateFor(userMessage, recentMessages = []) {
  return computeConversationState({ userMessage, recentMessages })
}

// —— A: late tease invitation without recent playful lookback ——
{
  const hist = [
    { role: 'user', content: 'Oggi ho fatto 3×6 di squat' },
    { role: 'assistant', content: 'Solido.' },
    { role: 'user', content: "Spiegami cos'è OAuth" },
    { role: 'assistant', content: 'OAuth è un protocollo di autorizzazione…' },
    { role: 'user', content: 'Ok, e i token?' },
    { role: 'assistant', content: 'I token portano i claims…' },
    { role: 'user', content: 'Che tempo fa?' },
    { role: 'assistant', content: 'Sole.' },
    { role: 'user', content: 'Grazie' },
    { role: 'assistant', content: 'Prego.' },
  ]
  assert.equal(looksLikePlayfulTeaseInvitation('Indovina quante ne ho fatte 😂'), true)
  assert.equal(
    looksLikePlayfulBanterBeat('Indovina quante ne ho fatte 😂', {
      priorMode: 'informational',
      recentMessages: hist,
    }),
    true,
  )
  const s = stateFor('Indovina quante ne ho fatte 😂', hist)
  assert.equal(s.conversationMode, 'casual', 'A: mode')
  assert.equal(s.responsePurpose, 'react', 'A: purpose')
  assert.equal(s.emotionalTone, 'playful', 'A: tone')
  assert.equal(s.desiredDepth, 'short', 'A: depth')
  assert.equal(s.structurePreference, 'prose', 'A: prose')
  assert.equal(s.initiativeLevel, 'low', 'A: initiative')
  assert.equal(s.questionNeeded, false, 'A: question')
  assert.notEqual(s.responsePurpose, 'explain', 'A: not explain')
}

// —— B: laugh + real question stays explain/answer ——
{
  assert.equal(looksLikeSubstantiveQuestion('Perché OAuth usa i token? 😂'), true)
  assert.equal(looksLikePlayfulTeaseInvitation('Perché OAuth usa i token? 😂'), false)
  assert.equal(looksLikePlayfulBanterBeat('Perché OAuth usa i token? 😂', {}), false)
  const s = stateFor('Perché OAuth usa i token? 😂')
  assert.ok(
    s.responsePurpose === 'explain' || s.responsePurpose === 'answer',
    `B: purpose=${s.responsePurpose}`,
  )
  assert.notEqual(s.responsePurpose, 'react', 'B: not banter-only')
  assert.notEqual(s.playfulBanterDetected, true, 'B: not banter')
}

// —— C: topic return caps depth (prior teaching) ——
{
  assert.equal(looksLikeTopicReturnCue('Torniamo a OAuth'), true)
  const hist = [
    { role: 'user', content: "Cos'è OAuth? Spiegamelo bene" },
    { role: 'assistant', content: 'OAuth è un protocollo… (spiegazione lunga)' },
    { role: 'user', content: 'Ok grazie' },
    { role: 'assistant', content: '👍' },
    { role: 'user', content: 'Che tempo fa a Milano?' },
    { role: 'assistant', content: 'Sole.' },
  ]
  const s = stateFor('Torniamo a OAuth', hist)
  assert.equal(s.responsePurpose, 'continue', 'C: continue')
  assert.equal(s.topicReturnDetected, true, 'C: topic return')
  assert.ok(
    s.desiredDepth === 'short' || s.desiredDepth === 'medium',
    `C: depth<=medium got ${s.desiredDepth}`,
  )
  assert.notEqual(s.desiredDepth, 'detailed', 'C: not detailed re-tutorial')
}

// —— D: explicit re-teach allows detailed ——
{
  const msg = 'Torniamo a OAuth e spiegamelo dettagliatamente da capo'
  assert.equal(looksLikeTopicReturnCue(msg), true)
  assert.equal(looksLikeExplicitReteachDetail(msg), true)
  const hist = [
    { role: 'user', content: "Cos'è OAuth?" },
    { role: 'assistant', content: 'OAuth è…' },
    { role: 'user', content: 'Ok' },
    { role: 'assistant', content: '👍' },
  ]
  const s = stateFor(msg, hist)
  assert.equal(s.conversationMode, 'teaching', 'D: teaching')
  assert.equal(s.responsePurpose, 'explain', 'D: explain')
  assert.equal(s.desiredDepth, 'detailed', 'D: detailed')
}

// —— E: technical frustration → debugging ——
{
  assert.equal(looksLikeTechnicalFrustration('Che palle, Preview di nuovo rossa'), true)
  const s = stateFor('Che palle, Preview di nuovo rossa')
  assert.equal(s.conversationMode, 'debugging', 'E: debugging')
  assert.equal(s.emotionalTone, 'frustrated', 'E: frustrated')
  assert.ok(
    s.responsePurpose === 'continue' || s.responsePurpose === 'answer',
    `E: purpose=${s.responsePurpose}`,
  )
}

// —— F: bare frustration is NOT debugging ——
{
  assert.equal(looksLikeTechnicalFrustration('Che palle.'), false)
  const s = stateFor('Che palle.')
  assert.notEqual(s.conversationMode, 'debugging', 'F: not debugging')
  assert.equal(s.emotionalTone, 'frustrated', 'F: frustrated')
  assert.ok(
    s.responsePurpose === 'react' || s.conversationMode === 'casual',
    `F: react/casual mode=${s.conversationMode} purpose=${s.responsePurpose}`,
  )
}

// —— G: #369B merge decision unchanged ——
{
  const s = stateFor('Preview Ready, CI verde, nessun conflitto. Faccio merge?')
  assert.equal(s.conversationMode, 'decision_support', 'G: decision')
  assert.equal(s.confidence, 'high', 'G: high confidence')
  assert.equal(s.threadEvidence?.completeGo, true, 'G: completeGo')
  assert.notEqual(s.conversationMode, 'debugging', 'G: not debugging')
}

// —— H: Ahhh ora sì → micro completion ——
{
  assert.equal(looksLikeCompletionCue('Ahhh ora sì'), true)
  const s = stateFor('Ahhh ora sì')
  assert.equal(s.completionCueDetected, true, 'H: completion')
  assert.equal(s.responsePurpose, 'react', 'H: react')
  assert.equal(s.desiredDepth, 'short', 'H: short')
  assert.equal(s.initiativeLevel, 'low', 'H: low')
  assert.equal(s.questionNeeded, false, 'H: no question')
}

// —— I: Ahhh ora sì, ma perché? stays OPEN ——
{
  assert.equal(looksLikeCompletionCue('Ahhh ora sì, ma perché?'), false)
  const s = stateFor('Ahhh ora sì, ma perché?')
  assert.equal(s.completionCueDetected, false, 'I: not completion')
}

// —— J: Ah sì? E come funziona? stays OPEN ——
{
  assert.equal(looksLikeCompletionCue('Ah sì? E come funziona?'), false)
  const s = stateFor('Ah sì? E come funziona?')
  assert.equal(s.completionCueDetected, false, 'J: not completion')
}

// —— Extra: CI fallisce / deploy rotto ——
{
  assert.equal(looksLikeTechnicalFrustration('CI fallisce ancora'), true)
  assert.equal(looksLikeTechnicalFrustration('Il deploy è rotto di nuovo'), true)
  assert.equal(stateFor('CI fallisce ancora').conversationMode, 'debugging')
  assert.equal(stateFor('Il deploy è rotto di nuovo').conversationMode, 'debugging')
}

// —— Extra: Cos'è una Preview? stays teaching/informational ——
{
  assert.equal(looksLikeTechnicalFrustration("Cos'è una Preview?"), false)
  const s = stateFor("Cos'è una Preview?")
  assert.notEqual(s.conversationMode, 'debugging')
  assert.ok(
    s.conversationMode === 'informational' ||
      s.conversationMode === 'teaching' ||
      s.conversationMode === 'quick_answer',
  )
}

// —— Extra: Ahhh sì completion ——
{
  assert.equal(looksLikeCompletionCue('Ahhh sì'), true)
  assert.equal(looksLikeCompletionCue('Aaaah sì'), true)
  assert.equal(looksLikeCompletionCue('Ah, ora sì'), true)
}

// —— Extra: topic return specific slice → short ——
{
  const hist = [
    { role: 'user', content: "Cos'è OAuth? Spiegamelo" },
    { role: 'assistant', content: 'OAuth…' },
    { role: 'user', content: 'Ok' },
    { role: 'assistant', content: '👍' },
  ]
  const s = stateFor('Torniamo a OAuth: quella cosa del token?', hist)
  assert.equal(s.responsePurpose, 'continue')
  assert.equal(s.desiredDepth, 'short')
}

console.log('long-thread-rhythm-371b.test.mjs: ok')
