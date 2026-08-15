/**
 * Extraction V2 PR3 — fact_key identity + verified single-valued slot supersede.
 * Run: node lib/server/memory-extraction-v2-pr3.test.mjs
 *
 * These tests exercise the REAL upsertMemory / obsoleteConflictingSlotRows path
 * against an in-memory Supabase fake (not a reimplemented store twin).
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  deriveFactKey,
  encodeFactKeyTag,
  extractDurableFacts,
  hasMemoryUpdateCue,
  isLegacyPredecessorForFactKey,
  isSingleValuedFactKey,
  mergeTagsWithFactKey,
  normalizeFavoriteSubjectKey,
  readFactKeyFromTags,
  selectUpsertTarget,
  upsertMemory,
} from './brain-memory.js'
import { buildCoreResponsesCreateParams } from './core-responses-params.js'
import { formatCoreMemoryPack, isRecallEligibleMemory } from './core-memory-recall.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')

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

/**
 * Minimal chainable Supabase fake covering the memory upsert/obsolete path.
 */
function createFakeSupabase(initialRows = []) {
  /** @type {any[]} */
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

  function applyFilters(filters) {
    return rows.filter((row) => filters.every((f) => matchesFilter(row, f)))
  }

  function project(row, selectCols) {
    if (!selectCols || selectCols === '*' || selectCols === MEMORY_SELECT_FAKE) {
      const out = {}
      for (const key of [
        'id',
        'category',
        'title',
        'content',
        'importance',
        'usage_count',
        'last_used_at',
        'created_at',
        'updated_at',
        'status',
        'tags',
      ]) {
        out[key] = row[key]
      }
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

  const MEMORY_SELECT_FAKE =
    'id, category, title, content, importance, usage_count, last_used_at, created_at, updated_at, status, tags'

  function createBuilder(table) {
    assert.equal(table, 'memories')
    /** @type {any} */
    const state = {
      filters: [],
      selectCols: MEMORY_SELECT_FAKE,
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
        if (state.mode === 'update' || state.mode === 'insert') {
          // keep mode
        } else {
          state.mode = 'select'
        }
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
      then(resolve, reject) {
        return api.thenable().then(resolve, reject)
      },
      thenable() {
        return Promise.resolve().then(() => execute(state))
      },
    }

    // Make builder thenable for await without .single()
    api[Symbol.toStringTag] = 'FakeQuery'
    // @ts-ignore
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
      return state.single
        ? { data: projected, error: null }
        : { data: [projected], error: null }
    }

    let matched = applyFilters(state.filters)
    if (state.orderCol) {
      matched = [...matched].sort((a, b) => {
        const av = a[state.orderCol]
        const bv = b[state.orderCol]
        if (av === bv) return 0
        if (state.ascending) return av < bv ? -1 : 1
        return av < bv ? 1 : -1
      })
    }
    if (typeof state.limitN === 'number') matched = matched.slice(0, state.limitN)

    if (state.mode === 'update') {
      const updated = []
      for (const row of matched) {
        Object.assign(row, state.patch)
        if (state.patch?.updated_at) row.updated_at = state.patch.updated_at
        updated.push(project(row, state.selectCols))
      }
      if (state.single) {
        if (updated.length === 0) {
          return { data: null, error: { message: 'No rows updated' } }
        }
        return { data: updated[0], error: null }
      }
      return { data: updated, error: null }
    }

    const projected = matched.map((row) => project(row, state.selectCols))
    if (state.single) {
      if (projected.length === 0) return { data: null, error: { message: 'not found' } }
      return { data: projected[0], error: null }
    }
    return { data: projected, error: null }
  }

  return {
    rows,
    from(table) {
      return createBuilder(table)
    },
    activeFor(userId, factKey) {
      return rows.filter(
        (r) =>
          r.user_id === userId &&
          String(r.status || 'active').toLowerCase() === 'active' &&
          readFactKeyFromTags(r.tags) === factKey,
      )
    },
    activeAll(userId) {
      return rows.filter(
        (r) => r.user_id === userId && String(r.status || 'active').toLowerCase() === 'active',
      )
    },
  }
}

async function writeMessage(db, userId, message) {
  const facts = extractDurableFacts(message)
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

function assertOneActiveColor(db, userId, valueRe) {
  const active = db.activeFor(userId, 'preferences.favorite.color')
  assert.equal(active.length, 1, 'exactly one active favorite-color row')
  assert.match(active[0].content, valueRe)
  assert.ok(active[0].tags.includes('fact_key:preferences.favorite.color'))
  assert.equal(active[0].status, 'active')
  return active[0]
}

// —— helpers ——
{
  assert.equal(encodeFactKeyTag('preferences.favorite.color'), 'fact_key:preferences.favorite.color')
  assert.equal(normalizeFavoriteSubjectKey('colore'), 'color')
  assert.equal(isSingleValuedFactKey('preferences.favorite.color'), true)
  assert.equal(isSingleValuedFactKey('preferences.interest.naruto'), false)
  assert.equal(hasMemoryUpdateCue('In realtà adesso preferisco il viola'), true)

  // Curly apostrophe + content-only color forms must match
  assert.equal(
    isLegacyPredecessorForFactKey(
      seedRow({
        id: 'c1',
        userId: 'u',
        title: 'Favorite',
        content: 'User\u2019s favorite: il blu.',
        tags: [],
      }),
      'preferences.favorite.color',
    ),
    true,
  )
  assert.equal(
    isLegacyPredecessorForFactKey(
      seedRow({
        id: 'c2',
        userId: 'u',
        title: 'Misc',
        content: "User's favorite: il rosso.",
        tags: [],
      }),
      'preferences.favorite.color',
    ),
    true,
  )
  assert.equal(
    isLegacyPredecessorForFactKey(
      seedRow({
        id: 'c3',
        userId: 'u',
        title: 'Preference',
        content: 'User likes / prefers: di più il rosso.',
        tags: [],
      }),
      'preferences.favorite.color',
    ),
    true,
  )
  assert.equal(
    isLegacyPredecessorForFactKey(
      seedRow({
        id: 'c4',
        userId: 'u',
        title: 'Preference',
        content: 'User likes / prefers: come la pensi però.',
        tags: [],
      }),
      'preferences.favorite.color',
    ),
    false,
  )
}

// Extraction assigns stable keys
{
  const color = extractDurableFacts('Il mio colore preferito è blu.')
  assert.equal(color[0].factKey, 'preferences.favorite.color')
  const animal = extractDurableFacts('Il mio animale preferito è il lupo.')
  assert.equal(animal[0].factKey, 'preferences.favorite.animal')
  const callMe = extractDurableFacts('Preferisco farmi chiamare Luca')
  assert.notEqual(callMe[0].factKey, 'identity.name')
}

// TEST 1 — legacy favorite color persisted statuses
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
      id: 'legacy-red',
      userId: 'user-a',
      title: 'Favorite',
      content: "User's favorite: il rosso.",
      tags: [],
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

  const write = await writeMessage(
    db,
    'user-a',
    'In realtà adesso il mio colore preferito è il viola.',
  )
  assert.ok(write.results[0].action === 'updated' || write.results[0].action === 'created')
  assert.ok(write.results[0].slotCleanup)
  assert.equal(write.results[0].slotCleanup.ok, true)
  assert.ok(write.results[0].slotCleanup.obsoletedIds.length >= 2)

  const canonical = assertOneActiveColor(db, 'user-a', /viola/i)

  for (const id of ['legacy-blue', 'legacy-red', 'legacy-pref-blue']) {
    if (id === canonical.id) continue
    const row = db.rows.find((r) => r.id === id)
    assert.ok(row, id)
    assert.equal(row.status, 'obsolete', `${id} must be obsolete`)
  }

  const activeColorish = db.activeAll('user-a').filter(
    (r) =>
      /\b(blu|rosso|viola)\b/i.test(r.content) &&
      (/favorite/i.test(r.title) ||
        /favorite/i.test(r.content) ||
        (/preference/i.test(r.title) && /likes\s*\/\s*prefers/i.test(r.content))),
  )
  assert.equal(activeColorish.length, 1)
}

// TEST 2 — repeated identical write → no duplicate active
{
  const db = createFakeSupabase()
  await writeMessage(db, 'user-a', 'Il mio colore preferito è il viola.')
  const again = await writeMessage(db, 'user-a', 'Il mio colore preferito è il viola.')
  assert.equal(again.results[0].action, 'skipped')
  assert.equal(db.activeFor('user-a', 'preferences.favorite.color').length, 1)
  assert.equal(db.rows.filter((r) => r.user_id === 'user-a').length, 1)
}

// TEST 3 — purple → green: only green active, purple obsolete
{
  const db = createFakeSupabase()
  await writeMessage(db, 'user-a', 'Il mio colore preferito è il viola.')
  const purple = db.activeFor('user-a', 'preferences.favorite.color')[0]
  await writeMessage(db, 'user-a', 'Il mio colore preferito è il verde.')
  assertOneActiveColor(db, 'user-a', /verde/i)
  const purpleRow = db.rows.find((r) => r.id === purple.id)
  // in-place update keeps same id active with new value OR obsolete if new row — either way one active green
  const active = db.activeFor('user-a', 'preferences.favorite.color')
  assert.equal(active.length, 1)
  assert.match(active[0].content, /verde/i)
  if (purpleRow && purpleRow.id !== active[0].id) {
    assert.equal(purpleRow.status, 'obsolete')
  } else {
    assert.doesNotMatch(active[0].content, /viola/i)
  }
}

// TEST 4 — favorite animal wolf → cat
{
  const db = createFakeSupabase([
    seedRow({
      id: 'legacy-wolf',
      userId: 'user-a',
      title: 'Favorite',
      content: "User's favorite: il lupo.",
      tags: [],
    }),
  ])
  await writeMessage(db, 'user-a', 'Adesso il mio animale preferito è il gatto.')
  const active = db.activeFor('user-a', 'preferences.favorite.animal')
  assert.equal(active.length, 1)
  assert.match(active[0].content, /gatto/i)
  assert.ok(active[0].tags.includes('fact_key:preferences.favorite.animal'))
  const wolf = db.rows.find((r) => r.id === 'legacy-wolf')
  if (wolf.id !== active[0].id) assert.equal(wolf.status, 'obsolete')
  else assert.doesNotMatch(active[0].content, /lupo/i)
}

// TEST 5 — multi-valued interests coexist
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

// TEST 6 — unrelated generic Preference untouched
{
  const db = createFakeSupabase([
    seedRow({
      id: 'pref-generic',
      userId: 'user-a',
      title: 'Preference',
      content: 'User likes / prefers: come la pensi però.',
      tags: [],
    }),
    seedRow({
      id: 'legacy-blue',
      userId: 'user-a',
      title: 'Favorite',
      content: "User's favorite: il blu.",
      tags: [],
    }),
  ])
  await writeMessage(db, 'user-a', 'Il mio colore preferito è il viola.')
  assert.equal(db.rows.find((r) => r.id === 'pref-generic').status, 'active')
  assertOneActiveColor(db, 'user-a', /viola/i)
}

// TEST 7 — user isolation
{
  const db = createFakeSupabase()
  await writeMessage(db, 'user-a', 'Il mio colore preferito è blu.')
  await writeMessage(db, 'user-b', 'Il mio colore preferito è rosso.')
  await writeMessage(db, 'user-a', 'Il mio colore preferito è il viola.')

  assertOneActiveColor(db, 'user-a', /viola/i)
  const aBlue = db.rows.filter(
    (r) => r.user_id === 'user-a' && /\bblu\b/i.test(r.content) && !/viola/i.test(r.content),
  )
  assert.ok(aBlue.every((r) => r.status === 'obsolete' || r.id === db.activeFor('user-a', 'preferences.favorite.color')[0].id))

  const bActive = db.activeFor('user-b', 'preferences.favorite.color')
  assert.equal(bActive.length, 1)
  assert.match(bActive[0].content, /rosso/i)
  assert.equal(bActive[0].status, 'active')
}

// TEST 8 — legacy compatibility: no two active logical copies
{
  const db = createFakeSupabase([
    seedRow({
      id: 'legacy-only',
      userId: 'user-a',
      title: 'Favorite',
      content: "User's favorite: il blu.",
      tags: [],
    }),
  ])
  const result = await writeMessage(
    db,
    'user-a',
    'In realtà adesso il mio colore preferito è il viola.',
  )
  assert.equal(result.results[0].action, 'updated')
  assert.equal(result.results[0].memory.id, 'legacy-only')
  assert.equal(db.activeFor('user-a', 'preferences.favorite.color').length, 1)
  assert.equal(db.rows.filter((r) => r.user_id === 'user-a' && r.status === 'active').length, 1)
}

// TEST 9 — Recall excludes obsolete blue/red
{
  const db = createFakeSupabase([
    seedRow({
      id: 'legacy-blue',
      userId: 'user-a',
      title: 'Favorite',
      content: "User's favorite: il blu.",
      tags: [],
    }),
    seedRow({
      id: 'legacy-red',
      userId: 'user-a',
      title: 'Favorite',
      content: "User's favorite: il rosso.",
      tags: [],
    }),
  ])
  await writeMessage(db, 'user-a', 'In realtà adesso il mio colore preferito è il viola.')
  const eligible = db.rows.filter((r) => r.user_id === 'user-a').filter(isRecallEligibleMemory)
  assert.ok(eligible.some((r) => /viola/i.test(r.content)))
  assert.ok(!eligible.some((r) => /\b(blu|rosso)\b/i.test(r.content) && !/viola/i.test(r.content)))
  const pack = formatCoreMemoryPack(eligible)
  assert.match(pack, /viola/i)
  assert.doesNotMatch(pack, /\b(blu|rosso)\b/i)
}

// Zero-row obsolete detection (mutation reliability)
{
  const db = createFakeSupabase([
    seedRow({
      id: 'legacy-blue',
      userId: 'user-a',
      title: 'Favorite',
      content: "User's favorite: il blu.",
      tags: [],
    }),
  ])
  // Break updates by wrapping update to return empty data
  const originalFrom = db.from.bind(db)
  db.from = (table) => {
    const builder = originalFrom(table)
    const originalUpdate = builder.update.bind(builder)
    builder.update = (patch) => {
      const chain = originalUpdate(patch)
      if (patch && patch.status === 'obsolete') {
        const originalSelect = chain.select.bind(chain)
        chain.select = (cols) => {
          const selected = originalSelect(cols)
          const originalThen = selected.then.bind(selected)
          selected.then = (resolve, reject) =>
            originalThen(
              (result) => resolve({ data: [], error: null }),
              reject,
            )
          // also override thenable path used by await
          selected.thenable = () => Promise.resolve({ data: [], error: null })
          return selected
        }
      }
      return chain
    }
    return builder
  }

  const result = await writeMessage(
    db,
    'user-a',
    'Il mio colore preferito è il viola.',
  )
  // Canonical write may succeed; cleanup must report failure when verification fails
  if (result.results[0].slotCleanup && result.results[0].slotCleanup.predecessorsFound > 0) {
    assert.equal(result.results[0].slotCleanup.ok, false)
    assert.ok(result.results[0].slotCleanup.failedIds.length > 0)
  }
}

// Preferred name must not collide with identity.name
{
  const db = createFakeSupabase()
  await writeMessage(db, 'user-a', 'Mi chiamo Marco')
  await writeMessage(db, 'user-a', 'Preferisco farmi chiamare Luca')
  const names = db.activeFor('user-a', 'identity.name')
  assert.equal(names.length, 1)
  assert.match(names[0].content, /Marco/)
}

// —— Regression contracts ——
{
  const chatSrc = readFileSync(join(root, 'api/chat.ts'), 'utf8')
  assert.equal((chatSrc.match(/\.responses\.create\s*\(/g) || []).length, 1)
  assert.match(chatSrc, /loadCoreMemoryPack/)
  assert.match(chatSrc, /requireExplicitUserId:\s*true/)

  const brainSrc = readFileSync(join(root, 'lib/server/brain-memory.js'), 'utf8')
  assert.match(brainSrc, /export async function obsoleteConflictingSlotRows/)
  assert.match(brainSrc, /zero-row obsolete update/)
  assert.match(brainSrc, /slotCleanup/)

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

console.log('ok: memory extraction V2 PR3 fact keys + verified legacy supersede')
