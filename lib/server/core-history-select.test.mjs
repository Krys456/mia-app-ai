/**
 * #277 Long conversation context — history selector + Core wiring
 * Run: node --test lib/server/core-history-select.test.mjs
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import {
  MAX_HISTORY_MESSAGES,
  MAX_HISTORY_TEXT_CHARS,
  historyVisibleTextChars,
  selectCoreConversationHistory,
} from './core-history-select.js'
import {
  applyRecentAttachmentHistoryLimit,
  documentOnlyModelNudgeForMessages,
  mapMessagesToResponsesInput,
  sanitizeMultimodalMessages,
  visibleUserText,
} from './chat-image-input.js'
import {
  buildCoreLanguageAppendix,
  buildLanguageAwarenessPlan,
} from './language-awareness.js'
import { buildCoreContinuityAppendix } from './conversation-continuity.js'

const root = process.cwd()
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')

function ua(n) {
  /** @type {Array<{role:string,content:string}>} */
  const out = []
  for (let i = 1; i <= n; i += 1) {
    out.push({ role: 'user', content: `U${i}` })
    out.push({ role: 'assistant', content: `A${i}` })
  }
  return out
}

describe('#277 core history select', () => {
  it('A/B — 20 and 40 messages all retained', () => {
    const m20 = ua(10) // 20 messages
    const m40 = ua(20)
    assert.equal(selectCoreConversationHistory(m20).length, 20)
    assert.equal(selectCoreConversationHistory(m40).length, 40)
    assert.deepEqual(
      selectCoreConversationHistory(m40).map((m) => m.content),
      m40.map((m) => m.content),
    )
  })

  it('C/D/E — 60 retained beyond old 40; 100+ capped at MAX_HISTORY_MESSAGES', () => {
    const m60 = ua(30)
    const selected60 = selectCoreConversationHistory(m60)
    assert.equal(selected60.length, 60)
    assert.ok(selected60.length > 40)

    const m120 = ua(60) // 120 messages
    const selected = selectCoreConversationHistory(m120)
    assert.equal(selected.length, MAX_HISTORY_MESSAGES)
    assert.equal(selected[0].content, 'U21') // last 80 of 120 → starts at turn 21
    assert.equal(selected.at(-1).content, 'A60')
  })

  it('F — character budget enforced (attachment payloads excluded)', () => {
    const msgs = [
      { role: 'user', content: 'a'.repeat(50_000) },
      { role: 'assistant', content: 'b'.repeat(50_000) },
      { role: 'user', content: 'c'.repeat(50_000) },
      { role: 'assistant', content: 'd'.repeat(50_000) },
      { role: 'user', content: 'latest' },
    ]
    const selected = selectCoreConversationHistory(msgs, {
      maxMessages: 80,
      maxTextChars: 60_000,
    })
    // newest always kept; then fit older while under 60k
    assert.equal(selected.at(-1).content, 'latest')
    assert.ok(selected.length < msgs.length)
    const chars = selected.reduce((n, m) => n + historyVisibleTextChars(m), 0)
    // latest is tiny; previous long messages may force early stop — newest alone ok if huge
    assert.ok(chars <= 60_000 + historyVisibleTextChars(selected.at(-1)))
  })

  it('G/H — newest always retained; huge latest user may exceed budget alone', () => {
    const huge = 'x'.repeat(MAX_HISTORY_TEXT_CHARS + 50_000)
    const msgs = [
      { role: 'user', content: 'old' },
      { role: 'assistant', content: 'old-a' },
      { role: 'user', content: huge },
    ]
    const selected = selectCoreConversationHistory(msgs)
    assert.equal(selected.length, 1)
    assert.equal(selected[0].content, huge)
    assert.ok(historyVisibleTextChars(selected[0]) > MAX_HISTORY_TEXT_CHARS)
  })

  it('I — pair-boundary drops orphaned leading assistant', () => {
    // Budget keeps asst of pair but would drop its user → drop assistant
    const msgs = [
      { role: 'user', content: 'KEEP_ME_OUT_' + 'z'.repeat(1000) },
      { role: 'assistant', content: 'orphan-candidate_' + 'y'.repeat(1000) },
      { role: 'user', content: 'recent-u' },
      { role: 'assistant', content: 'recent-a' },
    ]
    const selected = selectCoreConversationHistory(msgs, {
      maxMessages: 80,
      maxTextChars: 1050, // fits recent pair + orphan assistant; not the prior user
    })
    assert.ok(!selected.some((m) => String(m.content).startsWith('orphan-candidate')))
    assert.ok(!selected.some((m) => String(m.content).startsWith('KEEP_ME_OUT')))
    assert.equal(selected[0].role, 'user')
    assert.equal(selected[0].content, 'recent-u')
  })

  it('J — chronological order preserved', () => {
    const msgs = ua(5)
    const selected = selectCoreConversationHistory(msgs)
    assert.deepEqual(
      selected.map((m) => m.content),
      ['U1', 'A1', 'U2', 'A2', 'U3', 'A3', 'U4', 'A4', 'U5', 'A5'],
    )
  })

  it('K/L — image dataUrl and fileId excluded from char counting', () => {
    const dataUrl = 'data:image/jpeg;base64,' + 'A'.repeat(80_000)
    const msgs = [
      {
        role: 'user',
        content: 'see',
        attachments: [{ type: 'image', mimeType: 'image/jpeg', dataUrl }],
      },
      { role: 'assistant', content: 'ok' },
      {
        role: 'user',
        content: 'doc',
        attachments: [
          {
            type: 'file',
            fileId: 'file-abc123XYZ',
            name: 'x.pdf',
            mimeType: 'application/pdf',
            size: 12,
          },
        ],
      },
    ]
    assert.equal(historyVisibleTextChars(msgs[0]), 3)
    assert.equal(historyVisibleTextChars(msgs[2]), 3)
    const selected = selectCoreConversationHistory(msgs, {
      maxMessages: 10,
      maxTextChars: 20,
    })
    assert.equal(selected.length, 3)
  })

  it('M — image/file caps remain 2 after selection', () => {
    assert.equal(applyRecentAttachmentHistoryLimit.length, 1)
    const hist = read('lib/server/chat-image-input.js')
    assert.match(hist, /SERVER_MAX_RECENT_IMAGE_TURNS = 2/)
    assert.match(hist, /SERVER_MAX_RECENT_FILE_TURNS/)
    const pdf = read('src/lib/pdfAttachment.ts')
    const img = read('src/lib/imageAttachment.ts')
    assert.match(pdf, /MAX_RECENT_FILE_TURNS = 2/)
    assert.match(img, /MAX_RECENT_IMAGE_TURNS = 2/)
  })

  it('N/O/P/Q — early fact/decision/continua/il secondo retained in expanded window', () => {
    const early = [
      { role: 'user', content: "Per questo progetto scegliamo l'approccio B." },
      { role: 'assistant', content: 'Ok, approccio B.' },
      {
        role: 'user',
        content: 'Le opzioni sono: 1) rosso 2) verde 3) blu.',
      },
      { role: 'assistant', content: 'Ricevuto elenco.' },
    ]
    const filler = ua(25).map((m, i) => ({
      ...m,
      content: `filler-${i}-${m.content}`,
    }))
    const late = [
      { role: 'user', content: 'Quale approccio avevamo scelto?' },
      { role: 'assistant', content: '…' },
      { role: 'user', content: 'continua' },
      { role: 'assistant', content: '…' },
      { role: 'user', content: 'Torniamo al secondo.' },
    ]
    const all = [...early, ...filler, ...late]
    assert.ok(all.length > 40)
    const selected = selectCoreConversationHistory(all)
    assert.ok(selected.length > 40)
    const text = selected.map((m) => m.content).join('\n')
    assert.match(text, /approccio B/)
    assert.match(text, /1\) rosso 2\) verde 3\) blu/)
    assert.match(text, /continua/)
    assert.match(text, /Torniamo al secondo/)
  })

  it('R — evidence outside new budget still absent', () => {
    const early = { role: 'user', content: 'SECRET_EARLY_FACT_XYZ' }
    const rest = ua(50) // 100 msgs
    const selected = selectCoreConversationHistory([early, ...rest])
    assert.equal(selected.length, MAX_HISTORY_MESSAGES)
    assert.ok(!selected.some((m) => m.content === 'SECRET_EARLY_FACT_XYZ'))
  })

  it('S/T — sticky IT + explicit switch still win via sanitized history', () => {
    const turns = []
    turns.push({ role: 'user', content: 'Ciao, rispondi sempre in italiano.' })
    turns.push({ role: 'assistant', content: 'Certo, resto in italiano.' })
    for (let i = 0; i < 30; i += 1) {
      turns.push({ role: 'user', content: `Turno italiano ${i} con dettagli utili.` })
      turns.push({ role: 'assistant', content: `Risposta ${i}.` })
    }
    turns.push({ role: 'user', content: 'ok' })
    const sanitized = sanitizeMultimodalMessages(turns)
    assert.equal(sanitized.ok, true)
    assert.ok(sanitized.messages.length > 40)
    const planOk = buildLanguageAwarenessPlan({
      userMessage: 'ok',
      messages: sanitized.messages.map((m) => ({ role: m.role, content: m.content })),
    })
    assert.equal(planOk.replyLanguage, 'it')

    const switched = [
      ...sanitized.messages.slice(0, -1),
      { role: 'user', content: 'Please reply in English from now on.' },
      { role: 'assistant', content: 'Sure.' },
      { role: 'user', content: 'ok' },
    ]
    const planEn = buildLanguageAwarenessPlan({
      userMessage: 'ok',
      messages: switched.map((m) => ({ role: m.role, content: m.content })),
    })
    assert.equal(planEn.replyLanguage, 'en')
  })

  it('U/V — image/document-only sticky unchanged', () => {
    const itHist = [
      { role: 'user', content: 'Ciao, rispondi sempre in italiano.' },
      { role: 'assistant', content: 'Va bene.' },
      {
        role: 'user',
        content: '',
        attachments: [
          {
            type: 'image',
            mimeType: 'image/jpeg',
            dataUrl:
              'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGfAP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAQUCf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQMBAT8Bf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQIBAT8Bf//Z',
          },
        ],
      },
    ]
    const mapped = mapMessagesToResponsesInput(itHist)
    const text = mapped.at(-1).content.find((p) => p.type === 'input_text')
    assert.match(text.text, /Analizza l'immagine|immagine allegata/i)
    assert.equal(visibleUserText(itHist.at(-1)), '')
    const appendix = buildCoreLanguageAppendix({
      userMessage: '',
      messages: itHist.map((m) => ({ role: m.role, content: m.content })),
    })
    assert.match(appendix, /response language: it/)

    const docHist = [
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
    const mappedDoc = mapMessagesToResponsesInput(docHist)
    const docText = mappedDoc.at(-1).content.find((p) => p.type === 'input_text')
    assert.match(docText.text, /Analizza il documento/)
    assert.notEqual(docText.text, documentOnlyModelNudgeForMessages([]))
  })

  it('W — regenerate path uses same selector (sanitizeMultimodalMessages)', () => {
    const long = ua(45)
    const viaSanitize = sanitizeMultimodalMessages(long)
    assert.equal(viaSanitize.ok, true)
    assert.equal(viaSanitize.messages.length, MAX_HISTORY_MESSAGES)
    const direct = selectCoreConversationHistory(long)
    assert.deepEqual(
      viaSanitize.messages.map((m) => m.content),
      direct.map((m) => m.content),
    )
    const ctx = read('src/context/ChatContext.tsx')
    assert.match(ctx, /regenerateAssistant/)
    assert.match(ctx, /toApiMessages\(kept\)/)
    assert.doesNotMatch(ctx, /slice\(-40\)/)
  })

  it('X/Y — Memory extraction / control still current-turn only; Continuity intact', () => {
    const chat = read('api/chat.ts')
    assert.match(chat, /visibleUserText\(lastUserMessage\)/)
    assert.match(chat, /lastUserCaption/)
    assert.match(chat, /runMemoryIfEnabled/)
    assert.match(chat, /if \(lastUserCaption && !skipExtractionForInspection\)/)
    assert.match(chat, /tryHandleMemoryControl/)
    assert.match(chat, /buildCoreContinuityAppendix/)
    assert.match(chat, /buildCoreLanguageAppendix/)
    assert.equal(typeof buildCoreContinuityAppendix(), 'string')
    assert.match(buildCoreContinuityAppendix(), /CONVERSATION CONTINUITY/)
  })

  it('Z/AA/AB — one responses.create, maxDuration 120, reasoning.none', () => {
    const chat = read('api/chat.ts')
    const coreParams = read('lib/server/core-responses-params.js')
    assert.equal((chat.match(/\.responses\.create\(/g) || []).length, 1)
    assert.match(chat, /maxDuration:\s*120/)
    assert.match(coreParams, /effort:\s*['"]none['"]/)
  })

  it('AC–AK — regression contracts present; no summarization / working state', () => {
    const select = read('lib/server/core-history-select.js')
    const chat = read('api/chat.ts')
    const autoScroll = read('src/components/chat/AutoScrollController.ts')
    const shell = read('src/components/chat/ComposerShell.tsx')
    const vision = read('src/pages/Vision.tsx')
    assert.match(autoScroll, /STABLE/)
    assert.match(shell, /uploadDocumentAttachment|ComposerAttachMenu/)
    assert.match(vision, /prepareImageAttachment/)
    assert.match(chat, /sanitizeMultimodalMessages/)
    assert.doesNotMatch(select, /responses\.create|conversationMemoryMap|learningSignals/)
    assert.doesNotMatch(select, /generateRollingSummary|emit hidden summary/i)
    assert.match(select, /No summarization/)
    assert.match(select, /Working State would be a\n \* separate ephemeral layer/)
  })

  it('constants match intended MVP defaults', () => {
    assert.equal(MAX_HISTORY_MESSAGES, 80)
    assert.equal(MAX_HISTORY_TEXT_CHARS, 120_000)
  })
})
