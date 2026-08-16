/**
 * #281 end-to-end memoryEvent contract:
 * pipeline mutation → public event → chatApi parse → ChatContext reveal → ChatMessage → indicator.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  extractDurableFacts,
  readFactKeyFromTags,
  runMemoryPipeline,
  splitFavoriteList,
} from './brain-memory.js'
import { mapMemoryPipelineToFeedbackEvent } from './memory-feedback-event.js'
import {
  detectMemoryQueryIntent,
  formatCoreMemoryPack,
  rerankMemoriesForRecall,
} from './core-memory-recall.js'

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

async function pipeline(db, msg) {
  return runMemoryPipeline({
    userMessage: msg,
    assistantMessage: 'Ok.',
    memoryEnabled: true,
    userId: 'u1',
    requireExplicitUserId: true,
    supabase: db,
  })
}

/** Minimal reducer mirror of ChatContext memoryEvent lifecycle. */
function reduceChatMessages(messages, action) {
  switch (action.type) {
    case 'ASSISTANT_START': {
      const startEvent =
        action.memoryEvent &&
        (action.memoryEvent.type === 'created' ||
          action.memoryEvent.type === 'updated' ||
          action.memoryEvent.type === 'removed')
          ? action.memoryEvent
          : null
      return [
        ...messages,
        {
          id: action.id,
          role: 'assistant',
          content: '',
          ...(startEvent ? { memoryEvent: startEvent } : {}),
        },
      ]
    }
    case 'ASSISTANT_PROGRESS':
      return messages.map((m) =>
        m.id === action.id ? { ...m, content: action.content } : m,
      )
    case 'ASSISTANT_FINISH': {
      const memoryEvent =
        action.memoryEvent &&
        (action.memoryEvent.type === 'created' ||
          action.memoryEvent.type === 'updated' ||
          action.memoryEvent.type === 'removed')
          ? action.memoryEvent
          : null
      return messages.map((m) => {
        if (m.id !== action.id) return m
        const next = { ...m, content: action.content }
        if (memoryEvent) next.memoryEvent = memoryEvent
        else delete next.memoryEvent
        return next
      })
    }
    default:
      return messages
  }
}

describe('Preview exact Italian string WRITE (#281)', () => {
  const exact =
    'I miei colore preferito sono il rosso e il blu ed il viola'

  it('ed conjunction splits list values', () => {
    assert.deepEqual(splitFavoriteList('il rosso e il blu ed il viola'), [
      'rosso',
      'blu',
      'viola',
    ])
  })

  it('agreement-mismatched preferito + sono writes three cofavorites', async () => {
    const facts = extractDurableFacts(exact)
    assert.equal(facts.length, 3)
    assert.ok(facts.every((f) => String(f.factKey).startsWith('preferences.cofavorite.color.')))

    const db = createFakeSupabase()
    const result = await pipeline(db, exact)
    assert.equal(result.stats.created, 3)
    const event = mapMemoryPipelineToFeedbackEvent(result)
    assert.equal(event?.type, 'created')
  })

  it('exact remove after exact create → removed + recall excludes viola', async () => {
    const db = createFakeSupabase()
    await pipeline(db, exact)
    const remove = await pipeline(db, 'Il viola non è più il mio colore preferito')
    assert.ok(remove.stats.revoked >= 1)
    assert.equal(mapMemoryPipelineToFeedbackEvent(remove)?.type, 'removed')

    const active = db.rows
      .filter((r) => r.status === 'active')
      .map((r) => readFactKeyFromTags(r.tags))
    assert.deepEqual(
      active.sort(),
      [
        'preferences.cofavorite.color.blu',
        'preferences.cofavorite.color.rosso',
      ].sort(),
    )

    const rows = db.rows
      .filter((r) => r.status === 'active')
      .map((r) => ({ ...r, factKey: readFactKeyFromTags(r.tags) }))
    const q = 'Quali sono i miei colori preferiti?'
    const pack = formatCoreMemoryPack(
      rerankMemoriesForRecall(rows, q, { limit: 3, intent: detectMemoryQueryIntent(q) }),
    )
    assert.match(pack, /rosso/i)
    assert.match(pack, /blu/i)
    assert.doesNotMatch(pack, /viola/i)
  })
})

