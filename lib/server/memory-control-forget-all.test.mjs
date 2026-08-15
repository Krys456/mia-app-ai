/**
 * Conversational Memory Control PR2 — forget-all + confirmation.
 * Run: node lib/server/memory-control-forget-all.test.mjs
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  deleteAllMemories,
  extractDurableFacts,
  upsertMemory,
} from './brain-memory.js'
import { loadCoreMemoryPack } from './core-memory-recall.js'
import { buildCoreResponsesCreateParams } from './core-responses-params.js'
import {
  ACK_SPECIFIC_FORGET_IT,
  FORGET_ALL_CONFIRM_PROMPT_IT,
  dedupeForgetLabels,
  isGlobalForgetIntent,
  isSpecificForgetIntent,
  matchForgetAllConfirmPrompt,
  memoryForgetLabel,
  tryHandleForgetAll,
  tryHandleMemoryControl,
  tryHandleMemoryMetaFollowUp,
  tryHandleSpecificForget,
} from './memory-control-forget.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const COLOR_KEY = 'preferences.favorite.color'
const COLOR_TAG = `fact_key:${COLOR_KEY}`
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
    updated_at: partial.updatedAt || '2026-01-01T00:00:00.000Z',
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
    const cols =
      !selectCols || selectCols === '*' || selectCols === MEMORY_SELECT
        ? MEMORY_SELECT.split(',').map((c) => c.trim())
        : String(selectCols)
            .split(',')
            .map((c) => c.trim())
            .filter(Boolean)
    const out = {}
    for (const col of cols) out[col] = row[col]
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
      delete() {
        state.mode = 'delete'
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
      maybeSingle() {
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
      return state.single
        ? updated.length
          ? { data: updated[0], error: null }
          : { data: null, error: { message: 'No rows updated' } }
        : { data: updated, error: null }
    }

    if (state.mode === 'delete') {
      const deleted = []
      const keep = []
      for (const row of rows) {
        if (state.filters.every((f) => matchesFilter(row, f))) deleted.push(project(row, state.selectCols))
        else keep.push(row)
      }
      rows.length = 0
      rows.push(...keep)
      return state.single
        ? deleted.length
          ? { data: deleted[0], error: null }
          : { data: null, error: null }
        : { data: deleted, error: null }
    }

    const projected = matched.map((row) => project(row, state.selectCols))
    return state.single
      ? projected.length
        ? { data: projected[0], error: null }
        : { data: null, error: { message: 'not found' } }
      : { data: projected, error: null }
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
  for (const fact of facts) {
    await upsertMemory(
      {
        ...fact,
        userId,
        requireExplicitUserId: true,
        userMessage: message,
      },
      { supabase: db },
    )
  }
}

function msgs(...turns) {
  return turns.map(([role, content]) => ({ role, content }))
}

// Intent unit checks
{
  assert.equal(isGlobalForgetIntent('Dimentica tutto quello che sai su di me.'), true)
  assert.equal(isGlobalForgetIntent('Forget everything about me.'), true)
  assert.equal(isGlobalForgetIntent('Dimentica il mio colore preferito.'), false)
  assert.equal(isSpecificForgetIntent('Dimentica tutto quello che sai su di me.'), false)
  assert.equal(isSpecificForgetIntent('Dimentica il mio colore preferito.'), true)
  assert.equal(isGlobalForgetIntent('Non dimenticare che il mio colore preferito è blu.'), false)
}

// TEST 1 — request does not delete
{
  const db = createFakeSupabase([
    seedRow({ id: 'a1', userId: 'user-a', content: "User's favorite colore: verde", tags: [COLOR_TAG] }),
    seedRow({
      id: 'a2',
      userId: 'user-a',
      title: 'Interest',
      content: 'User is interested in: Naruto',
      tags: ['fact_key:preferences.interest.naruto'],
    }),
  ])
  const result = await tryHandleForgetAll({
    userMessage: 'Dimentica tutto quello che sai su di me.',
    userId: 'user-a',
    messages: msgs(['user', 'Dimentica tutto quello che sai su di me.']),
    supabase: db,
  })
  assert.equal(result.status, 'forget_all_confirm_required')
  assert.equal(result.message, FORGET_ALL_CONFIRM_PROMPT_IT)
  assert.equal(result.skippedModel, true)
  assert.equal(result.deletedCount, 0)
  assert.equal(db.rows.length, 2)
}

// TEST 2 — confirmed delete-all
{
  const db = createFakeSupabase([
    seedRow({ id: 'a1', userId: 'user-a', content: "User's favorite colore: verde", tags: [COLOR_TAG] }),
    seedRow({
      id: 'a2',
      userId: 'user-a',
      title: 'Interest',
      content: 'User is interested in: Naruto',
      tags: ['fact_key:preferences.interest.naruto'],
    }),
  ])
  const ask = await tryHandleForgetAll({
    userMessage: 'Dimentica tutto quello che sai su di me.',
    userId: 'user-a',
    messages: msgs(['user', 'Dimentica tutto quello che sai su di me.']),
    supabase: db,
  })
  assert.equal(ask.status, 'forget_all_confirm_required')

  const confirm = await tryHandleForgetAll({
    userMessage: 'Sì.',
    userId: 'user-a',
    messages: msgs(
      ['user', 'Dimentica tutto quello che sai su di me.'],
      ['assistant', FORGET_ALL_CONFIRM_PROMPT_IT],
      ['user', 'Sì.'],
    ),
    supabase: db,
  })
  assert.equal(confirm.status, 'forgotten_all')
  assert.equal(confirm.skippedModel, true)
  assert.equal(confirm.deletedCount, 2)
  assert.equal(db.rows.length, 0)
  assert.match(confirm.message, /Fatto\. Ho dimenticato/i)
}

// TEST 3 — cross-user isolation
{
  const db = createFakeSupabase([
    seedRow({ id: 'a1', userId: 'user-a', content: "User's favorite colore: verde", tags: [COLOR_TAG] }),
    seedRow({ id: 'b1', userId: 'user-b', content: "User's favorite colore: rosso", tags: [COLOR_TAG] }),
  ])
  const confirm = await tryHandleForgetAll({
    userMessage: 'Sì, confermo.',
    userId: 'user-a',
    messages: msgs(
      ['user', 'Dimentica tutto quello che sai su di me.'],
      ['assistant', FORGET_ALL_CONFIRM_PROMPT_IT],
      ['user', 'Sì, confermo.'],
    ),
    supabase: db,
  })
  assert.equal(confirm.status, 'forgotten_all')
  assert.equal(db.rows.length, 1)
  assert.equal(db.rows[0].user_id, 'user-b')
}

// TEST 4 — rejection
{
  const db = createFakeSupabase([
    seedRow({ id: 'a1', userId: 'user-a', content: "User's favorite colore: verde", tags: [COLOR_TAG] }),
  ])
  const reject = await tryHandleForgetAll({
    userMessage: 'No.',
    userId: 'user-a',
    messages: msgs(
      ['user', 'Dimentica tutto quello che sai su di me.'],
      ['assistant', FORGET_ALL_CONFIRM_PROMPT_IT],
      ['user', 'No.'],
    ),
    supabase: db,
  })
  assert.equal(reject.status, 'forget_all_cancelled')
  assert.equal(db.rows.length, 1)
  assert.match(reject.message, /non ho cancellato/i)
}

// TEST 5 — unrelated reply abandons pending
{
  const db = createFakeSupabase([
    seedRow({ id: 'a1', userId: 'user-a', content: "User's favorite colore: verde", tags: [COLOR_TAG] }),
  ])
  const abandoned = await tryHandleMemoryControl({
    userMessage: 'Parliamo di Naruto.',
    userId: 'user-a',
    messages: msgs(
      ['user', 'Dimentica tutto quello che sai su di me.'],
      ['assistant', FORGET_ALL_CONFIRM_PROMPT_IT],
      ['user', 'Parliamo di Naruto.'],
    ),
    supabase: db,
  })
  assert.equal(abandoned.handled, false)
  assert.equal(db.rows.length, 1)
}

// TEST 6 — stale yes after unrelated must NOT wipe
{
  const db = createFakeSupabase([
    seedRow({ id: 'a1', userId: 'user-a', content: "User's favorite colore: verde", tags: [COLOR_TAG] }),
  ])
  const stale = await tryHandleForgetAll({
    userMessage: 'Sì.',
    userId: 'user-a',
    messages: msgs(
      ['user', 'Dimentica tutto quello che sai su di me.'],
      ['assistant', FORGET_ALL_CONFIRM_PROMPT_IT],
      ['user', 'Parliamo di Naruto.'],
      ['assistant', 'Certo, Naruto è un classico.'],
      ['user', 'Sì.'],
    ),
    supabase: db,
  })
  assert.equal(stale.handled, false)
  assert.equal(db.rows.length, 1)
}

// TEST 7 — Memory OFF still deletes on confirm (gate ignores memoryEnabled)
{
  const db = createFakeSupabase([
    seedRow({ id: 'a1', userId: 'user-a', content: "User's favorite colore: verde", tags: [COLOR_TAG] }),
  ])
  const confirm = await tryHandleForgetAll({
    userMessage: 'Sì.',
    userId: 'user-a',
    messages: msgs(
      ['user', 'Dimentica tutto quello che sai su di me.'],
      ['assistant', FORGET_ALL_CONFIRM_PROMPT_IT],
      ['user', 'Sì.'],
    ),
    supabase: db,
  })
  assert.equal(confirm.status, 'forgotten_all')
  assert.equal(db.rows.length, 0)
}

// TEST 8 — unauthenticated
{
  const db = createFakeSupabase([
    seedRow({ id: 'a1', userId: 'user-a', content: "User's favorite colore: verde", tags: [COLOR_TAG] }),
  ])
  const ask = await tryHandleForgetAll({
    userMessage: 'Dimentica tutto quello che sai su di me.',
    userId: null,
    messages: msgs(['user', 'Dimentica tutto quello che sai su di me.']),
    supabase: db,
  })
  assert.equal(ask.status, 'unauthenticated')
  assert.equal(db.rows.length, 1)

  const confirm = await tryHandleForgetAll({
    userMessage: 'Sì.',
    userId: null,
    messages: msgs(
      ['user', 'Dimentica tutto quello che sai su di me.'],
      ['assistant', FORGET_ALL_CONFIRM_PROMPT_IT],
      ['user', 'Sì.'],
    ),
    supabase: db,
  })
  assert.equal(confirm.status, 'unauthenticated')
  assert.equal(db.rows.length, 1)
}

// TEST 9 — precedence: global forget, not specific
{
  const db = createFakeSupabase([
    seedRow({ id: 'a1', userId: 'user-a', content: "User's favorite colore: verde", tags: [COLOR_TAG] }),
  ])
  const control = await tryHandleMemoryControl({
    userMessage: 'Dimentica tutto quello che sai su di me.',
    userId: 'user-a',
    messages: msgs(['user', 'Dimentica tutto quello che sai su di me.']),
    supabase: db,
  })
  assert.equal(control.status, 'forget_all_confirm_required')
  assert.equal(db.rows[0].status, 'active')
  assert.equal(db.rows.length, 1)
}

// TEST 10 — save-wrapper regression
{
  assert.equal(isGlobalForgetIntent('Non dimenticare che il mio colore preferito è blu.'), false)
  assert.equal(isSpecificForgetIntent('Non dimenticare che il mio colore preferito è blu.'), false)
  const facts = extractDurableFacts('Non dimenticare che il mio colore preferito è blu.')
  assert.ok(facts.some((f) => f.factKey === COLOR_KEY && /blu/i.test(f.content)))
}

// TEST 11 — Specific Forget regression
{
  const db = createFakeSupabase([
    seedRow({ id: 'a1', userId: 'user-a', content: "User's favorite colore: verde", tags: [COLOR_TAG] }),
  ])
  const control = await tryHandleMemoryControl({
    userMessage: 'Dimentica il mio colore preferito.',
    userId: 'user-a',
    messages: msgs(['user', 'Dimentica il mio colore preferito.']),
    supabase: db,
  })
  assert.equal(control.status, 'forgotten')
  assert.equal(db.rows[0].status, 'obsolete')
  assert.equal(db.rows.length, 1)
}

// TEST 12 — failure truthfulness
{
  const db = createFakeSupabase([
    seedRow({ id: 'a1', userId: 'user-a', content: "User's favorite colore: verde", tags: [COLOR_TAG] }),
  ])
  const fail = await tryHandleForgetAll({
    userMessage: 'Sì.',
    userId: 'user-a',
    messages: msgs(
      ['user', 'Dimentica tutto quello che sai su di me.'],
      ['assistant', FORGET_ALL_CONFIRM_PROMPT_IT],
      ['user', 'Sì.'],
    ),
    supabase: db,
    deleteAllMemories: async () => {
      throw new Error('boom')
    },
  })
  assert.equal(fail.status, 'error')
  assert.match(fail.message, /Non sono riuscito/i)
  assert.doesNotMatch(fail.message, /Fatto/i)
  assert.equal(db.rows.length, 1)
}

// TEST 17 — Recall after wipe
{
  const db = createFakeSupabase()
  await writeMessage(db, 'user-a', 'Il mio colore preferito è verde.')
  assert.ok(db.rows.some((r) => /verde/i.test(r.content)))

  await tryHandleForgetAll({
    userMessage: 'Sì.',
    userId: 'user-a',
    messages: msgs(
      ['user', 'Dimentica tutto quello che sai su di me.'],
      ['assistant', FORGET_ALL_CONFIRM_PROMPT_IT],
      ['user', 'Sì.'],
    ),
    supabase: db,
  })
  assert.equal(db.rows.filter((r) => r.user_id === 'user-a').length, 0)

  const pack = await loadCoreMemoryPack({
    userMessage: 'Qual è il mio colore preferito?',
    ownerUserId: 'user-a',
    memoryEnabled: true,
    searchMemories: async () => [],
  })
  assert.equal(pack, '')
}

// Production deleteAllMemories helper still works with fake client
{
  const db = createFakeSupabase([
    seedRow({ id: 'a1', userId: 'user-a', content: 'x', tags: [COLOR_TAG] }),
    seedRow({ id: 'b1', userId: 'user-b', content: 'y', tags: [COLOR_TAG] }),
  ])
  const n = await deleteAllMemories({
    userId: 'user-a',
    requireExplicitUserId: true,
    supabase: db,
  })
  assert.equal(n, 1)
  assert.equal(db.rows.length, 1)
  assert.equal(db.rows[0].user_id, 'user-b')
}

// Source contracts: unified gate, one responses.create, Sol unchanged
{
  const chatSrc = readFileSync(join(root, 'api/chat.ts'), 'utf8')
  assert.match(chatSrc, /tryHandleMemoryControl/)
  assert.equal((chatSrc.match(/\.responses\.create\s*\(/g) || []).length, 1)
  const controlIdx = chatSrc.indexOf('tryHandleMemoryControl')
  const createIdx = chatSrc.indexOf('client.responses.create')
  const loadIdx = chatSrc.indexOf('await loadCoreMemoryPack')
  assert.ok(controlIdx > 0 && controlIdx < loadIdx && loadIdx < createIdx)

  const forgetSrc = readFileSync(join(root, 'lib/server/memory-control-forget.js'), 'utf8')
  assert.match(forgetSrc, /tryHandleForgetAll/)
  assert.match(forgetSrc, /deleteAllMemories/)
  assert.match(forgetSrc, /FORGET_ALL_CONFIRM_PROMPT_IT/)
  assert.doesNotMatch(forgetSrc, /ensureDefaultUserId/)

  const sol = buildCoreResponsesCreateParams({
    model: 'gpt-5.6-sol',
    instructions: 'test',
    maxOutputTokens: 100,
    input: [{ type: 'message', role: 'user', content: 'hi' }],
  })
  assert.equal(sol.model, 'gpt-5.6-sol')
  assert.equal('temperature' in sol, false)
  assert.deepEqual(sol.reasoning, { effort: 'none' })

  // specific forget path still exported
  assert.equal(typeof tryHandleSpecificForget, 'function')
}

// === Preview forensic regressions (PR #248 failure) ===

// TEST Preview-1 — exact utterance: global wins, specific NOT invoked, no mutation, zero model
{
  const db = createFakeSupabase([
    seedRow({ id: 'a1', userId: 'user-a', content: "User's favorite colore: verde", tags: [COLOR_TAG] }),
    seedRow({
      id: 'a2',
      userId: 'user-a',
      title: 'Interest',
      content: 'User is interested in: Naruto',
      tags: ['fact_key:preferences.interest.naruto'],
    }),
  ])
  const phrase = 'Dimentica tutto quello che sai su di me'
  assert.equal(isGlobalForgetIntent(phrase), true)
  assert.equal(isSpecificForgetIntent(phrase), false)

  let specificCalled = false
  const result = await tryHandleMemoryControl({
    userMessage: phrase,
    userId: 'user-a',
    messages: msgs(['user', phrase]),
    supabase: db,
    onBeforeSpecificForget: () => {
      specificCalled = true
    },
  })
  assert.equal(result.status, 'forget_all_confirm_required')
  assert.equal(result.message, FORGET_ALL_CONFIRM_PROMPT_IT)
  assert.equal(result.skippedModel, true)
  assert.equal(result.specificForgetInvoked, false)
  assert.equal(specificCalled, false)
  assert.equal(db.rows.length, 2)
  assert.ok(db.rows.every((r) => r.status === 'active'))
}

// TEST Preview-2 — green + Naruto still routes to forget-all confirm
{
  const db = createFakeSupabase([
    seedRow({ id: 'a1', userId: 'user-a', content: "User's favorite colore: il verde", tags: [COLOR_TAG] }),
    seedRow({
      id: 'a2',
      userId: 'user-a',
      title: 'Interest',
      content: 'User is interested in: Naruto',
      tags: ['fact_key:preferences.interest.naruto'],
    }),
    seedRow({
      id: 'a3',
      userId: 'user-a',
      title: 'Interest',
      content: 'User is interested in: Naruto',
      tags: ['fact_key:preferences.interest.naruto'],
    }),
  ])
  const result = await tryHandleMemoryControl({
    userMessage: 'Dimentica tutto quello che sai su di me',
    userId: 'user-a',
    messages: msgs(['user', 'Dimentica tutto quello che sai su di me']),
    supabase: db,
  })
  assert.equal(result.status, 'forget_all_confirm_required')
  assert.doesNotMatch(result.message, /Naruto|verde|Quale vuoi/i)
}

// TEST Preview-5 — meta follow-up after specific forget must not mention ChatGPT
{
  const meta = tryHandleMemoryMetaFollowUp({
    userMessage: 'Se provo in una nuova chat mi assicuri che non lo ricordi più?',
    messages: msgs(
      ['user', 'Dimentica il mio colore preferito.'],
      ['assistant', ACK_SPECIFIC_FORGET_IT],
      ['user', 'Se provo in una nuova chat mi assicuri che non lo ricordi più?'],
    ),
  })
  assert.equal(meta.handled, true)
  assert.equal(meta.skippedModel, true)
  assert.match(meta.message, /memoria attiva|nuove chat/i)
  assert.doesNotMatch(meta.message, /ChatGPT|Personalization|OpenAI|impostazioni di ChatGPT/i)
}

// TEST Preview-5b — meta after forget-all
{
  const meta = tryHandleMemoryMetaFollowUp({
    userMessage: 'Te lo ricorderai in una nuova chat?',
    messages: msgs(
      ['user', 'Sì, confermo.'],
      ['assistant', 'Fatto. Ho dimenticato tutte le informazioni che avevo memorizzato su di te.'],
      ['user', 'Te lo ricorderai in una nuova chat?'],
    ),
  })
  assert.equal(meta.handled, true)
  assert.match(meta.message, /cancellate|deleted/i)
  assert.doesNotMatch(meta.message, /ChatGPT|Personalization/i)
}

// TEST Preview-6 — duplicate Naruto labels deduped
{
  const labels = dedupeForgetLabels([
    memoryForgetLabel({ content: 'User is interested in: Naruto' }),
    memoryForgetLabel({ content: 'User likes / prefers: Naruto' }),
    memoryForgetLabel({ content: "User's favorite colore: verde" }),
  ])
  assert.equal(memoryForgetLabel({ content: 'User is interested in: Naruto' }), 'Naruto')
  assert.ok(!labels.some((l) => /^is\s+naruto$/i.test(l)))
  assert.equal(labels.filter((l) => /naruto/i.test(l)).length, 1)
  assert.ok(labels.some((l) => /verde/i.test(l)))
}

// Confirm prompt matcher tolerates trailing punctuation
{
  assert.equal(matchForgetAllConfirmPrompt(FORGET_ALL_CONFIRM_PROMPT_IT + '.'), 'it')
  assert.equal(matchForgetAllConfirmPrompt(FORGET_ALL_CONFIRM_PROMPT_IT + ' '), 'it')
}

// "Il verde voglio elimimare" is NOT a control forget success path
{
  assert.equal(isSpecificForgetIntent('Il verde voglio elimimare'), false)
  assert.equal(isGlobalForgetIntent('Il verde voglio elimimare'), false)
}

console.log('ok: memory control forget-all PR2')
