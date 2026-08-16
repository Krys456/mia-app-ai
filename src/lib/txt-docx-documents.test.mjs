/**
 * #276 TXT + DOCX document support — validation / mapping / regression guards
 * Run: node --test src/lib/txt-docx-documents.test.mjs
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import {
  DOCUMENT_ONLY_MODEL_NUDGE,
  IMAGE_ONLY_MODEL_NUDGE,
  applyRecentAttachmentHistoryLimit,
  documentOnlyModelNudgeForMessages,
  mapMessagesToResponsesInput,
  sanitizeFileAttachment,
  sanitizeMultimodalMessages,
  visibleUserText,
} from '../../lib/server/chat-image-input.js'
import {
  SERVER_DOCX_MIME,
  SERVER_MAX_DOCX_BYTES,
  SERVER_MAX_TXT_BYTES,
  SERVER_PDF_MIME,
  SERVER_TXT_MIME,
  bufferLooksLikeDocx,
  bufferLooksLikeZip,
  validateDocumentBuffer,
  validateDocxBuffer,
  validateTxtBuffer,
} from '../../lib/server/chat-pdf-files.js'
import {
  buildCoreLanguageAppendix,
  buildLanguageAwarenessPlan,
} from '../../lib/server/language-awareness.js'

const root = process.cwd()
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')

function makeDocxLikeBuffer() {
  // ZIP local-file magic + OOXML path markers in the same window (no unzip).
  const header = Buffer.from([0x50, 0x4b, 0x03, 0x04])
  const markers = Buffer.from('[Content_Types].xml\0word/document.xml\0word/', 'latin1')
  return Buffer.concat([header, Buffer.alloc(64, 0x20), markers])
}

function makeFakeZipBuffer() {
  return Buffer.concat([
    Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    Buffer.from('just a zip without ooxml markers'),
  ])
}

describe('#276 TXT + DOCX documents', () => {
  it('C/N — picker accept includes .pdf .txt .docx and OOXML MIME', () => {
    const menu = read('src/components/chat/ComposerAttachMenu.tsx')
    assert.match(menu, /File \/ Documento/)
    assert.match(menu, /\.pdf/)
    assert.match(menu, /\.txt/)
    assert.match(menu, /\.docx/)
    assert.match(menu, /text\/plain/)
    assert.match(
      menu,
      /application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document/,
    )
    assert.doesNotMatch(menu, /accept="[^"]*\.doc"/)
    assert.doesNotMatch(menu, /\.docm/)
  })

  it('J/K/L/M — TXT validation: empty / binary / bad UTF-8 / oversized', () => {
    assert.equal(validateTxtBuffer(Buffer.alloc(0), 'notes.txt', 'text/plain').ok, false)
    assert.equal(validateTxtBuffer(Buffer.alloc(0), 'notes.txt', 'text/plain').code, 'empty')
    assert.match(validateTxtBuffer(Buffer.alloc(0), 'notes.txt', 'text/plain').error, /TXT vuoto/)

    const binary = Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe, 0x00, 0x00])
    const bin = validateTxtBuffer(binary, 'notes.txt', 'text/plain')
    assert.equal(bin.ok, false)
    assert.equal(bin.code, 'binary_txt')
    assert.match(bin.error, /binari/)

    // Invalid UTF-8 continuation (no NUL → not binary path)
    const badUtf8 = Buffer.from([0x48, 0x69, 0xc3]) // 'Hi' + truncated multi-byte
    const enc = validateTxtBuffer(badUtf8, 'notes.txt', 'text/plain')
    assert.equal(enc.ok, false)
    assert.equal(enc.code, 'bad_encoding')

    const huge = Buffer.alloc(SERVER_MAX_TXT_BYTES + 1, 0x61)
    const tooBig = validateTxtBuffer(huge, 'notes.txt', 'text/plain')
    assert.equal(tooBig.ok, false)
    assert.equal(tooBig.code, 'too_large')
    assert.match(tooBig.error, /TXT troppo grande/)
  })

  it('D/E — TXT accepts UTF-8 + BOM and maps to input_file without detail', () => {
    const bom = Buffer.from([0xef, 0xbb, 0xbf, ...Buffer.from('Ciao mondo', 'utf8')])
    const ok = validateTxtBuffer(bom, 'notes.txt', 'text/plain')
    assert.equal(ok.ok, true)
    assert.equal(ok.mimeType, SERVER_TXT_MIME)

    const octet = validateTxtBuffer(Buffer.from('plain text', 'utf8'), 'notes.txt', 'application/octet-stream')
    assert.equal(octet.ok, true)

    const hist = [
      { role: 'user', content: 'Ciao, parliamo in italiano per favore.' },
      { role: 'assistant', content: 'Certo.' },
      {
        role: 'user',
        content: '',
        attachments: [
          {
            type: 'file',
            fileId: 'file-txtABC123',
            name: 'notes.txt',
            mimeType: 'text/plain',
            size: 42,
          },
        ],
      },
    ]
    const mapped = mapMessagesToResponsesInput(hist)
    const file = mapped.at(-1).content.find((p) => p.type === 'input_file')
    assert.deepEqual(file, {
      type: 'input_file',
      file_id: 'file-txtABC123',
    })
    assert.equal(Object.prototype.hasOwnProperty.call(file, 'detail'), false)
    assert.equal(Object.prototype.hasOwnProperty.call(file, 'filename'), false)
    assert.equal(Object.prototype.hasOwnProperty.call(file, 'file_data'), false)
    assert.equal(Object.prototype.hasOwnProperty.call(file, 'file_url'), false)
  })

  it('F — TXT document-only sticky IT language', () => {
    const itHist = [
      { role: 'user', content: 'Ciao, rispondi sempre in italiano.' },
      { role: 'assistant', content: 'Va bene, resto in italiano.' },
      {
        role: 'user',
        content: '',
        attachments: [
          {
            type: 'file',
            fileId: 'file-txtIT1',
            name: 'english-notes.txt',
            mimeType: 'text/plain',
            size: 20,
          },
        ],
      },
    ]
    const mapped = mapMessagesToResponsesInput(itHist)
    const text = mapped.at(-1).content.find((p) => p.type === 'input_text')
    assert.match(text.text, /Analizza il documento/)
    assert.notEqual(text.text, DOCUMENT_ONLY_MODEL_NUDGE)
    assert.notEqual(text.text, IMAGE_ONLY_MODEL_NUDGE)
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

  it('G/H/I — TXT caption + follow-up/regenerate keep fileId via sanitize', () => {
    const withCaption = sanitizeFileAttachment({
      type: 'file',
      fileId: 'file-txtCap1',
      name: 'notes.txt',
      mimeType: 'text/plain',
      size: 12,
    })
    assert.equal(withCaption?.fileId, 'file-txtCap1')
    assert.equal(withCaption?.mimeType, 'text/plain')

    const multi = sanitizeMultimodalMessages([
      { role: 'user', content: 'prima' },
      { role: 'assistant', content: 'ok' },
      {
        role: 'user',
        content: 'Riassumilo',
        attachments: [
          {
            type: 'file',
            fileId: 'file-txtFollow1',
            name: 'notes.txt',
            mimeType: 'text/plain',
            size: 12,
          },
        ],
      },
      { role: 'assistant', content: 'Riassunto…' },
      { role: 'user', content: 'Qual è il punto più importante?' },
    ])
    assert.equal(multi.ok, true)
    const fileMsg = multi.messages.find((m) => m.attachments?.some((a) => a.type === 'file'))
    assert.equal(fileMsg.attachments[0].fileId, 'file-txtFollow1')

    // Regenerate path: same sanitize keeps mime + fileId (no PDF hardcode)
    const ctx = read('src/context/ChatContext.tsx')
    assert.match(ctx, /mimeType: a\.mimeType/)
    assert.doesNotMatch(ctx, /mimeType: 'application\/pdf' as const/)
    assert.match(ctx, /regenerateAssistant/)
    assert.match(ctx, /toApiMessages\(kept\)/)
  })

  it('U/V/W/X/Y — DOCX rejects fake ZIP / corrupt / .doc / .docm / oversized', () => {
    assert.equal(bufferLooksLikeZip(makeFakeZipBuffer()), true)
    assert.equal(bufferLooksLikeDocx(makeFakeZipBuffer()), false)

    const fake = validateDocxBuffer(makeFakeZipBuffer(), 'doc.docx', SERVER_DOCX_MIME)
    assert.equal(fake.ok, false)
    assert.equal(fake.code, 'invalid_docx')
    assert.match(fake.error, /DOCX non valido/)

    const corrupt = validateDocumentBuffer(Buffer.from('not-zip'), 'a.docx', SERVER_DOCX_MIME)
    assert.equal(corrupt.ok, false)

    const doc = validateDocumentBuffer(Buffer.from('legacy'), 'report.doc', 'application/msword')
    assert.equal(doc.ok, false)
    assert.equal(doc.code, 'unsupported_word')
    assert.match(doc.error, /\.doc non sono ancora supportati/)

    const docm = validateDocumentBuffer(Buffer.from('macro'), 'report.docm', SERVER_DOCX_MIME)
    assert.equal(docm.ok, false)
    assert.equal(docm.code, 'unsupported_word')
    assert.match(docm.error, /\.docm non sono supportati/)

    const big = Buffer.concat([makeDocxLikeBuffer(), Buffer.alloc(SERVER_MAX_DOCX_BYTES)])
    const tooBig = validateDocxBuffer(big, 'big.docx', SERVER_DOCX_MIME)
    assert.equal(tooBig.ok, false)
    assert.equal(tooBig.code, 'too_large')
    assert.match(tooBig.error, /DOCX troppo grande/)
  })

  it('O/P — DOCX accepts OOXML sniff and maps without detail', () => {
    const buf = makeDocxLikeBuffer()
    assert.equal(bufferLooksLikeDocx(buf), true)
    const ok = validateDocxBuffer(buf, 'brief.docx', SERVER_DOCX_MIME)
    assert.equal(ok.ok, true)
    assert.equal(ok.mimeType, SERVER_DOCX_MIME)

    const octet = validateDocxBuffer(buf, 'brief.docx', 'application/octet-stream')
    assert.equal(octet.ok, true)

    const hist = [
      {
        role: 'user',
        content: 'Spiegamelo',
        attachments: [
          {
            type: 'file',
            fileId: 'file-docxXYZ1',
            name: 'brief.docx',
            mimeType: SERVER_DOCX_MIME,
            size: buf.length,
          },
        ],
      },
    ]
    const mapped = mapMessagesToResponsesInput(hist)
    const file = mapped.at(-1).content.find((p) => p.type === 'input_file')
    assert.deepEqual(file, {
      type: 'input_file',
      file_id: 'file-docxXYZ1',
    })
    assert.equal(Object.prototype.hasOwnProperty.call(file, 'detail'), false)
    assert.equal(Object.prototype.hasOwnProperty.call(file, 'filename'), false)
  })

  it('Q/R/S/T — DOCX sticky IT + caption + fileId preserved', () => {
    const itHist = [
      { role: 'user', content: 'Ciao, rispondi sempre in italiano.' },
      { role: 'assistant', content: 'Va bene, resto in italiano.' },
      {
        role: 'user',
        content: '',
        attachments: [
          {
            type: 'file',
            fileId: 'file-docxIT1',
            name: 'english.docx',
            mimeType: SERVER_DOCX_MIME,
            size: 100,
          },
        ],
      },
    ]
    const plan = buildLanguageAwarenessPlan({
      userMessage: '',
      messages: itHist.map((m) => ({ role: m.role, content: m.content })),
    })
    assert.equal(plan.replyLanguage, 'it')
    assert.equal(visibleUserText(itHist.at(-1)), '')

    const capped = sanitizeFileAttachment({
      type: 'file',
      fileId: 'file-docxCap1',
      name: 'brief.docx',
      mimeType: SERVER_DOCX_MIME,
      size: 100,
    })
    assert.equal(capped?.mimeType, SERVER_DOCX_MIME)
    assert.equal(capped?.fileId, 'file-docxCap1')
  })

  it('Z — image XOR document still enforced', () => {
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
            name: 'a.txt',
            mimeType: 'text/plain',
            size: 10,
          },
        ],
      },
    ])
    assert.equal(mixed.ok, false)
  })

  it('AA — history cap 2 across mixed PDF/TXT/DOCX', () => {
    const msgs = [
      {
        role: 'user',
        content: 'p1',
        attachments: [
          { type: 'file', fileId: 'file-pdf1', name: 'a.pdf', mimeType: SERVER_PDF_MIME, size: 10 },
        ],
      },
      { role: 'assistant', content: 'ok' },
      {
        role: 'user',
        content: 't1',
        attachments: [
          { type: 'file', fileId: 'file-txt1', name: 'a.txt', mimeType: SERVER_TXT_MIME, size: 10 },
        ],
      },
      { role: 'assistant', content: 'ok' },
      {
        role: 'user',
        content: 'd1',
        attachments: [
          {
            type: 'file',
            fileId: 'file-docx1',
            name: 'a.docx',
            mimeType: SERVER_DOCX_MIME,
            size: 10,
          },
        ],
      },
    ]
    const limited = applyRecentAttachmentHistoryLimit(msgs)
    const fileTurns = limited.filter((m) => m.attachments?.some((a) => a.type === 'file'))
    assert.equal(fileTurns.length, 2)
    assert.equal(fileTurns[0].attachments[0].fileId, 'file-txt1')
    assert.equal(fileTurns[1].attachments[0].fileId, 'file-docx1')
    // Oldest PDF turn degraded to caption-only
    assert.equal(limited[0].content, 'p1')
    assert.equal(limited[0].attachments, undefined)
  })

  it('AB/AC — Memory / LANGUAGE see caption only; document-only skips extraction gate', () => {
    const chat = read('api/chat.ts')
    assert.match(chat, /visibleUserText\(lastUserMessage\)/)
    assert.match(chat, /lastUserCaption/)
    assert.match(chat, /Image-only \/ PDF-only turns \(empty caption\) skip durable extraction/)
    assert.match(chat, /if \(lastUserCaption && !skipExtractionForInspection\)/)
    assert.match(chat, /toTextOnlyMessages/)
    assert.doesNotMatch(chat, /file_data|extractedText|docxText|txtContents/)
  })

  it('AD — logs never include document bytes/contents', () => {
    const apiFiles = read('api/files.ts')
    assert.match(apiFiles, /summarizePdfForLog/)
    assert.doesNotMatch(apiFiles, /buffer\.toString|file_data|base64/)
    const chat = read('api/chat.ts')
    assert.match(chat, /summarizePdfForLog/)
    assert.doesNotMatch(chat, /attachments:.*buffer/)
  })

  it('AE–AO / AP–AS — dictation / vision / image / scroll / core invariants', () => {
    const shell = read('src/components/chat/ComposerShell.tsx')
    const vision = read('src/pages/Vision.tsx')
    const autoScroll = read('src/components/chat/AutoScrollController.ts')
    const apiChat = read('api/chat.ts')
    const coreParams = read('lib/server/core-responses-params.js')
    const pkg = read('package.json')

    assert.match(shell, /composerDraftCanSend/)
    assert.match(shell, /showMic/)
    assert.match(shell, /uploadDocumentAttachment/)
    assert.match(shell, /documentBadgeFor/)
    assert.match(vision, /prepareImageAttachment/)
    assert.doesNotMatch(vision, /uploadDocumentAttachment|input_file/)
    assert.doesNotMatch(autoScroll, /input_file|fileId|DOCX|TXT/)
    assert.equal((apiChat.match(/\.responses\.create\(/g) || []).length, 1)
    assert.match(apiChat, /maxDuration:\s*120/)
    assert.match(coreParams, /effort:\s*['"]none['"]/)
    assert.doesNotMatch(pkg, /"mammoth"|"jszip"|"pdf-parse"|"pdfjs"/)
  })

  it('B — PDF file_id-only mapping still protected (no filename with file_id)', () => {
    const mapped = mapMessagesToResponsesInput([
      {
        role: 'user',
        content: 'x',
        attachments: [
          {
            type: 'file',
            fileId: 'file-pdfOnly1',
            name: 'report.pdf',
            mimeType: SERVER_PDF_MIME,
            size: 10,
          },
        ],
      },
    ])
    const file = mapped[0].content.find((p) => p.type === 'input_file')
    assert.deepEqual(file, {
      type: 'input_file',
      file_id: 'file-pdfOnly1',
      detail: 'low',
    })
  })
})