describe('memoryEvent end-to-end contract (#281)', () => {
  it('pipeline → public event → chatApi parse → reveal PROGRESS preserves → FINISH keeps', async () => {
    const { parseMemoryFeedbackEvent } = await import('../../src/lib/memoryFeedback.ts')

    const db = createFakeSupabase()
    const result = await pipeline(db, 'My favorite color is red.')
    const publicEvent = mapMemoryPipelineToFeedbackEvent(result)
    assert.equal(publicEvent?.type, 'created')

    // api/chat JSON shape (object, not legacy string)
    const apiJson = { content: 'Ciao.', memoryEvent: publicEvent }
    const parsed = parseMemoryFeedbackEvent(apiJson.memoryEvent)
    assert.deepEqual(parsed, publicEvent)

    // ChatContext: START with event → progressive reveal → FINISH
    let messages = []
    messages = reduceChatMessages(messages, {
      type: 'ASSISTANT_START',
      id: 'a1',
      memoryEvent: parsed,
    })
    assert.equal(messages[0].memoryEvent?.type, 'created')

    messages = reduceChatMessages(messages, {
      type: 'ASSISTANT_PROGRESS',
      id: 'a1',
      content: 'Ciao',
    })
    assert.equal(messages[0].memoryEvent?.type, 'created', 'PROGRESS must keep memoryEvent')

    messages = reduceChatMessages(messages, {
      type: 'ASSISTANT_PROGRESS',
      id: 'a1',
      content: 'Ciao dal reveal completo.',
    })
    assert.equal(messages[0].memoryEvent?.type, 'created')

    messages = reduceChatMessages(messages, {
      type: 'ASSISTANT_FINISH',
      id: 'a1',
      content: 'Ciao dal reveal completo.',
      memoryEvent: parsed,
    })
    assert.equal(messages[0].memoryEvent?.type, 'created')
    assert.equal(messages[0].content, 'Ciao dal reveal completo.')
  })

  it('null memoryEvent on regenerate/FINISH clears badge', () => {
    let messages = [
      {
        id: 'a1',
        role: 'assistant',
        content: 'old',
        memoryEvent: { type: 'created' },
      },
    ]
    messages = reduceChatMessages(messages, {
      type: 'ASSISTANT_FINISH',
      id: 'a1',
      content: 'regenerated',
      memoryEvent: null,
    })
    assert.equal(messages[0].memoryEvent, undefined)
  })

  it('MessageBubble renders indicator whenever assistant has memoryEvent', () => {
    const bubble = read('src/components/chat/MessageBubble.tsx')
    const ctx = read('src/context/ChatContext.tsx')
    assert.match(bubble, /MemoryMessageIndicator/)
    assert.match(bubble, /message\.memoryEvent/)
    // Must not gate on !isEmptyStream (indicator during/after reveal)
    assert.doesNotMatch(
      bubble,
      /!isEmptyStream\s*&&\s*message\.memoryEvent/,
    )
    assert.match(ctx, /ASSISTANT_START[\s\S]{0,200}memoryEvent/)
    assert.match(ctx, /Preserve memoryEvent across progressive reveal/)
  })

  it('created / updated / removed matrix', async () => {
    // CREATED
    {
      const db = createFakeSupabase()
      const r = await pipeline(db, 'My favorite color is red.')
      assert.equal(mapMemoryPipelineToFeedbackEvent(r)?.type, 'created')
    }
    // UPDATED
    {
      const db = createFakeSupabase()
      await pipeline(db, 'My main project is LAIfe.')
      const r = await pipeline(db, 'My main project is BrAIn now.')
      assert.equal(mapMemoryPipelineToFeedbackEvent(r)?.type, 'updated')
    }
    // REMOVED
    {
      const db = createFakeSupabase()
      await pipeline(db, 'I miei colori preferiti sono rosso, blu e viola.')
      const r = await pipeline(db, 'Il viola non è più il mio colore preferito.')
      assert.equal(mapMemoryPipelineToFeedbackEvent(r)?.type, 'removed')
    }
  })
})
