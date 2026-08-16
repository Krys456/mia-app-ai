/**
 * Memory 2.1 PR #261 — interest Recall intent / probe / ranking.
 * Run: node --test lib/server/memory-recall-interest.test.mjs
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { detectMemoryTopic } from './brain-memory.js'
import {
  detectMemoryQueryIntent,
  durableMemoryProvenanceRules,
  formatCoreMemoryPack,
  formatEmptyDurableMemorySignal,
  isPersonalMemoryProbe,
  loadCoreMemoryPack,
  rerankMemoriesForRecall,
  semanticRecallTier,
} from './core-memory-recall.js'
import { classifySpecificForgetTarget } from './memory-control-forget.js'

function mem(partial) {
  const factKey = partial.factKey || null
  const tags = Array.isArray(partial.tags)
    ? partial.tags
    : factKey
      ? [`fact_key:${factKey}`]
      : []
  return {
    id: partial.id || factKey || `m-${Math.random()}`,
    category: partial.category || 'preferences',
    title: partial.title || 'Memory',
    content: partial.content || '',
    importance: partial.importance ?? 6,
    usageCount: partial.usageCount ?? 0,
    lastUsedAt: partial.lastUsedAt ?? null,
    createdAt: partial.createdAt || '2026-01-01T00:00:00.000Z',
    updatedAt: partial.updatedAt || '2026-01-01T00:00:00.000Z',
    status: partial.status || 'active',
    tags,
    factKey,
  }
}

function packFor(query, rows) {
  const intent = detectMemoryQueryIntent(query)
  const ranked = rerankMemoriesForRecall(rows, query, { intent })
  return { intent, ranked, pack: formatCoreMemoryPack(ranked) }
}

const interestNaruto = mem({
  factKey: 'preferences.interest.naruto',
  title: 'Interest',
  content: 'User is interested in: Naruto',
})

test('TEST 1 — Cosa mi interessa? pack contains interest Naruto', () => {
  const { intent, pack } = packFor('Cosa mi interessa?', [interestNaruto])
  assert.equal(intent.subtype, 'interest')
  assert.equal(intent.domain, 'preferences')
  assert.match(pack, /interested in:\s*Naruto/i)
})

test('TEST 2 — Quali sono i miei interessi?', () => {
  const { intent, pack } = packFor('Quali sono i miei interessi?', [interestNaruto])
  assert.equal(intent.subtype, 'interest')
  assert.match(pack, /interested in:\s*Naruto/i)
})

test('TEST 3 — What am I interested in?', () => {
  const { intent, pack } = packFor('What am I interested in?', [interestNaruto])
  assert.equal(intent.subtype, 'interest')
  assert.match(pack, /interested in:\s*Naruto/i)
})

test('TEST 4 — What are my interests?', () => {
  const { intent, pack } = packFor('What are my interests?', [interestNaruto])
  assert.equal(intent.subtype, 'interest')
  assert.match(pack, /interested in:\s*Naruto/i)
})

test('TEST 5 — no interest rows → probe + empty durable signal', async () => {
  assert.equal(isPersonalMemoryProbe('Cosa mi interessa?'), true)
  const empty = await loadCoreMemoryPack({
    userMessage: 'Cosa mi interessa?',
    ownerUserId: 'user-a',
    memoryEnabled: true,
    searchMemories: async () => [],
  })
  assert.match(empty, /DURABLE MEMORY RESULT/i)
  assert.equal(empty.includes(formatEmptyDurableMemorySignal().slice(0, 40)), true)
})

test('TEST 6 — interest Naruto ranks before like Dragon Ball', () => {
  const like = mem({
    factKey: 'preferences.like.dragon_ball',
    title: 'Preference',
    content: 'User likes / prefers: Dragon Ball',
    importance: 9,
  })
  const { ranked, intent } = packFor('Cosa mi interessa?', [like, interestNaruto])
  assert.equal(intent.subtype, 'interest')
  assert.equal(ranked[0]?.factKey, 'preferences.interest.naruto')
  assert.ok(
    semanticRecallTier(interestNaruto, intent) < semanticRecallTier(like, intent),
  )
})

test('TEST 7 — like Naruto only → not presented as interest gloss', () => {
  const like = mem({
    factKey: 'preferences.like.naruto',
    title: 'Preference',
    content: 'User likes / prefers: Naruto',
  })
  const { pack, intent } = packFor('Cosa mi interessa?', [like])
  assert.equal(intent.subtype, 'interest')
  assert.doesNotMatch(pack, /interested in:\s*Naruto/i)
  if (pack.includes('Naruto')) {
    assert.match(pack, /likes\s*\/\s*prefers:\s*Naruto/i)
  }
  assert.match(durableMemoryProvenanceRules(), /like→interest/i)
})

test('TEST 8 — favorite Naruto only → not presented as interest gloss', () => {
  const fav = mem({
    factKey: 'preferences.favorite.anime',
    title: 'Favorite',
    content: "User's favorite anime: Naruto",
  })
  const { pack } = packFor('Cosa mi interessa?', [fav])
  assert.doesNotMatch(pack, /interested in:\s*Naruto/i)
  if (pack.includes('Naruto')) {
    assert.match(pack, /favorite anime:\s*Naruto/i)
  }
})

test('TEST 9 — Cosa mi piace? #254 like intent unchanged', () => {
  const intent = detectMemoryQueryIntent('Cosa mi piace?')
  assert.equal(intent.subtype, 'like')
  assert.equal(intent.domain, 'preferences')
  const { pack } = packFor('Cosa mi piace?', [
    interestNaruto,
    mem({
      factKey: 'preferences.like.dragon_ball',
      content: 'User likes / prefers: Dragon Ball',
    }),
  ])
  assert.match(pack, /interested in:\s*Naruto|likes\s*\/\s*prefers:\s*Dragon Ball/i)
})

test('TEST 10 — favorite query unchanged', () => {
  const intent = detectMemoryQueryIntent('Qual è il mio anime preferito?')
  assert.equal(intent.subtype, 'favorite')
  assert.equal(intent.subject, 'anime')
})

test('TEST 11 — project / identity recall unchanged', () => {
  assert.equal(
    detectMemoryQueryIntent('Qual è il mio progetto principale?').subtype,
    'project_primary',
  )
  assert.equal(detectMemoryQueryIntent('Come mi chiamo?').domain, 'identity')
})

test('TEST 12 — Specific Forget interest classifier unchanged', () => {
  const c = classifySpecificForgetTarget('Dimentica che mi interessa Naruto.')
  assert.equal(c.kind, 'interest')
  assert.equal(c.factKey, 'preferences.interest.naruto')
})

test('topic cues include interest stems; compound interest not a probe', () => {
  const topic = detectMemoryTopic('Cosa mi interessa?')
  assert.ok(topic.topicIds.includes('preferences'))
  assert.equal(isPersonalMemoryProbe('What is compound interest?'), false)
  assert.equal(detectMemoryQueryIntent('What is compound interest?').subtype, null)
})

test('remember interest probe forms', () => {
  assert.equal(detectMemoryQueryIntent('Ti ricordi cosa mi interessa?').subtype, 'interest')
  assert.equal(
    detectMemoryQueryIntent("Do you remember what I'm interested in?").subtype,
    'interest',
  )
  assert.equal(isPersonalMemoryProbe('Ti ricordi quali sono i miei interessi?'), true)
})
