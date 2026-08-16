/**
 * Memory 2.1 PR #260 — deterministic typed Specific Forget targeting.
 * Run: node --test lib/server/memory-specific-forget-targeting.test.mjs
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildCofavoriteFactKey,
  encodeFactKeyTag,
  favoriteValueSlugFromContent,
  readFactKeyFromTags,
} from './brain-memory.js'
import {
  formatCoreMemoryPack,
  isRecallEligibleMemory,
} from './core-memory-recall.js'
import {
  classifySpecificForgetTarget,
  isSpecificForgetIntent,
  isExplicitSaveMemoryIntent,
  isGlobalForgetIntent,
  tryHandleSpecificForget,
  familyAwareForgetLabel,
} from './memory-control-forget.js'
import { isOverviewEligibleMemory, selectOverviewMemories } from './memory-control-overview.js'

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
  const failIds = new Set(options.failIds || [])

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

  function createBuilder() {
    const state = {
      filters: [],
      mode: 'select',
      patch: null,
      insertRow: null,
      orderCol: null,
      ascending: false,
      limitN: null,
      single: false,
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
        return Promise.resolve().then(() => execute(state))
      },
      then(resolve, reject) {
        return Promise.resolve().then(() => execute(state)).then(resolve, reject)
      },
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
        return { data: project(row), error: null }
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
        if (options.failAllUpdates) {
          return { data: null, error: { message: 'db fail' } }
        }
        const idFilter = state.filters.find((f) => f.type === 'eq' && f.column === 'id')
        if (idFilter && failIds.has(String(idFilter.value))) {
          return { data: null, error: { message: 'db fail' } }
        }
        const updated = []
        for (const row of matched) {
          Object.assign(row, state.patch)
          updated.push(project(row))
        }
        return { data: updated, error: null }
      }

      const projected = matched.map((row) => project(row))
      if (state.single) {
        return projected.length
          ? { data: projected[0], error: null }
          : { data: null, error: { message: 'not found' } }
      }
      return { data: projected, error: null }
    }

    return api
  }

  return {
    rows,
    from() {
      return createBuilder()
    },
  }
}

function activeKeys(rows, userId = 'user-a') {
  return rows
    .filter((r) => r.user_id === userId && r.status === 'active')
    .map((r) => readFactKeyFromTags(r.tags))
    .filter(Boolean)
    .sort()
}

function obsoleteKeys(rows, userId = 'user-a') {
  return rows
    .filter((r) => r.user_id === userId && r.status === 'obsolete')
    .map((r) => readFactKeyFromTags(r.tags))
    .filter(Boolean)
    .sort()
}

// ——— Classifier smoke ———
test('classifier precedence: dislike before like; set vs member; value vs slot', () => {
  assert.equal(classifySpecificForgetTarget('Dimentica che non mi piace Naruto.').kind, 'dislike')
  assert.equal(classifySpecificForgetTarget('Dimentica che mi piace Naruto.').kind, 'like')
  assert.equal(
    classifySpecificForgetTarget('Dimentica Sasuke dai miei personaggi preferiti.').kind,
    'cofavorite_member',
  )
  assert.equal(
    classifySpecificForgetTarget('Dimentica i miei personaggi preferiti.').kind,
    'cofavorite_set',
  )
  assert.equal(
    classifySpecificForgetTarget('Dimentica che Naruto è il mio anime preferito.').kind,
    'favorite_value',
  )
  assert.equal(
    classifySpecificForgetTarget('Dimentica il mio anime preferito.').kind,
    'favorite_slot',
  )
  assert.equal(classifySpecificForgetTarget('Forget my favorite characters.').kind, 'cofavorite_set')
  assert.equal(classifySpecificForgetTarget('Forget my favorite anime.').kind, 'favorite_slot')
})

// TEST 1
test('TEST 1 — typed like forget', async () => {
  const db = createFakeSupabase([
    seedRow({
      id: 'like',
      factKey: 'preferences.like.naruto',
      content: 'User likes / prefers: Naruto.',
    }),
  ])
  const r = await tryHandleSpecificForget({
    userMessage: 'Dimentica che mi piace Naruto.',
    userId: 'user-a',
    supabase: db,
  })
  assert.equal(r.status, 'forgotten')
  assert.deepEqual(obsoleteKeys(db.rows), ['preferences.like.naruto'])
})

// TEST 2
test('TEST 2 — like forget leaves favorite', async () => {
  const db = createFakeSupabase([
    seedRow({
      id: 'like',
      factKey: 'preferences.like.naruto',
      content: 'User likes / prefers: Naruto.',
    }),
    seedRow({
      id: 'fav',
      factKey: 'preferences.favorite.anime',
      content: "User's favorite anime: Naruto.",
    }),
  ])
  const r = await tryHandleSpecificForget({
    userMessage: 'Dimentica che mi piace Naruto.',
    userId: 'user-a',
    supabase: db,
  })
  assert.equal(r.status, 'forgotten')
  assert.deepEqual(obsoleteKeys(db.rows), ['preferences.like.naruto'])
  assert.ok(activeKeys(db.rows).includes('preferences.favorite.anime'))
})

// TEST 3
test('TEST 3 — typed dislike forget', async () => {
  const db = createFakeSupabase([
    seedRow({
      id: 'dis',
      factKey: 'preferences.dislike.naruto',
      content: 'User dislikes: Naruto.',
    }),
  ])
  const r = await tryHandleSpecificForget({
    userMessage: 'Dimentica che non mi piace Naruto.',
    userId: 'user-a',
    supabase: db,
  })
  assert.equal(r.status, 'forgotten')
  assert.deepEqual(obsoleteKeys(db.rows), ['preferences.dislike.naruto'])
})

// TEST 4 — CRITICAL polarity regression
test('TEST 4 — EN dislike forget must NOT obsolete like', async () => {
  const db = createFakeSupabase([
    seedRow({
      id: 'like',
      factKey: 'preferences.like.naruto',
      content: 'User likes / prefers: Naruto.',
    }),
  ])
  const r = await tryHandleSpecificForget({
    userMessage: "Forget that I don't like Naruto.",
    userId: 'user-a',
    supabase: db,
  })
  assert.equal(r.status, 'not_found')
  assert.equal(db.rows[0].status, 'active')
  assert.deepEqual(activeKeys(db.rows), ['preferences.like.naruto'])
})

// TEST 5
test('TEST 5 — like+dislike typed dislike forget', async () => {
  const db = createFakeSupabase([
    seedRow({
      id: 'like',
      factKey: 'preferences.like.naruto',
      content: 'User likes / prefers: Naruto.',
    }),
    seedRow({
      id: 'dis',
      factKey: 'preferences.dislike.naruto',
      content: 'User dislikes: Naruto.',
    }),
  ])
  const r = await tryHandleSpecificForget({
    userMessage: 'Dimentica che non mi piace Naruto.',
    userId: 'user-a',
    supabase: db,
  })
  assert.equal(r.status, 'forgotten')
  assert.deepEqual(obsoleteKeys(db.rows), ['preferences.dislike.naruto'])
  assert.ok(activeKeys(db.rows).includes('preferences.like.naruto'))
})

// TEST 6–9 favorite
test('TEST 6 — favorite slot', async () => {
  const db = createFakeSupabase([
    seedRow({
      id: 'fav',
      factKey: 'preferences.favorite.anime',
      content: "User's favorite anime: Naruto.",
    }),
  ])
  const r = await tryHandleSpecificForget({
    userMessage: 'Dimentica il mio anime preferito.',
    userId: 'user-a',
    supabase: db,
  })
  assert.equal(r.status, 'forgotten')
  assert.equal(db.rows[0].status, 'obsolete')
})

test('TEST 7 — favorite value match', async () => {
  const db = createFakeSupabase([
    seedRow({
      id: 'fav',
      factKey: 'preferences.favorite.anime',
      content: "User's favorite anime: Naruto.",
    }),
  ])
  const r = await tryHandleSpecificForget({
    userMessage: 'Dimentica che Naruto è il mio anime preferito.',
    userId: 'user-a',
    supabase: db,
  })
  assert.equal(r.status, 'forgotten')
  assert.equal(db.rows[0].status, 'obsolete')
})

test('TEST 8 — favorite value mismatch keeps Dragon Ball', async () => {
  const db = createFakeSupabase([
    seedRow({
      id: 'fav',
      factKey: 'preferences.favorite.anime',
      content: "User's favorite anime: Dragon Ball.",
    }),
  ])
  const r = await tryHandleSpecificForget({
    userMessage: 'Dimentica che Naruto è il mio anime preferito.',
    userId: 'user-a',
    supabase: db,
  })
  assert.equal(r.status, 'not_found')
  assert.equal(db.rows[0].status, 'active')
  assert.equal(favoriteValueSlugFromContent(db.rows[0].content), 'dragon_ball')
})

test('TEST 9 — favorite-value forget leaves like', async () => {
  const db = createFakeSupabase([
    seedRow({
      id: 'fav',
      factKey: 'preferences.favorite.anime',
      content: "User's favorite anime: Naruto.",
    }),
    seedRow({
      id: 'like',
      factKey: 'preferences.like.naruto',
      content: 'User likes / prefers: Naruto.',
    }),
  ])
  const r = await tryHandleSpecificForget({
    userMessage: 'Dimentica che Naruto è il mio anime preferito.',
    userId: 'user-a',
    supabase: db,
  })
  assert.equal(r.status, 'forgotten')
  assert.deepEqual(obsoleteKeys(db.rows), ['preferences.favorite.anime'])
  assert.ok(activeKeys(db.rows).includes('preferences.like.naruto'))
})

// TEST 10–14 cofavorite
test('TEST 10 — cofavorite set forget', async () => {
  const db = createFakeSupabase([
    seedRow({
      id: 'itachi',
      factKey: buildCofavoriteFactKey('character', 'Itachi'),
      content: "User's co-favorite character: Itachi.",
      title: 'Co-favorite',
    }),
    seedRow({
      id: 'sasuke',
      factKey: buildCofavoriteFactKey('character', 'Sasuke'),
      content: "User's co-favorite character: Sasuke.",
      title: 'Co-favorite',
    }),
  ])
  const r = await tryHandleSpecificForget({
    userMessage: 'Dimentica i miei personaggi preferiti.',
    userId: 'user-a',
    supabase: db,
  })
  assert.equal(r.status, 'forgotten')
  assert.equal(activeKeys(db.rows).length, 0)
  assert.equal(obsoleteKeys(db.rows).length, 2)
})

test('TEST 11 — set forget leaves like', async () => {
  const db = createFakeSupabase([
    seedRow({
      id: 'itachi',
      factKey: buildCofavoriteFactKey('character', 'Itachi'),
      content: "User's co-favorite character: Itachi.",
      title: 'Co-favorite',
    }),
    seedRow({
      id: 'sasuke',
      factKey: buildCofavoriteFactKey('character', 'Sasuke'),
      content: "User's co-favorite character: Sasuke.",
      title: 'Co-favorite',
    }),
    seedRow({
      id: 'like',
      factKey: 'preferences.like.sasuke',
      content: 'User likes / prefers: Sasuke.',
    }),
  ])
  const r = await tryHandleSpecificForget({
    userMessage: 'Forget my favorite characters.',
    userId: 'user-a',
    supabase: db,
  })
  assert.equal(r.status, 'forgotten')
  assert.deepEqual(activeKeys(db.rows), ['preferences.like.sasuke'])
})

test('TEST 12 — cofavorite member', async () => {
  const db = createFakeSupabase([
    seedRow({
      id: 'itachi',
      factKey: buildCofavoriteFactKey('character', 'Itachi'),
      content: "User's co-favorite character: Itachi.",
      title: 'Co-favorite',
    }),
    seedRow({
      id: 'sasuke',
      factKey: buildCofavoriteFactKey('character', 'Sasuke'),
      content: "User's co-favorite character: Sasuke.",
      title: 'Co-favorite',
    }),
  ])
  const r = await tryHandleSpecificForget({
    userMessage: 'Dimentica Sasuke dai miei personaggi preferiti.',
    userId: 'user-a',
    supabase: db,
  })
  assert.equal(r.status, 'forgotten')
  assert.deepEqual(obsoleteKeys(db.rows), [buildCofavoriteFactKey('character', 'Sasuke')])
  assert.deepEqual(activeKeys(db.rows), [buildCofavoriteFactKey('character', 'Itachi')])
})

test('TEST 13 — member forget leaves dislike', async () => {
  const db = createFakeSupabase([
    seedRow({
      id: 'sasuke',
      factKey: buildCofavoriteFactKey('character', 'Sasuke'),
      content: "User's co-favorite character: Sasuke.",
      title: 'Co-favorite',
    }),
    seedRow({
      id: 'dis',
      factKey: 'preferences.dislike.sasuke',
      content: 'User dislikes: Sasuke.',
    }),
  ])
  const r = await tryHandleSpecificForget({
    userMessage: 'Forget Sasuke from my favorite characters.',
    userId: 'user-a',
    supabase: db,
  })
  assert.equal(r.status, 'forgotten')
  assert.ok(activeKeys(db.rows).includes('preferences.dislike.sasuke'))
  assert.ok(obsoleteKeys(db.rows).includes(buildCofavoriteFactKey('character', 'Sasuke')))
})

test('TEST 14 — wrong member not_found', async () => {
  const db = createFakeSupabase([
    seedRow({
      id: 'itachi',
      factKey: buildCofavoriteFactKey('character', 'Itachi'),
      content: "User's co-favorite character: Itachi.",
      title: 'Co-favorite',
    }),
    seedRow({
      id: 'sasuke',
      factKey: buildCofavoriteFactKey('character', 'Sasuke'),
      content: "User's co-favorite character: Sasuke.",
      title: 'Co-favorite',
    }),
  ])
  const r = await tryHandleSpecificForget({
    userMessage: 'Dimentica Madara dai miei personaggi preferiti.',
    userId: 'user-a',
    supabase: db,
  })
  assert.equal(r.status, 'not_found')
  assert.equal(activeKeys(db.rows).length, 2)
})

// TEST 15–18 bare entity
test('TEST 15 — bare entity unique like', async () => {
  const db = createFakeSupabase([
    seedRow({
      id: 'like',
      factKey: 'preferences.like.naruto',
      content: 'User likes / prefers: Naruto.',
    }),
  ])
  const r = await tryHandleSpecificForget({
    userMessage: 'Dimentica Naruto.',
    userId: 'user-a',
    supabase: db,
  })
  assert.equal(r.status, 'forgotten')
  assert.equal(db.rows[0].status, 'obsolete')
})

test('TEST 16 — bare entity ambiguous like+favorite', async () => {
  const db = createFakeSupabase([
    seedRow({
      id: 'like',
      factKey: 'preferences.like.naruto',
      content: 'User likes / prefers: Naruto.',
    }),
    seedRow({
      id: 'fav',
      factKey: 'preferences.favorite.anime',
      content: "User's favorite anime: Naruto.",
    }),
  ])
  const r = await tryHandleSpecificForget({
    userMessage: 'Dimentica Naruto.',
    userId: 'user-a',
    supabase: db,
  })
  assert.equal(r.status, 'ambiguous')
  assert.equal(r.obsoletedIds.length, 0)
  assert.equal(activeKeys(db.rows).length, 2)
  // Family meaning only — label language follows #262 control-language resolution.
  assert.ok(r.candidates?.some((c) => /like|piace/i.test(c)))
  assert.ok(r.candidates?.some((c) => /favorite|preferit/i.test(c)))
})

test('TEST 17 — bare entity multi-family labels', async () => {
  const db = createFakeSupabase([
    seedRow({
      id: 'like',
      factKey: 'preferences.like.naruto',
      content: 'User likes / prefers: Naruto.',
    }),
    seedRow({
      id: 'fav',
      factKey: 'preferences.favorite.anime',
      content: "User's favorite anime: Naruto.",
    }),
    seedRow({
      id: 'interest',
      factKey: 'preferences.interest.naruto',
      content: 'User is interested in: Naruto.',
    }),
    seedRow({
      id: 'cofav',
      factKey: buildCofavoriteFactKey('character', 'Naruto'),
      content: "User's co-favorite character: Naruto.",
      title: 'Co-favorite',
    }),
  ])
  const r = await tryHandleSpecificForget({
    userMessage: 'Forget Naruto.',
    userId: 'user-a',
    supabase: db,
  })
  assert.equal(r.status, 'ambiguous')
  assert.equal(activeKeys(db.rows).length, 4)
  assert.ok((r.candidates || []).length >= 3)
  const joined = (r.candidates || []).join(' | ')
  assert.match(joined, /like|piace/i)
  assert.match(joined, /favorite|preferito/i)
  assert.match(joined, /interest|interesse/i)
})

test('TEST 18 — bare entity not_found', async () => {
  const db = createFakeSupabase([
    seedRow({
      id: 'like',
      factKey: 'preferences.like.dragon_ball',
      content: 'User likes / prefers: Dragon Ball.',
    }),
  ])
  const r = await tryHandleSpecificForget({
    userMessage: 'Dimentica Naruto.',
    userId: 'user-a',
    supabase: db,
  })
  assert.equal(r.status, 'not_found')
  assert.equal(db.rows[0].status, 'active')
})

// Safety 19–26
test('TEST 19 — Non dimenticare is SAVE', () => {
  assert.equal(isSpecificForgetIntent('Non dimenticare che mi piace Naruto.'), false)
  assert.equal(isExplicitSaveMemoryIntent('Non dimenticare che mi piace Naruto.'), true)
})

test('TEST 20 — global wipe not specific', () => {
  assert.equal(isGlobalForgetIntent('Dimentica tutto quello che sai su di me.'), true)
  assert.equal(isSpecificForgetIntent('Dimentica tutto quello che sai su di me.'), false)
})

test('TEST 21 — question no mutation', async () => {
  const db = createFakeSupabase([
    seedRow({
      id: 'like',
      factKey: 'preferences.like.naruto',
      content: 'User likes / prefers: Naruto.',
    }),
  ])
  assert.equal(isSpecificForgetIntent('Dimentica Naruto?'), false)
  const r = await tryHandleSpecificForget({
    userMessage: 'Dimentica Naruto?',
    userId: 'user-a',
    supabase: db,
  })
  assert.equal(r.handled, false)
  assert.equal(db.rows[0].status, 'active')
})

test('TEST 22 — third-party no mutation', async () => {
  const db = createFakeSupabase([
    seedRow({
      id: 'like',
      factKey: 'preferences.like.naruto',
      content: 'User likes / prefers: Naruto.',
    }),
  ])
  assert.equal(isSpecificForgetIntent('Il mio amico vuole dimenticare Naruto.'), false)
  const r = await tryHandleSpecificForget({
    userMessage: 'Il mio amico vuole dimenticare Naruto.',
    userId: 'user-a',
    supabase: db,
  })
  assert.equal(r.handled, false)
  assert.equal(db.rows[0].status, 'active')
})

test('TEST 23 — meta no mutation', async () => {
  const db = createFakeSupabase([
    seedRow({
      id: 'like',
      factKey: 'preferences.like.naruto',
      content: 'User likes / prefers: Naruto.',
    }),
  ])
  assert.equal(isSpecificForgetIntent('Non ti sto chiedendo di dimenticare Naruto.'), false)
  const r = await tryHandleSpecificForget({
    userMessage: 'Non ti sto chiedendo di dimenticare Naruto.',
    userId: 'user-a',
    supabase: db,
  })
  assert.equal(r.handled, false)
  assert.equal(db.rows[0].status, 'active')
})

test('TEST 24 — Memory OFF still forgets (gate ignores memoryEnabled)', async () => {
  const db = createFakeSupabase([
    seedRow({
      id: 'like',
      factKey: 'preferences.like.naruto',
      content: 'User likes / prefers: Naruto.',
    }),
  ])
  const r = await tryHandleSpecificForget({
    userMessage: 'Dimentica che mi piace Naruto.',
    userId: 'user-a',
    supabase: db,
  })
  assert.equal(r.status, 'forgotten')
  assert.equal(db.rows[0].status, 'obsolete')
})

test('TEST 25 — unauthenticated', async () => {
  const db = createFakeSupabase([
    seedRow({
      id: 'like',
      factKey: 'preferences.like.naruto',
      content: 'User likes / prefers: Naruto.',
    }),
  ])
  const r = await tryHandleSpecificForget({
    userMessage: 'Dimentica che mi piace Naruto.',
    userId: null,
    supabase: db,
  })
  assert.equal(r.status, 'unauthenticated')
  assert.equal(db.rows[0].status, 'active')
})

test('TEST 26 — A/B owner isolation', async () => {
  const db = createFakeSupabase([
    seedRow({
      id: 'a',
      userId: 'user-a',
      factKey: 'preferences.like.naruto',
      content: 'User likes / prefers: Naruto.',
    }),
    seedRow({
      id: 'b',
      userId: 'user-b',
      factKey: 'preferences.like.naruto',
      content: 'User likes / prefers: Naruto.',
    }),
  ])
  const r = await tryHandleSpecificForget({
    userMessage: 'Dimentica che mi piace Naruto.',
    userId: 'user-a',
    supabase: db,
  })
  assert.equal(r.status, 'forgotten')
  assert.equal(db.rows.find((x) => x.id === 'a').status, 'obsolete')
  assert.equal(db.rows.find((x) => x.id === 'b').status, 'active')
})

// Post-conditions 27–31
test('TEST 27–29 — Recall/Overview exclude forgotten; other family remains', async () => {
  const db = createFakeSupabase([
    seedRow({
      id: 'like',
      factKey: 'preferences.like.naruto',
      content: 'User likes / prefers: Naruto.',
    }),
    seedRow({
      id: 'fav',
      factKey: 'preferences.favorite.anime',
      content: "User's favorite anime: Naruto.",
    }),
  ])
  await tryHandleSpecificForget({
    userMessage: 'Dimentica che mi piace Naruto.',
    userId: 'user-a',
    supabase: db,
  })
  const like = db.rows.find((r) => r.id === 'like')
  const fav = db.rows.find((r) => r.id === 'fav')
  assert.equal(isRecallEligibleMemory(like), false)
  assert.equal(isOverviewEligibleMemory(like), false)
  assert.equal(isRecallEligibleMemory(fav), true)
  assert.equal(isOverviewEligibleMemory(fav), true)
  const pack = formatCoreMemoryPack([
    { category: like.category, content: like.content, status: like.status },
    { category: fav.category, content: fav.content, status: fav.status },
  ])
  assert.doesNotMatch(pack, /likes\s*\/\s*prefers:\s*Naruto/i)
  assert.match(pack, /favorite anime:\s*Naruto/i)
  const overview = selectOverviewMemories(db.rows)
  assert.ok(overview.some((r) => readFactKeyFromTags(r.tags) === 'preferences.favorite.anime'))
  assert.ok(!overview.some((r) => readFactKeyFromTags(r.tags) === 'preferences.like.naruto'))
})

test('TEST 30 — duplicate exact-key rows all obsolete', async () => {
  const db = createFakeSupabase([
    seedRow({
      id: 'l1',
      factKey: 'preferences.like.naruto',
      content: 'User likes / prefers: Naruto.',
    }),
    seedRow({
      id: 'l2',
      factKey: 'preferences.like.naruto',
      content: 'User likes / prefers: Naruto.',
    }),
  ])
  const r = await tryHandleSpecificForget({
    userMessage: 'Dimentica che mi piace Naruto.',
    userId: 'user-a',
    supabase: db,
  })
  assert.equal(r.status, 'forgotten')
  assert.equal(r.obsoletedIds.length, 2)
  assert.equal(activeKeys(db.rows).length, 0)
})

test('TEST 31 — partial set-forget failure is not full success', async () => {
  const db = createFakeSupabase(
    [
      seedRow({
        id: 'itachi',
        factKey: buildCofavoriteFactKey('character', 'Itachi'),
        content: "User's co-favorite character: Itachi.",
        title: 'Co-favorite',
      }),
      seedRow({
        id: 'sasuke',
        factKey: buildCofavoriteFactKey('character', 'Sasuke'),
        content: "User's co-favorite character: Sasuke.",
        title: 'Co-favorite',
      }),
    ],
    { failIds: ['sasuke'] },
  )
  const r = await tryHandleSpecificForget({
    userMessage: 'Dimentica i miei personaggi preferiti.',
    userId: 'user-a',
    supabase: db,
  })
  assert.equal(r.status, 'error')
  assert.ok(db.rows.some((row) => row.status === 'active'))
})

test('interest typed forget', async () => {
  const db = createFakeSupabase([
    seedRow({
      id: 'i',
      factKey: 'preferences.interest.naruto',
      content: 'User is interested in: Naruto.',
    }),
    seedRow({
      id: 'like',
      factKey: 'preferences.like.naruto',
      content: 'User likes / prefers: Naruto.',
    }),
  ])
  const r = await tryHandleSpecificForget({
    userMessage: 'Dimentica che adoro Naruto.',
    userId: 'user-a',
    supabase: db,
  })
  assert.equal(r.status, 'forgotten')
  assert.deepEqual(obsoleteKeys(db.rows), ['preferences.interest.naruto'])
  assert.ok(activeKeys(db.rows).includes('preferences.like.naruto'))
})

test('family-aware labels distinguish families', () => {
  const like = seedRow({
    id: '1',
    factKey: 'preferences.like.naruto',
    content: 'User likes / prefers: Naruto.',
  })
  const fav = seedRow({
    id: '2',
    factKey: 'preferences.favorite.anime',
    content: "User's favorite anime: Naruto.",
  })
  assert.match(familyAwareForgetLabel(like, 'it'), /piace/i)
  assert.match(familyAwareForgetLabel(fav, 'it'), /preferito/i)
  assert.notEqual(familyAwareForgetLabel(like, 'it'), familyAwareForgetLabel(fav, 'it'))
})
