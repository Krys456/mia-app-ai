/**
 * Conversational Memory Control PR3 — Memory Overview.
 * Run: node lib/server/memory-control-overview.test.mjs
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { analyzeConversation } from './brain-memory.js'
import {
  isGlobalForgetIntent,
  isSpecificForgetIntent,
  tryHandleMemoryControl,
} from './memory-control-forget.js'
import {
  OVERVIEW_CATEGORY_CAPS,
  OVERVIEW_MAX_FACT_CHARS,
  OVERVIEW_MAX_MEMORIES,
  OVERVIEW_POOL_LIMIT,
  dedupeOverviewByFactKey,
  dedupeOverviewSemantically,
  formatMemoryOverviewPack,
  isMemoryOverviewIntent,
  isOverviewEligibleMemory,
  selectOverviewMemories,
  tryHandleMemoryOverview,
} from './memory-control-overview.js'
import { RECALL_MAX_MEMORIES } from './core-memory-recall.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const COLOR_KEY = 'preferences.favorite.color'
const COLOR_TAG = `fact_key:${COLOR_KEY}`
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
    title: partial.title || 'Memory',
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

  function matchesFilter(row, filter) {
    if (filter.type === 'eq') return String(row[filter.column]) === String(filter.value)
    if (filter.type === 'neq') return String(row[filter.column] || '') !== String(filter.value)
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
    }
    const api = {
      select() {
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
      then(resolve, reject) {
        return Promise.resolve()
          .then(() => {
            let matched = rows.filter((row) => state.filters.every((f) => matchesFilter(row, f)))
            if (state.orderCol) {
              matched = [...matched].sort((a, b) => {
                const av = a[state.orderCol]
                const bv = b[state.orderCol]
                if (av === bv) return 0
                if (state.ascending) return av < bv ? -1 : 1
                return av > bv ? -1 : 1
              })
            }
            if (state.limitN != null) matched = matched.slice(0, state.limitN)
            return { data: matched.map(project), error: null }
          })
          .then(resolve, reject)
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

function mapped(partial) {
  const row = seedRow(partial)
  return {
    id: row.id,
    category: row.category,
    title: row.title,
    content: row.content,
    importance: row.importance,
    usageCount: 0,
    lastUsedAt: null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    status: row.status,
    tags: row.tags,
    factKey: row.tags.find((t) => String(t).startsWith('fact_key:'))?.slice('fact_key:'.length) || null,
  }
}

// --- Intent detection ---
{
  const positives = [
    'Cosa ricordi di me?',
    'Che cosa ricordi di me?',
    'Cosa ti ricordi di me?',
    'Cosa sai di me?',
    'Che cosa sai su di me?',
    'Quali cose ricordi di me?',
    'Dimmi cosa ricordi di me.',
    'Dimmi cosa ti ricordi di me.',
    'What do you remember about me?',
    'What do you know about me?',
    'What do you remember about me so far?',
    'Tell me what you remember about me.',
  ]
  for (const phrase of positives) {
    assert.equal(isMemoryOverviewIntent(phrase), true, `should match: ${phrase}`)
  }

  const negatives = [
    'Ti ricordi Naruto?',
    'Che cosa sai di Naruto?',
    'Ricordi il mio colore preferito?',
    'Che cosa sai del mio progetto?',
    'Dimentica tutto quello che sai su di me.',
    'Dimentica il mio colore preferito.',
    'Forget everything about me',
    'Ciao',
    'Mi piace il verde',
  ]
  for (const phrase of negatives) {
    assert.equal(isMemoryOverviewIntent(phrase), false, `must not match: ${phrase}`)
  }
}

// TEST 7/8 — not Overview; Recall path remains for topic questions
{
  assert.equal(isMemoryOverviewIntent('Ti ricordi Naruto?'), false)
  assert.equal(isMemoryOverviewIntent('Cosa sai di Naruto?'), false)
  assert.equal(RECALL_MAX_MEMORIES, 3)
}

// TEST 18/19 — Forget regressions take precedence over Overview intent
{
  assert.equal(isGlobalForgetIntent('Dimentica tutto quello che sai su di me.'), true)
  assert.equal(isMemoryOverviewIntent('Dimentica tutto quello che sai su di me.'), false)
  assert.equal(isSpecificForgetIntent('Dimentica il mio colore preferito.'), true)
  assert.equal(isMemoryOverviewIntent('Dimentica il mio colore preferito.'), false)

  const wipe = await tryHandleMemoryControl({
    userMessage: 'Dimentica tutto quello che sai su di me.',
    userId: 'user-a',
    messages: [],
  })
  assert.equal(wipe.handled, true)
  assert.equal(wipe.status, 'forget_all_confirm_required')
  assert.equal(wipe.skippedModel, true)
}

// Eligibility: obsolete / empty / UI settings excluded
{
  assert.equal(
    isOverviewEligibleMemory(
      mapped({ id: '1', content: "User's favorite colore: verde", status: 'active' }),
    ),
    true,
  )
  assert.equal(
    isOverviewEligibleMemory(
      mapped({ id: '2', content: "User's favorite colore: blu", status: 'obsolete' }),
    ),
    false,
  )
  assert.equal(isOverviewEligibleMemory(mapped({ id: '3', content: '   ', status: 'active' })), false)
  assert.equal(
    isOverviewEligibleMemory(
      mapped({
        id: '4',
        category: 'settings',
        content: 'User prefers dark mode theme',
        status: 'active',
      }),
    ),
    false,
  )
}

// TEST 2 — obsolete conflict: only green
{
  const selected = selectOverviewMemories([
    mapped({
      id: 'blue',
      content: "User's favorite colore: blu",
      status: 'obsolete',
      tags: [COLOR_TAG],
      updatedAt: '2026-02-01T00:00:00.000Z',
    }),
    mapped({
      id: 'green',
      content: "User's favorite colore: verde",
      status: 'active',
      tags: [COLOR_TAG],
      updatedAt: '2026-03-01T00:00:00.000Z',
    }),
  ])
  assert.equal(selected.length, 1)
  assert.match(selected[0].content, /verde/i)
  assert.doesNotMatch(selected[0].content, /blu/i)
}

// TEST 12 — duplicate fact_key keep newest
{
  const deduped = dedupeOverviewByFactKey([
    mapped({
      id: 'old',
      content: "User's favorite colore: rosso",
      tags: [COLOR_TAG],
      updatedAt: '2026-01-01T00:00:00.000Z',
      importance: 9,
    }),
    mapped({
      id: 'new',
      content: "User's favorite colore: verde",
      tags: [COLOR_TAG],
      updatedAt: '2026-04-01T00:00:00.000Z',
      importance: 5,
    }),
  ])
  assert.equal(deduped.length, 1)
  assert.match(deduped[0].content, /verde/i)
}

// TEST 13 — semantic dedupe + multi-valued survive
{
  const collapsed = dedupeOverviewSemantically([
    mapped({ id: 'a', content: 'User likes / prefers: Naruto.' }),
    mapped({ id: 'b', content: 'User is interested in: Naruto' }),
    mapped({ id: 'c', content: 'User is interested in: Dragon Ball', tags: [DB_TAG] }),
  ])
  assert.equal(collapsed.length, 2)
  const text = collapsed.map((r) => r.content).join(' | ')
  assert.match(text, /Naruto/i)
  assert.match(text, /Dragon Ball/i)
}

// TEST 1 — standard overview pack content + ground-truth instructions
{
  const selected = selectOverviewMemories([
    mapped({
      id: '1',
      category: 'preferences',
      content: "User's favorite colore: verde",
      tags: [COLOR_TAG],
    }),
    mapped({
      id: '2',
      category: 'preferences',
      content: 'User is interested in: Naruto',
      tags: [NARUTO_TAG],
    }),
    mapped({
      id: '3',
      category: 'projects',
      content: 'User is developing: LAIfe',
      tags: ['fact_key:projects.laife'],
    }),
  ])
  assert.equal(selected.length, 3)
  const pack = formatMemoryOverviewPack(selected)
  assert.match(pack, /MEMORY OVERVIEW/)
  assert.match(pack, /ONLY these facts/)
  assert.match(pack, /do not infer additional remembered facts/i)
  assert.match(pack, /do not invent/i)
  assert.match(pack, /ChatGPT|OpenAI/i)
  assert.match(pack, /verde/i)
  assert.match(pack, /Naruto/i)
  assert.match(pack, /LAIfe/i)
  // TEST 14 — no metadata leakage in fact lines (instructions may name forbidden fields)
  const factsOnly = pack.split('Persisted facts:\n')[1] || ''
  assert.doesNotMatch(factsOnly, /\bfact_key:/)
  assert.doesNotMatch(factsOnly, /\buser_id\b/)
  assert.doesNotMatch(factsOnly, /\busage_count\b/)
  assert.doesNotMatch(factsOnly, /\bconfidence\b/)
  assert.doesNotMatch(factsOnly, /\bobsolete\b/)
  assert.doesNotMatch(factsOnly, /\b2026-0/)
  assert.doesNotMatch(factsOnly, /\bid:\s*1\b/)
}

// TEST 10 — bounds: 50 actives → max 15 / 2000 chars
{
  const many = []
  for (let i = 0; i < 50; i += 1) {
    const cat =
      i % 5 === 0
        ? 'identity'
        : i % 5 === 1
          ? 'relationships'
          : i % 5 === 2
            ? 'projects'
            : i % 5 === 3
              ? 'goals'
              : 'preferences'
    many.push(
      mapped({
        id: `m${i}`,
        category: cat,
        content: `Durable fact number ${i} with some padding text for the pack.`,
        importance: 5 + (i % 3),
        updatedAt: `2026-05-${String((i % 28) + 1).padStart(2, '0')}T00:00:00.000Z`,
        tags: [`fact_key:${cat}.slot.${i}`],
      }),
    )
  }
  const selected = selectOverviewMemories(many)
  assert.ok(selected.length <= OVERVIEW_MAX_MEMORIES)
  assert.equal(selected.length, OVERVIEW_MAX_MEMORIES)
  const factChars = selected.reduce((n, r) => n + String(r.content).trim().length, 0)
  assert.ok(factChars <= OVERVIEW_MAX_FACT_CHARS)
  const pack = formatMemoryOverviewPack(selected)
  const factsSection = pack.split('Persisted facts:\n')[1] || ''
  const contentChars = factsSection
    .split('\n')
    .map((line) => line.replace(/^- /, ''))
    .join('').length
  assert.ok(contentChars <= OVERVIEW_MAX_FACT_CHARS)
}

// TEST 11 — category diversity / preference cap under priority-fill
{
  const rows = []
  for (let i = 0; i < 20; i += 1) {
    rows.push(
      mapped({
        id: `pref${i}`,
        category: 'preferences',
        content: `User likes / prefers: PrefItem${i}`,
        tags: [`fact_key:preferences.interest.prefitem${i}`],
        importance: 8,
        updatedAt: `2026-06-${String((i % 28) + 1).padStart(2, '0')}T00:00:00.000Z`,
      }),
    )
  }
  rows.push(
    mapped({
      id: 'id1',
      category: 'identity',
      content: 'User is named: Cristian',
      tags: ['fact_key:identity.name'],
      importance: 9,
    }),
    mapped({
      id: 'rel1',
      category: 'relationships',
      content: 'User has a partner named: Alex',
      tags: ['fact_key:relationships.partner'],
      importance: 8,
    }),
    mapped({
      id: 'proj1',
      category: 'projects',
      content: 'User is developing: LAIfe',
      tags: ['fact_key:projects.laife'],
      importance: 8,
    }),
    mapped({
      id: 'goal1',
      category: 'goals',
      content: 'User goal: ship Memory 2.0',
      tags: ['fact_key:goals.memory'],
      importance: 7,
    }),
  )
  const selected = selectOverviewMemories(rows)
  const byCat = {}
  for (const row of selected) {
    byCat[row.category] = (byCat[row.category] || 0) + 1
  }
  assert.ok((byCat.identity || 0) >= 1)
  assert.ok((byCat.relationships || 0) >= 1)
  assert.ok((byCat.projects || 0) >= 1)
  assert.ok((byCat.goals || 0) >= 1)
  assert.ok((byCat.preferences || 0) <= OVERVIEW_CATEGORY_CAPS.preferences)
  assert.ok(selected.length <= OVERVIEW_MAX_MEMORIES)
}

// Priority-fill clarification: high-priority fill can exclude lower categories
{
  const rows = []
  for (let i = 0; i < 2; i += 1) {
    rows.push(
      mapped({
        id: `id${i}`,
        category: 'identity',
        content: `Identity fact ${i}`,
        tags: [`fact_key:identity.f${i}`],
      }),
    )
  }
  for (let i = 0; i < 3; i += 1) {
    rows.push(
      mapped({
        id: `rel${i}`,
        category: 'relationships',
        content: `Relationship fact ${i}`,
        tags: [`fact_key:relationships.f${i}`],
      }),
    )
  }
  for (let i = 0; i < 3; i += 1) {
    rows.push(
      mapped({
        id: `proj${i}`,
        category: 'projects',
        content: `Project fact ${i}`,
        tags: [`fact_key:projects.f${i}`],
      }),
    )
  }
  for (let i = 0; i < 3; i += 1) {
    rows.push(
      mapped({
        id: `goal${i}`,
        category: 'goals',
        content: `Goal fact ${i}`,
        tags: [`fact_key:goals.f${i}`],
      }),
    )
  }
  for (let i = 0; i < 4; i += 1) {
    rows.push(
      mapped({
        id: `pref${i}`,
        category: 'preferences',
        content: `Preference fact ${i}`,
        tags: [`fact_key:preferences.f${i}`],
      }),
    )
  }
  rows.push(
    mapped({
      id: 'skill0',
      category: 'skills',
      content: 'Skill fact 0',
      tags: ['fact_key:skills.f0'],
    }),
  )
  const selected = selectOverviewMemories(rows)
  assert.equal(selected.length, 15)
  assert.equal(selected.filter((r) => r.category === 'skills').length, 0)
  assert.equal(selected.filter((r) => r.category === 'preferences').length, 4)
}

// TEST 3/5/16 — empty + unauthenticated (zero model)
{
  const emptyDb = createFakeSupabase([])
  const empty = await tryHandleMemoryOverview({
    userMessage: 'Cosa ricordi di me?',
    userId: 'user-a',
    supabase: emptyDb,
  })
  assert.equal(empty.handled, true)
  assert.equal(empty.status, 'overview_empty')
  assert.equal(empty.skippedModel, true)
  assert.equal(empty.pack, '')
  assert.match(empty.message, /non ho informazioni salvate/i)

  let listCalls = 0
  const unauth = await tryHandleMemoryOverview({
    userMessage: 'What do you remember about me?',
    userId: null,
    listActiveMemoriesForOwner: async () => {
      listCalls += 1
      return { rows: [], error: null }
    },
  })
  assert.equal(unauth.handled, true)
  assert.equal(unauth.status, 'overview_unauthenticated')
  assert.equal(unauth.skippedModel, true)
  assert.equal(unauth.queried, false)
  assert.equal(listCalls, 0)
  assert.match(unauth.message, /signed-in|autenticato/i)
  assert.doesNotMatch(unauth.message, /brain-api@local/)
}

// TEST 1 + 4 + 6 + 15 — non-empty overview via tryHandle; Memory OFF irrelevant; isolation
{
  const db = createFakeSupabase([
    seedRow({
      id: 'a1',
      userId: 'user-a',
      content: "User's favorite colore: verde",
      tags: [COLOR_TAG],
      category: 'preferences',
    }),
    seedRow({
      id: 'a2',
      userId: 'user-a',
      content: 'User is interested in: Naruto',
      tags: [NARUTO_TAG],
      category: 'preferences',
    }),
    seedRow({
      id: 'a3',
      userId: 'user-a',
      content: 'User is developing: LAIfe',
      tags: ['fact_key:projects.laife'],
      category: 'projects',
    }),
    seedRow({
      id: 'b1',
      userId: 'user-b',
      content: "User's favorite colore: rosso",
      tags: [COLOR_TAG],
      category: 'preferences',
    }),
  ])

  const overview = await tryHandleMemoryOverview({
    userMessage: 'Cosa ricordi di me?',
    userId: 'user-a',
    supabase: db,
  })
  assert.equal(overview.handled, true)
  assert.equal(overview.status, 'overview')
  assert.equal(overview.skippedModel, false)
  assert.ok(overview.pack.includes('MEMORY OVERVIEW'))
  assert.match(overview.pack, /verde/i)
  assert.match(overview.pack, /Naruto/i)
  assert.match(overview.pack, /LAIfe/i)
  assert.doesNotMatch(overview.pack, /rosso/i)
  assert.ok(overview.selectedCount >= 3)
  assert.ok(overview.selectedCount <= OVERVIEW_MAX_MEMORIES)

  // Isolation: user-b only sees own row
  const overviewB = await tryHandleMemoryOverview({
    userMessage: 'What do you remember about me?',
    userId: 'user-b',
    supabase: db,
  })
  assert.equal(overviewB.handled, true)
  assert.match(overviewB.pack, /rosso/i)
  assert.doesNotMatch(overviewB.pack, /verde/i)
  assert.doesNotMatch(overviewB.pack, /Naruto/i)
}

// TEST 9 — no extraction save from overview request
{
  const decision = analyzeConversation('Cosa ricordi di me?', '')
  assert.equal(decision.save, false)
}

// TEST 20 — pack instructions forbid current-chat leakage
{
  const pack = formatMemoryOverviewPack([
    mapped({
      id: '1',
      content: "User's favorite colore: verde",
      tags: [COLOR_TAG],
    }),
  ])
  assert.match(pack, /verde/i)
  assert.doesNotMatch(pack, /cinema/i)
  assert.match(pack, /do not infer additional remembered facts from the current conversation/i)
  assert.match(pack, /do not claim a fact is remembered unless it appears below/i)
}

// Constants / source contracts
{
  assert.equal(OVERVIEW_MAX_MEMORIES, 15)
  assert.equal(OVERVIEW_MAX_FACT_CHARS, 2000)
  assert.equal(OVERVIEW_POOL_LIMIT, 80)

  const chatSrc = readFileSync(join(root, 'api/chat.ts'), 'utf8')
  assert.match(chatSrc, /tryHandleMemoryOverview/)
  assert.match(chatSrc, /overviewHandled/)
  const overviewIdx2 = chatSrc.indexOf('tryHandleMemoryOverview')
  const recallCallIdx = chatSrc.indexOf('await loadCoreMemoryPack')
  assert.ok(overviewIdx2 > 0 && recallCallIdx > overviewIdx2, 'Overview must run before Recall call')
  assert.match(chatSrc, /if \(lastUserCaption && !skipExtractionForInspection && advancedMemoryAllowed\)/)
  assert.match(chatSrc, /skipExtractionForInspection/)
  assert.match(chatSrc, /decideAdvancedMemoryEntitlement/)
  assert.match(chatSrc, /advancedMemoryAllowed/)
  assert.match(chatSrc, /isPersonalMemoryProbe/)
  assert.match(chatSrc, /memoryPack = overviewHandled/)
  // Overview itself is gated by advancedMemoryAllowed (forget stays Free / earlier).
  assert.match(chatSrc, /if \(lastUserCaption && advancedMemoryAllowed\)/)

  const forgetIdx = chatSrc.indexOf('tryHandleMemoryControl')
  assert.ok(forgetIdx > 0 && forgetIdx < overviewIdx2)

  const overviewSrc = readFileSync(join(root, 'lib/server/memory-control-overview.js'), 'utf8')
  assert.match(overviewSrc, /listActiveMemoriesForOwner/)
  assert.doesNotMatch(overviewSrc, /ensureDefaultUserId/)
  assert.doesNotMatch(overviewSrc, /DEFAULT_API_USER_EMAIL/)
}

// Ordinary chat / not-overview passthrough
{
  const miss = await tryHandleMemoryOverview({
    userMessage: 'Ciao, come stai?',
    userId: 'user-a',
    listActiveMemoriesForOwner: async () => {
      assert.fail('must not query on non-overview')
    },
  })
  assert.equal(miss.handled, false)
  assert.equal(miss.status, 'not_overview')
}

console.log('memory-control-overview.test.mjs: PASS')
