/**
 * Memory 2.1 — Semantic Recall (query intent + Recall-only rerank).
 * Run: node --test lib/server/memory-recall-semantics.test.mjs
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { selectTopMemories } from './brain-memory.js'
import {
  RECALL_CANDIDATE_LIMIT,
  RECALL_MAX_MEMORIES,
  RECALL_MAX_PACK_CHARS,
  RECALL_MAX_PER_CATEGORY,
  detectMemoryQueryIntent,
  formatCoreMemoryPack,
  formatEmptyDurableMemorySignal,
  isPersonalMemoryProbe,
  loadCoreMemoryPack,
  rerankMemoriesForRecall,
  semanticRecallTier,
} from './core-memory-recall.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')

function mem(partial) {
  const factKey = partial.factKey || null
  const tags = Array.isArray(partial.tags)
    ? partial.tags
    : factKey
      ? [`fact_key:${factKey}`]
      : []
  return {
    id: partial.id || factKey || partial.content || `m-${Math.random()}`,
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

function keys(rows) {
  return rows.map((r) => r.factKey || r.id)
}

function packContents(pack) {
  return String(pack || '')
    .split('\n')
    .filter((l) => l.startsWith('- ['))
    .join('\n')
}

const storeA = [
  mem({
    factKey: 'preferences.favorite.anime',
    title: 'Favorite',
    content: "User's favorite anime: Naruto",
    importance: 6,
    updatedAt: '2025-01-01T00:00:00.000Z',
  }),
  mem({
    factKey: 'preferences.like.dragon_ball',
    title: 'Preference',
    content: 'User likes / prefers: Dragon Ball',
    importance: 6,
    updatedAt: '2026-08-15T00:00:00.000Z',
    usageCount: 20,
    lastUsedAt: '2026-08-15T00:00:00.000Z',
  }),
  mem({
    factKey: 'preferences.interest.one_piece',
    title: 'Interest',
    content: 'User is interested in: One Piece',
    importance: 5,
  }),
  mem({
    factKey: 'preferences.cofavorite.character.itachi',
    title: 'Co-favorite',
    content: "User's favorite personaggi: Itachi",
  }),
  mem({
    factKey: 'preferences.cofavorite.character.sasuke',
    title: 'Co-favorite',
    content: "User's favorite personaggi: Sasuke",
  }),
  mem({
    factKey: 'preferences.favorite.color',
    title: 'Favorite',
    content: "User's favorite colore: green",
  }),
]

const storeB = [
  mem({
    category: 'projects',
    factKey: 'projects.primary',
    title: 'Primary project',
    content: "User's primary project: Nexus",
    importance: 6,
    updatedAt: '2025-01-01T00:00:00.000Z',
  }),
  mem({
    category: 'projects',
    factKey: 'projects.laife',
    title: 'Project',
    content: "User's project: LAIfe",
    importance: 8,
    updatedAt: '2026-08-15T00:00:00.000Z',
  }),
  mem({
    category: 'projects',
    factKey: 'projects.website',
    title: 'Project',
    content: "User's project: website",
    importance: 7,
  }),
]

const threeCofav = [
  mem({
    factKey: 'preferences.cofavorite.character.itachi',
    content: "User's favorite personaggi: Itachi",
  }),
  mem({
    factKey: 'preferences.cofavorite.character.sasuke',
    content: "User's favorite personaggi: Sasuke",
  }),
  mem({
    factKey: 'preferences.cofavorite.character.madara',
    content: "User's favorite personaggi: Madara",
  }),
]

const fourCofav = [
  ...threeCofav,
  mem({
    factKey: 'preferences.cofavorite.character.kakashi',
    content: "User's favorite personaggi: Kakashi",
  }),
]

const singularVsPlural = [
  mem({
    factKey: 'preferences.favorite.character',
    title: 'Favorite',
    content: "User's favorite personaggio: Madara",
    importance: 7,
  }),
  ...threeCofav.slice(0, 2),
]

// --- Intent cues ---
{
  assert.equal(detectMemoryQueryIntent('Qual è il mio anime preferito?').subtype, 'favorite')
  assert.equal(detectMemoryQueryIntent('Qual è il mio anime preferito?').subject, 'anime')
  assert.equal(detectMemoryQueryIntent('What is my favorite color?').subject, 'color')
  assert.equal(detectMemoryQueryIntent('Who is my favorite character?').subject, 'character')

  assert.equal(
    detectMemoryQueryIntent('Quali sono i miei personaggi preferiti?').subtype,
    'cofavorite',
  )
  assert.equal(
    detectMemoryQueryIntent('Chi sono i miei personaggi preferiti?').subject,
    'character',
  )
  assert.equal(
    detectMemoryQueryIntent('Who are my favorite characters?').subtype,
    'cofavorite',
  )

  assert.equal(
    detectMemoryQueryIntent('Qual è il mio progetto principale?').subtype,
    'project_primary',
  )
  assert.equal(detectMemoryQueryIntent('Quali sono i miei progetti?').subtype, 'project_list')
  assert.equal(detectMemoryQueryIntent('Quali progetti ho?').subtype, 'project_list')
  assert.equal(detectMemoryQueryIntent('What are my projects?').subtype, 'project_list')

  assert.equal(detectMemoryQueryIntent('Cosa mi piace?').polarity, 'positive')
  assert.equal(detectMemoryQueryIntent('Cosa non mi piace?').subtype, 'dislike')
  assert.equal(detectMemoryQueryIntent('What do I dislike?').polarity, 'negative')
}

// 1) favorite beats like
{
  const ranked = rerankMemoriesForRecall(storeA, 'Qual è il mio anime preferito?')
  assert.equal(ranked[0].factKey, 'preferences.favorite.anime')
  assert.ok(!keys(ranked).includes('preferences.like.dragon_ball') || ranked[0].factKey === 'preferences.favorite.anime')
}

// 2) favorite beats high-recency like
{
  const ranked = rerankMemoriesForRecall(storeA, 'What is my favorite anime?')
  assert.equal(ranked[0].factKey, 'preferences.favorite.anime')
  assert.ok(
    semanticRecallTier(
      storeA.find((r) => r.factKey === 'preferences.favorite.anime'),
      detectMemoryQueryIntent('What is my favorite anime?'),
    ) <
      semanticRecallTier(
        storeA.find((r) => r.factKey === 'preferences.like.dragon_ball'),
        detectMemoryQueryIntent('What is my favorite anime?'),
      ),
  )
}

// 3) cofavorite list beats like
{
  const ranked = rerankMemoriesForRecall(storeA, 'Quali sono i miei personaggi preferiti?')
  assert.deepEqual(keys(ranked).slice(0, 2).sort(), [
    'preferences.cofavorite.character.itachi',
    'preferences.cofavorite.character.sasuke',
  ].sort())
  assert.ok(!keys(ranked).includes('preferences.like.dragon_ball'))
}

// 4) 3 cofavorites all survive (+ selectTopMemories maxPerCategory=3)
{
  const ranked = rerankMemoriesForRecall(threeCofav, 'Quali sono i miei personaggi preferiti?')
  assert.equal(ranked.length, 3)
  assert.deepEqual(keys(ranked).sort(), [
    'preferences.cofavorite.character.itachi',
    'preferences.cofavorite.character.madara',
    'preferences.cofavorite.character.sasuke',
  ])

  const scored = threeCofav.map((row) => ({ row, score: 40 }))
  const cappedDefault = selectTopMemories(scored, 3, 2)
  assert.equal(cappedDefault.length, 2, 'default category cap remains 2')
  const cappedRecall = selectTopMemories(scored, 3, RECALL_MAX_PER_CATEGORY)
  assert.equal(cappedRecall.length, 3, 'Recall-only cap allows 3')
}

// 4b) four cofavorites still max 3
{
  const ranked = rerankMemoriesForRecall(fourCofav, 'Quali sono i miei personaggi preferiti?')
  assert.equal(ranked.length, 3)
  assert.equal(RECALL_MAX_MEMORIES, 3)
}

// 5) singular character → favorite.character
{
  const ranked = rerankMemoriesForRecall(
    singularVsPlural,
    'Qual è il mio personaggio preferito?',
  )
  assert.equal(ranked[0].factKey, 'preferences.favorite.character')
}

// 6) plural character → cofavorites before singular
{
  const ranked = rerankMemoriesForRecall(
    singularVsPlural,
    'Quali sono i miei personaggi preferiti?',
  )
  assert.ok(ranked[0].factKey.startsWith('preferences.cofavorite.character.'))
  assert.ok(ranked[1].factKey.startsWith('preferences.cofavorite.character.'))
  assert.notEqual(ranked[0].factKey, 'preferences.favorite.character')
}

// 7) subject anime vs color vs animal
{
  const store = [
    mem({ factKey: 'preferences.favorite.anime', content: "User's favorite anime: Naruto" }),
    mem({ factKey: 'preferences.favorite.color', content: "User's favorite colore: verde" }),
    mem({ factKey: 'preferences.favorite.animal', content: "User's favorite animale: lupo" }),
  ]
  assert.equal(
    rerankMemoriesForRecall(store, 'Qual è il mio anime preferito?')[0].factKey,
    'preferences.favorite.anime',
  )
  assert.equal(
    rerankMemoriesForRecall(store, 'Qual è il mio colore preferito?')[0].factKey,
    'preferences.favorite.color',
  )
  assert.equal(
    rerankMemoriesForRecall(store, 'Qual è il mio animale preferito?')[0].factKey,
    'preferences.favorite.animal',
  )
}

// 8) project primary wins over recent high-importance generic
{
  const ranked = rerankMemoriesForRecall(storeB, 'Qual è il mio progetto principale?')
  assert.equal(ranked[0].factKey, 'projects.primary')
}

// 9 + 10) Italian progetti + English projects — not empty
{
  for (const q of [
    'Quali sono i miei progetti?',
    'Quali progetti ho?',
    'What are my projects?',
  ]) {
    const ranked = rerankMemoriesForRecall(storeB, q)
    assert.ok(ranked.length >= 2, `expected project rows for: ${q}`)
    assert.ok(ranked.every((r) => String(r.factKey).startsWith('projects.')))
  }
}

// 11) broad positive preferences
{
  const withDislike = [
    ...storeA,
    mem({ factKey: 'preferences.dislike.bleach', content: 'User dislikes: Bleach' }),
  ]
  const ranked = rerankMemoriesForRecall(withDislike, 'Cosa mi piace?')
  assert.ok(!keys(ranked).includes('preferences.dislike.bleach'))
  assert.ok(ranked.length >= 1)
}

// 12) negative dislike query
{
  const withDislike = [
    mem({ factKey: 'preferences.like.naruto', content: 'User likes / prefers: Naruto' }),
    mem({ factKey: 'preferences.dislike.bleach', content: 'User dislikes: Bleach' }),
  ]
  const ranked = rerankMemoriesForRecall(withDislike, 'Cosa non mi piace?')
  assert.equal(ranked[0].factKey, 'preferences.dislike.bleach')
}

// 13) legacy fallback (no fact_key)
{
  const legacy = [
    mem({
      factKey: null,
      tags: [],
      title: 'Favorite',
      content: "User's favorite anime: Naruto",
      category: 'preferences',
    }),
    mem({
      factKey: 'preferences.like.dragon_ball',
      content: 'User likes / prefers: Dragon Ball',
    }),
  ]
  const ranked = rerankMemoriesForRecall(legacy, 'Qual è il mio anime preferito?')
  assert.equal(ranked[0].content, "User's favorite anime: Naruto")
}

// 14) EN characters vs IT content surface — fact_key bridges language
{
  const ranked = rerankMemoriesForRecall(storeA, 'Who are my favorite characters?')
  assert.deepEqual(keys(ranked).slice(0, 2).sort(), [
    'preferences.cofavorite.character.itachi',
    'preferences.cofavorite.character.sasuke',
  ].sort())
}

// 15) provenance empty behavior
{
  const pack = await loadCoreMemoryPack({
    userMessage: 'Qual è il mio anime preferito?',
    ownerUserId: 'user-a',
    memoryEnabled: true,
    searchMemories: async () => [],
  })
  assert.match(pack, /DURABLE MEMORY RESULT/)
  assert.equal(isPersonalMemoryProbe('Qual è il mio anime preferito?'), true)
  void formatEmptyDurableMemorySignal
}

// 16) loadCoreMemoryPack applies rerank + candidate options
{
  let seen = null
  const pack = await loadCoreMemoryPack({
    userMessage: 'Quali sono i miei personaggi preferiti?',
    ownerUserId: 'user-a',
    memoryEnabled: true,
    searchMemories: async (_q, options) => {
      seen = options
      // Simulate polluted candidate pool (like first)
      return [
        mem({
          factKey: 'preferences.like.dragon_ball',
          content: 'User likes / prefers: Dragon Ball',
        }),
        ...threeCofav,
      ]
    },
  })
  assert.equal(seen.limit, RECALL_CANDIDATE_LIMIT)
  assert.equal(seen.maxPerCategory, RECALL_MAX_PER_CATEGORY)
  assert.equal(seen.requireExplicitUserId, true)
  const lines = packContents(pack)
  assert.match(lines, /Itachi/)
  assert.match(lines, /Sasuke/)
  assert.match(lines, /Madara/)
  assert.doesNotMatch(lines, /Dragon Ball/)
  assert.doesNotMatch(pack, /fact_key/)
}

// 16b) favorite vs like through loadCoreMemoryPack
{
  const pack = await loadCoreMemoryPack({
    userMessage: 'Qual è il mio anime preferito?',
    ownerUserId: 'user-a',
    searchMemories: async () => storeA,
  })
  const lines = packContents(pack)
  assert.match(lines, /Naruto/)
  const firstFact = lines.split('\n')[0]
  assert.match(firstFact, /Naruto/)
}

// 17) pack limits unchanged
{
  assert.equal(RECALL_MAX_MEMORIES, 3)
  assert.equal(RECALL_MAX_PACK_CHARS, 600)
  assert.equal(RECALL_CANDIDATE_LIMIT, 6)
  assert.equal(RECALL_MAX_PER_CATEGORY, 3)
  const pack = formatCoreMemoryPack(threeCofav)
  assert.match(pack, /Itachi/)
  assert.match(pack, /Sasuke/)
  assert.match(pack, /Madara/)
  assert.equal(packContents(pack).split('\n').filter(Boolean).length, 3)
}

// 18) Overview / Forget / Extraction source contracts unchanged
{
  const overview = readFileSync(join(root, 'lib/server/memory-control-overview.js'), 'utf8')
  assert.doesNotMatch(overview, /rerankMemoriesForRecall/)
  assert.doesNotMatch(overview, /detectMemoryQueryIntent/)

  const forget = readFileSync(join(root, 'lib/server/memory-control-forget.js'), 'utf8')
  assert.match(forget, /scoreForgetCandidates/)
  assert.match(forget, /scoreMemoryRelevance/)
  assert.doesNotMatch(forget, /rerankMemoriesForRecall/)
  assert.doesNotMatch(forget, /maxPerCategory/)

  const brain = readFileSync(join(root, 'lib/server/brain-memory.js'), 'utf8')
  assert.match(brain, /const MAX_PER_CATEGORY = 2/)
  assert.match(brain, /progetti/)
  assert.match(brain, /options\.maxPerCategory/)

  const chat = readFileSync(join(root, 'api/chat.ts'), 'utf8')
  assert.match(chat, /loadCoreMemoryPack/)
  assert.match(chat, /responses\.create/)
  assert.match(chat, /buildCoreResponsesCreateParams/)

  const params = readFileSync(join(root, 'lib/server/core-responses-params.js'), 'utf8')
  assert.match(params, /gpt-5\.6-sol|GPT|model/i)
}

// 19) Memory OFF unchanged
{
  const pack = await loadCoreMemoryPack({
    userMessage: 'Qual è il mio anime preferito?',
    ownerUserId: 'user-a',
    memoryEnabled: false,
    searchMemories: async () => storeA,
  })
  assert.equal(pack, '')
}

// 20) Ti ricordi primary project
{
  const ranked = rerankMemoriesForRecall(
    storeB,
    'Ti ricordi qual è il mio progetto principale?',
  )
  assert.equal(ranked[0].factKey, 'projects.primary')
}

console.log('memory-recall-semantics.test.mjs: PASS')
