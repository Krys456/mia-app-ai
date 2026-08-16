/**
 * #281 additive favorite / cofavorite normalization follow-up.
 * Covers Preview: "oltre al rosso ed il blu, è anche il viola" first-turn write
 * + canonical displayText (not "Anche il viola").
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  cleanFavoritePreferenceValue,
  extractAdditiveFavoriteCandidates,
  extractDurableFacts,
  readFactKeyFromTags,
  runMemoryPipeline,
} from './brain-memory.js'
import {
  detectMemoryQueryIntent,
  formatCoreMemoryPack,
  rerankMemoriesForRecall,
} from './core-memory-recall.js'
import {
  mapMemoryPipelineToFeedbackEvent,
  safeMemoryDisplayText,
} from './memory-feedback-event.js'
import { buildCoreResponsesCreateParams } from './core-responses-params.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel) => readFileSync(join(root, rel), 'utf8')
const MEMORY_SELECT =
  'id, category, title, content, importance, usage_count, last_used_at, created_at, updated_at, status, tags'

const PREVIEW_SENTENCE =
  'Il mio colore preferito, oltre al rosso ed il blu, è anche il viola'

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
              for (const row of matched) Object.assign(row, state.patch, {
                updated_at: new Date().toISOString(),
              })
              resolve({ data: matched.map((r) => project(r)), error: null })
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

function activeKeys(db) {
  return db.rows
    .filter((r) => r.status === 'active')
    .map((r) => readFactKeyFromTags(r.tags))
    .filter(Boolean)
}

describe('additive favorite extract + normalize (#281)', () => {
  it('cleanFavoritePreferenceValue strips additive fillers', () => {
    assert.equal(cleanFavoritePreferenceValue('Anche il viola'), 'viola')
    assert.equal(cleanFavoritePreferenceValue('also purple'), 'purple')
    assert.equal(cleanFavoritePreferenceValue('il viola'), 'viola')
  })

  it('A/B Preview additive IT → only viola candidate', () => {
    const add = extractAdditiveFavoriteCandidates(PREVIEW_SENTENCE)
    assert.deepEqual(add, [{ subject: 'color', value: 'viola' }])
    const facts = extractDurableFacts(PREVIEW_SENTENCE)
    assert.equal(facts.length, 1)
    assert.equal(facts[0].factKey, 'preferences.cofavorite.color.viola')
    assert.match(facts[0].content, /viola/i)
    assert.doesNotMatch(facts[0].content, /anche|oltre/i)
  })

  it('C Anche il viola è il mio colore preferito → canonical viola cofavorite', () => {
    const facts = extractDurableFacts('Anche il viola è il mio colore preferito')
    assert.equal(facts.length, 1)
    assert.equal(facts[0].factKey, 'preferences.cofavorite.color.viola')
    assert.equal(facts[0].content, "User's favorite color: viola")
  })

  it('D displayText does not contain Anche il viola', () => {
    const gloss = safeMemoryDisplayText({
      title: 'Co-favorite',
      content: "User's favorite color: viola",
      tags: ['fact_key:preferences.cofavorite.color.viola'],
    })
    assert.equal(gloss, 'Favorite color: viola')
    assert.doesNotMatch(gloss || '', /Anche/i)

    const badLegacy = safeMemoryDisplayText({
      title: 'Favorite',
      content: 'Anche il viola',
    })
    assert.equal(badLegacy, undefined)
  })

  it('F EN additive favorite', () => {
    const facts = extractDurableFacts('Purple is also one of my favorite colors.')
    assert.equal(facts[0]?.factKey, 'preferences.cofavorite.color.purple')
    assert.ok(
      extractAdditiveFavoriteCandidates('Add purple to my favorite colors.').some(
        (c) => c.value.toLowerCase() === 'purple',
      ),
    )
    assert.ok(
      extractAdditiveFavoriteCandidates(
        'Besides red and blue, purple is also a favorite color.',
      ).some((c) => c.value.toLowerCase() === 'purple'),
    )
  })

  it('G food additive', () => {
    const facts = extractDurableFacts('Anche la pizza è uno dei miei cibi preferiti')
    assert.equal(facts[0]?.factKey, 'preferences.cofavorite.food.pizza')
  })

  it('H character additive', () => {
    const facts = extractDurableFacts('Anche Kakashi è uno dei miei personaggi preferiti')
    assert.equal(facts[0]?.factKey, 'preferences.cofavorite.character.kakashi')
  })
})

describe('additive favorite pipeline (#281)', () => {
  it('A existing rosso/blu + additive IT → creates only viola (created event)', async () => {
    const db = createFakeSupabase()
    await pipeline(db, 'I miei colori preferiti sono rosso e blu.')
    assert.deepEqual(
      activeKeys(db).sort(),
      [
        'preferences.cofavorite.color.blu',
        'preferences.cofavorite.color.rosso',
      ].sort(),
    )

    const result = await pipeline(db, PREVIEW_SENTENCE)
    assert.equal(result.stats.created, 1)
    assert.equal(result.stats.updated, 0)
    assert.equal(result.stats.revoked, 0)
    const keys = activeKeys(db).sort()
    assert.deepEqual(keys, [
      'preferences.cofavorite.color.blu',
      'preferences.cofavorite.color.rosso',
      'preferences.cofavorite.color.viola',
    ].sort())

    const event = mapMemoryPipelineToFeedbackEvent(result)
    assert.equal(event?.type, 'created')
    assert.equal(event?.displayText, 'Favorite color: viola')
    assert.doesNotMatch(event?.displayText || '', /Anche|oltre/i)
  })

  it('B exact Preview sentence works on first turn', async () => {
    const db = createFakeSupabase()
    await pipeline(db, 'I miei colori preferiti sono il rosso e il blu.')
    const result = await pipeline(db, PREVIEW_SENTENCE)
    assert.equal(result.stats.created, 1)
    assert.ok(activeKeys(db).includes('preferences.cofavorite.color.viola'))
    assert.equal(mapMemoryPipelineToFeedbackEvent(result)?.type, 'created')
  })

  it('E existing all three → duplicate/no-op / null event', async () => {
    const db = createFakeSupabase()
    await pipeline(db, 'I miei colori preferiti sono rosso, blu e viola.')
    const before = activeKeys(db).length
    const result = await pipeline(db, PREVIEW_SENTENCE)
    assert.equal(result.stats.created, 0)
    assert.equal(result.stats.updated, 0)
    assert.equal(activeKeys(db).length, before)
    assert.equal(mapMemoryPipelineToFeedbackEvent(result), null)
  })

  it('I removal after additive still revokes correct row', async () => {
    const db = createFakeSupabase()
    await pipeline(db, 'I miei colori preferiti sono rosso e blu.')
    await pipeline(db, PREVIEW_SENTENCE)
    const remove = await pipeline(db, 'Il viola non è più il mio colore preferito.')
    assert.ok(remove.stats.revoked >= 1)
    const active = activeKeys(db)
    assert.ok(active.includes('preferences.cofavorite.color.rosso'))
    assert.ok(active.includes('preferences.cofavorite.color.blu'))
    assert.ok(!active.includes('preferences.cofavorite.color.viola'))
    assert.equal(mapMemoryPipelineToFeedbackEvent(remove)?.type, 'removed')
  })

  it('J New Chat recall returns full current set', async () => {
    const db = createFakeSupabase()
    await pipeline(db, 'I miei colori preferiti sono rosso e blu.')
    await pipeline(db, PREVIEW_SENTENCE)
    const rows = db.rows
      .filter((r) => r.status === 'active')
      .map((r) => ({
        ...r,
        factKey: readFactKeyFromTags(r.tags),
      }))
    const q = 'Quali sono i miei colori preferiti?'
    const intent = detectMemoryQueryIntent(q)
    assert.equal(intent.subtype, 'cofavorite')
    const ranked = rerankMemoriesForRecall(rows, q, { limit: 3, intent })
    assert.equal(ranked.length, 3)
    const pack = formatCoreMemoryPack(ranked)
    assert.match(pack, /rosso/i)
    assert.match(pack, /blu/i)
    assert.match(pack, /viola/i)
  })

  it('K indicator attaches on first natural phrase (api contracts)', () => {
    const chat = read('api/chat.ts')
    assert.match(chat, /mapMemoryPipelineToFeedbackEvent/)
    assert.match(chat, /memoryEvent/)
    const ctx = read('src/context/ChatContext.tsx')
    assert.match(ctx, /next\.memoryEvent\s*=\s*memoryEvent/)
    const bubble = read('src/components/chat/MessageBubble.tsx')
    assert.match(bubble, /MemoryMessageIndicator/)
  })

  it('L one responses.create unchanged', () => {
    const params = buildCoreResponsesCreateParams({
      model: 'gpt-5.6-sol',
      instructions: 'x',
      maxOutputTokens: 100,
      input: [],
    })
    assert.deepEqual(params.reasoning, { effort: 'none' })
    const chat = read('api/chat.ts')
    const callLines = chat
      .split('\n')
      .filter((line) => /client\.responses\.create\s*\(/.test(line))
    assert.equal(callLines.length, 1)
  })

  it('created-vs-updated: cofavorite add is created; singular replace is updated', async () => {
    const db = createFakeSupabase()
    await pipeline(db, 'I miei colori preferiti sono rosso e blu.')
    const add = await pipeline(db, 'Anche il viola è il mio colore preferito')
    assert.equal(mapMemoryPipelineToFeedbackEvent(add)?.type, 'created')

    const db2 = createFakeSupabase()
    await pipeline(db2, 'Il mio colore preferito è rosso.')
    const replace = await pipeline(db2, 'Il mio colore preferito è blu.')
    assert.equal(mapMemoryPipelineToFeedbackEvent(replace)?.type, 'updated')
  })
})

describe('client displayText localization (#281 additive)', () => {
  it('IT locale remaps Favorite color gloss; rejects Anche fragment', async () => {
    const mod = await import('../../src/lib/memoryFeedback.ts')
    assert.equal(
      mod.localizeMemoryDisplayText('Favorite color: viola', 'it'),
      'Colore preferito: viola',
    )
    assert.equal(mod.localizeMemoryDisplayText('Anche il viola', 'it'), '')
    assert.deepEqual(
      mod.parseMemoryFeedbackEvent({
        type: 'created',
        displayText: 'Favorite color: viola',
      }),
      { type: 'created', displayText: 'Favorite color: viola' },
    )
    assert.deepEqual(
      mod.parseMemoryFeedbackEvent({
        type: 'created',
        displayText: 'Anche il viola',
      }),
      { type: 'created' },
    )
  })
})

describe('regressions #280/#281 invariants', () => {
  it('M does not change maxDuration / reasoning.none / DB schema', () => {
    const chat = read('api/chat.ts')
    assert.match(chat, /maxDuration:\s*120/)
    const paramsSrc = read('lib/server/core-responses-params.js')
    assert.match(paramsSrc, /effort:\s*['"]none['"]/)
  })

  it('N typecheck surface — memoryFeedback exports intact', async () => {
    const mod = await import('../../src/lib/memoryFeedback.ts')
    assert.equal(typeof mod.parseMemoryFeedbackEvent, 'function')
    assert.equal(typeof mod.localizeMemoryDisplayText, 'function')
    assert.equal(typeof mod.memoryFeedbackLabel, 'function')
  })
})
