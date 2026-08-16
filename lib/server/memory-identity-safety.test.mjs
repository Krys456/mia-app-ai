/**
 * Memory 2.1 PR #258 — identity safety + name revocation + Unicode meta guard.
 * Run: node --test lib/server/memory-identity-safety.test.mjs
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  encodeFactKeyTag,
  extractDurableFacts,
  extractIdentityNameRevokeCandidate,
  hasMetaNegationCue,
  identityNameValueFromContent,
  normalizeIdentityNameForMatch,
  readFactKeyFromTags,
  runMemoryPipeline,
  shouldSkipIdentityNameMutation,
  shouldSkipPreferencePolarityExtraction,
} from './brain-memory.js'
import { buildCoreResponsesCreateParams } from './core-responses-params.js'
import {
  isOverviewEligibleMemory,
  selectOverviewMemories,
} from './memory-control-overview.js'
import { isRecallEligibleMemory, rerankMemoriesForRecall } from './core-memory-recall.js'

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
    category: partial.category || 'identity',
    title: partial.title || 'Name',
    content: partial.content,
    importance: partial.importance ?? 9,
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

function activeName(rows, userId = 'user-a') {
  const row = rows.find(
    (r) =>
      r.user_id === userId &&
      String(r.status) === 'active' &&
      readFactKeyFromTags(r.tags) === 'identity.name',
  )
  return row ? identityNameValueFromContent(row.content) : null
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

test('TEST 1 — Mi chiamo Marco → identity.name Marco', async () => {
  const db = createFakeSupabase()
  await pipeline(db, 'Mi chiamo Marco.')
  assert.equal(activeName(db.rows), 'Marco')
  const facts = extractDurableFacts('Mi chiamo Marco.')
  assert.equal(facts.length, 1)
  assert.equal(facts[0].factKey, 'identity.name')
  assert.match(facts[0].content, /Marco/)
  assert.notEqual(facts[0].operation, 'revoke')
})

test('TEST 2 — Marco → Mi chiamo Luca → Luca replaces', async () => {
  const db = createFakeSupabase([
    seedRow({
      id: 'name-1',
      factKey: 'identity.name',
      content: "User's name is Marco.",
    }),
  ])
  await pipeline(db, 'Mi chiamo Luca.')
  assert.equal(activeName(db.rows), 'Luca')
  // Current single-valued behavior may update in place and/or obsolete peers.
  assert.ok(
    !db.rows.some(
      (r) =>
        r.status === 'active' &&
        readFactKeyFromTags(r.tags) === 'identity.name' &&
        /Marco/i.test(identityNameValueFromContent(r.content) || ''),
    ),
  )
})

test('TEST 3 — Non mi chiamo più Marco → obsolete, never name=più', async () => {
  const db = createFakeSupabase([
    seedRow({
      id: 'name-1',
      factKey: 'identity.name',
      content: "User's name is Marco.",
    }),
  ])
  const rev = extractIdentityNameRevokeCandidate('Non mi chiamo più Marco.')
  assert.equal(rev?.value, 'Marco')
  await pipeline(db, 'Non mi chiamo più Marco.')
  assert.equal(activeName(db.rows), null)
  assert.equal(db.rows.find((r) => r.id === 'name-1')?.status, 'obsolete')
  assert.ok(!db.rows.some((r) => /name is pi[uù]/i.test(r.content) && r.status === 'active'))
  assert.ok(!extractDurableFacts('Non mi chiamo più Marco.').some((f) => f.operation !== 'revoke'))
})

test('TEST 4 — Non mi chiamo più Luca while Marco stored → Marco remains', async () => {
  const db = createFakeSupabase([
    seedRow({
      id: 'name-1',
      factKey: 'identity.name',
      content: "User's name is Marco.",
    }),
  ])
  await pipeline(db, 'Non mi chiamo più Luca.')
  assert.equal(activeName(db.rows), 'Marco')
  assert.equal(db.rows.find((r) => r.id === 'name-1')?.status, 'active')
})

test('TEST 5 — Non mi chiamo più Marco? → no write/revoke', async () => {
  const db = createFakeSupabase([
    seedRow({
      id: 'name-1',
      factKey: 'identity.name',
      content: "User's name is Marco.",
    }),
  ])
  assert.equal(shouldSkipIdentityNameMutation('Non mi chiamo più Marco?'), true)
  assert.deepEqual(extractDurableFacts('Non mi chiamo più Marco?'), [])
  await pipeline(db, 'Non mi chiamo più Marco?')
  assert.equal(activeName(db.rows), 'Marco')
})

test('TEST 6 — Mi chiamo Marco? → no write', async () => {
  const db = createFakeSupabase()
  assert.deepEqual(extractDurableFacts('Mi chiamo Marco?'), [])
  await pipeline(db, 'Mi chiamo Marco?')
  assert.equal(activeName(db.rows), null)
  assert.equal(db.rows.length, 0)
})

test('TEST 7 — My name is Marco? → no write', async () => {
  const db = createFakeSupabase()
  assert.deepEqual(extractDurableFacts('My name is Marco?'), [])
  await pipeline(db, 'My name is Marco?')
  assert.equal(db.rows.length, 0)
})

test('TEST 8 — I don\'t go by Marco anymore → obsolete', async () => {
  const db = createFakeSupabase([
    seedRow({
      id: 'name-1',
      factKey: 'identity.name',
      content: "User's name is Marco.",
    }),
  ])
  await pipeline(db, "I don't go by Marco anymore.")
  assert.equal(activeName(db.rows), null)
  assert.equal(db.rows.find((r) => r.id === 'name-1')?.status, 'obsolete')
})

test('TEST 9 — I no longer go by Marco → obsolete', async () => {
  const db = createFakeSupabase([
    seedRow({
      id: 'name-1',
      factKey: 'identity.name',
      content: "User's name is Marco.",
    }),
  ])
  await pipeline(db, 'I no longer go by Marco.')
  assert.equal(activeName(db.rows), null)
})

test('TEST 10 — wrong EN value revoke → name remains', async () => {
  const db = createFakeSupabase([
    seedRow({
      id: 'name-1',
      factKey: 'identity.name',
      content: "User's name is Marco.",
    }),
  ])
  await pipeline(db, "I don't go by Luca anymore.")
  assert.equal(activeName(db.rows), 'Marco')
})

test('TEST 11 — third-party name → no identity.name mutation', async () => {
  const db = createFakeSupabase([
    seedRow({
      id: 'name-1',
      factKey: 'identity.name',
      content: "User's name is Luca.",
    }),
  ])
  await pipeline(db, 'Il mio amico si chiama Marco.')
  assert.equal(activeName(db.rows), 'Luca')
  assert.ok(!extractDurableFacts('Il mio amico si chiama Marco.').some((f) => f.factKey === 'identity.name'))
  await pipeline(db, 'Il mio amico non si chiama più Marco.')
  assert.equal(activeName(db.rows), 'Luca')
  await pipeline(db, "My brother doesn't go by Marco anymore.")
  assert.equal(activeName(db.rows), 'Luca')
})

test('TEST 12 — meta name phrase → no mutation', async () => {
  const db = createFakeSupabase([
    seedRow({
      id: 'name-1',
      factKey: 'identity.name',
      content: "User's name is Luca.",
    }),
  ])
  for (const msg of [
    'Non ho detto che mi chiamo Marco.',
    'È falso che mi chiamo Marco.',
    'È falso che non mi chiamo più Marco.',
    "I didn't say my name is Marco.",
    "It's false that my name is Marco.",
  ]) {
    assert.equal(shouldSkipIdentityNameMutation(msg), true, msg)
    assert.deepEqual(extractDurableFacts(msg).filter((f) => f.factKey === 'identity.name'), [])
    await pipeline(db, msg)
    assert.equal(activeName(db.rows), 'Luca', msg)
  }
})

test('TEST 13 — hypothetical name phrase → no mutation', async () => {
  const db = createFakeSupabase([
    seedRow({
      id: 'name-1',
      factKey: 'identity.name',
      content: "User's name is Luca.",
    }),
  ])
  for (const msg of ['Se mi chiamassi Marco...', 'If my name were Marco...']) {
    assert.deepEqual(extractDurableFacts(msg), [])
    await pipeline(db, msg)
    assert.equal(activeName(db.rows), 'Luca')
  }
})

test('TEST 14 — hedged name phrase → no mutation', async () => {
  const db = createFakeSupabase([
    seedRow({
      id: 'name-1',
      factKey: 'identity.name',
      content: "User's name is Luca.",
    }),
  ])
  for (const msg of [
    'Forse non mi chiamo più Marco.',
    "Maybe I don't go by Marco anymore.",
  ]) {
    assert.deepEqual(extractDurableFacts(msg), [])
    await pipeline(db, msg)
    assert.equal(activeName(db.rows), 'Luca')
  }
})

test('TEST 15 — È falso che non mi piace Naruto → no dislike', () => {
  assert.equal(hasMetaNegationCue('È falso che non mi piace Naruto.'), true)
  assert.equal(shouldSkipPreferencePolarityExtraction('È falso che non mi piace Naruto.'), true)
  assert.deepEqual(extractDurableFacts('È falso che non mi piace Naruto.'), [])
})

test('TEST 16 — E falso che non mi piace Naruto → no dislike', () => {
  assert.equal(hasMetaNegationCue('E falso che non mi piace Naruto.'), true)
  assert.deepEqual(extractDurableFacts('E falso che non mi piace Naruto.'), [])
})

test('TEST 17 — Non è vero che non mi piace Naruto → no dislike', () => {
  assert.equal(hasMetaNegationCue('Non è vero che non mi piace Naruto.'), true)
  assert.deepEqual(extractDurableFacts('Non è vero che non mi piace Naruto.'), [])
})

test('TEST 18 — Non mi piace Naruto → dislike still writes', async () => {
  const db = createFakeSupabase()
  const facts = extractDurableFacts('Non mi piace Naruto.')
  assert.ok(facts.some((f) => f.factKey === 'preferences.dislike.naruto'))
  await pipeline(db, 'Non mi piace Naruto.')
  assert.ok(
    db.rows.some(
      (r) =>
        r.status === 'active' && readFactKeyFromTags(r.tags) === 'preferences.dislike.naruto',
    ),
  )
})

test('TEST 19 — Non mi piace più Naruto → #255 polarity still works', async () => {
  const db = createFakeSupabase([
    seedRow({
      id: 'like-1',
      category: 'preferences',
      title: 'Preference',
      factKey: 'preferences.like.naruto',
      content: 'User likes / prefers: Naruto.',
      importance: 6,
    }),
  ])
  await pipeline(db, 'Non mi piace più Naruto.')
  assert.ok(
    db.rows.some(
      (r) =>
        r.status === 'active' && readFactKeyFromTags(r.tags) === 'preferences.dislike.naruto',
    ),
  )
  assert.equal(db.rows.find((r) => r.id === 'like-1')?.status, 'obsolete')
})

test('TEST 20 — favorite revoke #256 unchanged', async () => {
  const db = createFakeSupabase([
    seedRow({
      id: 'fav-1',
      category: 'preferences',
      title: 'Favorite',
      factKey: 'preferences.favorite.anime',
      content: "User's favorite anime: Naruto.",
      importance: 6,
    }),
  ])
  await pipeline(db, 'Naruto non è più il mio anime preferito.')
  assert.equal(db.rows.find((r) => r.id === 'fav-1')?.status, 'obsolete')
  assert.deepEqual(extractDurableFacts('Naruto non è più il mio anime preferito?'), [])
})

test('TEST 21 — replace_set #257 unchanged', async () => {
  const facts = extractDurableFacts(
    'Adesso i miei personaggi preferiti sono Itachi e Sasuke.',
  )
  assert.ok(facts.some((f) => f.operation === 'replace_set'))
  assert.deepEqual(
    facts.find((f) => f.operation === 'replace_set')?.values,
    ['Itachi', 'Sasuke'],
  )
})

test('TEST 22 — Recall eligibility ignores obsolete identity.name', () => {
  const active = seedRow({
    id: 'name-1',
    factKey: 'identity.name',
    content: "User's name is Marco.",
  })
  const obsolete = seedRow({
    id: 'name-2',
    factKey: 'identity.name',
    content: "User's name is Luca.",
    status: 'obsolete',
  })
  assert.equal(isRecallEligibleMemory(active), true)
  assert.equal(isRecallEligibleMemory(obsolete), false)
  const eligible = [active, obsolete].filter(isRecallEligibleMemory)
  const ranked = rerankMemoriesForRecall(eligible, 'Come mi chiamo?')
  assert.ok(ranked.every((r) => r.status !== 'obsolete'))
  assert.ok(ranked.some((r) => /Marco/i.test(r.content)))
  assert.ok(!ranked.some((r) => /Luca/i.test(r.content)))
})

test('TEST 23 — Provenance pack builder still present (no fabricate helper change)', () => {
  const src = readFileSync(join(root, 'lib/server/core-memory-recall.js'), 'utf8')
  assert.match(src, /provenance|no relevant|empty/i)
})

test('TEST 24 — Primary project extractor untouched smoke', () => {
  const facts = extractDurableFacts('Il mio progetto principale è LAIfe.')
  assert.ok(facts.some((f) => f.factKey === 'projects.primary'))
})

test('TEST 25 — Memory OFF no identity mutation', async () => {
  const db = createFakeSupabase([
    seedRow({
      id: 'name-1',
      factKey: 'identity.name',
      content: "User's name is Marco.",
    }),
  ])
  const result = await pipeline(db, 'Non mi chiamo più Marco.', 'user-a', false)
  assert.equal(result.reason, 'memory_disabled')
  assert.equal(activeName(db.rows), 'Marco')
})

test('TEST 26 — User A/B isolation', async () => {
  const db = createFakeSupabase([
    seedRow({
      id: 'a-name',
      userId: 'user-a',
      factKey: 'identity.name',
      content: "User's name is Marco.",
    }),
    seedRow({
      id: 'b-name',
      userId: 'user-b',
      factKey: 'identity.name',
      content: "User's name is Marco.",
    }),
  ])
  await pipeline(db, 'Non mi chiamo più Marco.', 'user-a')
  assert.equal(activeName(db.rows, 'user-a'), null)
  assert.equal(activeName(db.rows, 'user-b'), 'Marco')
  assert.equal(db.rows.find((r) => r.id === 'b-name')?.status, 'active')
})

test('TEST 27 — Overview after name revoke excludes old name', async () => {
  const db = createFakeSupabase([
    seedRow({
      id: 'name-1',
      factKey: 'identity.name',
      content: "User's name is Marco.",
    }),
  ])
  await pipeline(db, 'Non mi chiamo più Marco.')
  const eligible = db.rows.filter(isOverviewEligibleMemory)
  assert.ok(!eligible.some((r) => /Marco/i.test(r.content)))
  const selected = selectOverviewMemories(db.rows)
  assert.ok(!selected.some((r) => /Marco/i.test(r.content)))
})

test('TEST 28 — Core one responses.create params unchanged shape', () => {
  const params = buildCoreResponsesCreateParams({
    model: 'gpt-5.6-sol',
    input: [{ role: 'user', content: 'Ciao' }],
  })
  assert.ok(params)
  assert.equal(params.model, 'gpt-5.6-sol')
  const chatSrc = readFileSync(join(root, 'api/chat.ts'), 'utf8')
  const createCalls = chatSrc.match(/responses\.create/g) || []
  assert.ok(createCalls.length >= 1)
})

test('normalizeIdentityNameForMatch is exact, not fuzzy', () => {
  assert.equal(normalizeIdentityNameForMatch('Marco'), normalizeIdentityNameForMatch('marco'))
  assert.notEqual(normalizeIdentityNameForMatch('Marco'), normalizeIdentityNameForMatch('Luca'))
})

test('EN My name is Marco. still asserts', () => {
  const facts = extractDurableFacts('My name is Marco.')
  assert.ok(facts.some((f) => f.factKey === 'identity.name' && /Marco/.test(f.content)))
})

test('Il mio nome è Marco. still asserts', () => {
  const facts = extractDurableFacts('Il mio nome è Marco.')
  assert.ok(facts.some((f) => f.factKey === 'identity.name' && /Marco/.test(f.content)))
})

test('Non mi chiamo Marco. revokes when exact match', async () => {
  const db = createFakeSupabase([
    seedRow({
      id: 'name-1',
      factKey: 'identity.name',
      content: "User's name is Marco.",
    }),
  ])
  await pipeline(db, 'Non mi chiamo Marco.')
  assert.equal(activeName(db.rows), null)
})

test('My name is no longer Marco / isn\'t anymore', async () => {
  for (const msg of ['My name is no longer Marco.', "My name isn't Marco anymore."]) {
    const db = createFakeSupabase([
      seedRow({
        id: 'name-1',
        factKey: 'identity.name',
        content: "User's name is Marco.",
      }),
    ])
    await pipeline(db, msg)
    assert.equal(activeName(db.rows), null, msg)
  }
})
