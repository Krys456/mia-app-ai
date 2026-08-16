/**
 * Memory feedback UI (#281) — public event mapping, client parse, toast copy.
 * Does not change extraction / Recall / Forget / Overview semantics.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  mapMemoryPipelineToFeedbackEvent,
  safeMemoryDisplayText,
} from './memory-feedback-event.js'
import { buildCoreResponsesCreateParams } from './core-responses-params.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel) => readFileSync(join(root, rel), 'utf8')

describe('memory feedback event mapping (#281)', () => {
  it('A: new memory → created', () => {
    const event = mapMemoryPipelineToFeedbackEvent({
      saved: true,
      updated: false,
      revoked: false,
      replaced: false,
      stats: { created: 1, updated: 0, skipped: 0, revoked: 0, replaced: 0 },
      memory: {
        title: 'Primary project',
        content: "User's primary project: LAIfe.",
      },
    })
    assert.equal(event?.type, 'created')
    assert.equal(event?.displayText, 'LAIfe')
  })

  it('B: updated same slot → updated', () => {
    const event = mapMemoryPipelineToFeedbackEvent({
      saved: true,
      updated: true,
      stats: { created: 0, updated: 1, skipped: 0, revoked: 0, replaced: 0 },
      memory: {
        title: 'Primary project',
        content: "User's primary project: Nexus.",
      },
    })
    assert.equal(event?.type, 'updated')
  })

  it('C: replacement / replace_set → updated (not created/saved)', () => {
    const event = mapMemoryPipelineToFeedbackEvent({
      saved: true,
      updated: false,
      replaced: true,
      revoked: false,
      stats: { created: 0, updated: 0, skipped: 0, revoked: 0, replaced: 1 },
      memory: null,
    })
    assert.equal(event?.type, 'updated')
  })

  it('C2: mixed create+update prefers updated', () => {
    const event = mapMemoryPipelineToFeedbackEvent({
      saved: true,
      updated: true,
      stats: { created: 1, updated: 1, skipped: 0, revoked: 0, replaced: 0 },
    })
    assert.equal(event?.type, 'updated')
  })

  it('D: pure revoke → removed', () => {
    const event = mapMemoryPipelineToFeedbackEvent({
      saved: true,
      updated: false,
      revoked: true,
      replaced: false,
      stats: { created: 0, updated: 0, skipped: 0, revoked: 1, replaced: 0 },
      memory: null,
    })
    assert.equal(event?.type, 'removed')
  })

  it('E: duplicate/skipped → null', () => {
    assert.equal(
      mapMemoryPipelineToFeedbackEvent({
        saved: false,
        updated: false,
        skipped: true,
        stats: { created: 0, updated: 0, skipped: 1, revoked: 0, replaced: 0 },
      }),
      null,
    )
  })

  it('does not use created when nothing was written (legacy saved revoke)', () => {
    // Coarse saved:true with revoke-only must map to removed, not created
    const event = mapMemoryPipelineToFeedbackEvent({
      saved: true,
      updated: false,
      revoked: true,
      stats: { created: 0, updated: 0, skipped: 0, revoked: 2, replaced: 0 },
    })
    assert.equal(event?.type, 'removed')
  })
})

describe('safe displayText (#281)', () => {
  it('R/S: omits ids, fact_key, confidence, importance', () => {
    assert.equal(
      safeMemoryDisplayText({
        id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        factKey: 'projects.primary',
        confidence: 0.95,
        importance: 8,
        tags: ['fact_key:projects.primary'],
        title: 'projects.primary',
        content: 'fact_key=projects.primary confidence=0.95',
      }),
      undefined,
    )
  })

  it('extracts short value from canonical gloss', () => {
    assert.equal(
      safeMemoryDisplayText({
        title: 'Profession',
        content: "User's profession / role: programmer.",
      }),
      'programmer',
    )
  })

  it('omits when ambiguous / empty', () => {
    assert.equal(safeMemoryDisplayText(null), undefined)
    assert.equal(safeMemoryDisplayText({ title: '', content: '' }), undefined)
  })
})

describe('client memoryFeedback helpers', () => {
  it('Q: legacy saved/updated compatibility', async () => {
    const mod = await import('../../src/lib/memoryFeedback.ts')
    assert.deepEqual(mod.parseMemoryFeedbackEvent('saved'), { type: 'created' })
    assert.deepEqual(mod.parseMemoryFeedbackEvent('updated'), { type: 'updated' })
    assert.equal(mod.parseMemoryFeedbackEvent(null), null)
    assert.deepEqual(mod.parseMemoryFeedbackEvent({ type: 'removed' }), {
      type: 'removed',
    })
    assert.deepEqual(
      mod.parseMemoryFeedbackEvent({ type: 'created', displayText: 'LAIfe' }),
      { type: 'created', displayText: 'LAIfe' },
    )
    // Strip unsafe client displayText
    assert.deepEqual(
      mod.parseMemoryFeedbackEvent({
        type: 'created',
        displayText: 'projects.primary',
      }),
      { type: 'created' },
    )
  })

  it('T/U/V: IT/EN/FR/ES/DE labels + unknown → EN', async () => {
    const mod = await import('../../src/lib/memoryFeedback.ts')
    assert.equal(mod.memoryFeedbackLabel('created', 'it'), 'Memoria salvata')
    assert.equal(mod.memoryFeedbackLabel('updated', 'it'), 'Memoria aggiornata')
    assert.equal(mod.memoryFeedbackLabel('removed', 'it'), 'Memoria rimossa')
    assert.equal(mod.memoryFeedbackLabel('created', 'en'), 'Memory saved')
    assert.equal(mod.memoryFeedbackLabel('updated', 'en'), 'Memory updated')
    assert.equal(mod.memoryFeedbackLabel('removed', 'en'), 'Memory removed')
    assert.equal(mod.memoryFeedbackLabel('created', 'fr'), 'Mémoire enregistrée')
    assert.equal(mod.memoryFeedbackLabel('updated', 'es'), 'Memoria actualizada')
    assert.equal(mod.memoryFeedbackLabel('removed', 'de'), 'Erinnerung entfernt')
    assert.equal(mod.resolveMemoryFeedbackLocale('it-IT'), 'it')
    assert.equal(mod.resolveMemoryFeedbackLocale('ja-JP'), 'en')
    assert.equal(mod.resolveMemoryFeedbackLocale(''), 'en')
  })
})

describe('message-bound Memory indicator + ChatContext (#281)', () => {
  it('W: role=status / aria-live on one-shot announcer; book icon; no brain', () => {
    const indicator = read('src/components/MemoryMessageIndicator.tsx')
    const css = read('src/components/MemoryMessageIndicator.css')
    assert.match(indicator, /role="status"/)
    assert.match(indicator, /aria-live="polite"/)
    assert.match(indicator, /📖/)
    assert.doesNotMatch(indicator, /🧠/)
    assert.doesNotMatch(indicator, /Ho salvato una nuova memoria/)
    assert.match(css, /overflow-wrap:\s*anywhere/)
    assert.doesNotMatch(css, /position:\s*fixed/)
  })

  it('X: mobile CSS smoke — clamp / wrap / narrow viewport', () => {
    const css = read('src/components/MemoryMessageIndicator.css')
    assert.match(css, /overflow-wrap:\s*anywhere/)
    assert.match(css, /-webkit-line-clamp:\s*2/)
    assert.match(css, /@media \(max-width:\s*420px\)/)
    assert.doesNotMatch(css, /AutoScrollController/)
  })

  it('O/P/AC: New Chat clears messages; event attaches to ChatMessage', () => {
    const ctx = read('src/context/ChatContext.tsx')
    assert.match(ctx, /case 'NEW_CHAT':[\s\S]*?messages:\s*\[\]/)
    assert.match(ctx, /next\.memoryEvent\s*=\s*memoryEvent/)
    assert.match(ctx, /delete next\.memoryEvent/)
    assert.doesNotMatch(ctx, /memoryNotice/)
    const types = read('src/types.ts')
    assert.match(types, /interface ChatMessage \{[\s\S]*?memoryEvent\?:/)
  })

  it('K/L/M: Forget / Overview force null; Recall probe skips extraction', () => {
    const chat = read('api/chat.ts')
    assert.match(
      chat,
      /forget\.handled[\s\S]{0,400}memoryEvent:\s*null/,
    )
    assert.match(
      chat,
      /overview\.handled[\s\S]{0,400}memoryEvent:\s*null/,
    )
    assert.match(chat, /isPersonalMemoryProbe/)
    assert.match(chat, /mapMemoryPipelineToFeedbackEvent/)
  })

  it('F/G/H/I/J gates remain: OFF / unsafe / image / document / caption', () => {
    const chat = read('api/chat.ts')
    assert.match(chat, /if\s*\(\s*!memoryEnabled\s*\|\|\s*!ownerUserId\s*\)/)
    assert.match(chat, /!lastUserCaption/)
    assert.match(chat, /isVisionTaskShortcut/)
    assert.match(chat, /runMemoryIfEnabled\(\s*lastUserCaption/)
    const indicator = read('src/components/MemoryMessageIndicator.tsx')
    assert.match(indicator, /memoryFeedbackLabel/)
  })
})

describe('regressions: Core invariants + #277–#280 untouched by toast', () => {
  it('AG/AH/AI: one responses.create call, maxDuration 120, reasoning.none path', () => {
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

  it('Z–AF: Recall / Forget / Overview / LANGUAGE / history / WS / Reference unchanged contracts', () => {
    assert.match(read('lib/server/core-memory-recall.js'), /export function/)
    assert.match(read('lib/server/memory-control-forget.js'), /tryHandleMemoryControl/)
    assert.match(read('lib/server/memory-control-overview.js'), /tryHandleMemoryOverview/)
    assert.match(read('lib/server/language-awareness.js'), /detect|LANGUAGE|language/i)
    assert.match(read('lib/server/core-history-select.js'), /MAX_HISTORY_MESSAGES|selectCoreHistory/)
    assert.match(read('lib/server/core-working-state.js'), /buildConversationWorkingStateAppendix/)
    assert.match(read('lib/server/core-reference-context.js'), /buildReferenceContextAppendix/)
  })

  it('Y: #280 quality module still present', () => {
    const bm = read('lib/server/brain-memory.js')
    assert.match(bm, /extractProjectNamingCandidates/)
    assert.match(bm, /settings\.reply_style/)
  })

  it('N: regenerate TRIM_TO drops prior assistant (badge goes with message)', () => {
    const ctx = read('src/context/ChatContext.tsx')
    assert.match(ctx, /const regenerateAssistant = useCallback\([\s\S]{0,900}TRIM_TO/)
    assert.match(ctx, /case 'TRIM_TO':[\s\S]{0,250}messages:\s*state\.messages\.slice/)
  })
})
