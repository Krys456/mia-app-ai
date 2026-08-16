/**
 * Recall relation provenance — forgotten LIKE must not be reconstructed from favorite.
 * Run: node --test lib/server/memory-recall-relation-provenance.test.mjs
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { encodeFactKeyTag } from './brain-memory.js'
import { buildCoreResponsesCreateParams } from './core-responses-params.js'
import {
  RECALL_MAX_MEMORIES,
  detectMemoryQueryIntent,
  durableMemoryProvenanceRules,
  formatCoreMemoryPack,
  formatEmptyDurableMemorySignal,
  rerankMemoriesForRecall,
} from './core-memory-recall.js'
import { LAIFE_BASE_SYSTEM_PROMPT } from './laife-base-system-prompt.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')

function mem(partial) {
  const factKey = partial.factKey || null
  const tags = Array.isArray(partial.tags)
    ? [...partial.tags]
    : factKey
      ? [encodeFactKeyTag(factKey)].filter(Boolean)
      : []
  return {
    id: partial.id || factKey || `m-${Math.random()}`,
    category: partial.category || 'preferences',
    title: partial.title || 'Memory',
    content: partial.content || '',
    importance: partial.importance ?? 6,
    usageCount: 0,
    lastUsedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: partial.updatedAt || '2026-01-01T00:00:00.000Z',
    status: partial.status || 'active',
    tags,
    factKey,
  }
}

function factLines(pack) {
  return String(pack || '')
    .split('\n')
    .filter((l) => l.startsWith('- ['))
}

function packFor(query, rows) {
  const intent = detectMemoryQueryIntent(query)
  const ranked = rerankMemoriesForRecall(rows, query, {
    limit: RECALL_MAX_MEMORIES,
    intent,
  })
  return { intent, ranked, pack: formatCoreMemoryPack(ranked) }
}

test('1 — favorite-only + Cosa mi piace? → pack has favorite gloss, not likes gloss', () => {
  const rows = [
    mem({
      factKey: 'preferences.favorite.anime',
      title: 'Favorite',
      content: "User's favorite anime: Naruto.",
    }),
  ]
  const { intent, pack } = packFor('Cosa mi piace?', rows)
  assert.equal(intent.subtype, 'like')
  assert.match(pack, /favorite anime:\s*Naruto/i)
  assert.doesNotMatch(pack, /likes\s*\/\s*prefers:\s*Naruto/i)
  assert.match(pack, /Preserve each durable fact/i)
  assert.match(pack, /Do not convert favorite→like/i)
})

test('2 — active like → likes Naruto allowed in pack', () => {
  const rows = [
    mem({
      factKey: 'preferences.like.naruto',
      title: 'Preference',
      content: 'User likes / prefers: Naruto.',
    }),
  ]
  const { pack } = packFor('Cosa mi piace?', rows)
  assert.match(pack, /likes\s*\/\s*prefers:\s*Naruto/i)
})

test('3 — forgotten like + surviving favorite → relation preserved in pack + rules', () => {
  // Production search uses includeObsolete: false; obsolete like is absent from candidates.
  const rows = [
    mem({
      id: 'fav',
      factKey: 'preferences.favorite.anime',
      title: 'Favorite',
      content: "User's favorite anime: Naruto.",
    }),
  ]
  const { pack, ranked } = packFor('Cosa mi piace?', rows)
  assert.equal(ranked.length, 1)
  assert.equal(ranked[0].id, 'fav')
  assert.match(pack, /favorite anime:\s*Naruto/i)
  assert.doesNotMatch(pack, /likes\s*\/\s*prefers:\s*Naruto/i)
  assert.match(pack, /favorite fact does not authorize claiming a separate LIKE/i)

  // Belt: even if an obsolete like were mistakenly passed, pack eligibility drops it.
  const mixed = formatCoreMemoryPack([
    mem({
      id: 'like-obsolete',
      factKey: 'preferences.like.naruto',
      content: 'User likes / prefers: Naruto.',
      status: 'obsolete',
    }),
    ...rows,
  ])
  assert.match(mixed, /favorite anime:\s*Naruto/i)
  assert.doesNotMatch(mixed, /likes\s*\/\s*prefers:\s*Naruto/i)
})

test('4 — interest-only relation preserved', () => {
  const rows = [
    mem({
      factKey: 'preferences.interest.naruto',
      title: 'Interest',
      content: 'User is interested in: Naruto.',
    }),
  ]
  const { pack } = packFor('Cosa mi piace?', rows)
  assert.match(pack, /interested in:\s*Naruto/i)
  assert.doesNotMatch(pack, /likes\s*\/\s*prefers:\s*Naruto/i)
  assert.doesNotMatch(pack, /favorite anime:\s*Naruto/i)
})

test('5 — cofavorite-only relation preserved', () => {
  const rows = [
    mem({
      factKey: 'preferences.cofavorite.character.itachi',
      title: 'Co-favorite',
      content: "User's co-favorite character: Itachi.",
    }),
  ]
  const { pack } = packFor('Cosa mi piace?', rows)
  assert.match(pack, /co-favorite character:\s*Itachi/i)
  assert.doesNotMatch(pack, /likes\s*\/\s*prefers:\s*Itachi/i)
})

test('6 — favorite query unchanged', () => {
  const rows = [
    mem({
      factKey: 'preferences.favorite.anime',
      title: 'Favorite',
      content: "User's favorite anime: Naruto.",
    }),
  ]
  const { intent, pack } = packFor('Qual è il mio anime preferito?', rows)
  assert.equal(intent.subtype, 'favorite')
  assert.equal(intent.subject, 'anime')
  assert.match(pack, /favorite anime:\s*Naruto/i)
})

test('7 — #254 max3 unchanged with favorite + likes + interests', () => {
  const rows = [
    mem({
      factKey: 'preferences.favorite.anime',
      content: "User's favorite anime: Naruto.",
    }),
    mem({
      factKey: 'preferences.like.dragon_ball',
      content: 'User likes / prefers: Dragon Ball.',
    }),
    mem({
      factKey: 'preferences.interest.one_piece',
      content: 'User is interested in: One Piece.',
    }),
    mem({
      factKey: 'preferences.like.bleach',
      content: 'User likes / prefers: Bleach.',
    }),
  ]
  const { ranked, pack } = packFor('Cosa mi piace?', rows)
  assert.ok(ranked.length <= RECALL_MAX_MEMORIES)
  assert.equal(RECALL_MAX_MEMORIES, 3)
  assert.ok(factLines(pack).length <= 3)
})

test('8 — #251 provenance block still present; relation rules consolidated (not a 2nd appendix)', () => {
  const rules = durableMemoryProvenanceRules()
  assert.match(rules, /DURABLE MEMORY 2\.0/)
  assert.match(rules, /CURRENT THREAD/)
  assert.match(rules, /Preserve each durable fact/)
  assert.equal((rules.match(/Provenance \(ephemeral/g) || []).length, 1)

  const pack = formatCoreMemoryPack([
    mem({
      factKey: 'preferences.favorite.anime',
      content: "User's favorite anime: Naruto.",
    }),
  ])
  assert.equal((pack.match(/DURABLE LAIFE MEMORY 2\.0/g) || []).length, 1)
  assert.equal((pack.match(/Provenance \(ephemeral/g) || []).length, 1)
  assert.equal((pack.match(/Persisted durable facts:/g) || []).length, 1)

  const empty = formatEmptyDurableMemorySignal()
  assert.match(empty, /Preserve each durable fact/)
  assert.equal((empty.match(/Provenance \(ephemeral/g) || []).length, 1)
})

test('9 — favorite + like both preserved as distinct glosses', () => {
  const rows = [
    mem({
      factKey: 'preferences.favorite.anime',
      content: "User's favorite anime: Naruto.",
    }),
    mem({
      factKey: 'preferences.like.dragon_ball',
      content: 'User likes / prefers: Dragon Ball.',
    }),
  ]
  const { pack } = packFor('Cosa mi piace?', rows)
  assert.match(pack, /favorite anime:\s*Naruto/i)
  assert.match(pack, /likes\s*\/\s*prefers:\s*Dragon Ball/i)
})

test('10 — dislike never presented as positive like gloss in pack', () => {
  const rows = [
    mem({
      factKey: 'preferences.dislike.naruto',
      content: 'User dislikes: Naruto.',
    }),
  ]
  const { intent, ranked, pack } = packFor('Cosa mi piace?', rows)
  assert.equal(intent.subtype, 'like')
  // Broad positive like intent should demote / exclude dislike from useful pack.
  assert.ok(
    ranked.length === 0 || !/likes\s*\/\s*prefers:\s*Naruto/i.test(pack),
  )
  if (pack) {
    assert.doesNotMatch(pack, /likes\s*\/\s*prefers:\s*Naruto/i)
  }
})

test('11 — Core one responses.create + Sol unchanged; companion prompt not hosting relation rules', () => {
  assert.doesNotMatch(LAIFE_BASE_SYSTEM_PROMPT, /Do not convert favorite→like/)
  assert.doesNotMatch(LAIFE_BASE_SYSTEM_PROMPT, /DURABLE LAIFE MEMORY 2\.0/)

  const params = buildCoreResponsesCreateParams({
    model: 'gpt-5.6-sol',
    instructions: 'x',
    input: [],
  })
  assert.equal(params.model, 'gpt-5.6-sol')
  assert.equal('temperature' in params, false)

  const chatSrc = readFileSync(join(root, 'api/chat.ts'), 'utf8')
  assert.equal((chatSrc.match(/\.responses\.create\s*\(/g) || []).length, 1)
})
