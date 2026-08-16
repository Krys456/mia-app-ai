/**
 * Memory 2.1 PR3 — favorites coverage + co-favorites.
 * Run: node lib/server/memory-favorites-cofavorite.test.mjs
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildCofavoriteFactKey,
  collapseItemsBySingleValuedFactKey,
  extractDurableFacts,
  isFavoritePreferenceQuestion,
  isInterrogativeFavoriteValue,
  isSingleValuedFactKey,
  normalizeFavoriteSubjectKey,
  readFactKeyFromTags,
  runMemoryPipeline,
  scoreMemoryRelevance,
  splitFavoriteList,
  upsertMemory,
} from './brain-memory.js'
import {
  formatCoreMemoryPack,
  isPersonalMemoryProbe,
  isRecallEligibleMemory,
  loadCoreMemoryPack,
  RECALL_MAX_MEMORIES,
} from './core-memory-recall.js'
import { tryHandleSpecificForget } from './memory-control-forget.js'
import {
  dedupeOverviewByFactKey,
  dedupeOverviewSemantically,
  formatMemoryOverviewPack,
  selectOverviewMemories,
} from './memory-control-overview.js'
import { buildCoreResponsesCreateParams } from './core-responses-params.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const MEMORY_SELECT =
  'id, category, title, content, importance, usage_count, last_used_at, created_at, updated_at, status, tags'
const COLOR_KEY = 'preferences.favorite.color'
const CHAR_KEY = 'preferences.favorite.character'
const ANIME_KEY = 'preferences.favorite.anime'

function seedRow(partial) {
  return {
    id: partial.id,
    user_id: partial.userId || partial.user_id,
    category: partial.category || 'preferences',
    title: partial.title || 'Favorite',
    content: partial.content,
    importance: partial.importance ?? 6,
    usage_count: 0,
    last_used_at: null,
    created_at: partial.createdAt || '2026-01-01T00:00:00.000Z',
    updated_at: partial.updatedAt || partial.updated_at || '2026-01-01T00:00:00.000Z',
    status: partial.status || 'active',
    tags: Array.isArray(partial.tags) ? [...partial.tags] : [],
    source: partial.source || 'automatic',
    confidence: partial.confidence ?? 0.8,
  }
}

function createFakeSupabase(initialRows = []) {
  const rows = initialRows.map((r) => ({ ...r, tags: [...(r.tags || [])] }))
  let seq = rows.length + 1

  function matchesFilter(row, filter) {
    if (filter.type === 'eq') return String(row[filter.column]) === String(filter.value)
    if (filter.type === 'neq') return String(row[filter.column] || '') !== String(filter.value)
    if (filter.type === 'in') {
      return (filter.values || []).map(String).includes(String(row[filter.column]))
    }
    if (filter.type === 'contains') {
      const tags = Array.isArray(row.tags) ? row.tags.map(String) : []
      const need = Array.isArray(filter.value) ? filter.value.map(String) : []
      return need.every((t) => tags.includes(t))
    }
    return true
  }

  function project(row, selectCols) {
    if (!selectCols || selectCols === '*' || selectCols === MEMORY_SELECT) {
      const out = {}
      for (const key of MEMORY_SELECT.split(',').map((c) => c.trim())) out[key] = row[key]
      return out
    }
    const out = {}
    for (const col of String(selectCols)
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean)) {
      out[col] = row[col]
    }
    return out
  }

  function createBuilder(table) {
    assert.equal(table, 'memories')
    const state = {
      filters: [],
      selectCols: MEMORY_SELECT,
      orderCol: null,
      ascending: false,
      limitN: null,
      single: false,
      patch: null,
      insertRow: null,
      mode: 'select',
    }

    const api = {
      select(cols) {
        state.selectCols = cols
        return api
      },
      insert(row) {
        state.mode = 'insert'
        state.insertRow = row
        return api
      },
      update(patch) {
        state.mode = 'update'
        state.patch = patch
        return api
      },
      eq(column, value) {
        state.filters.push({ type: 'eq', column, value })
        return api
      },
      neq(column, value) {
        state.filters.push({ type: 'neq', column, value })
        return api
      },
      in(column, values) {
        state.filters.push({ type: 'in', column, values })
        return api
      },
      contains(column, value) {
        state.filters.push({ type: 'contains', column, value })
        return api
      },
      order(column, opts = {}) {
        state.orderCol = column
        state.ascending = Boolean(opts.ascending)
        return api
      },
      limit(n) {
        state.limitN = n
        return api
      },
      single() {
        state.single = true
        return api.thenable()
      },
      thenable() {
        return Promise.resolve().then(() => execute(state))
      },
    }
    api.then = (resolve, reject) => api.thenable().then(resolve, reject)
    return api
  }

  function execute(state) {
    if (state.mode === 'insert') {
      const row = {
        id: `m${seq++}`,
        usage_count: 0,
        last_used_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        ...state.insertRow,
        tags: Array.isArray(state.insertRow.tags) ? [...state.insertRow.tags] : [],
      }
      rows.push(row)
      const projected = project(row, state.selectCols)
      return state.single ? { data: projected, error: null } : { data: [projected], error: null }
    }

    let matched = rows.filter((row) => state.filters.every((f) => matchesFilter(row, f)))
    if (state.orderCol) {
      matched = [...matched].sort((a, b) => {
        const av = a[state.orderCol]
        const bv = b[state.orderCol]
        if (av === bv) return 0
        return state.ascending ? (av < bv ? -1 : 1) : av < bv ? 1 : -1
      })
    }
    if (typeof state.limitN === 'number') matched = matched.slice(0, state.limitN)

    if (state.mode === 'update') {
      const updated = []
      for (const row of matched) {
        Object.assign(row, state.patch)
        updated.push(project(row, state.selectCols))
      }
      if (state.single) {
        return updated.length
          ? { data: updated[0], error: null }
          : { data: null, error: { message: 'No rows updated' } }
      }
      return { data: updated, error: null }
    }

    const projected = matched.map((row) => project(row, state.selectCols))
    if (state.single) {
      return projected.length
        ? { data: projected[0], error: null }
        : { data: null, error: { message: 'not found' } }
    }
    return { data: projected, error: null }
  }

  return {
    rows,
    from(table) {
      return createBuilder(table)
    },
    activeKeyed(userId, factKey) {
      return rows.filter(
        (r) =>
          r.user_id === userId &&
          String(r.status || 'active').toLowerCase() === 'active' &&
          readFactKeyFromTags(r.tags) === factKey,
      )
    },
  }
}

async function writeMessage(db, userId, message) {
  const facts = collapseItemsBySingleValuedFactKey(extractDurableFacts(message))
  const results = []
  for (const fact of facts) {
    results.push(
      await upsertMemory(
        {
          ...fact,
          userId,
          requireExplicitUserId: true,
          userMessage: message,
        },
        { supabase: db },
      ),
    )
  }
  return { facts, results }
}

function activeCofavorites(db, userId, subject) {
  const prefix = `preferences.cofavorite.${normalizeFavoriteSubjectKey(subject)}.`
  return db.rows.filter(
    (r) =>
      r.user_id === userId &&
      r.status === 'active' &&
      String(readFactKeyFromTags(r.tags) || '').startsWith(prefix),
  )
}

// —— Normalization ——
{
  assert.equal(normalizeFavoriteSubjectKey('personaggio'), 'character')
  assert.equal(normalizeFavoriteSubjectKey('personaggi'), 'character')
  assert.equal(normalizeFavoriteSubjectKey('characters'), 'character')
  assert.equal(normalizeFavoriteSubjectKey('colori'), 'color')
  assert.equal(normalizeFavoriteSubjectKey('anime'), 'anime')
  assert.equal(isSingleValuedFactKey(CHAR_KEY), true)
  assert.equal(isSingleValuedFactKey(buildCofavoriteFactKey('character', 'Itachi')), false)
  assert.deepEqual(splitFavoriteList('Naruto, Dragon Ball e One Piece'), [
    'Naruto',
    'Dragon Ball',
    'One Piece',
  ])
}

// TEST 1 — singular character IT → favorite.character
{
  const facts = extractDurableFacts('Il mio personaggio preferito è Itachi.')
  assert.equal(facts.length, 1)
  assert.equal(facts[0].factKey, CHAR_KEY)
  assert.equal(isSingleValuedFactKey(facts[0].factKey), true)
  assert.match(facts[0].content, /Itachi/i)
}

// EN singular character same slot
{
  const facts = extractDurableFacts('My favorite character is Itachi.')
  assert.equal(facts[0].factKey, CHAR_KEY)
}

// TEST 2 — plural characters → two cofavorites
{
  const facts = extractDurableFacts('I miei personaggi preferiti sono Itachi e Sasuke.')
  assert.equal(facts.length, 2)
  const keys = facts.map((f) => f.factKey).sort()
  assert.deepEqual(keys, [
    'preferences.cofavorite.character.itachi',
    'preferences.cofavorite.character.sasuke',
  ])
  assert.ok(facts.every((f) => !isSingleValuedFactKey(f.factKey)))
}

// TEST 7 — reversed singular anime
{
  const facts = extractDurableFacts('Naruto è il mio anime preferito.')
  assert.equal(facts[0].factKey, ANIME_KEY)
  assert.match(facts[0].content, /Naruto/i)
}

// TEST 8 — partitive anime → cofavorite
{
  const facts = extractDurableFacts('Uno dei miei anime preferiti è Naruto.')
  assert.equal(facts.length, 1)
  assert.equal(facts[0].factKey, 'preferences.cofavorite.anime.naruto')
}

// TEST 9 — EN partitive bug fixed
{
  const facts = extractDurableFacts('One of my favorite characters is Itachi.')
  assert.equal(facts.length, 1)
  assert.equal(facts[0].factKey, 'preferences.cofavorite.character.itachi')
  assert.equal(facts.filter((f) => f.factKey === 'preferences.favorite.characters').length, 0)
  assert.equal(facts.filter((f) => String(f.factKey || '').startsWith('preferences.favorite.')).length, 0)
}

// TEST 10 / 11 — like / interest distinct
{
  assert.equal(extractDurableFacts('Mi piace Naruto.')[0].factKey, 'preferences.like.naruto')
  assert.equal(extractDurableFacts('Adoro Naruto.')[0].factKey, 'preferences.interest.naruto')
}

// TEST 17 / 18 — reversed plural IT/EN
{
  const it = extractDurableFacts('Itachi e Sasuke sono i miei personaggi preferiti.')
  assert.equal(it.length, 2)
  const en = extractDurableFacts('Itachi and Sasuke are my favorite characters.')
  assert.equal(en.length, 2)
}

// TEST 6 — anime plural
{
  const facts = extractDurableFacts('I miei anime preferiti sono Naruto e Dragon Ball.')
  assert.equal(facts.length, 2)
  assert.ok(facts.some((f) => f.factKey === 'preferences.cofavorite.anime.naruto'))
  assert.ok(facts.some((f) => f.factKey === 'preferences.cofavorite.anime.dragon_ball'))
}

// TEST 13 — plural colors
{
  const facts = extractDurableFacts('I miei colori preferiti sono verde e viola.')
  assert.equal(facts.length, 2)
  assert.ok(facts.some((f) => f.factKey === 'preferences.cofavorite.color.verde'))
  assert.ok(facts.some((f) => f.factKey === 'preferences.cofavorite.color.viola'))
}

// TEST 19 / 20 — negation must not assert positive favorites
// (#256 may emit structured revoke candidates; those are not positive writes.)
{
  for (const msg of [
    'Naruto non è il mio anime preferito.',
    'Itachi non è uno dei miei personaggi preferiti.',
    'I miei personaggi preferiti non sono Itachi e Sasuke.',
    'Naruto is not my favorite anime.',
    'Itachi is not one of my favorite characters.',
  ]) {
    const facts = extractDurableFacts(msg)
    assert.equal(
      facts.filter(
        (f) =>
          String(f.factKey || '').includes('favorite') &&
          String(f.operation || '').toLowerCase() !== 'revoke',
      ).length,
      0,
      msg,
    )
  }
}

// TEST 12 — color singular replacement
{
  const db = createFakeSupabase()
  await writeMessage(db, 'user-a', 'Il mio colore preferito è verde.')
  await writeMessage(db, 'user-a', 'Il mio colore preferito è viola.')
  assert.equal(db.activeKeyed('user-a', COLOR_KEY).length, 1)
  assert.match(db.activeKeyed('user-a', COLOR_KEY)[0].content, /viola/i)
}

// TEST 2+14 — persist plural + idempotent
{
  const db = createFakeSupabase()
  await writeMessage(db, 'user-a', 'I miei personaggi preferiti sono Itachi e Sasuke.')
  assert.equal(activeCofavorites(db, 'user-a', 'character').length, 2)
  await writeMessage(db, 'user-a', 'I miei personaggi preferiti sono Itachi e Sasuke.')
  assert.equal(activeCofavorites(db, 'user-a', 'character').length, 2)
}

// TEST 15 — singular → plural migrates singular when value in list
{
  const db = createFakeSupabase()
  await writeMessage(db, 'user-a', 'Il mio personaggio preferito è Itachi.')
  assert.equal(db.activeKeyed('user-a', CHAR_KEY).length, 1)
  await writeMessage(db, 'user-a', 'I miei personaggi preferiti sono Itachi e Sasuke.')
  assert.equal(db.activeKeyed('user-a', CHAR_KEY).length, 0)
  assert.equal(activeCofavorites(db, 'user-a', 'character').length, 2)
}

// TEST 16 — plural → singular keeps cofavorites
{
  const db = createFakeSupabase()
  await writeMessage(db, 'user-a', 'I miei personaggi preferiti sono Itachi e Sasuke.')
  await writeMessage(db, 'user-a', 'Il mio personaggio preferito è Madara.')
  assert.equal(db.activeKeyed('user-a', CHAR_KEY).length, 1)
  assert.match(db.activeKeyed('user-a', CHAR_KEY)[0].content, /Madara/i)
  assert.equal(activeCofavorites(db, 'user-a', 'character').length, 2)
}

// TEST 4 / 23 — Specific Forget unique name
{
  const db = createFakeSupabase()
  await writeMessage(db, 'user-a', 'I miei personaggi preferiti sono Itachi e Sasuke.')
  const result = await tryHandleSpecificForget({
    userMessage: 'Dimentica Sasuke.',
    userId: 'user-a',
    supabase: db,
  })
  assert.equal(result.status, 'forgotten')
  const itachi = activeCofavorites(db, 'user-a', 'character').find((r) => /itachi/i.test(r.content))
  const sasuke = db.rows.find((r) => /sasuke/i.test(r.content))
  assert.ok(itachi)
  assert.equal(itachi.status, 'active')
  assert.equal(sasuke.status, 'obsolete')
  assert.equal(isRecallEligibleMemory({ ...sasuke, status: 'obsolete' }), false)
}

// TEST 21 — user isolation
{
  const db = createFakeSupabase()
  await writeMessage(db, 'user-a', 'I miei personaggi preferiti sono Itachi e Sasuke.')
  await writeMessage(db, 'user-b', 'I miei personaggi preferiti sono Madara e Obito.')
  assert.equal(activeCofavorites(db, 'user-a', 'character').length, 2)
  assert.equal(activeCofavorites(db, 'user-b', 'character').length, 2)
  assert.ok(activeCofavorites(db, 'user-a', 'character').every((r) => /Itachi|Sasuke/i.test(r.content)))
}

// TEST 3 / 5 — Recall clean-store compatibility (no ranking redesign)
{
  assert.equal(isPersonalMemoryProbe('Quali sono i miei personaggi preferiti?'), true)
  assert.equal(RECALL_MAX_MEMORIES, 3)
  const rows = [
    {
      id: 'i',
      category: 'preferences',
      title: 'Co-favorite',
      content: "User's favorite character: Itachi",
      tags: ['fact_key:preferences.cofavorite.character.itachi'],
      importance: 6,
      status: 'active',
    },
    {
      id: 's',
      category: 'preferences',
      title: 'Co-favorite',
      content: "User's favorite character: Sasuke",
      tags: ['fact_key:preferences.cofavorite.character.sasuke'],
      importance: 6,
      status: 'active',
    },
  ]
  const scored = rows
    .map((r) => ({ id: r.id, ...scoreMemoryRelevance(r, 'Quali sono i miei personaggi preferiti?') }))
    .filter((s) => s.matched)
    .sort((a, b) => b.score - a.score)
  assert.ok(scored.some((s) => s.id === 'i'))
  assert.ok(scored.some((s) => s.id === 's'))
  assert.ok(scored.length >= 2)

  const pack = await loadCoreMemoryPack({
    userMessage: 'Quali sono i miei personaggi preferiti?',
    ownerUserId: 'user-a',
    memoryEnabled: true,
    searchMemories: async () => rows,
  })
  assert.match(pack, /Itachi/)
  assert.match(pack, /Sasuke/)
  assert.doesNotMatch(pack, /fact_key:preferences/)
}

// TEST 22 — Overview both cofavorites
{
  const overviewRows = [
    seedRow({
      id: 'i',
      userId: 'user-a',
      title: 'Co-favorite',
      content: "User's favorite character: Itachi",
      tags: ['fact_key:preferences.cofavorite.character.itachi'],
      updatedAt: '2026-01-04T00:00:00.000Z',
    }),
    seedRow({
      id: 's',
      userId: 'user-a',
      title: 'Co-favorite',
      content: "User's favorite character: Sasuke",
      tags: ['fact_key:preferences.cofavorite.character.sasuke'],
      updatedAt: '2026-01-03T00:00:00.000Z',
    }),
  ].map((r) => ({
    ...r,
    id: r.id,
    category: 'preferences',
    content: r.content,
    tags: r.tags,
    status: 'active',
    importance: 6,
    updatedAt: r.updated_at,
  }))
  const keyed = dedupeOverviewByFactKey(overviewRows)
  assert.equal(keyed.length, 2)
  const sem = dedupeOverviewSemantically(keyed)
  assert.equal(sem.length, 2)
  const selected = selectOverviewMemories(overviewRows)
  assert.ok(selected.some((r) => /Itachi/i.test(r.content)))
  assert.ok(selected.some((r) => /Sasuke/i.test(r.content)))
  const pack = formatMemoryOverviewPack(selected)
  assert.match(pack, /Itachi/)
  assert.match(pack, /Sasuke/)
  assert.doesNotMatch(pack, /preferences\.cofavorite/)
}

// TEST 27 — Memory OFF blocks write
{
  const result = await runMemoryPipeline({
    userMessage: 'I miei personaggi preferiti sono Itachi e Sasuke.',
    assistantMessage: 'ok',
    userId: 'user-a',
    requireExplicitUserId: true,
    memoryEnabled: false,
  })
  assert.equal(result.skipped, true)
  assert.equal(result.reason, 'memory_disabled')
  assert.equal(result.saved, false)
}

// TEST 26 / 28 — primary project + one responses.create unchanged
{
  const primary = extractDurableFacts('Il mio progetto principale è LAIfe.')
  assert.ok(primary.some((f) => f.factKey === 'projects.primary'))
  const params = buildCoreResponsesCreateParams({
    model: 'gpt-5.6-sol',
    instructions: 'x',
    input: [],
  })
  assert.ok(params)
  const brain = readFileSync(join(root, 'lib/server/brain-memory.js'), 'utf8')
  assert.match(brain, /preferences\.cofavorite/)
  const singleFn = brain.match(
    /export function isSingleValuedFactKey\(factKey\) \{[\s\S]*?\n\}/,
  )?.[0]
  assert.ok(singleFn)
  assert.match(singleFn, /preferences\.favorite\./)
  assert.doesNotMatch(singleFn, /cofavorite/)
}

// TEST 25 — provenance label still present in recall module
{
  const recall = readFileSync(join(root, 'lib/server/core-memory-recall.js'), 'utf8')
  assert.match(recall, /DURABLE LAIFE MEMORY 2\.0/)
  assert.match(recall, /RECALL_MAX_MEMORIES\s*=\s*3/)
}

// —— Interrogative write guard (Preview regression) ——
{
  const probes = [
    'Quali sono i miei personaggi preferiti?',
    'Chi sono i miei personaggi preferiti?',
    'Quali sono i miei anime preferiti?',
    'Quali sono i miei colori preferiti?',
    'Qual è il mio anime preferito?',
    'Chi è il mio personaggio preferito?',
    'What are my favorite characters?',
    'Who are my favorite characters?',
    'What is my favorite anime?',
    'Who is my favorite character?',
  ]
  for (const msg of probes) {
    assert.equal(isFavoritePreferenceQuestion(msg), true, `question: ${msg}`)
    const facts = extractDurableFacts(msg)
    assert.equal(
      facts.filter((f) => String(f.factKey || '').includes('favorite')).length,
      0,
      `no favorite/cofavorite from: ${msg}`,
    )
    assert.equal(
      facts.filter((f) => /quali|chi|what|who/i.test(String(f.factKey || ''))).length,
      0,
      msg,
    )
  }

  assert.equal(isInterrogativeFavoriteValue('Quali'), true)
  assert.equal(isInterrogativeFavoriteValue('Chi'), true)
  assert.equal(isInterrogativeFavoriteValue('What'), true)
  assert.equal(isInterrogativeFavoriteValue('Itachi'), false)

  // Probe coverage extension
  assert.equal(isPersonalMemoryProbe('Chi sono i miei personaggi preferiti?'), true)
  assert.equal(isPersonalMemoryProbe('Chi è il mio personaggio preferito?'), true)
  assert.equal(isPersonalMemoryProbe('Who are my favorite characters?'), true)
  assert.equal(isPersonalMemoryProbe('Who is my favorite character?'), true)

  // Declarations must remain questions=false
  for (const msg of [
    'Itachi è il mio personaggio preferito.',
    'Itachi e Sasuke sono i miei personaggi preferiti.',
    'I miei personaggi preferiti sono Itachi e Sasuke.',
    'Itachi is my favorite character.',
    'Itachi and Sasuke are my favorite characters.',
  ]) {
    assert.equal(isFavoritePreferenceQuestion(msg), false, msg)
    assert.ok(extractDurableFacts(msg).length >= 1, msg)
  }
}

// Canonical slot must not mutate from a question
{
  const db = createFakeSupabase()
  await writeMessage(db, 'user-a', 'Naruto è il mio anime preferito.')
  assert.equal(db.activeKeyed('user-a', ANIME_KEY).length, 1)
  assert.match(db.activeKeyed('user-a', ANIME_KEY)[0].content, /Naruto/i)

  await writeMessage(db, 'user-a', 'Qual è il mio anime preferito?')
  assert.equal(db.activeKeyed('user-a', ANIME_KEY).length, 1)
  assert.match(db.activeKeyed('user-a', ANIME_KEY)[0].content, /Naruto/i)
  assert.equal(db.rows.filter((r) => /qual/i.test(r.content) && !/Naruto/i.test(r.content)).length, 0)

  await writeMessage(db, 'user-a', 'What is my favorite anime?')
  assert.match(db.activeKeyed('user-a', ANIME_KEY)[0].content, /Naruto/i)
}

// Cofavorites must not gain Quali/Chi from probes
{
  const db = createFakeSupabase()
  await writeMessage(db, 'user-a', 'I miei personaggi preferiti sono Itachi e Sasuke.')
  assert.equal(activeCofavorites(db, 'user-a', 'character').length, 2)
  await writeMessage(db, 'user-a', 'Quali sono i miei personaggi preferiti?')
  await writeMessage(db, 'user-a', 'Chi sono i miei personaggi preferiti?')
  const active = activeCofavorites(db, 'user-a', 'character')
  assert.equal(active.length, 2)
  assert.ok(active.every((r) => /Itachi|Sasuke/i.test(r.content)))
  assert.equal(
    db.rows.filter((r) => /cofavorite\.character\.(quali|chi)\b/.test(readFactKeyFromTags(r.tags) || ''))
      .length,
    0,
  )
}

// chat.ts skips Extraction for personal probes (defense in depth)
{
  const chatSrc = readFileSync(join(root, 'api/chat.ts'), 'utf8')
  assert.match(chatSrc, /isPersonalMemoryProbe/)
  assert.match(chatSrc, /skipExtractionForInspection/)
}

console.log('memory-favorites-cofavorite.test.mjs: PASS')
