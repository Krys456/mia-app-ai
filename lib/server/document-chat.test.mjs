/**
 * #313 Document chat continuity — intent, context, reuse, expiry, privacy.
 * Run: node lib/server/document-chat.test.mjs
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  fileIdBelongsToConversation,
  isDocumentFileExpired,
  selectLatestActiveDocument,
  summarizeActiveDocumentForLog,
} from './document-chat-context.js'
import { detectDocumentReferenceIntent } from './document-chat-intent.js'
import {
  buildDocumentChatAppendix,
  documentEmptyPromptForLang,
  documentExpiredUserMessage,
} from './document-chat-appendix.js'
import {
  buildDocumentChatDiagPayload,
  isDocumentChatDiagEnabled,
  DOCUMENT_CHAT_DIAG_BUILD,
} from './document-chat-diag.js'
import {
  DOCUMENT_ONLY_MODEL_NUDGE,
  documentOnlyModelNudgeForMessages,
  mapMessagesToResponsesInput,
  sanitizeFileAttachment,
} from './chat-image-input.js'

const root = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(root, '../..')

function fileUser(name, fileId, extra = {}) {
  return {
    id: extra.id || 'u-doc',
    role: 'user',
    content: extra.content ?? 'Spiegami questo documento.',
    attachments: [
      {
        type: 'file',
        fileId,
        name,
        mimeType: extra.mimeType || 'application/pdf',
        size: extra.size || 12000,
        ...(extra.expiresAt != null ? { expiresAt: extra.expiresAt } : {}),
      },
    ],
  }
}

const pdfA = 'file-AAA111aaa'
const pdfB = 'file-BBB222bbb'

// ——— Initial / default prompt language ———
{
  assert.match(documentEmptyPromptForLang('it'), /Analizza questo documento/)
  assert.match(documentEmptyPromptForLang('en'), /Analyze this document/)
  assert.match(DOCUMENT_ONLY_MODEL_NUDGE, /Analyze this document/)
  assert.match(documentOnlyModelNudgeForMessages([], 'it-IT'), /Analizza questo documento/)
  assert.match(documentOnlyModelNudgeForMessages([], 'en-US'), /Analyze this document/)
}

// ——— Context selection + switching ———
{
  const msgs = [
    fileUser('a.pdf', pdfA, { id: 'ua', content: 'Riassumilo.' }),
    { role: 'assistant', content: 'Ecco il riassunto di A.' },
    fileUser('b.pdf', pdfB, { id: 'ub', content: 'E questo?' }),
  ]
  const active = selectLatestActiveDocument(msgs)
  assert.ok(active)
  assert.equal(active.fileId, pdfB)
  assert.equal(active.filename, 'b.pdf')
  assert.equal(fileIdBelongsToConversation(msgs, pdfA), true)
  assert.equal(fileIdBelongsToConversation(msgs, 'file-FOREIGN999'), false)
}

// ——— Follow-up reuse intent ———
{
  for (const phrase of [
    'Approfondisci il secondo punto.',
    'Fammi 5 domande',
    'Qual è la conclusione?',
    'Dove parla di energia?',
    'Spiegamelo meglio.',
    'Riassumi la parte finale.',
    'Cosa significa quella tabella?',
  ]) {
    const r = detectDocumentReferenceIntent(phrase, { hasActiveDocument: true })
    assert.equal(r.shouldReuseDocument, true, phrase)
    assert.equal(r.refersToDocument, true, phrase)
  }

  const weather = detectDocumentReferenceIntent('Che tempo farà domani?', {
    hasActiveDocument: true,
  })
  assert.equal(weather.shouldReuseDocument, false)
  assert.equal(weather.unrelated, true)

  assert.equal(
    detectDocumentReferenceIntent('Approfondisci', { hasActiveDocument: false }).shouldReuseDocument,
    false,
  )
}

// ——— mapMessagesToResponsesInput reuses file on last text turn ———
{
  const history = [
    {
      role: 'user',
      content: 'Spiegami.',
      attachments: [
        { type: 'file', fileId: pdfA, name: 'doc.pdf', mimeType: 'application/pdf', size: 1000 },
      ],
    },
    { role: 'assistant', content: 'Punto uno. Punto due.' },
    { role: 'user', content: 'Approfondisci il secondo punto.' },
  ]
  const mapped = mapMessagesToResponsesInput(history, {
    browserLocale: 'it-IT',
    reuseDocument: { fileId: pdfA, mimeType: 'application/pdf' },
  })
  const last = mapped[mapped.length - 1]
  assert.equal(last.role, 'user')
  assert.ok(Array.isArray(last.content))
  const filePart = last.content.find((p) => p.type === 'input_file')
  assert.ok(filePart)
  assert.equal(filePart.file_id, pdfA)

  // Unrelated: no reuseDocument → no file on last turn
  const mapped2 = mapMessagesToResponsesInput(history, { browserLocale: 'it-IT' })
  const last2 = mapped2[mapped2.length - 1]
  assert.equal(typeof last2.content, 'string')
}

// ——— Expiry ———
{
  const past = Math.floor(Date.now() / 1000) - 3600
  assert.equal(isDocumentFileExpired(past), true)
  assert.equal(isDocumentFileExpired(Math.floor(Date.now() / 1000) + 3600), false)
  assert.match(documentExpiredUserMessage('it'), /non è più disponibile/)
  assert.match(documentExpiredUserMessage('en'), /no longer available/)
}

// ——— Security: sanitize rejects bytes + bad ids ———
{
  assert.equal(
    sanitizeFileAttachment({
      type: 'file',
      fileId: 'not-a-file',
      name: 'x.pdf',
      mimeType: 'application/pdf',
      size: 100,
    }),
    null,
  )
  assert.equal(
    sanitizeFileAttachment({
      type: 'file',
      fileId: pdfA,
      name: 'x.pdf',
      mimeType: 'application/pdf',
      size: 100,
      dataUrl: 'data:application/pdf;base64,AAA',
    }),
    null,
  )
  const ok = sanitizeFileAttachment({
    type: 'file',
    fileId: pdfA,
    name: 'x.pdf',
    mimeType: 'application/pdf',
    size: 100,
    expiresAt: 9999999999,
  })
  assert.ok(ok)
  assert.equal(ok.expiresAt, 9999999999)
}

// ——— Appendix + diag ———
{
  const appendix = buildDocumentChatAppendix({ filename: 'report.pdf', reused: true })
  assert.match(appendix, /DOCUMENT CHAT/)
  assert.match(appendix, /page numbers/)
  assert.match(appendix, /Vision AI/)
  assert.ok(!/base64|data:application/i.test(appendix))

  const diag = buildDocumentChatDiagPayload({
    activeDocumentFound: true,
    activeDocumentReused: true,
    activeFilename: 'report.pdf',
    documentReferenceDetected: true,
    fileIncludedInModelInput: true,
    env: { VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_SHA: 'abcdef1234567' },
  })
  assert.equal(diag.route, 'document-chat')
  assert.equal(diag.diagBuild, DOCUMENT_CHAT_DIAG_BUILD)
  assert.ok(!('rawBytes' in diag))
  assert.equal(
    isDocumentChatDiagEnabled(
      { headers: { 'x-shinkaido-document-diag': '1' } },
      {},
      { VERCEL_ENV: 'preview' },
    ),
    true,
  )

  const log = summarizeActiveDocumentForLog({
    type: 'active_document',
    fileId: pdfA,
    filename: 'a.pdf',
    mimeType: 'application/pdf',
    size: 10,
    expiresAt: null,
    sourceTurnId: null,
  })
  assert.equal(log.hasActiveDocument, true)
  assert.ok(!JSON.stringify(log).includes(pdfA.slice(12))) // only prefix
}

// ——— Regression: Calendar/Email untouched; chat wires document-chat ———
{
  const chatSrc = fs.readFileSync(path.join(repoRoot, 'api/chat.ts'), 'utf8')
  assert.match(chatSrc, /document-chat|selectLatestActiveDocument|reuseDocument/)
  assert.match(chatSrc, /suppressActiveDocumentReuse/)
  for (const file of [
    'document-chat-context.js',
    'document-chat-intent.js',
    'document-chat-appendix.js',
    'document-chat-diag.js',
  ]) {
    const src = fs.readFileSync(path.join(root, file), 'utf8')
    assert.ok(!/calendar-chat|email-oauth|gmail/i.test(src), file)
  }
  assert.ok(!/create table.*documents|embeddings|vector/i.test(chatSrc))
}

console.log('document-chat.test.mjs: all assertions passed')
