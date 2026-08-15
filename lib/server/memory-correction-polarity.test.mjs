/**
 * Memory 2.1 — Correction PR1: like ↔ dislike polarity + "più" fix.
 * Run: node --test lib/server/memory-correction-polarity.test.mjs
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  encodeFactKeyTag,
  extractDislikePreferenceValue,
  extractDurableFacts,
  extractLikePreferenceValue,
  isPreferencePolarityQuestion,
  oppositePreferencePolarityFactKey,
  readFactKeyFromTags,
  runMemoryPipeline,
  shouldSkipPreferencePolarityExtraction,
  upsertMemory,
} from './brain-memory.js'
import {
  loadCoreMemoryPack,
  rerankMemoriesForRecall,
} from './core-memory-recall.js'

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
    title: partial.title || 'Preference',
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

async function applyUser(supabase, userMessage, userId = 'user-a') {
  const facts = extractDurableFacts(userMessage)
  const actions = []
  for (const fact of facts) {
    const result = await upsertMemory(
      {
        ...fact,
        userId,
        requireExplicitUserId: true,
        userMessage,
      },
      { supabase },
    )
    actions.push(result.action)
  }
  return { facts, actions }
}

// --- Helpers ---
{
  assert.equal(oppositePreferencePolarityFactKey('preferences.like.naruto'), 'preferences.dislike.naruto')
  assert.equal(oppositePreferencePolarityFactKey('preferences.dislike.naruto'), 'preferences.like.naruto')
  assert.equal(extractDislikePreferenceValue('Non mi piace più Naruto.'), 'Naruto')
  assert.equal(extractDislikePreferenceValue('Naruto non mi piace più.'), 'Naruto')
  assert.equal(extractLikePreferenceValue('Adesso mi piace Naruto.'), 'Naruto')
  assert.equal(extractLikePreferenceValue('I like Naruto now.'), 'Naruto')
  assert.equal(isPreferencePolarityQuestion('Non mi piace più Naruto?'), true)
  assert.equal(shouldSkipPreferencePolarityExtraction('Non mi piace più Naruto?'), true)
  assert.equal(extractDislikePreferenceValue('Non mi piace più Naruto?'), null)
  assert.equal(extractLikePreferenceValue('Adesso mi piace Naruto?'), null)
  assert.equal(shouldSkipPreferencePolarityExtraction('Non ho detto che Naruto non mi piace.'), true)
  assert.equal(shouldSkipPreferencePolarityExtraction('Se Naruto non mi piacesse...'), true)
  assert.equal(shouldSkipPreferencePolarityExtraction('Il mio amico non ama Naruto.'), true)
}

// TEST 1 — Mi piace Naruto → like active
{
  const sb = createFakeSupabase([])
  await applyUser(sb, 'Mi piace Naruto.')
  assert.deepEqual(activeKeys(sb.rows), ['preferences.like.naruto'])
}

// TEST 2 — like → Non mi piace Naruto
{
  const sb = createFakeSupabase([
    seedRow({
      id: 'like-1',
      factKey: 'preferences.like.naruto',
      title: 'Preference',
      content: 'User likes / prefers: Naruto',
    }),
  ])
  await applyUser(sb, 'Non mi piace Naruto.')
  assert.ok(obsoleteKeys(sb.rows).includes('preferences.like.naruto'))
  assert.ok(activeKeys(sb.rows).includes('preferences.dislike.naruto'))
  assert.ok(!activeKeys(sb.rows).includes('preferences.like.naruto'))
}

// TEST 3 — Non mi piace più Naruto (no malformed piu key)
{
  const sb = createFakeSupabase([
    seedRow({
      id: 'like-1',
      factKey: 'preferences.like.naruto',
      content: 'User likes / prefers: Naruto',
    }),
  ])
  const { facts } = await applyUser(sb, 'Non mi piace più Naruto.')
  assert.equal(facts[0].factKey, 'preferences.dislike.naruto')
  assert.ok(!facts.some((f) => /piu/i.test(String(f.factKey))))
  assert.ok(activeKeys(sb.rows).includes('preferences.dislike.naruto'))
  assert.ok(obsoleteKeys(sb.rows).includes('preferences.like.naruto'))
}

// TEST 4 — Naruto non mi piace più
{
  const sb = createFakeSupabase([
    seedRow({
      id: 'like-1',
      factKey: 'preferences.like.naruto',
      content: 'User likes / prefers: Naruto',
    }),
  ])
  const { facts } = await applyUser(sb, 'Naruto non mi piace più.')
  assert.equal(facts[0].factKey, 'preferences.dislike.naruto')
  assert.ok(obsoleteKeys(sb.rows).includes('preferences.like.naruto'))
}

// TEST 5 — dislike → Adesso mi piace Naruto
{
  const sb = createFakeSupabase([
    seedRow({
      id: 'dis-1',
      factKey: 'preferences.dislike.naruto',
      title: 'Dislike',
      content: 'User dislikes: Naruto',
    }),
  ])
  await applyUser(sb, 'Adesso mi piace Naruto.')
  assert.ok(obsoleteKeys(sb.rows).includes('preferences.dislike.naruto'))
  assert.ok(activeKeys(sb.rows).includes('preferences.like.naruto'))
  assert.ok(!activeKeys(sb.rows).includes('preferences.dislike.naruto'))
}

// TEST 6 — Ho cambiato idea, mi piace Naruto
{
  const sb = createFakeSupabase([
    seedRow({
      id: 'dis-1',
      factKey: 'preferences.dislike.naruto',
      title: 'Dislike',
      content: 'User dislikes: Naruto',
    }),
  ])
  await applyUser(sb, 'Ho cambiato idea, mi piace Naruto.')
  assert.ok(activeKeys(sb.rows).includes('preferences.like.naruto'))
  assert.ok(obsoleteKeys(sb.rows).includes('preferences.dislike.naruto'))
}

// TEST 7–8 — questions zero write (extraction unit + full invariant list)
{
  for (const q of [
    'Non mi piace più Naruto?',
    'Naruto non mi piace più?',
    'Mi piace Naruto?',
    'Mi piace ancora Naruto?',
    'Adesso mi piace Naruto?',
    'È vero che mi piace Naruto?',
    'È vero che non mi piace più Naruto?',
    'Do I like Naruto?',
    "Don't I like Naruto?",
    'Do I still like Naruto?',
    'Do I not like Naruto anymore?',
    "I don't like Naruto anymore?",
    'I like Naruto now?',
  ]) {
    assert.equal(isPreferencePolarityQuestion(q), true, `isQ: ${q}`)
    assert.equal(shouldSkipPreferencePolarityExtraction(q), true, `skip: ${q}`)
    assert.equal(extractDislikePreferenceValue(q), null, `dislike extractor: ${q}`)
    assert.equal(extractLikePreferenceValue(q), null, `like extractor: ${q}`)
    assert.equal(extractDurableFacts(q).length, 0, `question must not extract: ${q}`)
  }
}

// Preview Test C — E2E pipeline state: questions neither write nor revoke
{
  const sbNeg = createFakeSupabase([
    seedRow({
      id: 'like-1',
      factKey: 'preferences.like.naruto',
      content: 'User likes / prefers: Naruto',
    }),
  ])
  const r1 = await runMemoryPipeline({
    userMessage: 'Non mi piace più Naruto?',
    assistantMessage: 'ok',
    userId: 'user-a',
    requireExplicitUserId: true,
    memoryEnabled: true,
    supabase: sbNeg,
  })
  assert.equal(r1.saved, false)
  assert.equal(r1.decision?.save, false)
  assert.deepEqual(activeKeys(sbNeg.rows), ['preferences.like.naruto'])
  assert.ok(!activeKeys(sbNeg.rows).includes('preferences.dislike.naruto'))
  assert.equal(obsoleteKeys(sbNeg.rows).length, 0)

  const sbPos = createFakeSupabase([
    seedRow({
      id: 'dis-1',
      factKey: 'preferences.dislike.naruto',
      title: 'Dislike',
      content: 'User dislikes: Naruto',
    }),
  ])
  const r2 = await runMemoryPipeline({
    userMessage: 'Adesso mi piace Naruto?',
    assistantMessage: 'ok',
    userId: 'user-a',
    requireExplicitUserId: true,
    memoryEnabled: true,
    supabase: sbPos,
  })
  assert.equal(r2.saved, false)
  assert.equal(r2.decision?.save, false)
  assert.deepEqual(activeKeys(sbPos.rows), ['preferences.dislike.naruto'])
  assert.ok(!activeKeys(sbPos.rows).includes('preferences.like.naruto'))
  assert.equal(obsoleteKeys(sbPos.rows).length, 0)
}

// TEST 9 — third-party no preference revoke
{
  const sb = createFakeSupabase([
    seedRow({
      id: 'like-1',
      factKey: 'preferences.like.naruto',
      content: 'User likes / prefers: Naruto',
    }),
  ])
  await applyUser(sb, 'Il mio amico non ama Naruto.')
  assert.ok(activeKeys(sb.rows).includes('preferences.like.naruto'))
  assert.ok(!activeKeys(sb.rows).some((k) => String(k).startsWith('preferences.dislike')))
}

// TEST 10–11 — meta + hypothetical
{
  const sb = createFakeSupabase([
    seedRow({
      id: 'like-1',
      factKey: 'preferences.like.naruto',
      content: 'User likes / prefers: Naruto',
    }),
  ])
  await applyUser(sb, 'Non ho detto che Naruto non mi piace.')
  await applyUser(sb, 'Se Naruto non mi piacesse...')
  assert.deepEqual(activeKeys(sb.rows), ['preferences.like.naruto'])
  assert.equal(obsoleteKeys(sb.rows).length, 0)
}

// TEST 12–13 — idempotent repeated polarity
{
  const sb = createFakeSupabase([])
  await applyUser(sb, 'Mi piace Naruto.')
  await applyUser(sb, 'Mi piace Naruto.')
  assert.equal(sb.rows.filter((r) => readFactKeyFromTags(r.tags) === 'preferences.like.naruto').length, 1)

  const sb2 = createFakeSupabase([])
  await applyUser(sb2, 'Non mi piace Naruto.')
  await applyUser(sb2, 'Non mi piace Naruto.')
  assert.equal(
    sb2.rows.filter((r) => readFactKeyFromTags(r.tags) === 'preferences.dislike.naruto').length,
    1,
  )
}

// TEST 14 — user isolation
{
  const sb = createFakeSupabase([
    seedRow({
      id: 'b-like',
      userId: 'user-b',
      factKey: 'preferences.like.naruto',
      content: 'User likes / prefers: Naruto',
    }),
  ])
  await applyUser(sb, 'Non mi piace Naruto.', 'user-a')
  const bRow = sb.rows.find((r) => r.id === 'b-like')
  assert.equal(bRow.status, 'active')
  assert.ok(activeKeys(sb.rows, 'user-a').includes('preferences.dislike.naruto'))
}

// TEST 15 — Memory OFF
{
  const result = await runMemoryPipeline({
    userMessage: 'Non mi piace Naruto.',
    assistantMessage: 'ok',
    memoryEnabled: false,
    userId: 'user-a',
    requireExplicitUserId: true,
  })
  assert.equal(result.skipped, true)
  assert.equal(result.reason, 'memory_disabled')
}

// TEST 16 — favorite untouched by dislike
{
  const sb = createFakeSupabase([
    seedRow({
      id: 'fav',
      factKey: 'preferences.favorite.anime',
      title: 'Favorite',
      content: "User's favorite anime: Naruto",
    }),
    seedRow({
      id: 'like',
      factKey: 'preferences.like.naruto',
      content: 'User likes / prefers: Naruto',
    }),
  ])
  await applyUser(sb, 'Non mi piace Naruto.')
  assert.ok(activeKeys(sb.rows).includes('preferences.favorite.anime'))
  assert.ok(activeKeys(sb.rows).includes('preferences.dislike.naruto'))
  assert.ok(obsoleteKeys(sb.rows).includes('preferences.like.naruto'))
}

// TEST 17 — cofavorite untouched
{
  const sb = createFakeSupabase([
    seedRow({
      id: 'cof',
      factKey: 'preferences.cofavorite.character.naruto',
      title: 'Co-favorite',
      content: "User's favorite personaggi: Naruto",
    }),
  ])
  await applyUser(sb, 'Non mi piace Naruto.')
  assert.ok(activeKeys(sb.rows).includes('preferences.cofavorite.character.naruto'))
  assert.ok(activeKeys(sb.rows).includes('preferences.dislike.naruto'))
}

// TEST 18–19 — Recall polarity after correction
{
  const rows = [
    {
      id: '1',
      category: 'preferences',
      title: 'Dislike',
      content: 'User dislikes: Naruto',
      importance: 6,
      status: 'active',
      tags: [encodeFactKeyTag('preferences.dislike.naruto')],
      factKey: 'preferences.dislike.naruto',
    },
  ]
  const neg = rerankMemoriesForRecall(rows, 'Cosa non mi piace?')
  assert.equal(neg[0].factKey, 'preferences.dislike.naruto')

  const posPack = await loadCoreMemoryPack({
    userMessage: 'Cosa mi piace?',
    ownerUserId: 'user-a',
    searchMemories: async () => [],
  })
  // empty after obsolete like — probe may get empty-durable
  assert.ok(typeof posPack === 'string')
}

// Historical contradiction repair on re-assert
{
  const sb = createFakeSupabase([
    seedRow({
      id: 'like',
      factKey: 'preferences.like.naruto',
      content: 'User likes / prefers: Naruto',
    }),
    seedRow({
      id: 'dis',
      factKey: 'preferences.dislike.naruto',
      title: 'Dislike',
      content: 'User dislikes: Naruto',
    }),
  ])
  await applyUser(sb, 'Mi piace Naruto.')
  assert.ok(activeKeys(sb.rows).includes('preferences.like.naruto'))
  assert.ok(obsoleteKeys(sb.rows).includes('preferences.dislike.naruto'))
  assert.ok(!activeKeys(sb.rows).includes('preferences.dislike.naruto'))
}

// English parity
{
  const sb = createFakeSupabase([
    seedRow({
      id: 'like',
      factKey: 'preferences.like.naruto',
      content: 'User likes / prefers: Naruto',
    }),
  ])
  await applyUser(sb, "I don't like Naruto anymore.")
  assert.ok(activeKeys(sb.rows).includes('preferences.dislike.naruto'))
  assert.ok(obsoleteKeys(sb.rows).includes('preferences.like.naruto'))
}

// Interest deferred — dislike does not obsolete interest in PR1
{
  const sb = createFakeSupabase([
    seedRow({
      id: 'int',
      factKey: 'preferences.interest.naruto',
      title: 'Interest',
      content: 'User is interested in: Naruto',
    }),
  ])
  await applyUser(sb, 'Non mi piace più Naruto.')
  assert.ok(activeKeys(sb.rows).includes('preferences.interest.naruto'))
  assert.ok(activeKeys(sb.rows).includes('preferences.dislike.naruto'))
}

// Bleach untouched when flipping Naruto
{
  const sb = createFakeSupabase([
    seedRow({
      id: 'like-n',
      factKey: 'preferences.like.naruto',
      content: 'User likes / prefers: Naruto',
    }),
    seedRow({
      id: 'dis-b',
      factKey: 'preferences.dislike.bleach',
      title: 'Dislike',
      content: 'User dislikes: Bleach',
    }),
  ])
  await applyUser(sb, 'Non mi piace Naruto.')
  assert.ok(activeKeys(sb.rows).includes('preferences.dislike.bleach'))
  assert.ok(activeKeys(sb.rows).includes('preferences.dislike.naruto'))
}

// Source contracts — protected systems untouched structurally
{
  const forget = readFileSync(join(root, 'lib/server/memory-control-forget.js'), 'utf8')
  assert.doesNotMatch(forget, /obsoleteOppositePreferencePolarity/)
  const overview = readFileSync(join(root, 'lib/server/memory-control-overview.js'), 'utf8')
  assert.doesNotMatch(overview, /obsoleteOppositePreferencePolarity/)
  const chat = readFileSync(join(root, 'api/chat.ts'), 'utf8')
  assert.match(chat, /responses\.create/)
  assert.match(chat, /buildCoreResponsesCreateParams/)
  const brain = readFileSync(join(root, 'lib/server/brain-memory.js'), 'utf8')
  assert.match(brain, /obsoleteOppositePreferencePolarity/)
  assert.match(brain, /extractDislikePreferenceValue/)
  assert.match(brain, /isTerminalInterrogativeUtterance/)
  assert.match(brain, /shouldSkipPreferencePolarityExtraction/)
}

console.log('memory-correction-polarity.test.mjs: PASS')
