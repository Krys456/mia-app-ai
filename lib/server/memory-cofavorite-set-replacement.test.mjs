/**
 * Memory 2.1 PR #257 — high-confidence cofavorite set replacement.
 * Run: node --test lib/server/memory-cofavorite-set-replacement.test.mjs
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildCofavoriteFactKey,
  cleanCofavoriteReplaceSetValue,
  encodeFactKeyTag,
  extractCofavoriteReplaceSetCandidate,
  extractDurableFacts,
  hasIncompatibleMixedFavoriteOps,
  readFactKeyFromTags,
  runMemoryPipeline,
  shouldSkipFavoriteSetReplacement,
  stripCofavoriteReplacementCueTokens,
} from './brain-memory.js'
import {
  isRecallEligibleMemory,
  rerankMemoriesForRecall,
} from './core-memory-recall.js'
import { tryHandleSpecificForget } from './memory-control-forget.js'
import {
  isOverviewEligibleMemory,
  selectOverviewMemories,
} from './memory-control-overview.js'
import { buildCoreResponsesCreateParams } from './core-responses-params.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const MEMORY_SELECT =
  'id, category, title, content, importance, usage_count, last_used_at, created_at, updated_at, status, tags'

function seedRow(partial) {
  const factKey = partial.factKey || null
  const tags = Array.isArray(partial.tags)
    ? [...partial.tags]
    : factKey
      ? [encodeFactKeyTag(factKey)].filter(Boolean)
      : []
  return {
    id: partial.id,
    user_id: partial.userId || partial.user_id || 'user-a',
    category: partial.category || 'preferences',
    title: partial.title || 'Co-favorite',
    content: partial.content,
    importance: partial.importance ?? 6,
    usage_count: 0,
    last_used_at: null,
    created_at: partial.createdAt || '2026-01-01T00:00:00.000Z',
    updated_at: partial.updatedAt || '2026-01-01T00:00:00.000Z',
    status: partial.status || 'active',
    tags,
    source: 'automatic',
    confidence: 0.8,
  }
}

/**
 * @param {any[]} initialRows
 * @param {{
 *   failInsertFactKeys?: string[],
 *   failObsoleteIds?: string[],
 *   failAllObsolete?: boolean,
 * }} [hooks]
 */
