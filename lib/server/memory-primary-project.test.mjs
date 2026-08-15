/**
 * Memory 2.1 PR2 — primary project extraction (projects.primary).
 * Run: node lib/server/memory-primary-project.test.mjs
 *
 * Scope: explicit main/primary project language only.
 * Does not redesign Recall, Overview, conflict engine, or generic project extraction.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  collapseItemsBySingleValuedFactKey,
  extractDurableFacts,
  isSingleValuedFactKey,
  readFactKeyFromTags,
  scoreMemoryRelevance,
  upsertMemory,
} from './brain-memory.js'
import {
  EMPTY_DURABLE_MEMORY_RESULT_LINE,
  formatCoreMemoryPack,
  isPersonalMemoryProbe,
  isRecallEligibleMemory,
  loadCoreMemoryPack,
} from './core-memory-recall.js'
import {
  deriveForgetFactKey,
  scoreForgetCandidates,
  stripForgetWrapper,
  tryHandleSpecificForget,
} from './memory-control-forget.js'
import { isMemoryOverviewIntent } from './memory-control-overview.js'
import { buildCoreResponsesCreateParams } from './core-responses-params.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const PRIMARY_KEY = 'projects.primary'
const PRIMARY_TAG = `fact_key:${PRIMARY_KEY}`
const MEMORY_SELECT =
  'id, category, title, content, importance, usage_count, last_used_at, created_at, updated_at, status, tags'

function seedRow(partial) {
  return {
    id: partial.id,
    user_id: partial.userId || partial.user_id,
    category: partial.category || 'projects',
    title: partial.title || 'Project',
    content: partial.content,
    importance: partial.importance ?? 8,
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

function primaryFact(msg) {
  return extractDurableFacts(msg).find((f) => f.factKey === PRIMARY_KEY)
}

function projectFacts(msg) {
  return extractDurableFacts(msg).filter((f) => f.category === 'projects')
}

// —— Baseline invariants ——
{
  assert.equal(isSingleValuedFactKey(PRIMARY_KEY), true)
  assert.equal(deriveForgetFactKey('il mio progetto principale'), PRIMARY_KEY)
  assert.equal(deriveForgetFactKey(stripForgetWrapper('Dimentica il mio progetto principale.')), PRIMARY_KEY)
  assert.equal(deriveForgetFactKey(stripForgetWrapper('Forget my main project.')), PRIMARY_KEY)
  assert.equal(deriveForgetFactKey('LAIfe'), null)
}

// —— IT positive matrix ——
{
  const cases = [
    ['Il mio progetto principale è LAIfe.', /LAIfe/i],
    ['LAIfe è il mio progetto principale.', /LAIfe/i],
    ['Il mio progetto principale si chiama LAIfe.', /LAIfe/i],
    ['Ricorda che il mio progetto principale è LAIfe.', /LAIfe/i],
    ['Ricordati che il mio progetto principale è LAIfe.', /LAIfe/i],
    ['Non dimenticare che il mio progetto principale è LAIfe.', /LAIfe/i],
    ['Il progetto principale su cui sto lavorando è LAIfe.', /LAIfe/i],
    ['LAIfe è il progetto principale su cui sto lavorando.', /LAIfe/i],
    ['Il mio progetto principale è Nexus.', /Nexus/i],
    ['Il mio progetto principale è il mio nuovo sito.', /nuovo\s+sito/i],
    ["Il mio progetto principale è un'app per gestire il fotovoltaico.", /fotovoltaico/i],
    ['Adesso il mio progetto principale è Nexus.', /Nexus/i],
  ]
  for (const [msg, re] of cases) {
    const fact = primaryFact(msg)
    assert.ok(fact, `expected primary for: ${msg}`)
    assert.equal(fact.category, 'projects')
    assert.equal(fact.title, 'Primary project')
    assert.equal(fact.factKey, PRIMARY_KEY)
    assert.ok(fact.tags.includes(PRIMARY_TAG))
    assert.match(fact.content, /^User's primary project:/i)
    assert.match(fact.content, re)
    assert.equal(projectFacts(msg).filter((f) => f.factKey === PRIMARY_KEY).length, 1)
  }
}

// —— EN positive matrix ——
{
  const cases = [
    ['My main project is LAIfe.', /LAIfe/i],
    ['My primary project is LAIfe.', /LAIfe/i],
    ['LAIfe is my main project.', /LAIfe/i],
    ['LAIfe is my primary project.', /LAIfe/i],
    ["The main project I'm working on is LAIfe.", /LAIfe/i],
    ['My main project is called LAIfe.', /LAIfe/i],
    ['My primary project is called LAIfe.', /LAIfe/i],
    ['Remember that my main project is LAIfe.', /LAIfe/i],
    ["Don't forget that my primary project is LAIfe.", /LAIfe/i],
  ]
  for (const [msg, re] of cases) {
    const fact = primaryFact(msg)
    assert.ok(fact, `expected primary for: ${msg}`)
    assert.equal(fact.factKey, PRIMARY_KEY)
    assert.match(fact.content, re)
    assert.equal(fact.source, /remember|forget/i.test(msg) ? 'explicit' : 'automatic')
  }
}

// —— Negatives: must NOT produce projects.primary ——
{
  const negatives = [
    'Sto lavorando sulla full planche.',
    'Sto lavorando alla full planche.',
    'Sto lavorando sul mio inglese.',
    "Sto imparando l'inglese.",
    'Mi sto allenando per la full planche.',
    'Sto cercando di perdere 5 kg.',
    'Mi piace LAIfe.',
    'LAIfe è interessante.',
    'Il mio progetto è LAIfe.',
    'Sto lavorando su LAIfe.',
    'Sto costruendo LAIfe.',
  ]
  for (const msg of negatives) {
    const facts = extractDurableFacts(msg)
    assert.equal(
      facts.filter((f) => f.factKey === PRIMARY_KEY).length,
      0,
      `must not be primary: ${msg}`,
    )
  }

  // Generic project coexistence
  const generic = primaryFact
  void generic
  const laifeGeneric = projectFacts('Il mio progetto è LAIfe.')
  assert.ok(laifeGeneric.some((f) => f.factKey === 'projects.laife'))
  assert.ok(!laifeGeneric.some((f) => f.factKey === PRIMARY_KEY))

  const working = projectFacts('Sto lavorando su LAIfe.')
  assert.ok(working.some((f) => f.factKey === 'projects.laife'))
  assert.ok(!working.some((f) => f.factKey === PRIMARY_KEY))
}

// —— TEST A: single-valued replacement ——
{
  const db = createFakeSupabase()
  await writeMessage(db, 'user-a', 'Il mio progetto principale è LAIfe.')
  assertOneActiveKeyed(db, 'user-a', PRIMARY_KEY, /LAIfe/i)

  await writeMessage(db, 'user-a', 'Adesso il mio progetto principale è Nexus.')
  assertOneActiveKeyed(db, 'user-a', PRIMARY_KEY, /Nexus/i)
  assert.equal(db.activeKeyed('user-a', PRIMARY_KEY).length, 1)
  const obsoleteLaife = db.rows.filter(
    (r) =>
      r.user_id === 'user-a' &&
      readFactKeyFromTags(r.tags) === PRIMARY_KEY &&
      r.status !== 'active',
  )
  assert.ok(obsoleteLaife.some((r) => /LAIfe/i.test(r.content)) || !db.rows.some((r) => /LAIfe/i.test(r.content) && r.status === 'active' && readFactKeyFromTags(r.tags) === PRIMARY_KEY))
  assert.ok(!db.rows.some((r) => r.status === 'active' && readFactKeyFromTags(r.tags) === PRIMARY_KEY && /LAIfe/i.test(r.content)))
}

// —— TEST B: user isolation ——
{
  const db = createFakeSupabase()
  await writeMessage(db, 'user-a', 'Il mio progetto principale è LAIfe.')
  await writeMessage(db, 'user-b', 'Il mio progetto principale è Nexus.')
  assertOneActiveKeyed(db, 'user-a', PRIMARY_KEY, /LAIfe/i)
  assertOneActiveKeyed(db, 'user-b', PRIMARY_KEY, /Nexus/i)

  await writeMessage(db, 'user-a', 'Il mio progetto principale è Atlas.')
  assertOneActiveKeyed(db, 'user-a', PRIMARY_KEY, /Atlas/i)
  assertOneActiveKeyed(db, 'user-b', PRIMARY_KEY, /Nexus/i)
}

// —— TEST C: generic projects coexist; primary change does not obsolete generics ——
{
  const db = createFakeSupabase()
  await writeMessage(db, 'user-a', 'Sto lavorando su LAIfe.')
  await writeMessage(db, 'user-a', 'Sto lavorando su un sito.')
  await writeMessage(db, 'user-a', 'Il mio progetto principale è LAIfe.')

  const genericActive = db.rows.filter(
    (r) =>
      r.user_id === 'user-a' &&
      r.status === 'active' &&
      String(readFactKeyFromTags(r.tags) || '').startsWith('projects.') &&
      readFactKeyFromTags(r.tags) !== PRIMARY_KEY,
  )
  assert.ok(genericActive.length >= 2, 'generic LAIfe + site should remain')
  assertOneActiveKeyed(db, 'user-a', PRIMARY_KEY, /LAIfe/i)

  await writeMessage(db, 'user-a', 'Il mio progetto principale è Nexus.')
  assertOneActiveKeyed(db, 'user-a', PRIMARY_KEY, /Nexus/i)
  const genericsAfter = db.rows.filter(
    (r) =>
      r.user_id === 'user-a' &&
      r.status === 'active' &&
      String(readFactKeyFromTags(r.tags) || '').startsWith('projects.') &&
      readFactKeyFromTags(r.tags) !== PRIMARY_KEY,
  )
  assert.equal(genericsAfter.length, genericActive.length)
  assert.ok(genericsAfter.some((r) => /LAIfe/i.test(r.content)))
}

// —— Specific Forget: primary only ——
{
  const db = createFakeSupabase()
  await writeMessage(db, 'user-a', 'Sto lavorando su LAIfe.')
  await writeMessage(db, 'user-a', 'Il mio progetto principale è Nexus.')
  const genericBefore = db.rows.find(
    (r) => r.status === 'active' && readFactKeyFromTags(r.tags) === 'projects.laife',
  )
  assert.ok(genericBefore)

  const result = await tryHandleSpecificForget({
    userMessage: 'Dimentica il mio progetto principale.',
    userId: 'user-a',
    supabase: db,
  })
  assert.equal(result.status, 'forgotten')
  assert.equal(result.factKey, PRIMARY_KEY)
  assert.equal(db.activeKeyed('user-a', PRIMARY_KEY).length, 0)
  assert.equal(genericBefore.status, 'active')
}

// —— "Dimentica LAIfe" with both generic + primary → ambiguity (do not silently pick one) ——
{
  const db = createFakeSupabase([
    seedRow({
      id: 'g1',
      userId: 'user-a',
      title: 'Project',
      content: "User's project: LAIfe",
      tags: ['fact_key:projects.laife'],
    }),
    seedRow({
      id: 'p1',
      userId: 'user-a',
      title: 'Primary project',
      content: "User's primary project: LAIfe",
      tags: [PRIMARY_TAG],
    }),
  ])
  const scored = scoreForgetCandidates(db.rows, 'LAIfe')
  assert.ok(scored.length >= 2, 'both LAIfe rows should score')
  const result = await tryHandleSpecificForget({
    userMessage: 'Dimentica LAIfe.',
    userId: 'user-a',
    supabase: db,
  })
  assert.equal(result.status, 'ambiguous')
  assert.equal(result.obsoletedIds.length, 0)
  assert.equal(db.rows.every((r) => r.status === 'active'), true)
}

// —— Recall compatibility (leave ranking untouched; pack includes primary) ——
{
  assert.equal(isPersonalMemoryProbe('Ti ricordi qual è il mio progetto principale?'), true)
  assert.equal(isPersonalMemoryProbe('Qual è il mio progetto principale?'), true)

  const pack = await loadCoreMemoryPack({
    userMessage: 'Ti ricordi qual è il mio progetto principale?',
    ownerUserId: 'user-a',
    memoryEnabled: true,
    searchMemories: async () => [
      {
        id: 'm1',
        category: 'projects',
        title: 'Primary project',
        content: "User's primary project: LAIfe",
        importance: 8,
        usageCount: 0,
        lastUsedAt: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        status: 'active',
        tags: [PRIMARY_TAG],
      },
    ],
  })
  assert.match(pack, /DURABLE LAIFE MEMORY 2\.0/)
  assert.match(pack, /LAIfe/)
  assert.doesNotMatch(pack, /fact_key/)
  assert.doesNotMatch(pack, /projects\.primary/)

  const scored = scoreMemoryRelevance(
    {
      category: 'projects',
      title: 'Primary project',
      content: "User's primary project: LAIfe",
      tags: [PRIMARY_TAG],
      importance: 8,
      status: 'active',
    },
    'Qual è il mio progetto principale?',
  )
  assert.ok(scored.matched && scored.score > 0)
}

// —— Provenance #251 regression: empty durable until primary saved ——
{
  const empty = await loadCoreMemoryPack({
    userMessage: 'Ti ricordi qual è il mio progetto principale?',
    ownerUserId: 'user-a',
    memoryEnabled: true,
    searchMemories: async () => [],
  })
  assert.match(empty, new RegExp(EMPTY_DURABLE_MEMORY_RESULT_LINE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  assert.doesNotMatch(empty, /planche/i)

  // Activity utterance must not create primary
  assert.equal(primaryFact('Sto lavorando sulla full planche.'), undefined)

  const afterSave = await loadCoreMemoryPack({
    userMessage: 'Qual è il mio progetto principale?',
    ownerUserId: 'user-a',
    memoryEnabled: true,
    searchMemories: async () => [
      {
        id: 'm2',
        category: 'projects',
        title: 'Primary project',
        content: "User's primary project: LAIfe",
        importance: 8,
        status: 'active',
        tags: [PRIMARY_TAG],
      },
    ],
  })
  assert.match(afterSave, /LAIfe/)
  assert.doesNotMatch(afterSave, /DURABLE MEMORY RESULT/)
}

// —— Overview compatibility: intent unchanged; pack content stays human ——
{
  assert.equal(isMemoryOverviewIntent('Cosa ricordi di me?'), true)
  const pack = formatCoreMemoryPack([
    {
      category: 'projects',
      title: 'Primary project',
      content: "User's primary project: Nexus",
      status: 'active',
      tags: [PRIMARY_TAG],
    },
  ])
  assert.match(pack, /Nexus/)
  assert.doesNotMatch(pack, /fact_key|projects\.primary|UUID|status/i)
  assert.equal(
    isRecallEligibleMemory({
      content: "User's primary project: Nexus",
      status: 'obsolete',
      category: 'projects',
    }),
    false,
  )
}

// —— Protected surfaces: no Core/Sol/schema/UI edits in this PR ——
{
  const brain = readFileSync(join(root, 'lib/server/brain-memory.js'), 'utf8')
  assert.match(brain, /projects\.primary/)
  assert.match(brain, /User's primary project:/)

  const params = buildCoreResponsesCreateParams({
    model: 'gpt-5.6-sol',
    instructions: 'x',
    input: [],
  })
  assert.ok(params)
}

console.log('memory-primary-project.test.mjs: PASS')
