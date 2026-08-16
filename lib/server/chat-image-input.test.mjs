/**
 * #272 multimodal image sanitization / Responses mapping / log redaction
 * Run: node lib/server/chat-image-input.test.mjs
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  IMAGE_ONLY_MODEL_NUDGE,
  SERVER_MAX_RECENT_IMAGE_TURNS,
  applyRecentImageHistoryLimit,
  mapMessagesToResponsesInput,
  modelSupportsImageInput,
  redactAttachmentsForLog,
  sanitizeImageAttachment,
  sanitizeMultimodalMessages,
  summarizeImageForLog,
  visibleUserText,
} from './chat-image-input.js'
import {
  buildCoreLanguageAppendix,
  buildLanguageAwarenessPlan,
} from './language-awareness.js'

const tinyJpeg =
  'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGfAP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAQUCf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQMBAT8Bf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQIBAT8Bf//Z'

function imgAtt(overrides = {}) {
  return {
    type: 'image',
    mimeType: 'image/jpeg',
    dataUrl: tinyJpeg,
    ...overrides,
  }
}

// --- sanitize: text-only unchanged ---
{
  const r = sanitizeMultimodalMessages([
    { role: 'user', content: 'Ciao' },
    { role: 'assistant', content: 'Ciao!' },
  ])
  assert.equal(r.ok, true)
  assert.deepEqual(r.messages, [
    { role: 'user', content: 'Ciao' },
    { role: 'assistant', content: 'Ciao!' },
  ])
}

// --- valid image + Italian caption ---
{
  const r = sanitizeMultimodalMessages([
    {
      role: 'user',
      content: 'Che cos’è?',
      attachments: [imgAtt()],
    },
  ])
  assert.equal(r.ok, true)
  assert.equal(r.messages[0].content, 'Che cos’è?')
  assert.equal(r.messages[0].attachments?.length, 1)
  assert.equal(r.messages[0].attachments[0].mimeType, 'image/jpeg')
}

// --- image-only (empty caption) ---
{
  const r = sanitizeMultimodalMessages([
    { role: 'user', content: '', attachments: [imgAtt()] },
  ])
  assert.equal(r.ok, true)
  assert.equal(r.messages[0].content, '')
  assert.equal(r.messages[0].attachments?.length, 1)
}

// --- unsupported MIME rejected ---
{
  const r = sanitizeMultimodalMessages([
    {
      role: 'user',
      content: 'x',
      attachments: [
        {
          type: 'image',
          mimeType: 'image/gif',
          dataUrl: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
        },
      ],
    },
  ])
  assert.equal(r.ok, false)
  assert.equal(r.code, 'unsupported_mime')
}

// --- unknown attachment type rejected ---
{
  const r = sanitizeMultimodalMessages([
    {
      role: 'user',
      content: 'x',
      attachments: [{ type: 'file', mimeType: 'application/pdf', dataUrl: 'data:application/pdf;base64,aaa' }],
    },
  ])
  assert.equal(r.ok, false)
  assert.equal(r.code, 'unsupported_attachment_type')
}

// --- >1 image rejected ---
{
  const r = sanitizeMultimodalMessages([
    {
      role: 'user',
      content: 'x',
      attachments: [imgAtt(), imgAtt()],
    },
  ])
  assert.equal(r.ok, false)
  assert.equal(r.code, 'too_many_images')
}

// --- oversized data URL rejected ---
{
  const huge = `data:image/jpeg;base64,${'A'.repeat(2 * 1024 * 1024)}`
  const r = sanitizeMultimodalMessages([
    { role: 'user', content: 'x', attachments: [imgAtt({ dataUrl: huge })] },
  ])
  assert.equal(r.ok, false)
  assert.match(r.code, /image_too_large|invalid_image/)
}

// --- assistant cannot carry images ---
{
  const r = sanitizeMultimodalMessages([
    { role: 'assistant', content: 'hi', attachments: [imgAtt()] },
  ])
  assert.equal(r.ok, false)
  assert.equal(r.code, 'image_role_forbidden')
}

// --- Responses mapping: caption + image ---
{
  const mapped = mapMessagesToResponsesInput([
    {
      role: 'user',
      content: 'Che cos’è?',
      attachments: [imgAtt()],
    },
  ])
  assert.equal(mapped.length, 1)
  assert.equal(mapped[0].role, 'user')
  assert.ok(Array.isArray(mapped[0].content))
  assert.deepEqual(mapped[0].content[0], { type: 'input_text', text: 'Che cos’è?' })
  assert.equal(mapped[0].content[1].type, 'input_image')
  assert.equal(mapped[0].content[1].detail, 'high')
  assert.equal(mapped[0].content[1].image_url, tinyJpeg)
}

// --- image-only: model nudge is SERVER-ONLY (not visibleUserText) ---
{
  const msg = { role: 'user', content: '', attachments: [imgAtt()] }
  assert.equal(visibleUserText(msg), '')
  const mapped = mapMessagesToResponsesInput([msg])
  assert.equal(mapped[0].content[0].text, IMAGE_ONLY_MODEL_NUDGE)
  assert.equal(mapped[0].content[1].type, 'input_image')
}

// --- #272 I: IMAGE_ONLY_MODEL_NUDGE never reaches language detector / planner ---
{
  const itHist = [
    { role: 'user', content: 'Ciao, parliamo in italiano.' },
    { role: 'assistant', content: 'Certo!' },
    { role: 'user', content: 'Dimmi qualcosa sulla fotografia.' },
    { role: 'assistant', content: 'La luce naturale aiuta i ritratti.' },
    { role: 'user', content: '', attachments: [imgAtt()] },
  ]
  const sanitized = sanitizeMultimodalMessages(itHist)
  assert.equal(sanitized.ok, true)
  const latest = sanitized.messages.at(-1)
  const caption = visibleUserText(latest)
  assert.equal(caption, '')
  assert.notEqual(caption, IMAGE_ONLY_MODEL_NUDGE)
  const plan = buildLanguageAwarenessPlan({
    userMessage: caption,
    messages: sanitized.messages.map((m) => ({ role: m.role, content: m.content })),
  })
  assert.equal(plan.replyLanguage, 'it', '#272 I sticky it with empty caption')
  assert.ok(!JSON.stringify(plan).includes(IMAGE_ONLY_MODEL_NUDGE), '#272 I nudge absent from plan')
  const appendix = buildCoreLanguageAppendix({
    userMessage: caption,
    messages: sanitized.messages.map((m) => ({ role: m.role, content: m.content })),
  })
  assert.ok(!appendix.includes(IMAGE_ONLY_MODEL_NUDGE), '#272 I nudge absent from appendix')
  assert.ok(appendix.includes('response language: it'), '#272 I appendix asserts it')
}

// --- #272 J: image-only still skips durable Memory extraction (api wiring) ---
{
  const apiChat = fs.readFileSync(path.join(process.cwd(), 'api/chat.ts'), 'utf8')
  assert.match(apiChat, /!lastUserCaption/)
  assert.match(apiChat, /runMemoryIfEnabled\(\s*lastUserCaption/)
  // Extraction gated on caption presence
  assert.match(apiChat, /if \(lastUserCaption && !skipExtractionForInspection\)/)
}

// --- text-only path stays string content ---
{
  const mapped = mapMessagesToResponsesInput([
    { role: 'user', content: 'solo testo' },
    { role: 'assistant', content: 'ok' },
  ])
  assert.equal(mapped[0].content, 'solo testo')
  assert.equal(mapped[1].content, 'ok')
}

// --- recent image history limit (keep last N) ---
{
  assert.equal(SERVER_MAX_RECENT_IMAGE_TURNS, 2)
  const msgs = [
    { role: 'user', content: 'img1', attachments: [imgAtt()] },
    { role: 'assistant', content: 'a1' },
    { role: 'user', content: 'img2', attachments: [imgAtt()] },
    { role: 'assistant', content: 'a2' },
    { role: 'user', content: 'img3', attachments: [imgAtt()] },
  ]
  const limited = applyRecentImageHistoryLimit(msgs, 2)
  assert.equal(limited[0].attachments, undefined)
  assert.equal(limited[0].content, 'img1')
  assert.equal(limited[2].attachments?.length, 1)
  assert.equal(limited[4].attachments?.length, 1)

  const mapped = mapMessagesToResponsesInput(msgs)
  assert.equal(typeof mapped[0].content, 'string')
  assert.ok(Array.isArray(mapped[2].content))
  assert.ok(Array.isArray(mapped[4].content))
}

// --- model vision allowlist ---
assert.equal(modelSupportsImageInput('gpt-4o'), true)
assert.equal(modelSupportsImageInput('gpt-5.6-sol'), true)
assert.equal(modelSupportsImageInput('gpt-3.5-turbo'), false)
assert.equal(modelSupportsImageInput(''), false)

// --- log helpers never serialize image bytes ---
{
  const summary = summarizeImageForLog({
    mimeType: 'image/jpeg',
    dataUrl: tinyJpeg,
  })
  const dumped = JSON.stringify(summary)
  assert.ok(!dumped.includes(tinyJpeg))
  assert.ok(!dumped.includes('/9j/4AAQ'))
  assert.equal(summary.hasDataUrl, true)
  assert.ok(summary.dataUrlChars > 0)

  const redacted = redactAttachmentsForLog({
    role: 'user',
    content: 'Che cos’è?',
    attachments: [imgAtt()],
    nested: { image_url: tinyJpeg, previewUrl: tinyJpeg },
  })
  const redump = JSON.stringify(redacted)
  assert.ok(!redump.includes(tinyJpeg))
  assert.ok(!redump.includes('/9j/4AAQ'))
  assert.match(redump, /\[redacted/)
  assert.equal(redacted.content, 'Che cos’è?')
}

// --- sanitizeImageAttachment unit ---
assert.ok(sanitizeImageAttachment(imgAtt()))
assert.equal(sanitizeImageAttachment({ type: 'image', mimeType: 'image/png', dataUrl: 'not-a-data-url' }), null)

// --- api/chat wiring invariants ---
{
  const apiChat = fs.readFileSync(path.join(process.cwd(), 'api/chat.ts'), 'utf8')
  assert.match(apiChat, /maxDuration:\s*120/)
  assert.equal((apiChat.match(/\.responses\.create\(/g) || []).length, 1)
  assert.match(apiChat, /mapMessagesToResponsesInput\(messages\)/)
  assert.match(apiChat, /visibleUserText\(lastUserMessage\)/)
  assert.match(apiChat, /!lastUserCaption/)
  assert.match(apiChat, /image_unsupported_model/)
  assert.match(apiChat, /redactAttachmentsForLog/)
  assert.doesNotMatch(apiChat, /console\.(log|info|warn|error)\([^)]*dataUrl/)
  // Memory extraction uses caption only
  assert.match(apiChat, /runMemoryIfEnabled\(\s*lastUserCaption/)
  // Language appendix uses caption via visibleUserText
  assert.match(apiChat, /userMessage: visibleUserText\(latestUser\)/)
}

// --- GPT-5.6 Sol reasoning config unchanged ---
{
  const paramsSrc = fs.readFileSync(
    path.join(process.cwd(), 'lib/server/core-responses-params.js'),
    'utf8',
  )
  assert.match(paramsSrc, /effort:\s*['"]none['"]/)
}

console.log('ok: #272 chat-image-input sanitize / mapping / redaction')