function createFakeSupabase(initialRows = [], hooks = {}) {
  const rows = initialRows.map((r) => ({ ...r, tags: [...(r.tags || [])] }))
  let seq = rows.length + 1
  const failInsertFactKeys = new Set(hooks.failInsertFactKeys || [])
  const failObsoleteIds = new Set(hooks.failObsoleteIds || [])

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

  function project(row) {
    const out = {}
    for (const key of MEMORY_SELECT.split(',').map((c) => c.trim())) out[key] = row[key]
    return out
  }

  function createBuilder(table) {
    assert.equal(table, 'memories')
    const state = {
      filters: [],
      orderCol: null,
      ascending: false,
      limitN: null,
      single: false,
      patch: null,
      insertRow: null,
      mode: 'select',
    }
    const api = {
      select() {
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
      then(resolve, reject) {
        return api.thenable().then(resolve, reject)
      },
    }
    return api
  }

  function execute(state) {
    let matched = rows.filter((row) => state.filters.every((f) => matchesFilter(row, f)))
    if (state.orderCol) {
      matched = [...matched].sort((a, b) => {
        const av = a[state.orderCol]
        const bv = b[state.orderCol]
        if (av === bv) return 0
        if (av == null) return 1
        if (bv == null) return -1
        return state.ascending ? (av > bv ? 1 : -1) : av > bv ? -1 : 1
      })
    }
    if (state.limitN != null) matched = matched.slice(0, state.limitN)

    if (state.mode === 'insert') {
      const insertKey = readFactKeyFromTags(state.insertRow?.tags)
      if (insertKey && failInsertFactKeys.has(insertKey)) {
        return { data: null, error: { message: `simulated insert failure for ${insertKey}` } }
      }
      const row = {
        id: `row-${seq++}`,
        usage_count: 0,
        last_used_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        status: 'active',
        ...state.insertRow,
      }
      rows.push(row)
      const data = project(row)
      return state.single ? { data, error: null } : { data: [data], error: null }
    }

    if (state.mode === 'update') {
      if (state.patch && state.patch.status === 'obsolete') {
        if (hooks.failAllObsolete) {
          return { data: null, error: { message: 'simulated obsolete failure' } }
        }
        const idFilter = state.filters.find((f) => f.type === 'eq' && f.column === 'id')
        if (idFilter && failObsoleteIds.has(String(idFilter.value))) {
          return { data: null, error: { message: `simulated obsolete failure for ${idFilter.value}` } }
        }
      }
      const updated = []
      for (const row of matched) {
        Object.assign(row, state.patch)
        updated.push(project(row))
      }
      if (state.single) {
        return { data: updated[0] || null, error: updated[0] ? null : { message: 'not found' } }
      }
      return { data: updated, error: null }
    }

    const data = matched.map((r) => project(r))
    if (state.single) {
      return { data: data[0] || null, error: data[0] ? null : { message: 'not found' } }
    }
    return { data, error: null }
  }

  return {
    rows,
    from(table) {
      return createBuilder(table)
    },
  }
}

function activeKeys(rows, userId = 'user-a') {
  return rows
    .filter((r) => r.user_id === userId && String(r.status) === 'active')
    .map((r) => readFactKeyFromTags(r.tags) || r.id)
    .sort()
}

function obsoleteKeys(rows, userId = 'user-a') {
  return rows
    .filter((r) => r.user_id === userId && String(r.status) === 'obsolete')
    .map((r) => readFactKeyFromTags(r.tags) || r.id)
    .sort()
}

function characterTrio(userId = 'user-a') {
  return [
    seedRow({
      id: `${userId}-itachi`,
      userId,
      factKey: 'preferences.cofavorite.character.itachi',
      content: "User's favorite character: Itachi.",
    }),
    seedRow({
      id: `${userId}-sasuke`,
      userId,
      factKey: 'preferences.cofavorite.character.sasuke',
      content: "User's favorite character: Sasuke.",
    }),
    seedRow({
      id: `${userId}-madara`,
      userId,
      factKey: 'preferences.cofavorite.character.madara',
      content: "User's favorite character: Madara.",
    }),
  ]
}

async function pipeline(supabase, userMessage, userId = 'user-a', memoryEnabled = true) {
  return runMemoryPipeline({
    userMessage,
    assistantMessage: 'ok',
    userId,
    requireExplicitUserId: true,
    memoryEnabled,
    supabase,
  })
}

function assertReplaceExtraction(message, expectedValues) {
  const cand = extractCofavoriteReplaceSetCandidate(message)
  assert.ok(cand && !cand.overflow, message)
  assert.deepEqual(cand.values, expectedValues)
  const facts = extractDurableFacts(message)
  const rs = facts.filter((f) => f.operation === 'replace_set')
  assert.equal(rs.length, 1, message)
  assert.deepEqual(rs[0].values, expectedValues)
  assert.ok(!facts.some((f) => f.operation !== 'replace_set' && /cofavorite/.test(f.factKey || '')))
}

// --- Cue stripping unit ---
{
  assert.equal(stripCofavoriteReplacementCueTokens('solo Itachi e Kakashi'), 'Itachi e Kakashi')
  assert.equal(stripCofavoriteReplacementCueTokens('now Itachi and Kakashi'), 'Itachi and Kakashi')
  assert.equal(cleanCofavoriteReplaceSetValue('solo Itachi'), 'Itachi')
  assert.equal(cleanCofavoriteReplaceSetValue('only Kakashi'), 'Kakashi')
  assert.equal(buildCofavoriteFactKey('character', cleanCofavoriteReplaceSetValue('solo Itachi')), 'preferences.cofavorite.character.itachi')
}

// TEST 1 — IT replace: keep Itachi, add Kakashi, obsolete Sasuke+Madara
{
  const sb = createFakeSupabase(characterTrio())
  const r = await pipeline(sb, 'Adesso i miei personaggi preferiti sono Itachi e Kakashi.')
  assert.equal(r.replaced, true)
  assert.deepEqual(activeKeys(sb.rows), [
    'preferences.cofavorite.character.itachi',
    'preferences.cofavorite.character.kakashi',
  ])
  assert.deepEqual(obsoleteKeys(sb.rows), [
    'preferences.cofavorite.character.madara',
    'preferences.cofavorite.character.sasuke',
  ])
}

// TEST 2 — overlap Itachi kept
{
  const sb = createFakeSupabase(characterTrio())
  await pipeline(sb, 'Adesso i miei personaggi preferiti sono Itachi e Kakashi.')
  assert.ok(activeKeys(sb.rows).includes('preferences.cofavorite.character.itachi'))
  assert.equal(sb.rows.filter((r) => readFactKeyFromTags(r.tags) === 'preferences.cofavorite.character.itachi').length, 1)
}

// TEST 3 — Kakashi added
{
  const sb = createFakeSupabase(characterTrio())
  await pipeline(sb, 'Adesso i miei personaggi preferiti sono Itachi e Kakashi.')
  assert.ok(activeKeys(sb.rows).includes('preferences.cofavorite.character.kakashi'))
}

// TEST 4 — both absent peers obsolete
{
  const sb = createFakeSupabase(characterTrio())
  await pipeline(sb, 'Adesso i miei personaggi preferiti sono Itachi e Kakashi.')
  assert.ok(obsoleteKeys(sb.rows).includes('preferences.cofavorite.character.sasuke'))
  assert.ok(obsoleteKeys(sb.rows).includes('preferences.cofavorite.character.madara'))
}

// TEST 5 — anime cofavorites untouched
{
  const sb = createFakeSupabase([
    ...characterTrio(),
    seedRow({
      id: 'anime-1',
      factKey: 'preferences.cofavorite.anime.naruto',
      content: "User's favorite anime: Naruto.",
    }),
    seedRow({
      id: 'anime-2',
      factKey: 'preferences.cofavorite.anime.dragon_ball',
      content: "User's favorite anime: Dragon Ball.",
    }),
  ])
  await pipeline(sb, 'Adesso i miei personaggi preferiti sono Itachi e Kakashi.')
  assert.ok(activeKeys(sb.rows).includes('preferences.cofavorite.anime.naruto'))
  assert.ok(activeKeys(sb.rows).includes('preferences.cofavorite.anime.dragon_ball'))
}

// TEST 6 — like/dislike/interest untouched
{
  const sb = createFakeSupabase([
    ...characterTrio(),
    seedRow({
      id: 'like-1',
      title: 'Preference',
      factKey: 'preferences.like.sasuke',
      content: 'User likes / prefers: Sasuke.',
    }),
    seedRow({
      id: 'dislike-1',
      title: 'Dislike',
      factKey: 'preferences.dislike.boruto',
      content: 'User dislikes: Boruto.',
    }),
    seedRow({
      id: 'interest-1',
      title: 'Interest',
      factKey: 'preferences.interest.manga',
      content: 'User is interested in manga.',
    }),
  ])
  await pipeline(sb, 'Adesso i miei personaggi preferiti sono Itachi e Kakashi.')
  assert.ok(activeKeys(sb.rows).includes('preferences.like.sasuke'))
  assert.ok(activeKeys(sb.rows).includes('preferences.dislike.boruto'))
  assert.ok(activeKeys(sb.rows).includes('preferences.interest.manga'))
  assert.ok(obsoleteKeys(sb.rows).includes('preferences.cofavorite.character.sasuke'))
}

// TEST 7 — idempotent same set
{
  const sb = createFakeSupabase([
    seedRow({
      id: 'c1',
      factKey: 'preferences.cofavorite.character.itachi',
      content: "User's favorite character: Itachi.",
    }),
    seedRow({
      id: 'c2',
      factKey: 'preferences.cofavorite.character.kakashi',
      content: "User's favorite character: Kakashi.",
    }),
  ])
  await pipeline(sb, 'Adesso i miei personaggi preferiti sono Itachi e Kakashi.')
  assert.deepEqual(activeKeys(sb.rows), [
    'preferences.cofavorite.character.itachi',
    'preferences.cofavorite.character.kakashi',
  ])
  assert.equal(obsoleteKeys(sb.rows).length, 0)
  assert.equal(
    sb.rows.filter((r) => readFactKeyFromTags(r.tags) === 'preferences.cofavorite.character.itachi').length,
    1,
  )
}

// TEST 8 — different subject untouched (color)
{
  const sb = createFakeSupabase([
    ...characterTrio(),
    seedRow({
      id: 'color-1',
      factKey: 'preferences.cofavorite.color.blue',
      content: "User's favorite color: blue.",
    }),
  ])
  await pipeline(sb, 'Adesso i miei personaggi preferiti sono Itachi e Kakashi.')
  assert.ok(activeKeys(sb.rows).includes('preferences.cofavorite.color.blue'))
}

// TEST 9 — question → no mutation
{
  const sb = createFakeSupabase(characterTrio())
  await pipeline(sb, 'Adesso i miei personaggi preferiti sono Itachi e Kakashi?')
  assert.deepEqual(activeKeys(sb.rows), [
    'preferences.cofavorite.character.itachi',
    'preferences.cofavorite.character.madara',
    'preferences.cofavorite.character.sasuke',
  ])
  assert.equal(obsoleteKeys(sb.rows).length, 0)
  assert.equal(extractCofavoriteReplaceSetCandidate('Adesso i miei personaggi preferiti sono Itachi e Kakashi?'), null)
}

// TEST 10 — third-party → no mutation
{
  const sb = createFakeSupabase(characterTrio())
  await pipeline(sb, 'I personaggi preferiti di mio fratello adesso sono Itachi e Kakashi.')
  assert.equal(obsoleteKeys(sb.rows).length, 0)
  assert.ok(shouldSkipFavoriteSetReplacement('His favorite characters are only Itachi and Kakashi.'))
}

// TEST 11 — hypothetical → no mutation
{
  const sb = createFakeSupabase(characterTrio())
  await pipeline(sb, 'Se i miei personaggi preferiti fossero Itachi e Kakashi...')
  assert.equal(obsoleteKeys(sb.rows).length, 0)
}

// TEST 12 — meta-negation → no mutation
{
  const sb = createFakeSupabase(characterTrio())
  await pipeline(sb, 'Non ho detto che i miei personaggi preferiti sono solo Itachi e Kakashi.')
  assert.equal(obsoleteKeys(sb.rows).length, 0)
}

// TEST 13 — hedge → no mutation
{
  const sb = createFakeSupabase(characterTrio())
  await pipeline(sb, 'Forse adesso i miei personaggi preferiti sono Itachi e Kakashi.')
  assert.equal(obsoleteKeys(sb.rows).length, 0)
  assert.ok(!activeKeys(sb.rows).includes('preferences.cofavorite.character.kakashi'))
}

// TEST 14 — Ricorda wrapper → replacement works
{
  const sb = createFakeSupabase(characterTrio())
  await pipeline(sb, 'Ricorda che adesso i miei personaggi preferiti sono Itachi e Kakashi.')
  assert.deepEqual(activeKeys(sb.rows), [
    'preferences.cofavorite.character.itachi',
    'preferences.cofavorite.character.kakashi',
  ])
}

// TEST 15 — Memory OFF → no mutation
{
  const sb = createFakeSupabase(characterTrio())
  const r = await pipeline(sb, 'Adesso i miei personaggi preferiti sono Itachi e Kakashi.', 'user-a', false)
  assert.equal(r.reason, 'memory_disabled')
  assert.deepEqual(activeKeys(sb.rows), [
    'preferences.cofavorite.character.itachi',
    'preferences.cofavorite.character.madara',
    'preferences.cofavorite.character.sasuke',
  ])
}

// TEST 16 — User A/B isolation
{
  const sb = createFakeSupabase([...characterTrio('user-a'), ...characterTrio('user-b')])
  await pipeline(sb, 'Adesso i miei personaggi preferiti sono Itachi e Kakashi.', 'user-a')
  assert.deepEqual(activeKeys(sb.rows, 'user-a'), [
    'preferences.cofavorite.character.itachi',
    'preferences.cofavorite.character.kakashi',
  ])
  assert.deepEqual(activeKeys(sb.rows, 'user-b'), [
    'preferences.cofavorite.character.itachi',
    'preferences.cofavorite.character.madara',
    'preferences.cofavorite.character.sasuke',
  ])
}

// TEST 17 — Recall #254 new set only
{
  const rows = [
    {
      id: '1',
      category: 'preferences',
      content: "User's favorite character: Itachi.",
      status: 'active',
      importance: 6,
      tags: [encodeFactKeyTag('preferences.cofavorite.character.itachi')],
      factKey: 'preferences.cofavorite.character.itachi',
    },
    {
      id: '2',
      category: 'preferences',
      content: "User's favorite character: Kakashi.",
      status: 'active',
      importance: 6,
      tags: [encodeFactKeyTag('preferences.cofavorite.character.kakashi')],
      factKey: 'preferences.cofavorite.character.kakashi',
    },
    {
      id: '3',
      category: 'preferences',
      content: "User's favorite character: Sasuke.",
      status: 'obsolete',
      importance: 6,
      tags: [encodeFactKeyTag('preferences.cofavorite.character.sasuke')],
      factKey: 'preferences.cofavorite.character.sasuke',
    },
  ]
  const eligible = rows.filter((r) => isRecallEligibleMemory(r))
  const ranked = rerankMemoriesForRecall(eligible, 'Quali sono i miei personaggi preferiti?')
  assert.ok(ranked.some((r) => /Itachi/i.test(r.content)))
  assert.ok(ranked.some((r) => /Kakashi/i.test(r.content)))
  assert.ok(!ranked.some((r) => /Sasuke/i.test(r.content)))
}

// TEST 18 — Overview new set only
{
  const rows = [
    seedRow({
      id: '1',
      factKey: 'preferences.cofavorite.character.itachi',
      content: "User's favorite character: Itachi.",
    }),
    seedRow({
      id: '2',
      factKey: 'preferences.cofavorite.character.sasuke',
      content: "User's favorite character: Sasuke.",
      status: 'obsolete',
    }),
  ]
  assert.equal(isOverviewEligibleMemory(rows[1]), false)
  const selected = selectOverviewMemories(rows.filter((r) => isOverviewEligibleMemory(r)))
  assert.ok(selected.some((r) => /Itachi/i.test(r.content)))
  assert.ok(!selected.some((r) => /Sasuke/i.test(r.content)))
}

// TEST 19 — Specific Forget after replacement
{
  const sb = createFakeSupabase([
    seedRow({
      id: 'c1',
      factKey: 'preferences.cofavorite.character.itachi',
      content: "User's favorite character: Itachi.",
    }),
    seedRow({
      id: 'c2',
      factKey: 'preferences.cofavorite.character.kakashi',
      content: "User's favorite character: Kakashi.",
    }),
  ])
  const result = await tryHandleSpecificForget({
    userMessage: 'Dimentica Kakashi.',
    userId: 'user-a',
    supabase: sb,
  })
  assert.equal(result.status, 'forgotten')
  assert.ok(obsoleteKeys(sb.rows).includes('preferences.cofavorite.character.kakashi'))
  assert.ok(activeKeys(sb.rows).includes('preferences.cofavorite.character.itachi'))
}

// TEST 20 — #256 individual revoke unchanged
{
  const facts = extractDurableFacts('Sasuke non è più uno dei miei personaggi preferiti.')
  assert.ok(facts.some((f) => f.operation === 'revoke' && f.factKey === 'preferences.cofavorite.character.sasuke'))
}

// TEST 21 — #255 polarity unchanged
{
  const facts = extractDurableFacts('Non mi piace più Naruto.')
  assert.ok(facts.some((f) => f.factKey === 'preferences.dislike.naruto'))
}

// TEST 22 — #253 bare plural remains additive
{
  const sb = createFakeSupabase(characterTrio())
  await pipeline(sb, 'I miei personaggi preferiti sono Itachi e Kakashi.')
  assert.ok(activeKeys(sb.rows).includes('preferences.cofavorite.character.sasuke'))
  assert.ok(activeKeys(sb.rows).includes('preferences.cofavorite.character.madara'))
  assert.ok(activeKeys(sb.rows).includes('preferences.cofavorite.character.kakashi'))
  assert.equal(extractCofavoriteReplaceSetCandidate('I miei personaggi preferiti sono Itachi e Kakashi.'), null)
}

// TEST 23 — 4+ apparent list items → NO destructive replace
{
  const sb = createFakeSupabase(characterTrio())
  const cand = extractCofavoriteReplaceSetCandidate(
    'Adesso i miei personaggi preferiti sono A, B, C e D.',
  )
  assert.equal(cand?.overflow, true)
  const facts = extractDurableFacts('Adesso i miei personaggi preferiti sono A, B, C e D.')
  assert.ok(!facts.some((f) => f.operation === 'replace_set'))
  assert.ok(!facts.some((f) => /cofavorite/.test(f.factKey || '')))
  await pipeline(sb, 'Adesso i miei personaggi preferiti sono A, B, C e D.')
  assert.deepEqual(activeKeys(sb.rows), [
    'preferences.cofavorite.character.itachi',
    'preferences.cofavorite.character.madara',
    'preferences.cofavorite.character.sasuke',
  ])
  assert.equal(obsoleteKeys(sb.rows).length, 0)
}

// TEST 24 — no cue leakage in fact_keys
{
  const msgs = [
    'I miei personaggi preferiti sono solo Itachi e Kakashi.',
    'My favorite characters are now Itachi and Kakashi.',
    'I miei personaggi preferiti ora sono Itachi e Kakashi.',
    'Now my favorite characters are only Itachi and Kakashi.',
  ]
  for (const msg of msgs) {
    const cand = extractCofavoriteReplaceSetCandidate(msg)
    assert.ok(cand?.factKeys?.every((k) => !/(solo|soltanto|ora|now|only)_/.test(k)), msg)
    assert.ok(cand?.factKeys?.every((k) => !/_(adesso|now)$/.test(k)), msg)
    assert.deepEqual(cand.values, ['Itachi', 'Kakashi'])
  }
}

// TEST 25 — duplicate absent cofavorite rows → all obsolete
{
  const sb = createFakeSupabase([
    seedRow({
      id: 'dup-sasuke-a',
      factKey: 'preferences.cofavorite.character.sasuke',
      content: "User's favorite character: Sasuke.",
    }),
    seedRow({
      id: 'dup-sasuke-b',
      factKey: 'preferences.cofavorite.character.sasuke',
      content: "User's favorite character: Sasuke.",
    }),
    seedRow({
      id: 'itachi',
      factKey: 'preferences.cofavorite.character.itachi',
      content: "User's favorite character: Itachi.",
    }),
  ])
  await pipeline(sb, 'Adesso i miei personaggi preferiti sono Itachi e Kakashi.')
  assert.equal(sb.rows.find((r) => r.id === 'dup-sasuke-a').status, 'obsolete')
  assert.equal(sb.rows.find((r) => r.id === 'dup-sasuke-b').status, 'obsolete')
}

// TEST 26 — singular favorite not in incoming set → obsolete
{
  const sb = createFakeSupabase([
    seedRow({
      id: 'sing',
      title: 'Favorite',
      factKey: 'preferences.favorite.character',
      content: "User's favorite character: Itachi.",
    }),
    ...characterTrio(),
  ])
  await pipeline(sb, 'Adesso i miei personaggi preferiti sono Sasuke e Kakashi.')
  assert.equal(sb.rows.find((r) => r.id === 'sing').status, 'obsolete')
}

// TEST 27 — singular favorite in incoming set → no unintended destructive change
{
  const sb = createFakeSupabase([
    seedRow({
      id: 'sing',
      title: 'Favorite',
      factKey: 'preferences.favorite.character',
      content: "User's favorite character: Itachi.",
    }),
    ...characterTrio(),
  ])
  await pipeline(sb, 'Adesso i miei personaggi preferiti sono Itachi e Kakashi.')
  assert.equal(sb.rows.find((r) => r.id === 'sing').status, 'active')
}

// TEST 28 — multi-word values
{
  assertReplaceExtraction(
    'Adesso i miei anime preferiti sono Attack on Titan e Dragon Ball.',
    ['Attack on Titan', 'Dragon Ball'],
  )
}

// TEST 29 — EN now …
{
  const sb = createFakeSupabase(characterTrio())
  await pipeline(sb, 'Now my favorite characters are Itachi and Kakashi.')
  assert.deepEqual(activeKeys(sb.rows), [
    'preferences.cofavorite.character.itachi',
    'preferences.cofavorite.character.kakashi',
  ])
}

// TEST 30 — EN only …
{
  const sb = createFakeSupabase(characterTrio())
  await pipeline(sb, 'My favorite characters are only Itachi and Kakashi.')
  assert.deepEqual(activeKeys(sb.rows), [
    'preferences.cofavorite.character.itachi',
    'preferences.cofavorite.character.kakashi',
  ])
}

// TEST 31 — bare English plural remains additive
{
  const sb = createFakeSupabase(characterTrio())
  await pipeline(sb, 'My favorite characters are Itachi and Kakashi.')
  assert.ok(activeKeys(sb.rows).includes('preferences.cofavorite.character.sasuke'))
  assert.ok(activeKeys(sb.rows).includes('preferences.cofavorite.character.madara'))
  assert.equal(extractCofavoriteReplaceSetCandidate('My favorite characters are Itachi and Kakashi.'), null)
}

// TEST 32 — mid-cue IT
{
  assertReplaceExtraction(
    'I miei personaggi preferiti adesso sono Itachi e Kakashi.',
    ['Itachi', 'Kakashi'],
  )
}

// TEST 33 — mid-cue EN
{
  assertReplaceExtraction(
    'My favorite characters are now Itachi and Kakashi.',
    ['Itachi', 'Kakashi'],
  )
}

// TEST 34 — incoming upsert failure → no absent-member obsolete phase
// Simulation: fake Supabase rejects INSERT for preferences.cofavorite.character.kakashi
// (Itachi already exists → idempotent skip succeeds; Kakashi insert throws → Order A abort).
{
  const sb = createFakeSupabase(characterTrio(), {
    failInsertFactKeys: ['preferences.cofavorite.character.kakashi'],
  })
  const r = await pipeline(sb, 'Adesso i miei personaggi preferiti sono Itachi e Kakashi.')
  const result = r.replaceSetResults?.[0]
  assert.equal(result?.action, 'failed_upsert')
  assert.deepEqual(activeKeys(sb.rows), [
    'preferences.cofavorite.character.itachi',
    'preferences.cofavorite.character.madara',
    'preferences.cofavorite.character.sasuke',
  ])
  assert.equal(obsoleteKeys(sb.rows).length, 0)
  assert.ok(!activeKeys(sb.rows).includes('preferences.cofavorite.character.kakashi'))
}

// TEST 35 — obsolete failure after incoming success → may remain SUPERSET
// Simulation: Kakashi inserts successfully; UPDATE status=obsolete for Sasuke/Madara fails.
{
  const sb = createFakeSupabase(characterTrio(), {
    failAllObsolete: true,
  })
  const r = await pipeline(sb, 'Adesso i miei personaggi preferiti sono Itachi e Kakashi.')
  const result = r.replaceSetResults?.[0]
  assert.equal(result?.action, 'partial_obsolete')
  assert.ok(activeKeys(sb.rows).includes('preferences.cofavorite.character.kakashi'))
  assert.ok(activeKeys(sb.rows).includes('preferences.cofavorite.character.sasuke'))
  assert.ok(activeKeys(sb.rows).includes('preferences.cofavorite.character.madara'))
  // Never destructive empty set
  assert.ok(activeKeys(sb.rows).length >= 3)
}

// TEST 36 — Core exactly one responses.create params (no temperature / reasoning expansion)
{
  const params = buildCoreResponsesCreateParams({
    model: 'gpt-5.6-sol',
    instructions: 'x',
    input: [],
  })
  assert.ok(params)
  assert.equal(params.temperature, undefined)
  const coreSrc = readFileSync(join(root, 'lib/server/core-responses-params.js'), 'utf8')
  assert.match(coreSrc, /responses\.create|buildCoreResponsesCreateParams/)
}

// TEST 37 — same-turn mixed operation → replace_set skipped, no destructive mutation
{
  const msg =
    'Adesso i miei personaggi preferiti sono Itachi e Kakashi, ma Sasuke mi piace ancora.'
  assert.equal(hasIncompatibleMixedFavoriteOps(msg), true)
  assert.equal(extractCofavoriteReplaceSetCandidate(msg), null)
  assert.ok(!extractDurableFacts(msg).some((f) => f.operation === 'replace_set'))
  const sb = createFakeSupabase(characterTrio())
  await pipeline(sb, msg)
  // No destructive set replacement: absent peers remain active; Kakashi not force-added via replace.
  assert.equal(obsoleteKeys(sb.rows).length, 0)
  assert.ok(activeKeys(sb.rows).includes('preferences.cofavorite.character.itachi'))
  assert.ok(activeKeys(sb.rows).includes('preferences.cofavorite.character.sasuke'))
  assert.ok(activeKeys(sb.rows).includes('preferences.cofavorite.character.madara'))
  assert.ok(!activeKeys(sb.rows).includes('preferences.cofavorite.character.kakashi'))
}

console.log('memory-cofavorite-set-replacement: all tests passed')
