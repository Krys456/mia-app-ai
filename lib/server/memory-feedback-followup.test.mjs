/**
 * #281 follow-up: favorite multi-value colors + Memory feedback event semantics
 * + message-bound UI contracts.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  extractDurableFacts,
  extractLikeListValues,
  normalizeFavoriteSubjectKey,
  readFactKeyFromTags,
  runMemoryPipeline,
  splitFavoriteList,
} from './brain-memory.js'
import {
  detectMemoryQueryIntent,
  formatCoreMemoryPack,
  isRecallEligibleMemory,
  loadCoreMemoryPack,
  rerankMemoriesForRecall,
} from './core-memory-recall.js'
import { mapMemoryPipelineToFeedbackEvent } from './memory-feedback-event.js'
import { buildCoreResponsesCreateParams } from './core-responses-params.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel) => readFileSync(join(root, rel), 'utf8')
const MEMORY_SELECT =
  'id, category, title, content, importance, usage_count, last_used_at, created_at, updated_at, status, tags'

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
        state.ascending = !!opts.ascending
        return api
      },
      limit(n) {
        state.limitN = n
        return api
      },
      maybeSingle() {
        state.single = 'maybe'
        return api
      },
      single() {
        state.single = true
        return api
      },
      then(resolve, reject) {
        return Promise.resolve().then(() => {
          try {
            let matched = rows.filter((row) => state.filters.every((f) => matchesFilter(row, f)))
            if (state.mode === 'insert') {
              const row = {
                id: String(seq++),
                usage_count: 0,
                last_used_at: null,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                status: 'active',
                tags: [],
                source: 'automatic',
                confidence: 0.8,
                importance: 1,
                ...state.insertRow,
              }
              rows.push(row)
              resolve(
                state.single
                  ? { data: project(row), error: null }
                  : { data: [project(row)], error: null },
              )
              return
            }
            if (state.mode === 'update') {
              for (const row of matched) Object.assign(row, state.patch)
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
            if (state.orderCol) {
              matched = [...matched].sort((a, b) => {
                const av = a[state.orderCol]
                const bv = b[state.orderCol]
                if (av === bv) return 0
                return (av > bv ? 1 : -1) * (state.ascending ? 1 : -1)
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

describe('color / multi-favorite generalization (#281 follow-up)', () => {
  it('A IT favorite colors multi-value write', () => {
    const facts = extractDurableFacts('I miei colori preferiti sono rosso, blu e viola.')
    assert.equal(facts.length, 3)
    assert.ok(facts.every((f) => String(f.factKey).startsWith('preferences.cofavorite.color.')))
    assert.ok(facts.some((f) => f.factKey === 'preferences.cofavorite.color.rosso'))
    assert.ok(facts.some((f) => f.factKey === 'preferences.cofavorite.color.blu'))
    assert.ok(facts.some((f) => f.factKey === 'preferences.cofavorite.color.viola'))
  })

  it('B EN favorite colors multi-value write', () => {
    const facts = extractDurableFacts('My favorite colors are red, blue and purple.')
    assert.equal(facts.length, 3)
    assert.ok(facts.some((f) => f.factKey === 'preferences.cofavorite.color.red'))
    assert.ok(facts.some((f) => f.factKey === 'preferences.cofavorite.color.blue'))
    assert.ok(facts.some((f) => f.factKey === 'preferences.cofavorite.color.purple'))
  })

  it('C conjunction list parsing: rosso, blu e viola', () => {
    assert.deepEqual(splitFavoriteList('rosso, blu e viola'), ['rosso', 'blu', 'viola'])
  })

  it('D colors stored as cofavorite set (atomic rows)', async () => {
    const db = createFakeSupabase()
    const result = await pipeline(db, 'I miei colori preferiti sono rosso, blu e viola.')
    assert.equal(result.stats.created, 3)
    const keys = db.rows
      .filter((r) => r.status === 'active')
      .map((r) => readFactKeyFromTags(r.tags))
    assert.ok(keys.includes('preferences.cofavorite.color.rosso'))
    assert.ok(keys.includes('preferences.cofavorite.color.blu'))
    assert.ok(keys.includes('preferences.cofavorite.color.viola'))
  })

  it('E new-chat recall returns all three colors', () => {
    const rows = extractDurableFacts('I miei colori preferiti sono rosso, blu e viola.').map(
      (f, i) => ({
        id: String(i + 1),
        category: f.category,
        title: f.title,
        content: f.content,
        importance: 6,
        status: 'active',
        tags: [`fact_key:${f.factKey}`],
        factKey: f.factKey,
      }),
    )
    const q = 'Quali sono i miei colori preferiti?'
    const intent = detectMemoryQueryIntent(q)
    assert.equal(intent.subtype, 'cofavorite')
    assert.equal(intent.subject, 'color')
    const ranked = rerankMemoriesForRecall(rows, q, { limit: 3, intent })
    assert.equal(ranked.length, 3)
    const pack = formatCoreMemoryPack(ranked)
    assert.match(pack, /rosso/i)
    assert.match(pack, /blu/i)
    assert.match(pack, /viola/i)
  })

  it('F especially purple — qualifier omitted; three colors kept', () => {
    const facts = extractDurableFacts(
      'I miei colori preferiti sono rosso, blu e viola, soprattutto il viola.',
    )
    assert.equal(facts.length, 3)
    assert.ok(facts.every((f) => !/soprattutto/i.test(f.content)))
  })

  it('G favorite characters regression', () => {
    const facts = extractDurableFacts('I miei personaggi preferiti sono Itachi e Sasuke.')
    assert.ok(facts.some((f) => f.factKey === 'preferences.cofavorite.character.itachi'))
    assert.ok(facts.some((f) => f.factKey === 'preferences.cofavorite.character.sasuke'))
  })

  it('H favorite anime regression', () => {
    const facts = extractDurableFacts('I miei anime preferiti sono Naruto e Dragon Ball.')
    assert.ok(facts.some((f) => f.factKey === 'preferences.cofavorite.anime.naruto'))
    assert.ok(facts.some((f) => f.factKey === 'preferences.cofavorite.anime.dragon_ball'))
  })

  it('I multi-value likes (mi piacciono) write as likes, not invented favorites', () => {
    assert.deepEqual(extractLikeListValues('Mi piacciono molto il rosso, il blu e il viola.'), [
      'rosso',
      'blu',
      'viola',
    ])
    const facts = extractDurableFacts('Mi piacciono molto il rosso, il blu e il viola.')
    assert.equal(facts.length, 3)
    assert.ok(facts.every((f) => String(f.factKey).startsWith('preferences.like.')))
    assert.equal(facts.filter((f) => String(f.factKey).includes('favorite')).length, 0)
  })

  it('J no duplicate colors from equivalent phrasing', async () => {
    const db = createFakeSupabase()
    await pipeline(db, 'I miei colori preferiti sono rosso, blu e viola.')
    const again = await pipeline(db, 'I miei colori preferiti sono rosso, blu e viola.')
    assert.equal(again.stats.created, 0)
    assert.equal(again.stats.skipped, 3)
    assert.equal(
      db.rows.filter((r) => r.status === 'active' && /cofavorite\.color\./.test(readFactKeyFromTags(r.tags) || ''))
        .length,
      3,
    )
  })

  it('subject aliases: foods/cibi/sports normalize', () => {
    assert.equal(normalizeFavoriteSubjectKey('foods'), 'food')
    assert.equal(normalizeFavoriteSubjectKey('cibi'), 'food')
    assert.equal(normalizeFavoriteSubjectKey('sports'), 'sport')
    const foods = extractDurableFacts('My favorite foods are pizza, sushi and pasta.')
    assert.ok(foods.every((f) => String(f.factKey).startsWith('preferences.cofavorite.food.')))
  })
})

describe('real pipeline memoryEvent semantics (#281)', () => {
  it('K new fact → created', async () => {
    const db = createFakeSupabase()
    const result = await pipeline(db, 'My favorite color is red.')
    assert.equal(result.stats.created, 1)
    assert.equal(mapMemoryPipelineToFeedbackEvent(result)?.type, 'created')
  })

  it('L single-slot correction → updated', async () => {
    const db = createFakeSupabase()
    await pipeline(db, 'My main project is LAIfe.')
    const result = await pipeline(db, 'My main project is BrAIn now.')
    assert.equal(result.stats.updated, 1)
    assert.equal(result.stats.created, 0)
    assert.equal(mapMemoryPipelineToFeedbackEvent(result)?.type, 'updated')
  })

  it('M favorite singular correction → updated', async () => {
    const db = createFakeSupabase()
    await pipeline(db, 'My favorite color is red.')
    const result = await pipeline(db, 'My favorite color is blue.')
    assert.equal(result.stats.updated, 1)
    assert.equal(mapMemoryPipelineToFeedbackEvent(result)?.type, 'updated')
  })

  it('N replace_set → updated', async () => {
    const db = createFakeSupabase()
    await pipeline(db, 'I miei personaggi preferiti sono Itachi e Sasuke.')
    const result = await pipeline(
      db,
      'Adesso i miei personaggi preferiti sono solo Madara e Kakashi.',
    )
    assert.ok(result.stats.replaced >= 1)
    assert.equal(mapMemoryPipelineToFeedbackEvent(result)?.type, 'updated')
  })

  it('O pure revoke → removed (real conversational path)', async () => {
    const db = createFakeSupabase()
    await pipeline(db, 'Il mio colore preferito è rosso.')
    const result = await pipeline(db, 'Il rosso non è più il mio colore preferito.')
    assert.equal(result.stats.revoked, 1)
    assert.equal(result.stats.created, 0)
    assert.equal(result.stats.updated, 0)
    assert.equal(mapMemoryPipelineToFeedbackEvent(result)?.type, 'removed')
  })

  it('P duplicate → null', async () => {
    const db = createFakeSupabase()
    await pipeline(db, 'My favorite color is red.')
    const result = await pipeline(db, 'My favorite color is red.')
    assert.equal(result.stats.created, 0)
    assert.equal(result.stats.updated, 0)
    assert.equal(mapMemoryPipelineToFeedbackEvent(result), null)
  })

  it('Q Forget path stays null in api/chat', () => {
    const chat = read('api/chat.ts')
    assert.match(chat, /forget\.handled[\s\S]{0,400}memoryEvent:\s*null/)
  })

  it('R unsafe blocked → null event mapping', () => {
    assert.equal(
      mapMemoryPipelineToFeedbackEvent({
        saved: false,
        stats: { created: 0, updated: 0, skipped: 1, revoked: 0, replaced: 0 },
      }),
      null,
    )
  })

  it('S Memory OFF → runMemoryIfEnabled returns null', () => {
    const chat = read('api/chat.ts')
    assert.match(chat, /if\s*\(\s*!memoryEnabled\s*\|\|\s*!ownerUserId\s*\)/)
    assert.match(chat, /return \{\s*event:\s*null\s*\}/)
  })
})

describe('message-bound Memory UI (#281)', () => {
  it('T–AE: attaches to ChatMessage; no toast; regenerate clears', () => {
    const types = read('src/types.ts')
    const ctx = read('src/context/ChatContext.tsx')
    const bubble = read('src/components/chat/MessageBubble.tsx')
    const indicator = read('src/components/MemoryMessageIndicator.tsx')
    const css = read('src/components/MemoryMessageIndicator.css')
    const app = read('src/App.tsx')

    assert.match(types, /memoryEvent\?:/)
    assert.match(ctx, /next\.memoryEvent\s*=\s*memoryEvent/)
    assert.match(ctx, /delete next\.memoryEvent/)
    assert.match(ctx, /case 'TRIM_TO':/)
    assert.match(ctx, /case 'NEW_CHAT':[\s\S]*?messages:\s*\[\]/)
    assert.doesNotMatch(ctx, /memoryNotice/)
    assert.doesNotMatch(ctx, /CLEAR_MEMORY_NOTICE/)

    assert.match(bubble, /MemoryMessageIndicator/)
    assert.match(bubble, /message\.memoryEvent/)
    assert.match(indicator, /📖/)
    assert.match(indicator, /role="status"/)
    assert.match(indicator, /aria-live="polite"/)
    assert.match(css, /-webkit-line-clamp:\s*2/)
    assert.match(css, /overflow-wrap:\s*anywhere/)
    assert.match(css, /pointer-events:\s*none/)
    assert.doesNotMatch(css, /position:\s*fixed/)
    assert.doesNotMatch(app, /MemoryToast/)
  })

  it('no duplicate MemoryToast system left', () => {
    assert.throws(() => read('src/components/MemoryToast.tsx'), /ENOENT/)
    assert.throws(() => read('src/components/MemoryToast.css'), /ENOENT/)
  })

  it('Core invariants unchanged', () => {
    const chat = read('api/chat.ts')
    assert.match(chat, /maxDuration:\s*120/)
    const calls = chat.split('\n').filter((l) => /client\.responses\.create\s*\(/.test(l))
    assert.equal(calls.length, 1)
    const params = buildCoreResponsesCreateParams({
      model: 'gpt-5.6-sol',
      instructions: 'x',
      maxOutputTokens: 100,
      input: [],
    })
    assert.deepEqual(params.reasoning, { effort: 'none' })
  })
})
