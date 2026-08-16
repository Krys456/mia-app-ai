/**
 * #264 Non-probe preference Recall guard
 * Run: node lib/server/memory-recall-nonprobe-preference-guard.test.mjs
 */

import assert from 'node:assert/strict'
import {
  applyNonProbePreferenceRecallGuard,
  detectMemoryQueryIntent,
  formatCoreMemoryPack,
  hasConcretePreferenceEntityOverlap,
  isGenericPreferenceOpinionQuery,
  isPersonalMemoryProbe,
  isPreferenceFamilyMemory,
  loadCoreMemoryPack,
  RECALL_MAX_MEMORIES,
  rerankMemoriesForRecall,
  shouldSuppressPreferenceMemoryOnNonProbe,
} from './core-memory-recall.js'
import { CONVERSATION_CONTINUITY_CONTRACT } from './conversation-continuity.js'

function row(partial) {
  return {
    title: '',
    status: 'active',
    importance: 8,
    category: 'preferences',
    ...partial,
  }
}

const favNaruto = row({
  content: "User's favorite anime: Naruto.",
  tags: ['fk:preferences.favorite.anime'],
  factKey: 'preferences.favorite.anime',
})
const likeNaruto = row({
  content: 'User likes Naruto.',
  tags: ['fk:preferences.like.naruto'],
  factKey: 'preferences.like.naruto',
})
const interestAi = row({
  content: 'User is interested in AI.',
  tags: ['fk:preferences.interest.ai'],
  factKey: 'preferences.interest.ai',
})
const favDragonBall = row({
  content: "User's favorite anime: Dragon Ball.",
  tags: ['fk:preferences.favorite.anime'],
  factKey: 'preferences.favorite.anime',
})
const cofavItachi = row({
  content: 'User cofavorite character: Itachi.',
  tags: ['fk:preferences.cofavorite.character.itachi'],
  factKey: 'preferences.cofavorite.character.itachi',
})
const primaryLaife = row({
  category: 'projects',
  content: 'User primary project: LAIfe.',
  tags: ['fk:projects.primary'],
  factKey: 'projects.primary',
})
const identityName = row({
  category: 'identity',
  content: 'User name: Alex.',
  tags: ['fk:identity.name'],
  factKey: 'identity.name',
})
const legacyLike = row({
  category: 'preferences',
  content: 'User likes One Piece.',
  tags: [],
  factKey: undefined,
})

function packKeys(memories, query) {
  const guarded = applyNonProbePreferenceRecallGuard(memories, query)
  const intent = detectMemoryQueryIntent(query)
  const ranked = rerankMemoriesForRecall(guarded, query, { limit: RECALL_MAX_MEMORIES, intent })
  const pack = formatCoreMemoryPack(ranked)
  return {
    guarded: guarded.map((r) => r.factKey || r.content),
    pack,
    hasNaruto: pack.includes('Naruto'),
    hasDragonBall: pack.includes('Dragon Ball'),
    hasAI: /interested in AI|\bAI\./i.test(pack),
    hasItachi: pack.includes('Itachi'),
    hasLAIfe: pack.includes('LAIfe.'),
    hasOnePiece: pack.includes('One Piece'),
    hasAlex: pack.includes('Alex'),
  }
}

// —— Family / opinion helpers ——
assert.equal(isPreferenceFamilyMemory(favNaruto), true)
assert.equal(isPreferenceFamilyMemory(primaryLaife), false)
assert.equal(isPreferenceFamilyMemory(identityName), false)
assert.equal(isPreferenceFamilyMemory(legacyLike), true)

assert.equal(isGenericPreferenceOpinionQuery('Perché secondo te mi piace così tanto?'), true)
assert.equal(isGenericPreferenceOpinionQuery('Why do I like it so much?'), true)
assert.equal(isGenericPreferenceOpinionQuery('Perché mi interessa così tanto?'), true)
assert.equal(isGenericPreferenceOpinionQuery('Cosa mi piace?'), false)
assert.equal(isPersonalMemoryProbe('Cosa mi piace?'), true)

// —— TEST A ——
{
  const q = 'Perché secondo te mi piace così tanto?'
  assert.equal(shouldSuppressPreferenceMemoryOnNonProbe(q, favNaruto), true)
  const r = packKeys([favNaruto, primaryLaife], q)
  assert.equal(r.hasNaruto, false, 'TEST A: Naruto excluded')
  assert.ok(r.guarded.includes('projects.primary'), 'TEST A: project survives filter')
}

// —— TEST B ——
{
  const q = 'Why do I like it?'
  assert.equal(shouldSuppressPreferenceMemoryOnNonProbe(q, likeNaruto), true)
  const r = packKeys([likeNaruto], q)
  assert.equal(r.hasNaruto, false, 'TEST B')
}

// —— TEST C ——
{
  const q = 'Perché secondo te mi interessa così tanto?'
  assert.equal(isGenericPreferenceOpinionQuery(q), true)
  assert.equal(shouldSuppressPreferenceMemoryOnNonProbe(q, interestAi), true)
  const r = packKeys([interestAi], q)
  assert.equal(r.hasAI, false, 'TEST C')
}

// —— TEST D ——
{
  const q = 'Why do I like it so much?'
  const r = packKeys([likeNaruto, favDragonBall, interestAi, cofavItachi], q)
  assert.equal(r.hasNaruto, false, 'TEST D naruto')
  assert.equal(r.hasDragonBall, false, 'TEST D db')
  assert.equal(r.hasAI, false, 'TEST D ai')
  assert.equal(r.hasItachi, false, 'TEST D itachi')
  assert.equal(r.pack, '', 'TEST D empty pack')
}

