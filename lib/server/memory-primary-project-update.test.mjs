/**
 * #281 — single-valued primary project update / temporal-bridge follow-up.
 * Preview: "In realtà il mio progetto principale ora è LAIfe" must UPDATE
 * projects.primary (not miss write / not create a parallel row).
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  extractDurableFacts,
  normalizeLifecycleEntityValue,
  readFactKeyFromTags,
  runMemoryPipeline,
} from './brain-memory.js'
import {
  detectMemoryQueryIntent,
  formatCoreMemoryPack,
  rerankMemoriesForRecall,
} from './core-memory-recall.js'
import { mapMemoryPipelineToFeedbackEvent } from './memory-feedback-event.js'
import { buildCoreResponsesCreateParams } from './core-responses-params.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel) => readFileSync(join(root, rel), 'utf8')
const MEMORY_SELECT =
  'id, category, title, content, importance, usage_count, last_used_at, created_at, updated_at, status, tags'

const PREVIEW_CREATE = 'Il mio progetto principale è BrAIn'
const PREVIEW_UPDATE = 'In realtà il mio progetto principale ora è LAIfe'

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
  function createBuilder() {
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
        return api
      },
      maybeSingle() {
        state.single = 'maybe'
        return api
      },
      then(resolve, reject) {
        return Promise.resolve().then(() => {
          try {
            if (state.mode === 'insert') {
              const row = {
                id: String(seq++),
                usage_count: 0,
                last_used_at: null,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                status: 'active',
                ...state.insertRow,
              }
              rows.push(row)
              resolve({ data: project(row), error: null })
              return
            }
            if (state.mode === 'update') {
              let matched = rows.filter((r) => state.filters.every((f) => matchesFilter(r, f)))
              for (const row of matched) {
                Object.assign(row, state.patch, { updated_at: new Date().toISOString() })
              }
              const data = matched.map((r) => project(r))
              resolve(
                state.single === true
                  ? { data: data[0] || null, error: data[0] ? null : { message: 'none' } }
                  : state.single === 'maybe'
                    ? { data: data[0] || null, error: null }
                    : { data, error: null },
              )
              return
            }
            let matched = rows.filter((r) => state.filters.every((f) => matchesFilter(r, f)))
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
            const data = matched.map((r) => project(r))
            resolve(
              state.single === true
                ? { data: data[0] || null, error: data[0] ? null : { message: 'none' } }
                : state.single === 'maybe'
                  ? { data: data[0] || null, error: null }
                  : { data, error: null },
            )
          } catch (e) {
            reject(e)
          }
        })
      },
    }
    return api
  }
  return { from: createBuilder, rows }
}

async function pipeline(db, msg, userId = 'u1') {
  return runMemoryPipeline({
    userMessage: msg,
    assistantMessage: 'Ok.',
    memoryEnabled: true,
    userId,
    requireExplicitUserId: true,
    supabase: db,
  })
}

function activePrimary(db) {
  return db.rows.filter(
    (r) => r.status === 'active' && readFactKeyFromTags(r.tags) === 'projects.primary',
  )
}

describe('primary project temporal-bridge extract (#281)', () => {
  it('normalizeLifecycleEntityValue strips trailing now/ora', () => {
    assert.equal(normalizeLifecycleEntityValue('LAIfe now'), 'LAIfe')
    assert.equal(normalizeLifecycleEntityValue('LAIfe ora'), 'LAIfe')
    assert.equal(normalizeLifecycleEntityValue('ora LAIfe'), 'LAIfe')
  })

  it('exact Preview correction extracts canonical LAIfe', () => {
    const facts = extractDurableFacts(PREVIEW_UPDATE)
    assert.equal(facts.length, 1)
    assert.equal(facts[0].factKey, 'projects.primary')
    assert.equal(facts[0].content, "User's primary project: LAIfe")
    assert.doesNotMatch(facts[0].content, /ora|realt|in realtà/i)
  })

  it('natural IT/EN update phrases extract projects.primary', () => {
    const phrases = [
      'In realtà il mio progetto principale ora è LAIfe.',
      'Adesso il mio progetto principale è LAIfe.',
      'Il mio progetto principale ora è LAIfe.',
      'Anzi, il mio progetto principale è LAIfe.',
      'Ho cambiato: il progetto principale è LAIfe.',
      'Actually my main project is LAIfe now.',
      'My main project is LAIfe now.',
      'I changed it — my main project is LAIfe.',
    ]
    for (const p of phrases) {
      const facts = extractDurableFacts(p).filter((f) => f.factKey === 'projects.primary')
      assert.ok(facts.length >= 1, `missing extract for: ${p}`)
      assert.match(facts[0].content, /LAIfe/i)
      assert.doesNotMatch(facts[0].content, /\bnow\b|\bora\b/i)
    }
  })

  it('narrow singular-favorite temporal bridge still works', () => {
    const facts = extractDurableFacts('Il mio colore preferito ora è blu')
    assert.ok(facts.some((f) => f.factKey === 'preferences.favorite.color' && /blu/i.test(f.content)))
  })
})

describe('primary project real pipeline update (#281)', () => {
  it('second-turn Preview sentence → updated event + single active LAIfe', async () => {
    const db = createFakeSupabase()
    const created = await pipeline(db, PREVIEW_CREATE)
    assert.equal(created.stats.created, 1)
    const createdEvent = mapMemoryPipelineToFeedbackEvent(created)
    assert.equal(createdEvent?.type, 'created')
    assert.equal(createdEvent?.displayText, 'Primary project: BrAIn')
    assert.equal(activePrimary(db).length, 1)
    assert.match(activePrimary(db)[0].content, /BrAIn/)

    const updated = await pipeline(db, PREVIEW_UPDATE)
    assert.equal(updated.stats.created, 0)
    assert.equal(updated.stats.updated, 1)
    assert.equal(updated.stats.revoked, 0)
    assert.equal(updated.stats.replaced, 0)

    const event = mapMemoryPipelineToFeedbackEvent(updated)
    assert.equal(event?.type, 'updated')
    assert.equal(event?.displayText, 'Primary project: LAIfe')

    const actives = activePrimary(db)
    assert.equal(actives.length, 1)
    assert.match(actives[0].content, /LAIfe/)
    assert.doesNotMatch(actives[0].content, /BrAIn/)
    assert.ok(
      !db.rows.some(
        (r) =>
          r.status === 'active' &&
          readFactKeyFromTags(r.tags) === 'projects.primary' &&
          /BrAIn/i.test(r.content),
      ),
    )
  })

  it('Created / Updated / Removed real matrix', async () => {
    const db = createFakeSupabase()
    const c = await pipeline(db, PREVIEW_CREATE)
    assert.equal(mapMemoryPipelineToFeedbackEvent(c)?.type, 'created')

    const u = await pipeline(db, PREVIEW_UPDATE)
    assert.equal(mapMemoryPipelineToFeedbackEvent(u)?.type, 'updated')

    const r = await pipeline(db, 'LAIfe non è più il mio progetto principale.')
    assert.ok(r.stats.revoked >= 1)
    assert.equal(r.stats.created, 0)
    assert.equal(r.stats.updated, 0)
    assert.equal(mapMemoryPipelineToFeedbackEvent(r)?.type, 'removed')
    assert.equal(activePrimary(db).length, 0)
  })

  it('New Chat recall returns LAIfe only after update', async () => {
    const db = createFakeSupabase()
    await pipeline(db, PREVIEW_CREATE)
    await pipeline(db, PREVIEW_UPDATE)
    const rows = db.rows
      .filter((r) => r.status === 'active')
      .map((r) => ({ ...r, factKey: readFactKeyFromTags(r.tags) }))
    const q = 'Qual è il mio progetto principale?'
    const intent = detectMemoryQueryIntent(q)
    assert.equal(intent.subtype, 'project_primary')
    const ranked = rerankMemoriesForRecall(rows, q, { limit: 3, intent })
    assert.equal(ranked.length, 1)
    assert.match(ranked[0].content, /LAIfe/)
    assert.doesNotMatch(ranked[0].content, /BrAIn/)
    const pack = formatCoreMemoryPack(ranked)
    assert.match(pack, /LAIfe/)
    assert.doesNotMatch(pack, /BrAIn/)
  })

  it('IT UI localization of Primary project gloss', async () => {
    const mod = await import('../../src/lib/memoryFeedback.ts')
    assert.equal(
      mod.localizeMemoryDisplayText('Primary project: LAIfe', 'it'),
      'Progetto principale: LAIfe',
    )
  })

  it('Core invariants unchanged', () => {
    const chat = read('api/chat.ts')
    assert.match(chat, /maxDuration:\s*120/)
    const callLines = chat
      .split('\n')
      .filter((line) => /client\.responses\.create\s*\(/.test(line))
    assert.equal(callLines.length, 1)
    const params = buildCoreResponsesCreateParams({
      model: 'gpt-5.6-sol',
      instructions: 'x',
      maxOutputTokens: 100,
      input: [],
    })
    assert.deepEqual(params.reasoning, { effort: 'none' })
  })
})
