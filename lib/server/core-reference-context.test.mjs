/**
 * Temporary Reference Context (#279) — unit + wiring tests.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  MAX_HISTORY_MESSAGES,
  MAX_HISTORY_TEXT_CHARS,
} from './core-history-select.js'
import {
  SERVER_MAX_RECENT_FILE_TURNS,
  SERVER_MAX_RECENT_IMAGE_TURNS,
  sanitizeMultimodalMessages,
} from './chat-image-input.js'
import { buildCoreContinuityAppendix } from './conversation-continuity.js'
import {
  deriveConversationWorkingState,
  buildConversationWorkingStateAppendix,
} from './core-working-state.js'
import {
  buildReferenceContextAppendix,
  deriveRecentAlternatives,
  deriveRecentArtifacts,
  deriveRecentOrderedOptions,
  deriveReferenceContext,
  extractAlternativesFromText,
  extractOrderedOptionsFromText,
  MAX_APPENDIX_CHARS,
  REFERENCE_CONTEXT_VERSION,
} from './core-reference-context.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel) => readFileSync(join(root, rel), 'utf8')

const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

function imgAtt() {
  return { type: 'image', mimeType: 'image/png', dataUrl: TINY_PNG }
}

function fileAtt(name, fileId = `file-${name}`) {
  return {
    type: 'file',
    fileId,
    name,
    mimeType: 'application/pdf',
    size: 1200,
  }
}

describe('core-reference-context (#279)', () => {
  it('A — assistant list of 3 options → recentOrderedOptions extracted', () => {
    const opts = extractOrderedOptionsFromText(
      'Here are ideas:\n1. Improve Memory\n2. Improve references\n3. Improve UI\n',
    )
    assert.deepEqual(opts, ['Improve Memory', 'Improve references', 'Improve UI'])

    const ctx = deriveReferenceContext([
      { role: 'user', content: 'What should we improve?' },
      {
        role: 'assistant',
        content: '1. Improve Memory\n2. Improve references\n3. Improve UI',
      },
      { role: 'user', content: 'La seconda.' },
    ])
    assert.equal(ctx?.version, REFERENCE_CONTEXT_VERSION)
    assert.deepEqual(ctx?.recentOrderedOptions, [
      'Improve Memory',
      'Improve references',
      'Improve UI',
    ])
  })

  it('B/C — Italian/English ordinal turns receive ordered hint in appendix', () => {
    const messages = [
      {
        role: 'assistant',
        content: '1. Improve Memory\n2. Improve references\n3. Improve UI',
      },
      { role: 'user', content: 'La seconda.' },
    ]
    const appendixIt = buildReferenceContextAppendix(messages)
    assert.match(appendixIt, /TEMPORARY REFERENCE CONTEXT/)
    assert.match(appendixIt, /Recent ordered options:/)
    assert.match(appendixIt, /2\. Improve references/)
    assert.match(appendixIt, /Prefer the latest explicit user message/)

    const appendixEn = buildReferenceContextAppendix([
      ...messages.slice(0, 1),
      { role: 'user', content: 'The second one' },
    ])
    assert.match(appendixEn, /2\. Improve references/)
  })

  it('D — newer assistant option list supersedes older one', () => {
    const opts = deriveRecentOrderedOptions([
      { role: 'assistant', content: '1. Alpha\n2. Beta\n3. Gamma' },
      { role: 'user', content: 'ok' },
      { role: 'assistant', content: '1. Red\n2. Blue' },
      { role: 'user', content: 'the first' },
    ])
    assert.deepEqual(opts, ['Red', 'Blue'])
  })

  it('E — unclear prose does not become option list', () => {
    assert.equal(
      extractOrderedOptionsFromText(
        'I think we should improve memory and maybe references later.',
      ),
      null,
    )
    assert.equal(
      extractOrderedOptionsFromText('First we ship, then we polish, finally we celebrate.'),
      null,
    )
    const ctx = deriveReferenceContext([
      { role: 'assistant', content: 'Maybe memory, or UI, depending.' },
      { role: 'user', content: 'La seconda.' },
    ])
    assert.equal(ctx?.recentOrderedOptions, undefined)
  })

  it('F — assistant suggestions do NOT enter Working State', () => {
    const messages = [
      {
        role: 'assistant',
        content: '1. Improve Memory\n2. Improve references\n3. Improve UI',
      },
      { role: 'user', content: 'La seconda.' },
    ]
    const ws = deriveConversationWorkingState(messages)
    assert.equal(ws, null)
    const ref = deriveReferenceContext(messages)
    assert.ok(ref?.recentOrderedOptions?.length === 3)
  })

  it('G — image recent + payload present → evidenceAvailable true', () => {
    const arts = deriveRecentArtifacts([
      { role: 'user', content: '', attachments: [imgAtt()] },
      { role: 'assistant', content: 'Nice photo.' },
      { role: 'user', content: 'Cosa c’era nella foto?' },
    ])
    assert.equal(arts?.length, 1)
    assert.equal(arts?.[0].kind, 'image')
    assert.equal(arts?.[0].evidenceAvailable, true)
    assert.equal('name' in (arts?.[0] || {}), false)
  })

  it('H — older image stripped by cap → evidenceAvailable false', () => {
    const arts = deriveRecentArtifacts([
      { role: 'user', content: 'old', attachments: [imgAtt()] },
      { role: 'assistant', content: 'ok' },
      { role: 'user', content: 'mid', attachments: [imgAtt()] },
      { role: 'assistant', content: 'ok' },
      { role: 'user', content: 'new', attachments: [imgAtt()] },
    ])
    assert.equal(arts?.length, 3)
    assert.equal(arts?.[0].evidenceAvailable, false)
    assert.equal(arts?.[1].evidenceAvailable, true)
    assert.equal(arts?.[2].evidenceAvailable, true)
    assert.equal(SERVER_MAX_RECENT_IMAGE_TURNS, 2)
  })

  it('I — recent PDF/TXT/DOCX with file ref → evidenceAvailable true', () => {
    const arts = deriveRecentArtifacts([
      {
        role: 'user',
        content: 'see report',
        attachments: [fileAtt('report.pdf')],
      },
    ])
    assert.deepEqual(arts, [
      { kind: 'file', name: 'report.pdf', evidenceAvailable: true },
    ])
  })

  it('J — older file stripped → evidenceAvailable false', () => {
    const arts = deriveRecentArtifacts([
      { role: 'user', content: '', attachments: [fileAtt('a.pdf', 'file-a')] },
      { role: 'user', content: '', attachments: [fileAtt('b.pdf', 'file-b')] },
      { role: 'user', content: '', attachments: [fileAtt('c.pdf', 'file-c')] },
    ])
    assert.equal(arts?.length, 3)
    assert.equal(arts?.[0].evidenceAvailable, false)
    assert.equal(arts?.[0].name, 'a.pdf')
    assert.equal(arts?.[1].evidenceAvailable, true)
    assert.equal(arts?.[2].evidenceAvailable, true)
    assert.equal(SERVER_MAX_RECENT_FILE_TURNS, 2)
  })

  it('K — multiple files preserve chronological order', () => {
    const arts = deriveRecentArtifacts([
      { role: 'user', content: '', attachments: [fileAtt('first.pdf')] },
      { role: 'assistant', content: 'got it' },
      { role: 'user', content: '', attachments: [fileAtt('second.pdf')] },
    ])
    assert.deepEqual(
      arts?.map((a) => a.name),
      ['first.pdf', 'second.pdf'],
    )
  })

  it('L/M/N — no fileId, dataUrl, or synthesized document/image content', () => {
    const appendix = buildReferenceContextAppendix([
      {
        role: 'user',
        content: 'look',
        attachments: [fileAtt('secret.pdf', 'file-SECRET123')],
      },
      { role: 'user', content: '', attachments: [imgAtt()] },
      {
        role: 'assistant',
        content: '1. Keep going\n2. Stop',
      },
    ])
    assert.doesNotMatch(appendix, /file-SECRET|fileId|data:image|base64/i)
    assert.doesNotMatch(appendix, /iVBORw0KGgo/)
    assert.match(appendix, /evidence available|evidence unavailable/)
    const ctx = deriveReferenceContext([
      {
        role: 'user',
        content: '',
        attachments: [fileAtt('report.pdf', 'file-xyz')],
      },
    ])
    const json = JSON.stringify(ctx)
    assert.doesNotMatch(json, /file-xyz|fileId|dataUrl|data:image/)
  })

  it('O — ambiguity does not force wrong binding (no referent field)', () => {
    const ctx = deriveReferenceContext([
      { role: 'assistant', content: '1. Cats\n2. Dogs' },
      { role: 'user', content: 'maybe' },
      { role: 'assistant', content: '1. Red\n2. Blue' },
      { role: 'user', content: 'la seconda' },
    ])
    // Most recent list only — no invented binding to "Dogs" or "Blue".
    assert.deepEqual(ctx?.recentOrderedOptions, ['Red', 'Blue'])
    assert.equal('referent' in (ctx || {}), false)
    assert.equal('resolvedOption' in (ctx || {}), false)
    const appendix = buildReferenceContextAppendix([
      { role: 'assistant', content: '1. Cats\n2. Dogs' },
      { role: 'assistant', content: '1. Red\n2. Blue' },
      { role: 'user', content: 'la seconda' },
    ])
    assert.match(appendix, /Do not invent a referent/)
    assert.match(appendix, /Ask a concise clarification/)
  })

  it('P — clear two-option alternatives hint (optional)', () => {
    const alts = extractAlternativesFromText('Option A: Memory / Option B: UI')
    assert.deepEqual(alts, ['Memory', 'UI'])
    const derived = deriveRecentAlternatives([
      { role: 'assistant', content: 'You can choose Memory or UI.' },
      { role: 'user', content: "Non quello, l'altro." },
    ])
    assert.deepEqual(derived, ['Memory', 'UI'])
    const appendix = buildReferenceContextAppendix([
      { role: 'assistant', content: 'You can choose Memory or UI.' },
      { role: 'user', content: "Non quello, l'altro." },
    ])
    assert.match(appendix, /Recent alternatives:/)
    assert.match(appendix, /Memory/)
    assert.match(appendix, /UI/)
  })

  it('Q — continua still primarily CONTINUITY; Reference does not own it', () => {
    const continuity = buildCoreContinuityAppendix()
    assert.match(continuity, /CONVERSATION CONTINUITY/)
    const appendix = buildReferenceContextAppendix([
      { role: 'user', content: 'Write a long essay about Rome.' },
      { role: 'assistant', content: 'Part one…' },
      { role: 'user', content: 'Continua.' },
    ])
    // No ordered options / artifacts → empty Reference appendix; Continuity handles continua.
    assert.equal(appendix, '')
  })

  it('R — #278 task/decision/constraint behavior unchanged', () => {
    const messages = [
      { role: 'user', content: 'Do not modify api/chat.ts.' },
      { role: 'user', content: 'Next implement Vision.' },
      { role: 'user', content: 'We choose Postgres.' },
    ]
    const ws = deriveConversationWorkingState(messages)
    assert.equal(ws?.activeTask, 'Vision')
    assert.ok(ws?.decisions?.some((d) => /Postgres/i.test(d)))
    assert.ok(ws?.constraints?.some((c) => /api\/chat\.ts/i.test(c)))
    // Assistant lists still do not pollute WS
    const mixed = [
      ...messages,
      { role: 'assistant', content: '1. Ship\n2. Wait' },
    ]
    const ws2 = deriveConversationWorkingState(mixed)
    assert.deepEqual(ws2?.decisions, ws?.decisions)
  })

  it('S/T — regenerate temporal safety (request-scoped messages only)', () => {
    const early = [
      { role: 'assistant', content: '1. Alpha\n2. Beta' },
      { role: 'user', content: 'go' },
    ]
    const later = [
      ...early,
      { role: 'assistant', content: '1. Gamma\n2. Delta' },
      { role: 'user', content: 'the second' },
    ]
    assert.deepEqual(deriveRecentOrderedOptions(early), ['Alpha', 'Beta'])
    assert.deepEqual(deriveRecentOrderedOptions(later), ['Gamma', 'Delta'])

    const earlyArts = deriveRecentArtifacts([
      { role: 'user', content: '', attachments: [fileAtt('early.pdf')] },
    ])
    const laterArts = deriveRecentArtifacts([
      { role: 'user', content: '', attachments: [fileAtt('early.pdf')] },
      { role: 'user', content: '', attachments: [fileAtt('later.pdf')] },
    ])
    assert.equal(earlyArts?.length, 1)
    assert.equal(laterArts?.length, 2)
    assert.equal(laterArts?.[1].name, 'later.pdf')
  })

  it('U — LANGUAGE module / sticky contract untouched by Reference Context', () => {
    const lang = read('lib/server/language-awareness.js')
    assert.match(lang, /LANGUAGE_CONTRACT|buildCoreLanguageAppendix/)
    assert.doesNotMatch(lang, /buildReferenceContextAppendix|core-reference-context/)
    const appendix = buildReferenceContextAppendix([
      { role: 'assistant', content: '1. Uno\n2. Due' },
      { role: 'user', content: 'La seconda.' },
    ])
    assert.doesNotMatch(appendix, /^LANGUAGE/m)
  })

  it('V/W/X/Y — Memory / Recall / Forget / Overview untouched', () => {
    const chat = read('api/chat.ts')
    assert.match(chat, /buildReferenceContextAppendix/)
    assert.match(chat, /loadCoreMemoryPack|appendMemoryPackToInstructions/)
    assert.match(chat, /tryHandleMemoryControl|memory-control-forget/)
    assert.match(chat, /memory-control-overview|tryHandleMemoryOverview|overview/)
    assert.doesNotMatch(chat, /reference-resolution|v2\/brain\/reference/)
    const brain = read('lib/server/brain-memory.js')
    assert.doesNotMatch(brain, /core-reference-context|deriveReferenceContext/)
  })

  it('Z/AA — image/file caps remain 2; #277 selector unchanged', () => {
    assert.equal(SERVER_MAX_RECENT_IMAGE_TURNS, 2)
    assert.equal(SERVER_MAX_RECENT_FILE_TURNS, 2)
    assert.equal(MAX_HISTORY_MESSAGES, 80)
    assert.equal(MAX_HISTORY_TEXT_CHARS, 120_000)
    const img = read('src/lib/imageAttachment.ts')
    const pdf = read('src/lib/pdfAttachment.ts')
    assert.match(img, /MAX_RECENT_IMAGE_TURNS = 2/)
    assert.match(pdf, /MAX_RECENT_FILE_TURNS = 2/)
  })

  it('AB/AC/AD — one responses.create, maxDuration 120, reasoning.none', () => {
    const chat = read('api/chat.ts')
    const params = read('lib/server/core-responses-params.js')
    assert.equal((chat.match(/\.responses\.create\(/g) || []).length, 1)
    assert.match(chat, /maxDuration:\s*120/)
    assert.match(params, /effort:\s*['"]none['"]/)
  })

  it('instruction order LANGUAGE → CONTINUITY → REFERENCE → WORKING STATE', () => {
    const chat = read('api/chat.ts')
    const lang = chat.indexOf('const languageAppendix = buildCoreLanguageAppendix')
    const cont = chat.indexOf('const continuityAppendix = buildCoreContinuityAppendix')
    const ref = chat.indexOf('const referenceContextAppendix = buildReferenceContextAppendix')
    const ws = chat.indexOf('const workingStateAppendix = buildConversationWorkingStateAppendix')
    assert.ok(lang > 0 && cont > lang && ref > cont && ws > ref)

    const appendix = buildReferenceContextAppendix([
      { role: 'assistant', content: '1. A\n2. B' },
      {
        role: 'user',
        content: 'see',
        attachments: [fileAtt('report.pdf')],
      },
    ])
    assert.ok(appendix.length <= MAX_APPENDIX_CHARS)
    assert.match(appendix, /TEMPORARY REFERENCE CONTEXT/)
    assert.match(appendix, /Do not treat this as durable Memory/)
    assert.match(appendix, /file: report\.pdf — evidence available/)
  })

  it('Option A/B lettered lists + lettered bullets', () => {
    assert.deepEqual(
      extractOrderedOptionsFromText(
        '- Option A: Ship now\n- Option B: Wait\n- Option C: Cancel',
      ),
      ['Ship now', 'Wait', 'Cancel'],
    )
    assert.deepEqual(extractOrderedOptionsFromText('A: Red\nB: Blue'), ['Red', 'Blue'])
  })

  it('caps option count and length; empty when no signal', () => {
    const long = Array.from({ length: 8 }, (_, i) => `${i + 1}. Item ${'x'.repeat(200)}`).join(
      '\n',
    )
    const opts = extractOrderedOptionsFromText(long)
    assert.equal(opts?.length, 5)
    assert.ok((opts?.[0]?.length || 0) <= 120)

    assert.equal(buildReferenceContextAppendix([]), '')
    assert.equal(buildReferenceContextAppendix([{ role: 'user', content: 'hi' }]), '')
  })

  it('AE — no V2 reconnect; ChatContext / WS schema untouched', () => {
    const refMod = read('lib/server/core-reference-context.js')
    assert.doesNotMatch(refMod, /from ['"].*v2\/brain|from ['"].*reference-resolution/)
    const ctx = read('src/context/ChatContext.tsx')
    assert.doesNotMatch(ctx, /deriveReferenceContext|ReferenceContext/)
    const wsMod = read('lib/server/core-working-state.js')
    assert.doesNotMatch(wsMod, /recentOrderedOptions|recentArtifacts/)
    assert.match(wsMod, /activeTask|decisions|constraints/)
  })

  it('sanitize path still selects history; Reference uses request messages only', () => {
    const long = []
    for (let i = 0; i < 50; i += 1) {
      long.push({ role: 'user', content: `U${i}` })
      long.push({ role: 'assistant', content: `A${i}` })
    }
    // Replace the last assistant turn with an ordered list (stays inside #277 window).
    long[long.length - 1] = {
      role: 'assistant',
      content: '1. Only visible if in window\n2. Second',
    }
    const sanitized = sanitizeMultimodalMessages(long)
    assert.equal(sanitized.ok, true)
    assert.equal(sanitized.messages.length, MAX_HISTORY_MESSAGES)
    const ref = deriveReferenceContext(sanitized.messages)
    assert.deepEqual(ref?.recentOrderedOptions, ['Only visible if in window', 'Second'])
  })

  it('WS appendix still builds independently alongside Reference', () => {
    const messages = [
      { role: 'user', content: 'Next implement references.' },
      {
        role: 'assistant',
        content: '1. Improve Memory\n2. Improve references\n3. Improve UI',
      },
      { role: 'user', content: 'La seconda.' },
    ]
    const wsAppendix = buildConversationWorkingStateAppendix(messages)
    const refAppendix = buildReferenceContextAppendix(messages)
    assert.match(wsAppendix, /CONVERSATION WORKING STATE/)
    assert.match(wsAppendix, /Current task:/)
    assert.match(refAppendix, /Recent ordered options:/)
    assert.doesNotMatch(refAppendix, /Current task:|Recent explicit decisions/)
    assert.doesNotMatch(wsAppendix, /Recent ordered options|Recent artifacts/)
  })
})
