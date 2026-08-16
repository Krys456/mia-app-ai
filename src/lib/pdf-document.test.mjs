/**
 * #275 PDF document MVP — wiring / regression guards
 * Run: node --test src/lib/pdf-document.test.mjs
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import {
  DOCUMENT_ONLY_MODEL_NUDGE,
  IMAGE_ONLY_MODEL_NUDGE,
  documentOnlyModelNudgeForMessages,
  mapMessagesToResponsesInput,
  sanitizeFileAttachment,
  sanitizeMultimodalMessages,
  visibleUserText,
} from '../../lib/server/chat-image-input.js'
import {
  SERVER_PDF_EXPIRES_SECONDS,
  bufferLooksLikePdf,
  isSafeOpenAiFileId,
  sanitizePdfFilename,
  summarizePdfForLog,
  validatePdfBuffer,
} from '../../lib/server/chat-pdf-files.js'
import {
  buildCoreLanguageAppendix,
  buildLanguageAwarenessPlan,
} from '../../lib/server/language-awareness.js'

const root = process.cwd()
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')

const tinyPdf = Buffer.from('%PDF-1.4 minimal test file content')

describe('#275 PDF document MVP', () => {
  it('validates PDF magic / size / filename; rejects non-PDF', () => {
    assert.equal(bufferLooksLikePdf(tinyPdf), true)
    assert.equal(bufferLooksLikePdf(Buffer.from('MZ exe')), false)
    const ok = validatePdfBuffer(tinyPdf, 'report.pdf', 'application/pdf')
    assert.equal(ok.ok, true)
    const bad = validatePdfBuffer(Buffer.from('not-a-pdf'), 'x.pdf', 'application/pdf')
    assert.equal(bad.ok, false)
    assert.equal(bad.code, 'invalid_pdf')
    const huge = validatePdfBuffer(Buffer.alloc(11 * 1024 * 1024, 0x25), 'big.pdf', 'application/pdf')
    // magic fails because alloc fills 0x25 only for first... actually Buffer.alloc(n, 0x25) fills all with %
    // Fix: check too_large with proper PDF header
    const big = Buffer.concat([Buffer.from('%PDF-1.4'), Buffer.alloc(11 * 1024 * 1024)])
    const tooBig = validatePdfBuffer(big, 'big.pdf', 'application/pdf')
    assert.equal(tooBig.ok, false)
    assert.equal(tooBig.code, 'too_large')
    assert.equal(sanitizePdfFilename('../../evil.pdf'), 'evil.pdf')
    assert.equal(isSafeOpenAiFileId('file-abc123'), true)
    assert.equal(isSafeOpenAiFileId('file-abc/../x'), false)
  })

  it('sanitizes file attachment (fileId only) and rejects bytes / mixed', () => {
    const file = sanitizeFileAttachment({
      type: 'file',
      fileId: 'file-abc123XYZ',
      name: 'Energy_Report.pdf',
      mimeType: 'application/pdf',
      size: 2400,
    })
    assert.equal(file?.type, 'file')
    assert.equal(file?.fileId, 'file-abc123XYZ')

    assert.equal(
      sanitizeFileAttachment({
        type: 'file',
        fileId: 'file-abc',
        name: 'x.pdf',
        mimeType: 'application/pdf',
        size: 1,
        dataUrl: 'data:application/pdf;base64,aaa',
      }),
      null,
    )

    const mixed = sanitizeMultimodalMessages([
      {
        role: 'user',
        content: 'x',
        attachments: [
          {
            type: 'image',
            mimeType: 'image/jpeg',
            dataUrl:
              'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGfAP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAQUCf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQMBAT8Bf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQIBAT8Bf//Z',
          },
          {
            type: 'file',
            fileId: 'file-abc123',
            name: 'a.pdf',
            mimeType: 'application/pdf',
            size: 10,
          },
        ],
      },
    ])
    assert.equal(mixed.ok, false)
    assert.equal(mixed.code, 'too_many_images')
  })

  it('maps PDF to input_file with file_id + detail only (no filename/file_data/file_url)', () => {
    const itHist = [
      { role: 'user', content: 'Ciao, parliamo in italiano per favore.' },
      { role: 'assistant', content: 'Certo, parliamo pure in italiano.' },
      {
        role: 'user',
        content: '',
        attachments: [
          {
            type: 'file',
            fileId: 'file-abc123XYZ',
            name: 'report.pdf',
            mimeType: 'application/pdf',
            size: 100,
          },
        ],
      },
    ]
    const mapped = mapMessagesToResponsesInput(itHist)
    const last = mapped.at(-1)
    assert.ok(Array.isArray(last.content))
    const text = last.content.find((p) => p.type === 'input_text')
    const file = last.content.find((p) => p.type === 'input_file')
    assert.match(text.text, /Analizza il documento/)
    assert.notEqual(text.text, DOCUMENT_ONLY_MODEL_NUDGE)
    assert.notEqual(text.text, IMAGE_ONLY_MODEL_NUDGE)
    assert.equal(file.file_id, 'file-abc123XYZ')
    assert.equal(file.detail, 'low')
    assert.equal(Object.prototype.hasOwnProperty.call(file, 'filename'), false)
    assert.equal(Object.prototype.hasOwnProperty.call(file, 'file_data'), false)
    assert.equal(Object.prototype.hasOwnProperty.call(file, 'file_url'), false)
    assert.deepEqual(file, {
      type: 'input_file',
      file_id: 'file-abc123XYZ',
      detail: 'low',
    })
    // Filename remains on sanitized ChatApi/message metadata (UI), not Responses input.
    assert.equal(itHist.at(-1).attachments[0].name, 'report.pdf')
    assert.equal(visibleUserText(itHist.at(-1)), '')

    const plan = buildLanguageAwarenessPlan({
      userMessage: '',
      messages: itHist.map((m) => ({ role: m.role, content: m.content })),
    })
    assert.equal(plan.replyLanguage, 'it')
    const appendix = buildCoreLanguageAppendix({
      userMessage: '',
      messages: itHist.map((m) => ({ role: m.role, content: m.content })),
    })
    assert.match(appendix, /response language: it/)
    assert.ok(!appendix.includes(documentOnlyModelNudgeForMessages(itHist)))
  })

  it('Files API purpose user_data + 24h expiry configured in server helpers', () => {
    assert.equal(SERVER_PDF_EXPIRES_SECONDS, 24 * 60 * 60)
    const pdfFiles = read('lib/server/chat-pdf-files.js')
    assert.match(pdfFiles, /purpose:\s*['"]user_data['"]/)
    assert.match(pdfFiles, /expires_after/)
    assert.match(pdfFiles, /SERVER_PDF_EXPIRES_SECONDS/)
    const apiFiles = read('api/files.ts')
    assert.match(apiFiles, /uploadDocumentToOpenAiFiles/)
    assert.match(apiFiles, /validateDocumentBuffer/)
    assert.match(apiFiles, /maxDuration:\s*60/)
    assert.doesNotMatch(apiFiles, /responses\.create/)
  })

  it('Composer / ChatContext / bubble wiring — no PDF bytes in history path', () => {
    const menu = read('src/components/chat/ComposerAttachMenu.tsx')
    const shell = read('src/components/chat/ComposerShell.tsx')
    const ctx = read('src/context/ChatContext.tsx')
    const bubble = read('src/components/chat/MessageBubble.tsx')
    const types = read('src/types.ts')
    const apiChat = read('api/chat.ts')
    const vercel = read('vercel.json')

    assert.match(menu, /File \/ Documento/)
    assert.match(menu, /\.pdf/)
    assert.match(menu, /\.txt/)
    assert.match(menu, /\.docx/)
    assert.match(shell, /uploadDocumentAttachment/)
    assert.match(shell, /composer-file-chip/)
    assert.match(shell, /kind: 'file'/)
    assert.match(types, /kind: 'file'/)
    assert.match(types, /fileId: string/)
    assert.doesNotMatch(types, /kind: 'file'[\s\S]*dataUrl/)
    assert.match(ctx, /MAX_RECENT_FILE_TURNS/)
    assert.match(ctx, /type: 'file'/)
    assert.match(ctx, /fileId: a\.fileId/)
    assert.match(ctx, /mimeType: a\.mimeType/)
    assert.doesNotMatch(ctx, /mimeType: 'application\/pdf' as const/)
    assert.match(bubble, /bubble__attachment-file/)
    assert.match(bubble, /documentBadgeFor/)
    assert.match(apiChat, /modelSupportsFileInput/)
    assert.match(apiChat, /file_unsupported_model/)
    assert.equal((apiChat.match(/\.responses\.create\(/g) || []).length, 1)
    assert.match(apiChat, /maxDuration:\s*120/)
    assert.match(vercel, /api\/files\.ts/)
    assert.equal(summarizePdfForLog({ name: 'a.pdf', size: 1, fileId: 'file-abc' }).hasFileId, true)
    assert.equal(JSON.stringify(summarizePdfForLog({ name: 'a.pdf', size: 1 })).includes('base64'), false)
  })

  it('Vision / mic / image / scroll invariants untouched by PDF MVP', () => {
    const vision = read('src/pages/Vision.tsx')
    const shell = read('src/components/chat/ComposerShell.tsx')
    const autoScroll = read('src/components/chat/AutoScrollController.ts')
    const coreParams = read('lib/server/core-responses-params.js')
    assert.match(vision, /prepareImageAttachment/)
    assert.doesNotMatch(vision, /uploadDocumentAttachment|uploadPdfAttachment|input_file/)
    assert.match(shell, /showMic/)
    assert.match(shell, /composerDraftCanSend/)
    assert.doesNotMatch(autoScroll, /input_file|fileId|PDF/)
    assert.match(coreParams, /effort:\s*['"]none['"]/)
  })
})