// —— TEST E probe like ——
{
  const q = 'Cosa mi piace?'
  assert.equal(isPersonalMemoryProbe(q), true)
  assert.equal(shouldSuppressPreferenceMemoryOnNonProbe(q, likeNaruto), false)
  const r = packKeys([likeNaruto, favDragonBall, interestAi], q)
  assert.ok(r.pack.includes('likes') || r.hasNaruto || r.hasDragonBall || r.hasAI, 'TEST E packs')
}

// —— TEST F favorite probe ——
{
  const q = 'Qual è il mio anime preferito?'
  assert.equal(isPersonalMemoryProbe(q), true)
  const intent = detectMemoryQueryIntent(q)
  assert.equal(intent.subtype, 'favorite')
  const guarded = applyNonProbePreferenceRecallGuard([favNaruto, likeNaruto, interestAi], q)
  assert.equal(guarded.length, 3, 'TEST F no suppression')
  const ranked = rerankMemoriesForRecall(guarded, q, { limit: 3, intent })
  assert.equal(ranked[0].factKey, 'preferences.favorite.anime', 'TEST F tier')
}

// —— TEST G interest probe ——
{
  const q = 'Cosa mi interessa?'
  assert.equal(isPersonalMemoryProbe(q), true)
  const intent = detectMemoryQueryIntent(q)
  assert.equal(intent.subtype, 'interest')
  const ranked = rerankMemoriesForRecall(
    applyNonProbePreferenceRecallGuard([interestAi, likeNaruto, favNaruto], q),
    q,
    { limit: 3, intent },
  )
  assert.equal(ranked[0].factKey, 'preferences.interest.ai', 'TEST G')
}

// —— TEST H matching Dragon Ball allowed ——
{
  const q = 'Parlando di Dragon Ball, perché secondo te mi piace così tanto?'
  assert.equal(isGenericPreferenceOpinionQuery(q), true)
  assert.equal(hasConcretePreferenceEntityOverlap(q, favDragonBall), true)
  assert.equal(shouldSuppressPreferenceMemoryOnNonProbe(q, favDragonBall), false)
  const r = packKeys([favDragonBall], q)
  assert.equal(r.hasDragonBall, true, 'TEST H')
}

// —— TEST I same query + Naruto only ——
{
  const q = 'Parlando di Dragon Ball, perché secondo te mi piace così tanto?'
  assert.equal(shouldSuppressPreferenceMemoryOnNonProbe(q, favNaruto), true)
  const r = packKeys([favNaruto], q)
  assert.equal(r.hasNaruto, false, 'TEST I')
}

// —— TEST J fresh chat ——
{
  const q = 'Perché mi piace così tanto?'
  const r = packKeys([favNaruto], q)
  assert.equal(r.hasNaruto, false, 'TEST J')
  assert.equal(r.pack, '')
}

// —— TEST K project unaffected ——
{
  const q = 'Perché secondo te mi piace così tanto?'
  assert.equal(shouldSuppressPreferenceMemoryOnNonProbe(q, primaryLaife), false)
  const r = packKeys([primaryLaife, favNaruto], q)
  assert.ok(r.guarded.includes('projects.primary'), 'TEST K')
}

// —— TEST L identity unaffected ——
{
  const q = 'Why do I like it so much?'
  assert.equal(shouldSuppressPreferenceMemoryOnNonProbe(q, identityName), false)
  const guarded = applyNonProbePreferenceRecallGuard([identityName, favNaruto], q)
  assert.ok(guarded.some((r) => r.factKey === 'identity.name'), 'TEST L')
  assert.ok(!guarded.some((r) => r.factKey === 'preferences.favorite.anime'), 'TEST L pref gone')
}

// —— TEST M/N architectural: Overview/Forget not imported/changed here ——
// Covered by separate regression suites.

// —— TEST O continuity unchanged ——
assert.ok(CONVERSATION_CONTINUITY_CONTRACT.includes('CURRENT THREAD REFERENT > DURABLE MEMORY BACKGROUND'))

// —— TEST P language module still importable / RECALL_MAX unchanged ——
assert.equal(RECALL_MAX_MEMORIES, 3)

// —— loadCoreMemoryPack integration ——
{
  const q = 'Perché secondo te mi piace così tanto?'
  const pack = await loadCoreMemoryPack({
    userMessage: q,
    ownerUserId: 'user-test',
    memoryEnabled: true,
    searchMemories: async () => [favNaruto, primaryLaife],
  })
  assert.ok(!pack.includes('Naruto'), 'integration: Naruto suppressed')
  // project may still pack if search returned it and scoring would — after guard,
  // primary remains; format may include it depending on eligibility.
  assert.ok(
    pack === '' || pack.includes('LAIfe') || pack.includes('projects'),
    'integration: non-pref may remain or empty if format filters',
  )
}

{
  const q = 'Qual è il mio anime preferito?'
  const pack = await loadCoreMemoryPack({
    userMessage: q,
    ownerUserId: 'user-test',
    memoryEnabled: true,
    searchMemories: async () => [favNaruto],
  })
  assert.ok(pack.includes('Naruto'), 'integration: probe still packs Naruto')
}

// Legacy row without fact_key
{
  const q = 'Why do I like it?'
  assert.equal(shouldSuppressPreferenceMemoryOnNonProbe(q, legacyLike), true)
  const q2 = 'Parlando di One Piece, perché mi piace?'
  assert.equal(shouldSuppressPreferenceMemoryOnNonProbe(q2, legacyLike), false)
}

console.log('ok: #264 non-probe preference Recall guard')
