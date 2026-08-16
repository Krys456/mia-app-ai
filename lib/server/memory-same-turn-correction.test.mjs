/**
 * Memory 2.1 PR #259 — same-turn corrections + reassertion hygiene.
 * Run: node --test lib/server/memory-same-turn-correction.test.mjs
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  encodeFactKeyTag,
  extractDurableFacts,
  extractLikePreferenceValue,
  extractCofavoriteReplaceSetCandidate,
  hasIncompatibleMixedFavoriteOps,
  identityNameValueFromContent,
  readFactKeyFromTags,
  resolveSameTurnCorrection,
  runMemoryPipeline,
  favoriteValueSlugFromContent,
} from './brain-memory.js'
import { buildCoreResponsesCreateParams } from './core-responses-params.js'
import { isOverviewEligibleMemory, selectOverviewMemories } from './memory-control-overview.js'
import { isRecallEligibleMemory } from './core-memory-recall.js'

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
    title: partial.title || 'Fact',
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

function createFakeSupabase(initialRows = [], options = {}) {
  const rows = initialRows.map((r) => ({ ...r, tags: [...(r.tags || [])] }))
  let seq = rows.length + 1
  const failWrites = options.failWrites === true

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
      if (failWrites) return { data: null, error: { message: 'simulated insert failure' } }
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
      if (failWrites) return { data: null, error: { message: 'simulated update failure' } }
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

function activeKey(rows, key, userId = 'user-a') {
  return rows.find(
    (r) =>
      r.user_id === userId &&
      String(r.status) === 'active' &&
      readFactKeyFromTags(r.tags) === key,
  )
}

function activeName(rows, userId = 'user-a') {
  const row = activeKey(rows, 'identity.name', userId)
  return row ? identityNameValueFromContent(row.content) : null
}

function activeFavoriteAnime(rows) {
  const row = activeKey(rows, 'preferences.favorite.anime')
  return row ? favoriteValueSlugFromContent(row.content) : null
}

test('TEST 1 — Mi chiamo Marco, anzi Luca → Luca', async () => {
  const db = createFakeSupabase()
  await pipeline(db, 'Mi chiamo Marco, anzi Luca.')
  assert.equal(activeName(db.rows), 'Luca')
})

test('TEST 2 — Mi chiamo Marco, anzi mi chiamo Luca → Luca', async () => {
  const db = createFakeSupabase()
  await pipeline(db, 'Mi chiamo Marco, anzi mi chiamo Luca.')
  assert.equal(activeName(db.rows), 'Luca')
})

test('TEST 3 — My name is Marco, actually Luca → Luca', async () => {
  const db = createFakeSupabase()
  await pipeline(db, 'My name is Marco, actually Luca.')
  assert.equal(activeName(db.rows), 'Luca')
})

test('TEST 4 — anime preferito Naruto, anzi Dragon Ball', async () => {
  const db = createFakeSupabase()
  await pipeline(db, 'Il mio anime preferito è Naruto, anzi Dragon Ball.')
  assert.equal(activeFavoriteAnime(db.rows), 'dragon_ball')
})

test('TEST 5 — My favorite anime is Naruto, actually Dragon Ball', async () => {
  const db = createFakeSupabase()
  await pipeline(db, 'My favorite anime is Naruto, actually Dragon Ball.')
  assert.equal(activeFavoriteAnime(db.rows), 'dragon_ball')
})

test('TEST 6 — progetto principale LAIfe, anzi Nexus', async () => {
  const db = createFakeSupabase()
  await pipeline(db, 'Il mio progetto principale è LAIfe, anzi Nexus.')
  const row = activeKey(db.rows, 'projects.primary')
  assert.match(row.content, /Nexus/i)
  assert.ok(!/LAIfe/i.test(row.content) || /Nexus/i.test(row.content))
})

test('TEST 7 — My main project is LAIfe, actually Nexus', async () => {
  const db = createFakeSupabase()
  await pipeline(db, 'My main project is LAIfe, actually Nexus.')
  assert.match(activeKey(db.rows, 'projects.primary').content, /Nexus/i)
})

test('TEST 8 — bare e contradiction is NOT last-wins', async () => {
  const db = createFakeSupabase()
  await pipeline(db, 'Mi chiamo Marco e mi chiamo Luca.')
  assert.equal(activeName(db.rows), 'Marco')
  assert.equal(resolveSameTurnCorrection('Mi chiamo Marco e mi chiamo Luca.').mode, 'none')
})

test('TEST 9 — revoke + successor IT → Dragon Ball', async () => {
  const db = createFakeSupabase([
    seedRow({
      id: 'fav-1',
      factKey: 'preferences.favorite.anime',
      content: "User's favorite anime: Naruto.",
    }),
  ])
  const facts = extractDurableFacts(
    'Naruto non è più il mio anime preferito; il mio anime preferito è Dragon Ball.',
  )
  assert.ok(facts.some((f) => f.factKey === 'preferences.favorite.anime' && /Dragon Ball/i.test(f.content)))
  assert.ok(!facts.some((f) => f.operation === 'revoke'))
  await pipeline(
    db,
    'Naruto non è più il mio anime preferito; il mio anime preferito è Dragon Ball.',
  )
  assert.equal(activeFavoriteAnime(db.rows), 'dragon_ball')
})

test('TEST 10 — revoke + successor EN → Dragon Ball', async () => {
  const db = createFakeSupabase([
    seedRow({
      id: 'fav-1',
      factKey: 'preferences.favorite.anime',
      content: "User's favorite anime: Naruto.",
    }),
  ])
  await pipeline(
    db,
    'Naruto is no longer my favorite anime. My favorite anime is now Dragon Ball.',
  )
  assert.equal(activeFavoriteAnime(db.rows), 'dragon_ball')
})

test('TEST 11 — successor write failure must NOT empty favorite slot', async () => {
  const db = createFakeSupabase(
    [
      seedRow({
        id: 'fav-1',
        factKey: 'preferences.favorite.anime',
        content: "User's favorite anime: Naruto.",
      }),
    ],
    { failWrites: true },
  )
  let threw = false
  try {
    await pipeline(
      db,
      'Naruto non è più il mio anime preferito; il mio anime preferito è Dragon Ball.',
    )
  } catch {
    threw = true
  }
  // Assert-first architecture: no revoke emitted. On write failure, Naruto must remain.
  // EMPTY active favorite slot is always a FAIL.
  const activeFav = db.rows.filter(
    (r) => r.status === 'active' && readFactKeyFromTags(r.tags) === 'preferences.favorite.anime',
  )
  assert.ok(activeFav.length >= 1, 'must not end with empty favorite slot')
  assert.equal(favoriteValueSlugFromContent(activeFav[0].content), 'naruto')
  assert.ok(threw || activeFav.length >= 1)
})

test('TEST 12 — like → anzi dislike', async () => {
  const db = createFakeSupabase([
    seedRow({
      id: 'like-1',
      factKey: 'preferences.like.naruto',
      content: 'User likes / prefers: Naruto.',
    }),
  ])
  await pipeline(db, 'Mi piace Naruto, anzi non mi piace Naruto.')
  assert.ok(activeKey(db.rows, 'preferences.dislike.naruto'))
  assert.ok(!activeKey(db.rows, 'preferences.like.naruto'))
})

test('TEST 13 — dislike → anzi like', async () => {
  const db = createFakeSupabase([
    seedRow({
      id: 'dis-1',
      factKey: 'preferences.dislike.naruto',
      content: 'User dislikes: Naruto.',
    }),
  ])
  await pipeline(db, 'Non mi piace Naruto, anzi mi piace Naruto.')
  assert.ok(activeKey(db.rows, 'preferences.like.naruto'))
  assert.ok(!activeKey(db.rows, 'preferences.dislike.naruto'))
})

test('TEST 14 — EN like → actually dislike', async () => {
  const db = createFakeSupabase()
  await pipeline(db, "I like Naruto, actually I don't like Naruto.")
  assert.ok(activeKey(db.rows, 'preferences.dislike.naruto'))
})

test('TEST 15 — EN dislike → actually like', async () => {
  const db = createFakeSupabase()
  await pipeline(db, "I don't like Naruto, actually I like Naruto.")
  assert.ok(activeKey(db.rows, 'preferences.like.naruto'))
})

test('TEST 16 — Mi piace di nuovo Naruto → like.naruto', async () => {
  const db = createFakeSupabase()
  await pipeline(db, 'Mi piace di nuovo Naruto.')
  assert.ok(activeKey(db.rows, 'preferences.like.naruto'))
  assert.equal(extractLikePreferenceValue('Mi piace di nuovo Naruto.'), 'Naruto')
})

test('TEST 17 — I like Naruto again → like.naruto', async () => {
  assert.equal(extractLikePreferenceValue('I like Naruto again.'), 'Naruto')
  const db = createFakeSupabase()
  await pipeline(db, 'I like Naruto again.')
  assert.ok(activeKey(db.rows, 'preferences.like.naruto'))
})

test('TEST 18 — Mi piace ancora Naruto → like.naruto', async () => {
  assert.equal(extractLikePreferenceValue('Mi piace ancora Naruto.'), 'Naruto')
  const db = createFakeSupabase()
  await pipeline(db, 'Mi piace ancora Naruto.')
  assert.ok(activeKey(db.rows, 'preferences.like.naruto'))
})

test('TEST 19 — I still like Naruto → like.naruto', async () => {
  assert.equal(extractLikePreferenceValue('I still like Naruto.'), 'Naruto')
  const db = createFakeSupabase()
  await pipeline(db, 'I still like Naruto.')
  assert.ok(activeKey(db.rows, 'preferences.like.naruto'))
})

test('TEST 20 — no filler tokens in fact_keys', async () => {
  for (const msg of [
    'Mi piace di nuovo Naruto.',
    'I like Naruto again.',
    'Mi piace ancora Naruto.',
    'I still like Naruto.',
    'I like Naruto still.',
  ]) {
    for (const f of extractDurableFacts(msg)) {
      assert.ok(!/di_nuovo|again|ancora|still/i.test(f.factKey || ''), msg + ' ' + f.factKey)
    }
  }
})

test('TEST 21 — reassert like over dislike (#255)', async () => {
  const db = createFakeSupabase([
    seedRow({
      id: 'dis-1',
      factKey: 'preferences.dislike.naruto',
      content: 'User dislikes: Naruto.',
    }),
  ])
  await pipeline(db, 'Mi piace di nuovo Naruto.')
  assert.ok(activeKey(db.rows, 'preferences.like.naruto'))
  assert.equal(db.rows.find((r) => r.id === 'dis-1')?.status, 'obsolete')
})

test('TEST 22 — EN mixed still-like skips polluted replace_set', () => {
  const msg = 'Now my favorite characters are Itachi and Kakashi, but I still like Sasuke.'
  assert.equal(hasIncompatibleMixedFavoriteOps(msg), true)
  assert.equal(extractCofavoriteReplaceSetCandidate(msg), null)
  const facts = extractDurableFacts(msg)
  assert.ok(!facts.some((f) => f.operation === 'replace_set'))
  assert.ok(!facts.some((f) => /still|but_i/i.test(f.factKey || '')))
})

test('TEST 23 — IT mixed ancora skips replace_set pollution', () => {
  const msg =
    'Adesso i miei personaggi preferiti sono Itachi e Kakashi, ma Sasuke mi piace ancora.'
  assert.equal(hasIncompatibleMixedFavoriteOps(msg), true)
  assert.equal(extractCofavoriteReplaceSetCandidate(msg), null)
  const facts = extractDurableFacts(msg)
  assert.ok(!facts.some((f) => f.operation === 'replace_set'))
  assert.ok(!facts.some((f) => /ancora/i.test(f.factKey || '')))
})

test('TEST 24 — cofavorite anzi → safe no-write (never anzi_itachi)', () => {
  const msg = 'I miei personaggi preferiti sono Itachi e Sasuke, anzi Itachi e Kakashi.'
  assert.equal(resolveSameTurnCorrection(msg).mode, 'skip_cofavorite_correction')
  const facts = extractDurableFacts(msg)
  assert.equal(facts.length, 0)
  assert.ok(!facts.some((f) => /anzi/i.test(f.factKey || '')))
})

test('TEST 25 — cofavorite actually → never actually_itachi', () => {
  const msg = 'My favorite characters are Itachi and Sasuke, actually Itachi and Kakashi.'
  assert.equal(resolveSameTurnCorrection(msg).mode, 'skip_cofavorite_correction')
  assert.deepEqual(extractDurableFacts(msg), [])
})

test('TEST 26 — correction question → no mutation', async () => {
  const db = createFakeSupabase([
    seedRow({
      id: 'name-1',
      category: 'identity',
      factKey: 'identity.name',
      content: "User's name is Marco.",
      importance: 9,
    }),
  ])
  await pipeline(db, 'Mi chiamo Marco, anzi Luca?')
  assert.equal(activeName(db.rows), 'Marco')
})

test('TEST 27 — meta → no mutation', async () => {
  const db = createFakeSupabase([
    seedRow({
      id: 'name-1',
      category: 'identity',
      factKey: 'identity.name',
      content: "User's name is Marco.",
      importance: 9,
    }),
  ])
  await pipeline(db, 'È falso che mi chiamo Marco, anzi Luca.')
  assert.equal(activeName(db.rows), 'Marco')
})

test('TEST 28 — hedge → no mutation', () => {
  assert.deepEqual(
    extractDurableFacts('Forse il mio anime preferito è Naruto, anzi Dragon Ball.'),
    [],
  )
})

test('TEST 29 — third-party → no first-person identity mutation', async () => {
  const db = createFakeSupabase([
    seedRow({
      id: 'name-1',
      category: 'identity',
      factKey: 'identity.name',
      content: "User's name is Luca.",
      importance: 9,
    }),
  ])
  await pipeline(db, 'Il mio amico si chiama Marco, anzi Luca.')
  assert.equal(activeName(db.rows), 'Luca')
  assert.ok(!extractDurableFacts('Il mio amico si chiama Marco, anzi Luca.').some((f) => f.factKey === 'identity.name'))
})

test('TEST 30 — Memory OFF → no mutation', async () => {
  const db = createFakeSupabase([
    seedRow({
      id: 'name-1',
      category: 'identity',
      factKey: 'identity.name',
      content: "User's name is Marco.",
      importance: 9,
    }),
  ])
  const result = await pipeline(db, 'Mi chiamo Marco, anzi Luca.', 'user-a', false)
  assert.equal(result.reason, 'memory_disabled')
  assert.equal(activeName(db.rows), 'Marco')
})

test('TEST 31 — User A/B isolation', async () => {
  const db = createFakeSupabase([
    seedRow({
      id: 'a',
      userId: 'user-a',
      category: 'identity',
      factKey: 'identity.name',
      content: "User's name is Marco.",
      importance: 9,
    }),
    seedRow({
      id: 'b',
      userId: 'user-b',
      category: 'identity',
      factKey: 'identity.name',
      content: "User's name is Marco.",
      importance: 9,
    }),
  ])
  await pipeline(db, 'Mi chiamo Marco, anzi Luca.', 'user-a')
  assert.equal(activeName(db.rows, 'user-a'), 'Luca')
  assert.equal(activeName(db.rows, 'user-b'), 'Marco')
})

test('TEST 32 — object-elliptical polarity must not guess-mutate', async () => {
  // Deferred case: either no mutation, or original like remains authoritative.
  for (const msg of [
    'Mi piace Naruto, ma in realtà non mi piace.',
    "I like Naruto, but actually I don't.",
  ]) {
    const facts = extractDurableFacts(msg)
    assert.ok(
      !facts.some((f) => f.factKey === 'preferences.dislike.naruto'),
      'must not invent dislike from object-less clause: ' + msg,
    )
    // If anything is written, it must be the clear pre-clause like — not a filler key.
    for (const f of facts) {
      assert.ok(!/ma_in_realta|realta_non|but_actually/i.test(f.factKey || ''), f.factKey)
    }
  }
  const db = createFakeSupabase()
  await pipeline(db, 'Mi piace Naruto, ma in realtà non mi piace.')
  assert.ok(!activeKey(db.rows, 'preferences.dislike.naruto'))
})

test('wrappers preserve correction', async () => {
  const db = createFakeSupabase()
  await pipeline(db, 'Ricorda che mi chiamo Marco, anzi Luca.')
  assert.equal(activeName(db.rows), 'Luca')
})

test('mi correggo elliptical', async () => {
  const db = createFakeSupabase()
  await pipeline(db, 'Mi chiamo Marco. Mi correggo: Luca.')
  assert.equal(activeName(db.rows), 'Luca')
})

test('Overview/Recall eligibility after correction', async () => {
  const db = createFakeSupabase()
  await pipeline(db, 'Mi chiamo Marco, anzi Luca.')
  const active = db.rows.filter(isOverviewEligibleMemory)
  assert.ok(active.some((r) => /Luca/i.test(r.content)))
  assert.ok(!selectOverviewMemories(db.rows).some((r) => /Marco/i.test(r.content) && !/Luca/i.test(r.content)))
  assert.ok(db.rows.filter(isRecallEligibleMemory).some((r) => /Luca/i.test(r.content)))
})

test('Core one responses.create unchanged', () => {
  const params = buildCoreResponsesCreateParams({
    model: 'gpt-5.6-sol',
    input: [{ role: 'user', content: 'Ciao' }],
  })
  assert.equal(params.model, 'gpt-5.6-sol')
  const chatSrc = readFileSync(join(root, 'api/chat.ts'), 'utf8')
  assert.ok((chatSrc.match(/responses\.create/g) || []).length >= 1)
})
