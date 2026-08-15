/**
 * Conversational Memory Control PR1 — specific forget.
 * Run: node lib/server/memory-control-forget.test.mjs
 *
 * Exercises real tryHandleSpecificForget / markMemoriesObsolete / listActiveRowsForFactKey
 * via a fake Supabase client (same production mutation path as Core).
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  extractDurableFacts,
  readFactKeyFromTags,
  upsertMemory,
} from './brain-memory.js'
import {
  formatCoreMemoryPack,
  isRecallEligibleMemory,
  loadCoreMemoryPack,
} from './core-memory-recall.js'
import { buildCoreResponsesCreateParams } from './core-responses-params.js'
import {
  deriveForgetFactKey,
  isExplicitSaveMemoryIntent,
  isSpecificForgetIntent,
  stripForgetWrapper,
  tryHandleSpecificForget,
} from './memory-control-forget.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const COLOR_KEY = 'preferences.favorite.color'
const COLOR_TAG = `fact_key:${COLOR_KEY}`
const ANIMAL_KEY = 'preferences.favorite.animal'
const ANIMAL_TAG = `fact_key:${ANIMAL_KEY}`
const NARUTO_KEY = 'preferences.interest.naruto'
const NARUTO_TAG = `fact_key:${NARUTO_KEY}`
const DB_KEY = 'preferences.interest.dragon_ball'
const DB_TAG = `fact_key:${DB_KEY}`
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

// --- Intent parser unit checks ---
{
  assert.equal(isSpecificForgetIntent('Dimentica il mio colore preferito.'), true)
  assert.equal(isSpecificForgetIntent('Forget my favorite animal.'), true)
  assert.equal(isSpecificForgetIntent('Non ricordare più che adoro Naruto.'), true)
  assert.equal(isSpecificForgetIntent("Don't remember that I like Naruto."), true)
  assert.equal(isSpecificForgetIntent('Il mio colore preferito è blu, dimenticalo.'), true)
  assert.equal(isSpecificForgetIntent('Non dimenticare che il mio colore preferito è blu.'), false)
  assert.equal(isExplicitSaveMemoryIntent('Non dimenticare che il mio colore preferito è blu.'), true)
  assert.equal(isSpecificForgetIntent('Ricorda che il mio colore preferito è verde.'), false)
  assert.equal(deriveForgetFactKey(stripForgetWrapper('Dimentica il mio colore preferito.')), COLOR_KEY)
  assert.equal(deriveForgetFactKey(stripForgetWrapper('Forget my favorite animal.')), ANIMAL_KEY)
  assert.equal(
    deriveForgetFactKey(stripForgetWrapper('Non ricordare più il nome del mio cane.')),
    'relationships.pet.dog.name',
  )
}

// 1) favorite color forget → obsolete + Recall excludes
{
  const db = createFakeSupabase()
  await writeMessage(db, 'user-a', 'Il mio colore preferito è verde.')
  const green = db.rows.find((r) => r.user_id === 'user-a' && /verde/i.test(r.content))
  assert.ok(green)
  assert.equal(green.status, 'active')

  const result = await tryHandleSpecificForget({
    userMessage: 'Dimentica il mio colore preferito.',
    userId: 'user-a',
    supabase: db,
  })
  assert.equal(result.handled, true)
  assert.equal(result.status, 'forgotten')
  assert.equal(result.skippedModel, true)
  assert.match(result.message, /dimenticato/i)
  assert.equal(green.status, 'obsolete')
  assert.equal(isRecallEligibleMemory(green), false)
  const pack = formatCoreMemoryPack([
    {
      category: green.category,
      content: green.content,
      status: green.status,
    },
  ])
  assert.equal(pack, '')
}

// 2) favorite animal EN
{
  const db = createFakeSupabase([
    seedRow({
      id: 'a1',
      userId: 'user-a',
      title: 'Favorite',
      content: "User's favorite animale: wolf",
      tags: [ANIMAL_TAG],
    }),
  ])
  const result = await tryHandleSpecificForget({
    userMessage: 'Forget my favorite animal.',
    userId: 'user-a',
    supabase: db,
  })
  assert.equal(result.status, 'forgotten')
  assert.equal(db.rows[0].status, 'obsolete')
  assert.match(result.message, /forgotten/i)
}

// 3) Naruto obsolete, Dragon Ball stays
{
  const db = createFakeSupabase()
  await writeMessage(db, 'user-a', 'Adoro Naruto.')
  await writeMessage(db, 'user-a', 'Adoro Dragon Ball.')
  assert.equal(db.rows.filter((r) => r.status === 'active').length, 2)

  const result = await tryHandleSpecificForget({
    userMessage: 'Dimentica Naruto.',
    userId: 'user-a',
    supabase: db,
  })
  assert.equal(result.status, 'forgotten')
  const naruto = db.rows.find((r) => /naruto/i.test(r.content))
  const dragon = db.rows.find((r) => /dragon\s*ball/i.test(r.content))
  assert.equal(naruto.status, 'obsolete')
  assert.equal(dragon.status, 'active')
}

// 4) vague anime reference → ambiguous, no mutation
{
  const db = createFakeSupabase([
    seedRow({
      id: 'n1',
      userId: 'user-a',
      title: 'Interest',
      content: 'User is interested in: Naruto',
      tags: [NARUTO_TAG],
    }),
    seedRow({
      id: 'd1',
      userId: 'user-a',
      title: 'Interest',
      content: 'User is interested in: Dragon Ball',
      tags: [DB_TAG],
    }),
  ])
  const result = await tryHandleSpecificForget({
    userMessage: 'Dimentica quello sugli anime.',
    userId: 'user-a',
    supabase: db,
  })
  assert.equal(result.status, 'ambiguous')
  assert.equal(result.obsoletedIds.length, 0)
  assert.equal(db.rows.every((r) => r.status === 'active'), true)
  assert.match(result.message, /Quale vuoi che dimentichi/i)
  assert.ok(result.candidates?.some((c) => /naruto/i.test(c)))
  assert.ok(result.candidates?.some((c) => /dragon/i.test(c)))
}

// 5) unknown favorite film → not found
{
  const db = createFakeSupabase([
    seedRow({
      id: 'c1',
      userId: 'user-a',
      content: "User's favorite colore: verde",
      tags: [COLOR_TAG],
    }),
  ])
  const before = db.rows.map((r) => r.status)
  const result = await tryHandleSpecificForget({
    userMessage: 'Dimentica il mio film preferito.',
    userId: 'user-a',
    supabase: db,
  })
  assert.equal(result.status, 'not_found')
  assert.deepEqual(
    db.rows.map((r) => r.status),
    before,
  )
  assert.match(result.message, /Non ho trovato/i)
}

// 6) Memory OFF still forgets (gate ignores memoryEnabled — caller still invokes)
{
  const db = createFakeSupabase([
    seedRow({
      id: 'c2',
      userId: 'user-a',
      content: "User's favorite colore: verde",
      tags: [COLOR_TAG],
    }),
  ])
  // Simulate chat path: forget runs even when memoryEnabled would be false for write/recall
  const result = await tryHandleSpecificForget({
    userMessage: 'Dimentica il mio colore preferito.',
    userId: 'user-a',
    supabase: db,
  })
  assert.equal(result.status, 'forgotten')
  assert.equal(db.rows[0].status, 'obsolete')
}

// 7) unauthenticated — no mutation, no default user
{
  const db = createFakeSupabase([
    seedRow({
      id: 'c3',
      userId: 'user-a',
      content: "User's favorite colore: verde",
      tags: [COLOR_TAG],
    }),
  ])
  const result = await tryHandleSpecificForget({
    userMessage: 'Dimentica il mio colore preferito.',
    userId: null,
    supabase: db,
  })
  assert.equal(result.status, 'unauthenticated')
  assert.equal(db.rows[0].status, 'active')
  assert.equal(result.obsoletedIds.length, 0)
}

// 8) User A cannot mutate User B
{
  const db = createFakeSupabase([
    seedRow({
      id: 'b-color',
      userId: 'user-b',
      content: "User's favorite colore: rosso",
      tags: [COLOR_TAG],
    }),
    seedRow({
      id: 'a-color',
      userId: 'user-a',
      content: "User's favorite colore: verde",
      tags: [COLOR_TAG],
    }),
  ])
  const result = await tryHandleSpecificForget({
    userMessage: 'Dimentica il mio colore preferito.',
    userId: 'user-a',
    supabase: db,
  })
  assert.equal(result.status, 'forgotten')
  assert.equal(db.rows.find((r) => r.id === 'a-color').status, 'obsolete')
  assert.equal(db.rows.find((r) => r.id === 'b-color').status, 'active')
}

// 9) Non dimenticare = SAVE, not forget
{
  assert.equal(
    isSpecificForgetIntent('Non dimenticare che il mio colore preferito è blu.'),
    false,
  )
  const facts = extractDurableFacts('Non dimenticare che il mio colore preferito è blu.')
  assert.ok(facts.some((f) => f.factKey === COLOR_KEY && /blu/i.test(f.content)))
}

// 10) "… blu, dimenticalo" — forget wins; no new blue write in same command path
{
  const db = createFakeSupabase([
    seedRow({
      id: 'c-green',
      userId: 'user-a',
      content: "User's favorite colore: verde",
      tags: [COLOR_TAG],
    }),
  ])
  const forget = await tryHandleSpecificForget({
    userMessage: 'Il mio colore preferito è blu, dimenticalo.',
    userId: 'user-a',
    supabase: db,
  })
  assert.equal(forget.handled, true)
  assert.equal(forget.status, 'forgotten')
  // Chat path short-circuits: Extraction must not run after handled forget.
  // Assert no blue row was created by this forget path alone.
  assert.ok(!db.rows.some((r) => /blu/i.test(r.content) && r.status === 'active'))
  assert.equal(db.rows.find((r) => r.id === 'c-green').status, 'obsolete')
}

// 11) Recall V1 pack after forget
{
  const db = createFakeSupabase([
    seedRow({
      id: 'c4',
      userId: 'user-a',
      content: "User's favorite colore: verde",
      tags: [COLOR_TAG],
    }),
  ])
  await tryHandleSpecificForget({
    userMessage: 'Dimentica il mio colore preferito.',
    userId: 'user-a',
    supabase: db,
  })
  const pack = await loadCoreMemoryPack({
    userMessage: 'Qual è il mio colore preferito?',
    ownerUserId: 'user-a',
    memoryEnabled: true,
    searchMemories: async () =>
      db.rows
        .filter((r) => r.user_id === 'user-a' && String(r.status) === 'active')
        .map((r) => ({
          id: r.id,
          category: r.category,
          content: r.content,
          status: r.status,
          title: r.title,
        })),
  })
  assert.equal(pack, '')
}

// 12–14) Source contracts: ordinary chat still one responses.create; forget skips model;
// Sol / companion / Extraction / Auth unchanged markers
{
  const chatSrc = readFileSync(join(root, 'api/chat.ts'), 'utf8')
  assert.match(chatSrc, /tryHandleMemoryControl|tryHandleSpecificForget/)
  assert.equal((chatSrc.match(/\.responses\.create\s*\(/g) || []).length, 1)
  const forgetIdx = Math.max(
    chatSrc.indexOf('tryHandleMemoryControl'),
    chatSrc.indexOf('tryHandleSpecificForget'),
  )
  const createIdx = chatSrc.indexOf('client.responses.create')
  const loadIdx = chatSrc.indexOf('await loadCoreMemoryPack')
  assert.ok(forgetIdx > 0 && forgetIdx < loadIdx && loadIdx < createIdx)
  assert.match(chatSrc, /forget\.handled/)
  assert.match(chatSrc, /skippedModel|memoryControl/)
  // Write path still gated by memoryEnabled for ordinary turns
  assert.match(chatSrc, /if\s*\(\s*!memoryEnabled\s*\|\|\s*!ownerUserId\s*\)/)
  assert.match(
    chatSrc,
    /runMemoryPipeline\(\{\s*[\s\S]*?userId:\s*ownerUserId,\s*[\s\S]*?requireExplicitUserId:\s*true/,
  )
  assert.doesNotMatch(chatSrc, /ensureDefaultUserId\s*\(/)
  assert.doesNotMatch(chatSrc, /ensureDefaultUserId/)

  const forgetSrc = readFileSync(join(root, 'lib/server/memory-control-forget.js'), 'utf8')
  assert.match(forgetSrc, /markMemoriesObsolete/)
  assert.doesNotMatch(forgetSrc, /ensureDefaultUserId/)
  // Specific-forget path still soft-obsoletes; hard delete is only via deleteAllMemories helper.
  assert.match(forgetSrc, /markMemoriesObsolete/)
  assert.match(forgetSrc, /status:\s*'obsolete'|markMemoriesObsolete/)

  const sol = buildCoreResponsesCreateParams({
    model: 'gpt-5.6-sol',
    instructions: 'test',
    maxOutputTokens: 100,
    input: [{ type: 'message', role: 'user', content: 'hi' }],
  })
  assert.equal(sol.model, 'gpt-5.6-sol')
  assert.equal('temperature' in sol, false)
  assert.deepEqual(sol.reasoning, { effort: 'none' })

  const promptSrc = readFileSync(join(root, 'lib/server/laife-base-system-prompt.js'), 'utf8')
  assert.match(promptSrc, /Sei LAIfe/)
  assert.doesNotMatch(promptSrc, /tryHandleSpecificForget|memory-control-forget/)
}

console.log('ok: memory control specific forget PR1')
