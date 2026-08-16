/**
 * Memory 2.1 PR #256 — individual favorite / cofavorite revocation.
 * Run: node --test lib/server/memory-favorite-revocation.test.mjs
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildCofavoriteFactKey,
  cleanFavoritePreferenceValue,
  encodeFactKeyTag,
  extractDurableFacts,
  extractFavoriteRevokeCandidates,
  favoriteValueSlugFromContent,
  normalizeFavoriteSubjectKey,
  readFactKeyFromTags,
  runMemoryPipeline,
  shouldSkipFavoriteRevocation,
  slugifyFactKeyPart,
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
    title: partial.title || 'Favorite',
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
}

function obsoleteKeys(rows, userId = 'user-a') {
  return rows
    .filter((r) => r.user_id === userId && String(r.status) === 'obsolete')
    .map((r) => readFactKeyFromTags(r.tags) || r.id)
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

// --- Normalization reuse ---
{
  assert.equal(normalizeFavoriteSubjectKey('personaggi'), 'character')
  assert.equal(buildCofavoriteFactKey('personaggi', 'Sasuke'), 'preferences.cofavorite.character.sasuke')
  assert.equal(buildCofavoriteFactKey('characters', 'sasuke'), 'preferences.cofavorite.character.sasuke')
  assert.equal(buildCofavoriteFactKey('characters', 'Sasuké'), 'preferences.cofavorite.character.sasuke')
  assert.equal(cleanFavoritePreferenceValue('Il Sasuke'), 'Sasuke')
  assert.equal(favoriteValueSlugFromContent("User's favorite anime: Naruto"), 'naruto')
  assert.equal(slugifyFactKeyPart(cleanFavoritePreferenceValue('Sasuke')), 'sasuke')
}

// TEST 1 — singular revoke
{
  const sb = createFakeSupabase([
    seedRow({
      id: 'fav-1',
      factKey: 'preferences.favorite.anime',
      content: "User's favorite anime: Naruto",
    }),
  ])
  const r = await pipeline(sb, 'Naruto non è più il mio anime preferito.')
  assert.equal(r.revoked, true)
  assert.ok(obsoleteKeys(sb.rows).includes('preferences.favorite.anime'))
  assert.ok(!activeKeys(sb.rows).includes('preferences.favorite.anime'))
}

// TEST 2 — wrong-value singular no-op
{
  const sb = createFakeSupabase([
    seedRow({
      id: 'fav-1',
      factKey: 'preferences.favorite.anime',
      content: "User's favorite anime: Naruto",
    }),
  ])
  await pipeline(sb, 'Dragon Ball non è più il mio anime preferito.')
  assert.deepEqual(activeKeys(sb.rows), ['preferences.favorite.anime'])
  assert.equal(obsoleteKeys(sb.rows).length, 0)
}

// TEST 3 — cofavorite revoke leaves peer
{
  const sb = createFakeSupabase([
    seedRow({
      id: 'c1',
      title: 'Co-favorite',
      factKey: 'preferences.cofavorite.character.itachi',
      content: "User's favorite personaggi: Itachi",
    }),
    seedRow({
      id: 'c2',
      title: 'Co-favorite',
      factKey: 'preferences.cofavorite.character.sasuke',
      content: "User's favorite personaggi: Sasuke",
    }),
  ])
  await pipeline(sb, 'Sasuke non è più uno dei miei personaggi preferiti.')
  assert.ok(activeKeys(sb.rows).includes('preferences.cofavorite.character.itachi'))
  assert.ok(obsoleteKeys(sb.rows).includes('preferences.cofavorite.character.sasuke'))
}

// TEST 4 — wrong cofavorite value no-op
{
  const sb = createFakeSupabase([
    seedRow({
      id: 'c1',
      title: 'Co-favorite',
      factKey: 'preferences.cofavorite.character.itachi',
      content: "User's favorite personaggi: Itachi",
    }),
    seedRow({
      id: 'c2',
      title: 'Co-favorite',
      factKey: 'preferences.cofavorite.character.sasuke',
      content: "User's favorite personaggi: Sasuke",
    }),
  ])
  await pipeline(sb, 'Madara non è più uno dei miei personaggi preferiti.')
  assert.deepEqual(activeKeys(sb.rows).sort(), [
    'preferences.cofavorite.character.itachi',
    'preferences.cofavorite.character.sasuke',
  ])
}

// TEST 5 — singular question no mutation
{
  const sb = createFakeSupabase([
    seedRow({
      id: 'fav-1',
      factKey: 'preferences.favorite.anime',
      content: "User's favorite anime: Naruto",
    }),
  ])
  assert.equal(shouldSkipFavoriteRevocation('Naruto non è più il mio anime preferito?'), true)
  assert.equal(extractDurableFacts('Naruto non è più il mio anime preferito?').length, 0)
  await pipeline(sb, 'Naruto non è più il mio anime preferito?')
  assert.deepEqual(activeKeys(sb.rows), ['preferences.favorite.anime'])
}

// TEST 6 — cofavorite question no mutation
{
  const sb = createFakeSupabase([
    seedRow({
      id: 'c2',
      title: 'Co-favorite',
      factKey: 'preferences.cofavorite.character.sasuke',
      content: "User's favorite personaggi: Sasuke",
    }),
  ])
  await pipeline(sb, 'Sasuke non è più uno dei miei personaggi preferiti?')
  assert.deepEqual(activeKeys(sb.rows), ['preferences.cofavorite.character.sasuke'])
}

// TEST 7 — third-party no mutation
{
  const sb = createFakeSupabase([
    seedRow({
      id: 'fav-1',
      factKey: 'preferences.favorite.anime',
      content: "User's favorite anime: Naruto",
    }),
  ])
  await pipeline(sb, 'Il mio amico dice che Naruto non è il suo anime preferito.')
  assert.ok(activeKeys(sb.rows).includes('preferences.favorite.anime'))
  assert.equal(obsoleteKeys(sb.rows).length, 0)
}

// TEST 8 — meta-negation
{
  const sb = createFakeSupabase([
    seedRow({
      id: 'fav-1',
      factKey: 'preferences.favorite.anime',
      content: "User's favorite anime: Naruto",
    }),
  ])
  await pipeline(sb, 'Non ho detto che Naruto non è più il mio anime preferito.')
  assert.deepEqual(activeKeys(sb.rows), ['preferences.favorite.anime'])
}

// TEST 9 — hypothetical
{
  const sb = createFakeSupabase([
    seedRow({
      id: 'fav-1',
      factKey: 'preferences.favorite.anime',
      content: "User's favorite anime: Naruto",
    }),
  ])
  await pipeline(sb, 'Se Naruto non fosse più il mio anime preferito...')
  assert.deepEqual(activeKeys(sb.rows), ['preferences.favorite.anime'])
}

// TEST 10 — hedge
{
  const sb = createFakeSupabase([
    seedRow({
      id: 'fav-1',
      factKey: 'preferences.favorite.anime',
      content: "User's favorite anime: Naruto",
    }),
  ])
  await pipeline(sb, 'Forse Naruto non è più il mio anime preferito.')
  await pipeline(sb, 'Potrebbe non essere più il mio anime preferito.')
  assert.deepEqual(activeKeys(sb.rows), ['preferences.favorite.anime'])
}

// TEST 11 — Ricorda wrapper singular
{
  const sb = createFakeSupabase([
    seedRow({
      id: 'fav-1',
      factKey: 'preferences.favorite.anime',
      content: "User's favorite anime: Naruto",
    }),
  ])
  await pipeline(sb, 'Ricorda che Naruto non è più il mio anime preferito.')
  assert.ok(obsoleteKeys(sb.rows).includes('preferences.favorite.anime'))
}

// TEST 12 — Ricordati wrapper cofavorite
{
  const sb = createFakeSupabase([
    seedRow({
      id: 'c2',
      title: 'Co-favorite',
      factKey: 'preferences.cofavorite.character.sasuke',
      content: "User's favorite personaggi: Sasuke",
    }),
  ])
  await pipeline(sb, 'Ricordati che Sasuke non è più uno dei miei personaggi preferiti.')
  assert.ok(obsoleteKeys(sb.rows).includes('preferences.cofavorite.character.sasuke'))
}

// TEST 13 — like survives favorite revoke
{
  const sb = createFakeSupabase([
    seedRow({
      id: 'fav-1',
      factKey: 'preferences.favorite.anime',
      content: "User's favorite anime: Naruto",
    }),
    seedRow({
      id: 'like-1',
      title: 'Preference',
      factKey: 'preferences.like.naruto',
      content: 'User likes / prefers: Naruto',
    }),
  ])
  await pipeline(sb, 'Naruto non è più il mio anime preferito.')
  assert.ok(activeKeys(sb.rows).includes('preferences.like.naruto'))
  assert.ok(obsoleteKeys(sb.rows).includes('preferences.favorite.anime'))
}

// TEST 14 — dislike survives favorite revoke
{
  const sb = createFakeSupabase([
    seedRow({
      id: 'fav-1',
      factKey: 'preferences.favorite.anime',
      content: "User's favorite anime: Naruto",
    }),
    seedRow({
      id: 'dis-1',
      title: 'Dislike',
      factKey: 'preferences.dislike.naruto',
      content: 'User dislikes: Naruto',
    }),
  ])
  await pipeline(sb, 'Naruto non è più il mio anime preferito.')
  assert.ok(activeKeys(sb.rows).includes('preferences.dislike.naruto'))
}

// TEST 15 — singular / cofavorite isolation
{
  const sb = createFakeSupabase([
    seedRow({
      id: 'fav',
      factKey: 'preferences.favorite.character',
      content: "User's favorite personaggio: Itachi",
    }),
    seedRow({
      id: 'c1',
      title: 'Co-favorite',
      factKey: 'preferences.cofavorite.character.itachi',
      content: "User's favorite personaggi: Itachi",
    }),
    seedRow({
      id: 'c2',
      title: 'Co-favorite',
      factKey: 'preferences.cofavorite.character.sasuke',
      content: "User's favorite personaggi: Sasuke",
    }),
  ])
  await pipeline(sb, 'Itachi non è più il mio personaggio preferito.')
  assert.ok(obsoleteKeys(sb.rows).includes('preferences.favorite.character'))
  assert.ok(activeKeys(sb.rows).includes('preferences.cofavorite.character.itachi'))
  assert.ok(activeKeys(sb.rows).includes('preferences.cofavorite.character.sasuke'))

  await pipeline(sb, 'Itachi non è più uno dei miei personaggi preferiti.')
  assert.ok(obsoleteKeys(sb.rows).includes('preferences.cofavorite.character.itachi'))
  assert.ok(activeKeys(sb.rows).includes('preferences.cofavorite.character.sasuke'))
}

// TEST 16 — Memory OFF
{
  const sb = createFakeSupabase([
    seedRow({
      id: 'fav-1',
      factKey: 'preferences.favorite.anime',
      content: "User's favorite anime: Naruto",
    }),
  ])
  const r = await pipeline(sb, 'Naruto non è più il mio anime preferito.', 'user-a', false)
  assert.equal(r.reason, 'memory_disabled')
  assert.deepEqual(activeKeys(sb.rows), ['preferences.favorite.anime'])
}

// TEST 17 — A/B isolation
{
  const sb = createFakeSupabase([
    seedRow({
      id: 'a-fav',
      userId: 'user-a',
      factKey: 'preferences.favorite.anime',
      content: "User's favorite anime: Naruto",
    }),
    seedRow({
      id: 'b-fav',
      userId: 'user-b',
      factKey: 'preferences.favorite.anime',
      content: "User's favorite anime: Naruto",
    }),
  ])
  await pipeline(sb, 'Naruto non è più il mio anime preferito.', 'user-a')
  assert.equal(sb.rows.find((r) => r.id === 'a-fav').status, 'obsolete')
  assert.equal(sb.rows.find((r) => r.id === 'b-fav').status, 'active')
}

// TEST 18 — Recall after singular revoke
{
  const obsolete = {
    id: '1',
    category: 'preferences',
    content: "User's favorite anime: Naruto",
    status: 'obsolete',
    importance: 6,
    tags: [encodeFactKeyTag('preferences.favorite.anime')],
  }
  assert.equal(isRecallEligibleMemory(obsolete), false)
  const eligible = [obsolete].filter((r) => isRecallEligibleMemory(r))
  const ranked = rerankMemoriesForRecall(eligible, 'Qual è il mio anime preferito?')
  assert.equal(ranked.length, 0)
}

// TEST 19 — Recall after cofavorite revoke
{
  const rows = [
    {
      id: '1',
      category: 'preferences',
      content: "User's favorite personaggi: Itachi",
      status: 'active',
      importance: 6,
      tags: [encodeFactKeyTag('preferences.cofavorite.character.itachi')],
      factKey: 'preferences.cofavorite.character.itachi',
    },
    {
      id: '2',
      category: 'preferences',
      content: "User's favorite personaggi: Sasuke",
      status: 'obsolete',
      importance: 6,
      tags: [encodeFactKeyTag('preferences.cofavorite.character.sasuke')],
      factKey: 'preferences.cofavorite.character.sasuke',
    },
  ]
  const eligible = rows.filter((r) => isRecallEligibleMemory(r))
  const ranked = rerankMemoriesForRecall(eligible, 'Quali sono i miei personaggi preferiti?')
  assert.ok(ranked.some((r) => /Itachi/i.test(r.content)))
  assert.ok(!ranked.some((r) => /Sasuke/i.test(r.content)))
}

// TEST 20 — Overview excludes revoked
{
  const rows = [
    seedRow({
      id: 'fav-1',
      factKey: 'preferences.favorite.anime',
      content: "User's favorite anime: Naruto",
      status: 'obsolete',
    }),
    seedRow({
      id: 'like-1',
      title: 'Preference',
      factKey: 'preferences.like.bleach',
      content: 'User likes / prefers: Bleach',
    }),
  ]
  assert.equal(isOverviewEligibleMemory(rows[0]), false)
  const selected = selectOverviewMemories(rows.filter((r) => isOverviewEligibleMemory(r)))
  assert.ok(!selected.some((r) => /Naruto/i.test(r.content)))
}

// TEST 21 — Specific Forget unchanged
{
  const sb = createFakeSupabase([
    seedRow({
      id: 'c1',
      title: 'Co-favorite',
      factKey: 'preferences.cofavorite.character.itachi',
      content: "User's favorite personaggi: Itachi",
    }),
    seedRow({
      id: 'c2',
      title: 'Co-favorite',
      factKey: 'preferences.cofavorite.character.sasuke',
      content: "User's favorite personaggi: Sasuke",
    }),
  ])
  const result = await tryHandleSpecificForget({
    userMessage: 'Dimentica Sasuke.',
    userId: 'user-a',
    supabase: sb,
  })
  assert.equal(result.status, 'forgotten')
  assert.equal(sb.rows.find((r) => r.id === 'c2').status, 'obsolete')
  assert.equal(sb.rows.find((r) => r.id === 'c1').status, 'active')
}

// TEST 22 — #253 positive extraction unchanged
{
  const singular = extractDurableFacts('Il mio anime preferito è Naruto.')
  assert.ok(singular.some((f) => f.factKey === 'preferences.favorite.anime' && !f.operation))
  const plural = extractDurableFacts('I miei personaggi preferiti sono Itachi e Sasuke.')
  assert.ok(plural.some((f) => f.factKey === 'preferences.cofavorite.character.itachi'))
  assert.ok(plural.some((f) => f.factKey === 'preferences.cofavorite.character.sasuke'))
}

// TEST 23 — #255 polarity still extracts dislike
{
  const facts = extractDurableFacts('Non mi piace più Naruto.')
  assert.ok(facts.some((f) => f.factKey === 'preferences.dislike.naruto'))
}

// TEST 24 — #252 primary project unchanged
{
  const facts = extractDurableFacts('Il mio progetto principale è LAIfe.')
  assert.ok(facts.some((f) => f.factKey === 'projects.primary'))
}

// TEST 25 — provenance contract still present
{
  const recall = readFileSync(join(root, 'lib/server/core-memory-recall.js'), 'utf8')
  assert.match(recall, /DURABLE MEMORY 2\.0/)
}

// TEST 26 — Core one responses.create params
{
  const params = buildCoreResponsesCreateParams({
    model: 'gpt-5.6-sol',
    instructions: 'x',
    input: [],
  })
  assert.ok(params)
  assert.equal(params.temperature, undefined)
}

// TEST 27 — EN "is no longer" revoke, no positive "no longer Naruto"
{
  const extracted = extractDurableFacts('My favorite anime is no longer Naruto.')
  assert.equal(extracted.length, 1)
  assert.equal(extracted[0].operation, 'revoke')
  assert.equal(extracted[0].factKey, 'preferences.favorite.anime')
  assert.equal(extracted[0].value, 'Naruto')
  assert.doesNotMatch(extracted[0].content, /no longer Naruto/i)

  const sb = createFakeSupabase([
    seedRow({
      id: 'fav-1',
      factKey: 'preferences.favorite.anime',
      content: "User's favorite anime: Naruto",
    }),
  ])
  await pipeline(sb, 'My favorite anime is no longer Naruto.')
  assert.ok(obsoleteKeys(sb.rows).includes('preferences.favorite.anime'))
}

// TEST 28 — normalization parity for cofavorite revoke
{
  for (const form of ['Sasuke', 'sasuke', 'Sasuké']) {
    const c = extractFavoriteRevokeCandidates(
      `${form} non è più uno dei miei personaggi preferiti.`,
    )
    assert.equal(c[0]?.factKey, 'preferences.cofavorite.character.sasuke', form)
  }
}

// TEST 29 — duplicate exact matches → obsolete ALL (deterministic)
{
  const sb = createFakeSupabase([
    seedRow({
      id: 'dup-b',
      factKey: 'preferences.favorite.anime',
      content: "User's favorite anime: Naruto",
    }),
    seedRow({
      id: 'dup-a',
      factKey: 'preferences.favorite.anime',
      content: "User's favorite anime: Naruto",
    }),
  ])
  const r = await pipeline(sb, 'Naruto non è più il mio anime preferito.')
  assert.equal(r.revoked, true)
  assert.equal(r.revokeResults?.[0]?.obsoletedIds?.length, 2)
  assert.equal(
    sb.rows.filter((row) => row.status === 'obsolete').length,
    2,
  )
  assert.equal(sb.rows.filter((row) => row.status === 'active').length, 0)
}

// EN / IT coverage smoke
{
  for (const msg of [
    'Naruto non è il mio anime preferito.',
    'Il mio anime preferito non è più Naruto.',
    'Il mio anime preferito non è Naruto.',
    'Itachi non è più il mio personaggio preferito.',
    'Il verde non è più il mio colore preferito.',
    "Naruto isn't my favorite anime anymore.",
    'Naruto is not my favorite anime.',
    'My favorite anime is not Naruto.',
    'Sasuke non è più tra i miei personaggi preferiti.',
    'Sasuke non è uno dei miei personaggi preferiti.',
    "Sasuke isn't one of my favorite characters anymore.",
    'Sasuke is no longer one of my favorite characters.',
  ]) {
    const c = extractFavoriteRevokeCandidates(msg)
    assert.ok(c.length >= 1, `expected revoke for: ${msg}`)
    assert.ok(!extractDurableFacts(msg).some((f) => !f.operation && /favorite/i.test(f.factKey || '')))
  }
}

// Source contracts
{
  const brain = readFileSync(join(root, 'lib/server/brain-memory.js'), 'utf8')
  assert.match(brain, /applyFavoriteRevocation/)
  assert.match(brain, /extractFavoriteRevokeCandidates/)
  assert.match(brain, /shouldSkipFavoriteRevocation/)
  const forget = readFileSync(join(root, 'lib/server/memory-control-forget.js'), 'utf8')
  assert.doesNotMatch(forget, /extractFavoriteRevokeCandidates/)
}

console.log('memory-favorite-revocation.test.mjs: PASS')
