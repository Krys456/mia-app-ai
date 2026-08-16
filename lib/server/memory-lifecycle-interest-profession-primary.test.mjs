/**
 * Memory 2.1 PR #261 — lifecycle safety: interest + profession + primary project.
 * Run: node --test lib/server/memory-lifecycle-interest-profession-primary.test.mjs
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  encodeFactKeyTag,
  extractDurableFacts,
  lifecycleEntitySlug,
  normalizeLifecycleEntityValue,
  primaryProjectValueFromContent,
  professionValueFromContent,
  readFactKeyFromTags,
  resolveSameTurnCorrection,
  runMemoryPipeline,
} from './brain-memory.js'
import {
  durableMemoryProvenanceRules,
  formatCoreMemoryPack,
  isRecallEligibleMemory,
} from './core-memory-recall.js'
import { classifySpecificForgetTarget } from './memory-control-forget.js'
import { isOverviewEligibleMemory } from './memory-control-overview.js'
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
    title: partial.title || 'Memory',
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
        state.ascending = opts.ascending === true
        return api
      },
      limit(n) {
        state.limitN = n
        return api
      },
      single() {
        state.single = true
        return api
      },
      maybeSingle() {
        state.single = true
        return api
      },
      async then(resolve, reject) {
        try {
          if (state.mode === 'insert') {
            const row = {
              id: `row-${seq++}`,
              user_id: state.insertRow.user_id,
              category: state.insertRow.category,
              title: state.insertRow.title,
              content: state.insertRow.content,
              importance: state.insertRow.importance ?? 1,
              usage_count: 0,
              last_used_at: null,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              status: state.insertRow.status || 'active',
              tags: state.insertRow.tags || [],
              source: state.insertRow.source || 'automatic',
              confidence: state.insertRow.confidence ?? 0.8,
            }
            rows.push(row)
            resolve({ data: state.single ? project(row) : [project(row)], error: null })
            return
          }
          let matched = rows.filter((row) => state.filters.every((f) => matchesFilter(row, f)))
          if (state.mode === 'update') {
            for (const row of matched) Object.assign(row, state.patch)
            matched = rows.filter((row) => state.filters.every((f) => matchesFilter(row, f)))
          }
          if (state.orderCol) {
            matched.sort((a, b) => {
              const av = a[state.orderCol]
              const bv = b[state.orderCol]
              if (av === bv) return 0
              if (state.ascending) return av > bv ? 1 : -1
              return av > bv ? -1 : 1
            })
          }
          if (state.limitN != null) matched = matched.slice(0, state.limitN)
          if (state.single) {
            resolve({ data: matched[0] ? project(matched[0]) : null, error: null })
            return
          }
          resolve({ data: matched.map(project), error: null })
        } catch (err) {
          reject(err)
        }
      },
    }
    return api
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

test('value recovery helpers', () => {
  assert.equal(professionValueFromContent("User's profession / role: programmer"), 'programmer')
  assert.equal(primaryProjectValueFromContent("User's primary project: LAIfe"), 'LAIfe')
  assert.equal(lifecycleEntitySlug("l'intelligenza artificiale"), 'intelligenza_artificiale')
  assert.equal(normalizeLifecycleEntityValue('no longer LAIfe'), 'LAIfe')
})

test('TEST 1 — EN primary no longer revokes; never stores no longer LAIfe', async () => {
  const sb = createFakeSupabase([
    seedRow({
      id: 'p1',
      category: 'projects',
      title: 'Primary project',
      factKey: 'projects.primary',
      content: "User's primary project: LAIfe",
    }),
  ])
  const r = await pipeline(sb, 'My main project is no longer LAIfe.')
  assert.equal(r.revoked, true)
  assert.ok(obsoleteKeys(sb.rows).includes('projects.primary'))
  assert.ok(!activeKeys(sb.rows).includes('projects.primary'))
  assert.ok(!sb.rows.some((row) => /no longer/i.test(row.content) && row.status === 'active'))
})

test('TEST 2 — IT primary revoke', async () => {
  const sb = createFakeSupabase([
    seedRow({
      id: 'p1',
      category: 'projects',
      title: 'Primary project',
      factKey: 'projects.primary',
      content: "User's primary project: LAIfe",
    }),
  ])
  await pipeline(sb, 'LAIfe non è più il mio progetto principale.')
  assert.deepEqual(obsoleteKeys(sb.rows), ['projects.primary'])
})

test('TEST 3 — wrong-value primary revoke keeps LAIfe', async () => {
  const sb = createFakeSupabase([
    seedRow({
      id: 'p1',
      category: 'projects',
      title: 'Primary project',
      factKey: 'projects.primary',
      content: "User's primary project: LAIfe",
    }),
  ])
  await pipeline(sb, 'Nexus non è più il mio progetto principale.')
  assert.deepEqual(activeKeys(sb.rows), ['projects.primary'])
  assert.equal(obsoleteKeys(sb.rows).length, 0)
})

test('TEST 4 — primary replacement LAIfe→Nexus', async () => {
  const sb = createFakeSupabase([
    seedRow({
      id: 'p1',
      category: 'projects',
      title: 'Primary project',
      factKey: 'projects.primary',
      content: "User's primary project: LAIfe",
    }),
  ])
  await pipeline(sb, 'Adesso il mio progetto principale è Nexus.')
  const row = sb.rows.find((r) => r.id === 'p1')
  assert.equal(row.status, 'active')
  assert.match(row.content, /Nexus/i)
  assert.ok(!/LAIfe/i.test(row.content))
})

test('TEST 5 — same-turn revoke + Nexus successor assert-first', async () => {
  const sb = createFakeSupabase([
    seedRow({
      id: 'p1',
      category: 'projects',
      title: 'Primary project',
      factKey: 'projects.primary',
      content: "User's primary project: LAIfe",
    }),
  ])
  const msg =
    'LAIfe non è più il mio progetto principale; il mio progetto principale è Nexus.'
  const facts = extractDurableFacts(msg)
  assert.ok(!facts.some((f) => f.operation === 'revoke'))
  assert.ok(facts.some((f) => f.factKey === 'projects.primary' && /Nexus/i.test(f.content)))
  await pipeline(sb, msg)
  const active = sb.rows.filter((r) => r.status === 'active')
  assert.equal(active.length, 1)
  assert.match(active[0].content, /Nexus/i)
})

test('TEST 6 — Non sono un programmatore → no positive write', async () => {
  const facts = extractDurableFacts('Non sono un programmatore.')
  assert.ok(facts.every((f) => f.operation === 'revoke'))
  assert.ok(!facts.some((f) => f.operation !== 'revoke' && f.factKey === 'skills.profession'))
})

test('TEST 7 — IT profession revoke', async () => {
  const sb = createFakeSupabase([
    seedRow({
      id: 'j1',
      category: 'skills',
      title: 'Profession',
      factKey: 'skills.profession',
      content: "User's profession / role: programmatore",
    }),
  ])
  await pipeline(sb, 'Non sono più un programmatore.')
  assert.deepEqual(obsoleteKeys(sb.rows), ['skills.profession'])
})

test('TEST 8 — EN profession revoke', async () => {
  const sb = createFakeSupabase([
    seedRow({
      id: 'j1',
      category: 'skills',
      title: 'Profession',
      factKey: 'skills.profession',
      content: "User's profession / role: programmer",
    }),
  ])
  await pipeline(sb, "I'm no longer a programmer.")
  assert.deepEqual(obsoleteKeys(sb.rows), ['skills.profession'])
})

test('TEST 9 — wrong profession value keeps current', async () => {
  const sb = createFakeSupabase([
    seedRow({
      id: 'j1',
      category: 'skills',
      title: 'Profession',
      factKey: 'skills.profession',
      content: "User's profession / role: programmer",
    }),
  ])
  await pipeline(sb, "I'm no longer a designer.")
  assert.deepEqual(activeKeys(sb.rows), ['skills.profession'])
  assert.equal(obsoleteKeys(sb.rows).length, 0)
})

test('TEST 10 — profession replacement', async () => {
  const sb = createFakeSupabase([
    seedRow({
      id: 'j1',
      category: 'skills',
      title: 'Profession',
      factKey: 'skills.profession',
      content: "User's profession / role: programmatore",
    }),
  ])
  await pipeline(sb, 'Adesso sono un designer.')
  assert.match(sb.rows.find((r) => r.id === 'j1').content, /designer/i)
})

test('TEST 11 — same-turn profession anzi', async () => {
  const corr = resolveSameTurnCorrection('Sono un programmatore, anzi sono un designer.')
  assert.equal(corr.mode, 'rewrite')
  const facts = extractDurableFacts('Sono un programmatore, anzi sono un designer.')
  assert.equal(facts.length, 1)
  assert.match(facts[0].content, /designer/i)
  assert.ok(!/programmatore/i.test(facts[0].content))
})

test('TEST 12 — My job is no longer programmer revokes; never stores no longer', async () => {
  const sb = createFakeSupabase([
    seedRow({
      id: 'j1',
      category: 'skills',
      title: 'Profession',
      factKey: 'skills.profession',
      content: "User's profession / role: programmer",
    }),
  ])
  await pipeline(sb, 'My job is no longer programmer.')
  assert.deepEqual(obsoleteKeys(sb.rows), ['skills.profession'])
  assert.ok(!sb.rows.some((r) => /no longer/i.test(r.content) && r.status === 'active'))
})

test('TEST 13 — Adoro Naruto asserts interest', async () => {
  const facts = extractDurableFacts('Adoro Naruto.')
  assert.equal(facts[0]?.factKey, 'preferences.interest.naruto')
})

test('TEST 14 — Non adoro più Naruto revokes', async () => {
  const sb = createFakeSupabase([
    seedRow({
      id: 'i1',
      factKey: 'preferences.interest.naruto',
      content: 'User is interested in: Naruto',
    }),
  ])
  await pipeline(sb, 'Non adoro più Naruto.')
  assert.deepEqual(obsoleteKeys(sb.rows), ['preferences.interest.naruto'])
})

test('TEST 15 — Mi interessa Naruto parity', async () => {
  const facts = extractDurableFacts('Mi interessa Naruto.')
  assert.equal(facts[0]?.factKey, 'preferences.interest.naruto')
})

test('TEST 16 — I\'m interested in Naruto parity', async () => {
  const facts = extractDurableFacts("I'm interested in Naruto.")
  assert.equal(facts[0]?.factKey, 'preferences.interest.naruto')
})

test('TEST 17 — Non mi interessa più Naruto revokes', async () => {
  const sb = createFakeSupabase([
    seedRow({
      id: 'i1',
      factKey: 'preferences.interest.naruto',
      content: 'User is interested in: Naruto',
    }),
  ])
  await pipeline(sb, 'Non mi interessa più Naruto.')
  assert.deepEqual(obsoleteKeys(sb.rows), ['preferences.interest.naruto'])
})

test('TEST 18 — wrong-value interest revoke keeps Naruto', async () => {
  const sb = createFakeSupabase([
    seedRow({
      id: 'i1',
      factKey: 'preferences.interest.naruto',
      content: 'User is interested in: Naruto',
    }),
  ])
  await pipeline(sb, 'Non mi interessa più Dragon Ball.')
  assert.deepEqual(activeKeys(sb.rows), ['preferences.interest.naruto'])
})

test('TEST 19 — interest question no mutation', async () => {
  assert.deepEqual(extractDurableFacts('Non mi interessa più Naruto?'), [])
})

test('TEST 20 — Maybe/Forse interest no mutation', async () => {
  assert.deepEqual(extractDurableFacts("Maybe I'm really into AI."), [])
  assert.deepEqual(extractDurableFacts('Forse non mi interessa più Naruto.'), [])
})

test('TEST 21 — third-party interest no first-person interest revoke', async () => {
  const facts = extractDurableFacts('Il mio amico non è più interessato a Naruto.')
  assert.ok(!facts.some((f) => f.operation === 'revoke' && f.targetType === 'interest'))
})

test('TEST 22 — Non studio più matematica no false studies', async () => {
  const facts = extractDurableFacts('Non studio più matematica.')
  assert.ok(!facts.some((f) => String(f.factKey || '').startsWith('skills.studies')))
})

test('TEST 23 — Studio matematica still asserts', async () => {
  const facts = extractDurableFacts('Studio matematica.')
  assert.equal(facts[0]?.factKey, 'skills.studies.matematica')
})

test('TEST 24 — duplicate interest exact key revoke all', async () => {
  const sb = createFakeSupabase([
    seedRow({
      id: 'i1',
      factKey: 'preferences.interest.naruto',
      content: 'User is interested in: Naruto',
    }),
    seedRow({
      id: 'i2',
      factKey: 'preferences.interest.naruto',
      content: 'User is interested in: Naruto',
    }),
  ])
  await pipeline(sb, 'Non adoro più Naruto.')
  assert.equal(obsoleteKeys(sb.rows).length, 2)
  assert.equal(activeKeys(sb.rows).length, 0)
})

test('TEST 25 — Memory OFF no lifecycle mutation', async () => {
  const sb = createFakeSupabase([
    seedRow({
      id: 'i1',
      factKey: 'preferences.interest.naruto',
      content: 'User is interested in: Naruto',
    }),
  ])
  const r = await pipeline(sb, 'Non adoro più Naruto.', 'user-a', false)
  assert.equal(r.skipped, true)
  assert.equal(r.reason, 'memory_disabled')
  assert.deepEqual(activeKeys(sb.rows), ['preferences.interest.naruto'])
})

test('TEST 26 — owner A/B isolation', async () => {
  const sb = createFakeSupabase([
    seedRow({
      id: 'a1',
      userId: 'user-a',
      factKey: 'preferences.interest.naruto',
      content: 'User is interested in: Naruto',
    }),
    seedRow({
      id: 'b1',
      userId: 'user-b',
      factKey: 'preferences.interest.naruto',
      content: 'User is interested in: Naruto',
    }),
  ])
  await pipeline(sb, 'Non adoro più Naruto.', 'user-a')
  assert.equal(sb.rows.find((r) => r.id === 'a1').status, 'obsolete')
  assert.equal(sb.rows.find((r) => r.id === 'b1').status, 'active')
})

test('TEST 27 — Recall excludes revoked', () => {
  const obsolete = {
    id: 'x',
    category: 'preferences',
    content: 'User is interested in: Naruto',
    status: 'obsolete',
    factKey: 'preferences.interest.naruto',
  }
  assert.equal(isRecallEligibleMemory(obsolete), false)
})

test('TEST 28 — Overview excludes revoked', () => {
  const obsolete = {
    id: 'x',
    category: 'preferences',
    content: 'User is interested in: Naruto',
    status: 'obsolete',
  }
  assert.equal(isOverviewEligibleMemory(obsolete), false)
})

test('TEST 29 — #260 provenance preserved', () => {
  const rules = durableMemoryProvenanceRules()
  assert.match(rules, /favorite→like/i)
  assert.match(rules, /Preserve each durable fact/i)
  const pack = formatCoreMemoryPack([
    {
      id: 'f1',
      category: 'preferences',
      content: "User's favorite anime: Naruto.",
      status: 'active',
      factKey: 'preferences.favorite.anime',
      importance: 6,
    },
  ])
  assert.match(pack, /favorite anime:\s*Naruto/i)
  assert.match(pack, /Do not convert favorite→like/i)
})

test('TEST 30 — Specific Forget classifier unchanged for interest', () => {
  const c = classifySpecificForgetTarget('Dimentica che mi interessa Naruto.')
  assert.equal(c.kind, 'interest')
  assert.equal(c.factKey, 'preferences.interest.naruto')
})

test('EN same-turn profession actually', () => {
  const facts = extractDurableFacts('I am a programmer, actually I am a designer.')
  assert.match(facts[0]?.content || '', /designer/i)
})

test('one responses.create unchanged', () => {
  const params = buildCoreResponsesCreateParams({
    model: 'gpt-5.6-sol',
    instructions: 'test',
    maxOutputTokens: 256,
    input: [{ role: 'user', content: 'hi' }],
  })
  assert.ok(params)
  const src = readFileSync(join(root, 'api/chat.ts'), 'utf8')
  const createCalls = src.match(/client\.responses\.create\s*\(/g) || []
  assert.equal(createCalls.length, 1)
})
