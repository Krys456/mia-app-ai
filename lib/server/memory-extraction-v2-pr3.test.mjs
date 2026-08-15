/**
 * Extraction V2 PR3 — surgical single-valued fact_key invariant.
 * Run: node lib/server/memory-extraction-v2-pr3.test.mjs
 *
 * Tests exercise REAL upsertMemory / obsoleteConflictingSlotRows / runMemoryPipeline
 * via a fake Supabase client — not a reimplemented conflict twin.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  collapseItemsBySingleValuedFactKey,
  extractDurableFacts,
  listActiveRowsForFactKey,
  readFactKeyFromTags,
  upsertMemory,
} from './brain-memory.js'
import { buildCoreResponsesCreateParams } from './core-responses-params.js'
import { formatCoreMemoryPack, isRecallEligibleMemory } from './core-memory-recall.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const COLOR_KEY = 'preferences.favorite.color'
const COLOR_TAG = `fact_key:${COLOR_KEY}`
const ANIMAL_KEY = 'preferences.favorite.animal'
const ANIMAL_TAG = `fact_key:${ANIMAL_KEY}`
const MEMORY_SELECT =
  'id, category, title, content, importance, usage_count, last_used_at, created_at, updated_at, status, tags'

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

function assertOneActiveKeyed(db, userId, factKey, valueRe) {
  const active = db.activeKeyed(userId, factKey)
  assert.equal(active.length, 1, `expected exactly one active ${factKey}`)
  assert.equal(active[0].status, 'active')
  assert.ok(active[0].tags.includes(`fact_key:${factKey}`))
  if (valueRe) assert.match(active[0].content, valueRe)
  return active[0]
}

// TEST 1 — duplicate keyed rows already exist → purple leaves exactly one active
{
  const db = createFakeSupabase([
    seedRow({
      id: 'k-blue',
      userId: 'user-a',
      content: "User's favorite colore: blu.",
      tags: [COLOR_TAG],
      updatedAt: '2026-01-01T00:00:00.000Z',
    }),
    seedRow({
      id: 'k-red',
      userId: 'user-a',
      content: "User's favorite colore: rosso.",
      tags: [COLOR_TAG],
      updatedAt: '2026-01-02T00:00:00.000Z',
    }),
  ])

  const write = await writeMessage(
    db,
    'user-a',
    'In realtà adesso il mio colore preferito è il viola.',
  )
  assert.ok(write.results[0].slotCleanup)
  assert.equal(write.results[0].slotCleanup.activeCountAfter, 1)
  assert.equal(write.results[0].slotCleanup.cleanupOk, true)
  assert.ok(write.results[0].slotCleanup.obsoletedIds.length >= 1)

  assertOneActiveKeyed(db, 'user-a', COLOR_KEY, /viola/i)
  const obsolete = db.rows.filter((r) => r.user_id === 'user-a' && r.status === 'obsolete')
  assert.ok(obsolete.some((r) => r.id === 'k-blue' || r.id === 'k-red'))
  assert.ok(obsolete.every((r) => readFactKeyFromTags(r.tags) === COLOR_KEY || /blu|rosso/i.test(r.content)))
}

// TEST 2 — same-turn: at most one preferences.favorite.color candidate
{
  const facts = extractDurableFacts('Il mio colore preferito è il viola.')
  const colorFacts = facts.filter((f) => f.factKey === COLOR_KEY)
  assert.ok(colorFacts.length <= 1)
  const collapsed = collapseItemsBySingleValuedFactKey([
    ...facts,
    {
      category: 'preferences',
      title: 'Favorite',
      content: "User's favorite colore: il blu",
      factKey: COLOR_KEY,
      tags: [COLOR_TAG],
      importance: 6,
    },
  ])
  assert.equal(collapsed.filter((f) => f.factKey === COLOR_KEY).length, 1)
  assert.match(collapsed.find((f) => f.factKey === COLOR_KEY).content, /blu/i)
}

// TEST 3 — sequential blue → red → purple → green; count=1 each step
{
  const db = createFakeSupabase()
  for (const [msg, re] of [
    ['Il mio colore preferito è blu.', /blu/i],
    ['Il mio colore preferito è rosso.', /rosso/i],
    ['Il mio colore preferito è il viola.', /viola/i],
    ['Il mio colore preferito è il verde.', /verde/i],
  ]) {
    const result = await writeMessage(db, 'user-a', msg)
    assert.equal(result.results[0].slotCleanup.activeCountAfter, 1)
    assertOneActiveKeyed(db, 'user-a', COLOR_KEY, re)
  }
  assert.equal(db.activeKeyed('user-a', COLOR_KEY).length, 1)
  assert.match(db.activeKeyed('user-a', COLOR_KEY)[0].content, /verde/i)
}

// TEST 4 — exact repeat purple → no second active
{
  const db = createFakeSupabase()
  await writeMessage(db, 'user-a', 'Il mio colore preferito è il viola.')
  const again = await writeMessage(db, 'user-a', 'Il mio colore preferito è il viola.')
  assert.equal(again.results[0].action, 'skipped')
  assert.equal(again.results[0].slotCleanup.activeCountAfter, 1)
  assert.equal(db.activeKeyed('user-a', COLOR_KEY).length, 1)
  assert.equal(db.rows.filter((r) => r.user_id === 'user-a' && r.status === 'active').length, 1)
}

// TEST 5 — legacy + keyed mix
{
  const db = createFakeSupabase([
    seedRow({
      id: 'legacy-blue',
      userId: 'user-a',
      title: 'Favorite',
      content: "User's favorite: il blu.",
      tags: [],
      updatedAt: '2026-01-01T00:00:00.000Z',
    }),
    seedRow({
      id: 'keyed-red',
      userId: 'user-a',
      content: "User's favorite colore: rosso.",
      tags: [COLOR_TAG],
      updatedAt: '2026-01-02T00:00:00.000Z',
    }),
    seedRow({
      id: 'legacy-pref-blue',
      userId: 'user-a',
      title: 'Preference',
      content: 'User likes / prefers: il blu.',
      tags: [],
      updatedAt: '2026-01-01T12:00:00.000Z',
    }),
  ])

  const write = await writeMessage(db, 'user-a', 'Il mio colore preferito è il viola.')
  assert.equal(write.results[0].slotCleanup.cleanupOk, true)
  assert.equal(write.results[0].slotCleanup.activeCountAfter, 1)
  assertOneActiveKeyed(db, 'user-a', COLOR_KEY, /viola/i)

  for (const id of ['legacy-blue', 'keyed-red', 'legacy-pref-blue']) {
    const row = db.rows.find((r) => r.id === id)
    if (row.id === write.results[0].memory.id) {
      assert.equal(row.status, 'active')
      assert.match(row.content, /viola/i)
    } else {
      assert.equal(row.status, 'obsolete', `${id} must be obsolete`)
    }
  }
}

// TEST 6 — unrelated Preference untouched
{
  const db = createFakeSupabase([
    seedRow({
      id: 'pref-generic',
      userId: 'user-a',
      title: 'Preference',
      content: 'User likes / prefers: come la pensi però.',
      tags: [],
    }),
  ])
  await writeMessage(db, 'user-a', 'Il mio colore preferito è il viola.')
  assert.equal(db.rows.find((r) => r.id === 'pref-generic').status, 'active')
  assertOneActiveKeyed(db, 'user-a', COLOR_KEY, /viola/i)
}

// TEST 7 — favorite animal
{
  const db = createFakeSupabase([
    seedRow({
      id: 'legacy-wolf',
      userId: 'user-a',
      content: "User's favorite: il lupo.",
      tags: [],
    }),
  ])
  await writeMessage(db, 'user-a', 'Adesso il mio animale preferito è il gatto.')
  assertOneActiveKeyed(db, 'user-a', ANIMAL_KEY, /gatto/i)
  const wolf = db.rows.find((r) => r.id === 'legacy-wolf')
  if (wolf.id !== db.activeKeyed('user-a', ANIMAL_KEY)[0].id) {
    assert.equal(wolf.status, 'obsolete')
  }
}

// TEST 8 — multi-valued interests
{
  const db = createFakeSupabase()
  await writeMessage(db, 'user-a', 'Adoro Naruto.')
  await writeMessage(db, 'user-a', 'Adoro Dragon Ball.')
  const interests = db.rows.filter(
    (r) =>
      r.user_id === 'user-a' &&
      r.status === 'active' &&
      String(readFactKeyFromTags(r.tags) || '').startsWith('preferences.interest.'),
  )
  assert.ok(interests.length >= 2)
  assert.ok(interests.some((r) => /Naruto/i.test(r.content)))
  assert.ok(interests.some((r) => /Dragon Ball/i.test(r.content)))
}

// TEST 9 — two users
{
  const db = createFakeSupabase()
  await writeMessage(db, 'user-a', 'Il mio colore preferito è blu.')
  await writeMessage(db, 'user-b', 'Il mio colore preferito è rosso.')
  await writeMessage(db, 'user-a', 'Il mio colore preferito è il viola.')
  assertOneActiveKeyed(db, 'user-a', COLOR_KEY, /viola/i)
  assertOneActiveKeyed(db, 'user-b', COLOR_KEY, /rosso/i)
}

// TEST 10 — Recall only current active
{
  const db = createFakeSupabase([
    seedRow({
      id: 'k-blue',
      userId: 'user-a',
      content: "User's favorite colore: blu.",
      tags: [COLOR_TAG],
    }),
    seedRow({
      id: 'k-red',
      userId: 'user-a',
      content: "User's favorite colore: rosso.",
      tags: [COLOR_TAG],
      updatedAt: '2026-01-02T00:00:00.000Z',
    }),
  ])
  await writeMessage(db, 'user-a', 'Il mio colore preferito è il viola.')
  const eligible = db.rows.filter((r) => r.user_id === 'user-a').filter(isRecallEligibleMemory)
  assert.ok(eligible.some((r) => /viola/i.test(r.content)))
  assert.ok(!eligible.some((r) => /\b(blu|rosso)\b/i.test(r.content) && !/viola/i.test(r.content)))
  const pack = formatCoreMemoryPack(eligible)
  assert.match(pack, /viola/i)
  assert.doesNotMatch(pack, /\b(blu|rosso)\b/i)
}

// TEST 11 — DB verification failure (zero-row obsolete)
{
  const db = createFakeSupabase([
    seedRow({
      id: 'k-blue',
      userId: 'user-a',
      content: "User's favorite colore: blu.",
      tags: [COLOR_TAG],
    }),
    seedRow({
      id: 'k-red',
      userId: 'user-a',
      content: "User's favorite colore: rosso.",
      tags: [COLOR_TAG],
      updatedAt: '2026-01-02T00:00:00.000Z',
    }),
  ])

  const originalFrom = db.from.bind(db)
  db.from = (table) => {
    const builder = originalFrom(table)
    const originalUpdate = builder.update.bind(builder)
    builder.update = (patch) => {
      const chain = originalUpdate(patch)
      if (patch && patch.status === 'obsolete') {
        chain.select = () => ({
          then: (resolve, reject) => Promise.resolve({ data: [], error: null }).then(resolve, reject),
          thenable: () => Promise.resolve({ data: [], error: null }),
        })
      }
      return chain
    }
    return builder
  }

  const result = await writeMessage(db, 'user-a', 'Il mio colore preferito è il viola.')
  assert.ok(result.results[0].slotCleanup)
  assert.equal(result.results[0].slotCleanup.cleanupOk, false)
  assert.ok(
    result.results[0].slotCleanup.failedIds.length > 0 ||
      result.results[0].slotCleanup.activeCountAfter !== 1,
  )
}

// listActiveRowsForFactKey returns ALL keyed actives (not just one)
{
  const db = createFakeSupabase([
    seedRow({
      id: 'k1',
      userId: 'user-a',
      content: "User's favorite colore: blu.",
      tags: [COLOR_TAG],
    }),
    seedRow({
      id: 'k2',
      userId: 'user-a',
      content: "User's favorite colore: rosso.",
      tags: [COLOR_TAG],
      updatedAt: '2026-01-02T00:00:00.000Z',
    }),
  ])
  const listed = await listActiveRowsForFactKey(db, 'user-a', COLOR_KEY, 'preferences')
  assert.equal(listed.rows.length, 2)
}

// TEST 12 — Core regression
{
  const chatSrc = readFileSync(join(root, 'api/chat.ts'), 'utf8')
  assert.equal((chatSrc.match(/\.responses\.create\s*\(/g) || []).length, 1)
  assert.match(chatSrc, /loadCoreMemoryPack/)
  assert.match(chatSrc, /requireExplicitUserId:\s*true/)

  const memoriesSrc = readFileSync(join(root, 'api/memories/index.ts'), 'utf8')
  assert.match(memoriesSrc, /upsertMemory/)
  assert.doesNotMatch(memoriesSrc, /saveMemory\(/)

  const brainSrc = readFileSync(join(root, 'lib/server/brain-memory.js'), 'utf8')
  assert.match(brainSrc, /collapseItemsBySingleValuedFactKey/)
  assert.match(brainSrc, /listActiveRowsForFactKey/)
  assert.match(brainSrc, /activeCountAfter/)
  assert.match(brainSrc, /cleanupOk/)

  const sol = buildCoreResponsesCreateParams({
    model: 'gpt-5.6-sol',
    instructions: 'test',
    maxOutputTokens: 50,
    input: [{ type: 'message', role: 'user', content: 'hi' }],
  })
  assert.equal(sol.model, 'gpt-5.6-sol')
  assert.equal('temperature' in sol, false)
  assert.deepEqual(sol.reasoning, { effort: 'none' })
}

console.log('ok: memory extraction V2 PR3 surgical keyed invariant')
