/**
 * #278 Deterministic Conversation Working State
 * Run: node --test lib/server/core-working-state.test.mjs
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import {
  MAX_APPENDIX_CHARS,
  MAX_CONSTRAINTS,
  MAX_DECISIONS,
  buildConversationWorkingStateAppendix,
  deriveConversationWorkingState,
} from './core-working-state.js'
import {
  MAX_HISTORY_MESSAGES,
  MAX_HISTORY_TEXT_CHARS,
  selectCoreConversationHistory,
} from './core-history-select.js'
import {
  mapMessagesToResponsesInput,
  sanitizeMultimodalMessages,
  visibleUserText,
} from './chat-image-input.js'
import { buildCoreLanguageAppendix, buildLanguageAwarenessPlan } from './language-awareness.js'
import { buildCoreContinuityAppendix } from './conversation-continuity.js'

const root = process.cwd()
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')

describe('#278 conversation working state', () => {
  it('A — explicit EN decision extracted', () => {
    const state = deriveConversationWorkingState([
      { role: 'user', content: 'Use architecture B.' },
      { role: 'assistant', content: 'Understood, architecture B.' },
    ])
    assert.ok(state)
    assert.deepEqual(state.decisions, ['B'])
  })

  it('B — explicit IT decision extracted', () => {
    const state = deriveConversationWorkingState([
      { role: 'user', content: "Scegliamo l'approccio B." },
    ])
    assert.ok(state?.decisions?.some((d) => /B/i.test(d)))
  })

  it('C — assistant suggestion does not create decision', () => {
    const state = deriveConversationWorkingState([
      { role: 'assistant', content: 'I suggest we choose architecture B.' },
      { role: 'user', content: 'ok' },
    ])
    assert.equal(state, null)
  })

  it('D — newer decision supersedes older when confidently matched', () => {
    const state = deriveConversationWorkingState([
      { role: 'user', content: 'Use architecture B.' },
      { role: 'assistant', content: 'Ok B.' },
      { role: 'user', content: 'Actually switch to C.' },
    ])
    assert.deepEqual(state?.decisions, ['C'])
    assert.ok(!state?.decisions?.includes('B'))
  })

  it('E/F — explicit EN/IT constraints extracted', () => {
    const en = deriveConversationWorkingState([
      { role: 'user', content: 'Do not modify api/chat.ts.' },
    ])
    assert.ok(en?.constraints?.some((c) => /api\/chat\.ts/i.test(c)))

    const it = deriveConversationWorkingState([
      { role: 'user', content: 'Non toccare Memory.' },
    ])
    assert.ok(it?.constraints?.some((c) => /Memory/i.test(c)))
  })

  it('G — constraint cancellation removes old constraint', () => {
    const state = deriveConversationWorkingState([
      { role: 'user', content: 'Do not modify api/chat.ts.' },
      { role: 'assistant', content: 'Understood.' },
      { role: 'user', content: 'You can modify api/chat.ts now.' },
    ])
    assert.ok(!state?.constraints?.length)
  })

  it('H/I — active task extracted and replaced', () => {
    const first = deriveConversationWorkingState([
      { role: 'user', content: 'Next implement the microphone.' },
    ])
    assert.match(first?.activeTask || '', /microphone/i)

    const next = deriveConversationWorkingState([
      { role: 'user', content: 'Next implement the microphone.' },
      { role: 'assistant', content: 'Starting mic.' },
      { role: 'user', content: 'Vision is done. Next implement documents.' },
    ])
    assert.match(next?.activeTask || '', /documents/i)
    assert.ok(!/microphone/i.test(next?.activeTask || ''))
  })

  it('J/K — state size bounded; long strings clipped', () => {
    const long = 'Use architecture ' + 'X'.repeat(400)
    const state = deriveConversationWorkingState([{ role: 'user', content: long }])
    assert.ok((state?.decisions?.[0]?.length || 0) <= 120)
    const appendix = buildConversationWorkingStateAppendix([{ role: 'user', content: long }])
    assert.ok(appendix.length <= MAX_APPENDIX_CHARS)
    assert.ok(MAX_DECISIONS === 3 && MAX_CONSTRAINTS === 3)
  })

  it('L/M — empty / assistant-only → no state', () => {
    assert.equal(deriveConversationWorkingState([]), null)
    assert.equal(deriveConversationWorkingState([{ role: 'assistant', content: 'hi' }]), null)
    assert.equal(buildConversationWorkingStateAppendix([]), '')
  })

  it('N — latest user correction wins', () => {
    const state = deriveConversationWorkingState([
      { role: 'user', content: 'Use option 2.' },
      { role: 'user', content: 'Actually use option 3.' },
    ])
    assert.deepEqual(state?.decisions, ['3'])
  })

  it('O/P/Q — no fileId / dataUrl / document contents in state', () => {
    const state = deriveConversationWorkingState([
      {
        role: 'user',
        content: 'Riassumilo',
        attachments: [
          {
            type: 'file',
            fileId: 'file-abc123XYZ',
            name: 'secret.pdf',
            mimeType: 'application/pdf',
            size: 12,
          },
        ],
      },
      {
        role: 'user',
        content: '',
        attachments: [
          {
            type: 'image',
            mimeType: 'image/jpeg',
            dataUrl: 'data:image/jpeg;base64,' + 'A'.repeat(200),
          },
        ],
      },
    ])
    const dumped = JSON.stringify(state)
    assert.ok(!dumped || !/file-abc|data:image|base64/i.test(dumped))
  })

  it('R — no durable Memory integration in module', () => {
    const src = read('lib/server/core-working-state.js')
    assert.doesNotMatch(src, /brain-memory|loadCoreMemoryPack|runMemoryPipeline|supabase/i)
    assert.match(src, /Not durable Memory/)
  })

  it('S — fresh conversation has no prior state inheritance', () => {
    const prior = deriveConversationWorkingState([
      { role: 'user', content: 'Use architecture B.' },
    ])
    assert.ok(prior)
    const fresh = deriveConversationWorkingState([])
    assert.equal(fresh, null)
    const newChat = deriveConversationWorkingState([
      { role: 'user', content: 'Ciao, nuovo chat.' },
    ])
    assert.equal(newChat, null)
  })

  it('T/U — regenerate temporal safety (no future leakage)', () => {
    const beforeC = [
      { role: 'user', content: 'Use architecture B.' },
      { role: 'assistant', content: 'Using B.' },
      { role: 'user', content: 'Continue please.' },
    ]
    const afterC = [
      ...beforeC,
      { role: 'assistant', content: 'Continuing.' },
      { role: 'user', content: 'Actually switch to C.' },
    ]
    assert.deepEqual(deriveConversationWorkingState(beforeC)?.decisions, ['B'])
    assert.deepEqual(deriveConversationWorkingState(afterC)?.decisions, ['C'])
  })

  it('boundary — dropped #277 history cannot revive Working State', () => {
    // Documented MVP limitation: source outside selected window → gone.
    const early = { role: 'user', content: 'Use architecture SECRET_B_ONLY.' }
    const filler = []
    for (let i = 0; i < 50; i += 1) {
      filler.push({ role: 'user', content: `filler user ${i}` })
      filler.push({ role: 'assistant', content: `filler asst ${i}` })
    }
    const all = [early, ...filler, { role: 'user', content: 'What did we choose?' }]
    const selected = selectCoreConversationHistory(all)
    assert.ok(!selected.some((m) => /SECRET_B_ONLY/.test(m.content || '')))
    const state = deriveConversationWorkingState(selected)
    assert.ok(!state?.decisions?.some((d) => /SECRET_B_ONLY|B_ONLY/i.test(d)))
  })

  it('V — LANGUAGE behavior unchanged / WS not language evidence', () => {
    const msgs = [
      { role: 'user', content: 'Ciao, rispondi sempre in italiano.' },
      { role: 'assistant', content: 'Certo.' },
      { role: 'user', content: 'Use architecture B.' },
      { role: 'user', content: 'ok' },
    ]
    const plan = buildLanguageAwarenessPlan({
      userMessage: 'ok',
      messages: msgs,
    })
    assert.equal(plan.replyLanguage, 'it')
    const src = read('lib/server/core-working-state.js')
    assert.doesNotMatch(src, /replyLanguage|buildCoreLanguageAppendix/)
  })

  it('W/X — image/document-only sticky unchanged', () => {
    const itHist = [
      { role: 'user', content: 'Ciao, rispondi sempre in italiano.' },
      { role: 'assistant', content: 'Va bene.' },
      {
        role: 'user',
        content: '',
        attachments: [
          {
            type: 'file',
            fileId: 'file-txtABC123',
            name: 'notes.txt',
            mimeType: 'text/plain',
            size: 10,
          },
        ],
      },
    ]
    assert.equal(visibleUserText(itHist.at(-1)), '')
    const appendix = buildCoreLanguageAppendix({
      userMessage: '',
      messages: itHist.map((m) => ({ role: m.role, content: m.content })),
    })
    assert.match(appendix, /response language: it/)
    assert.equal(deriveConversationWorkingState(itHist), null)
  })

  it('Y/Z/AA — Recall/Forget/Overview modules untouched by WS wiring', () => {
    const chat = read('api/chat.ts')
    assert.match(chat, /buildConversationWorkingStateAppendix/)
    assert.match(chat, /loadCoreMemoryPack/)
    assert.match(chat, /tryHandleMemoryControl|memory-control-forget/)
    assert.match(chat, /memory-control-overview|tryHandleMemoryOverview|overview/)
    const wsCall = chat.indexOf('const workingStateAppendix = buildConversationWorkingStateAppendix')
    const memCall = chat.indexOf('appendMemoryPackToInstructions(buildInstructions')
    assert.ok(wsCall > 0 && memCall > wsCall)
  })

  it('AB/AC — #277 selector + multimodal caps unchanged', () => {
    assert.equal(MAX_HISTORY_MESSAGES, 80)
    assert.equal(MAX_HISTORY_TEXT_CHARS, 120_000)
    const img = read('src/lib/imageAttachment.ts')
    const pdf = read('src/lib/pdfAttachment.ts')
    const server = read('lib/server/chat-image-input.js')
    assert.match(img, /MAX_RECENT_IMAGE_TURNS = 2/)
    assert.match(pdf, /MAX_RECENT_FILE_TURNS = 2/)
    assert.match(server, /SERVER_MAX_RECENT_IMAGE_TURNS = 2/)
  })

  it('AD/AE/AF — one responses.create, maxDuration 120, reasoning.none', () => {
    const chat = read('api/chat.ts')
    const params = read('lib/server/core-responses-params.js')
    assert.equal((chat.match(/\.responses\.create\(/g) || []).length, 1)
    assert.match(chat, /maxDuration:\s*120/)
    assert.match(params, /effort:\s*['"]none['"]/)
    assert.match(params, /stream:\s*false/)
  })

  it('AG — instruction order LANGUAGE → CONTINUITY → REFERENCE → WORKING STATE; continuity intact', () => {
    const chat = read('api/chat.ts')
    const lang = chat.indexOf('const languageAppendix = buildCoreLanguageAppendix')
    const cont = chat.indexOf('const continuityAppendix = buildCoreContinuityAppendix')
    const ref = chat.indexOf('const referenceContextAppendix = buildReferenceContextAppendix')
    const ws = chat.indexOf('const workingStateAppendix = buildConversationWorkingStateAppendix')
    assert.ok(lang > 0 && cont > lang && ref > cont && ws > ref)
    assert.match(buildCoreContinuityAppendix(), /CONVERSATION CONTINUITY/)
    const appendix = buildConversationWorkingStateAppendix([
      { role: 'user', content: 'Do not modify api/chat.ts.' },
      { role: 'user', content: 'Next implement Vision.' },
    ])
    assert.match(appendix, /CONVERSATION WORKING STATE/)
    assert.match(appendix, /Current task:/)
    assert.match(appendix, /Active explicit constraints:/)
    assert.doesNotMatch(appendix, /file-|data:image|durable Memory pack/i)
  })

  it('sanitize path still selects history before Core (no ChatContext WS store)', () => {
    const long = []
    for (let i = 0; i < 50; i += 1) {
      long.push({ role: 'user', content: `U${i}` })
      long.push({ role: 'assistant', content: `A${i}` })
    }
    const sanitized = sanitizeMultimodalMessages(long)
    assert.equal(sanitized.ok, true)
    assert.equal(sanitized.messages.length, MAX_HISTORY_MESSAGES)
    const ctx = read('src/context/ChatContext.tsx')
    assert.doesNotMatch(ctx, /deriveConversationWorkingState|WorkingState/)
    const mapped = mapMessagesToResponsesInput(sanitized.messages)
    assert.ok(Array.isArray(mapped))
  })
})
