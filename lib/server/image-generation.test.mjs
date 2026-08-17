/**
 * #289 image generation tool helpers
 * Run: node lib/server/image-generation.test.mjs
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import {
  MAX_GENERATED_IMAGES_PER_TURN,
  buildImageGenerationAppendix,
  buildImageGenerationTools,
  contentClaimsImageWithoutPayload,
  mimeTypeForGeneratedImage,
  modelSupportsImageGenerationTool,
  parseImageGenerationCalls,
  toChatApiImages,
} from './image-generation.js'
import { buildCoreResponsesCreateParams } from './core-responses-params.js'
import {
  collectPriorImagesForEditContext,
  mapMessagesToResponsesInput,
  sanitizeMultimodalMessages,
} from './chat-image-input.js'

const tinyPngB64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const tinyJpeg =
  'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGfAP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAQUCf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQMBAT8Bf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQIBAT8Bf//Z'

const root = path.dirname(fileURLToPath(import.meta.url))

// --- model gate ---
assert.equal(modelSupportsImageGenerationTool('gpt-5.6-sol'), true)
assert.equal(modelSupportsImageGenerationTool('gpt-5.6'), true)
assert.equal(modelSupportsImageGenerationTool('gpt-4o'), false)
assert.equal(modelSupportsImageGenerationTool('gpt-5.4'), false)
assert.equal(buildImageGenerationTools('gpt-4o').length, 0)
assert.equal(buildImageGenerationTools('gpt-5.6-sol').length, 1)
assert.equal(buildImageGenerationTools('gpt-5.6-sol')[0].type, 'image_generation')
assert.equal(buildImageGenerationTools('gpt-5.6-sol')[0].quality, 'low')

// --- tools + reasoning.none coexist ---
{
  const tools = buildImageGenerationTools('gpt-5.6-sol')
  const params = buildCoreResponsesCreateParams({
    model: 'gpt-5.6-sol',
    instructions: 'x',
    maxOutputTokens: 4096,
    input: [{ type: 'message', role: 'user', content: 'Genera' }],
    tools,
  })
  assert.deepEqual(params.reasoning, { effort: 'none' })
  assert.equal(params.stream, false)
  assert.equal(Array.isArray(params.tools), true)
  assert.equal(params.tools[0].type, 'image_generation')
  assert.equal('temperature' in params, false)
}

// --- parse success ---
{
  const parsed = parseImageGenerationCalls({
    output: [
      {
        type: 'image_generation_call',
        id: 'ig_1',
        status: 'completed',
        output_format: 'png',
        result: tinyPngB64,
      },
    ],
  })
  assert.equal(parsed.images.length, 1)
  assert.equal(parsed.images[0].source, 'generated')
  assert.ok(parsed.images[0].dataUrl.startsWith('data:image/png;base64,'))
  assert.equal(parsed.safetyRefused, false)
}

// --- parse edit action ---
{
  const parsed = parseImageGenerationCalls({
    output: [
      {
        type: 'image_generation_call',
        id: 'ig_edit',
        status: 'completed',
        action: 'edit',
        output_format: 'png',
        result: tinyPngB64,
      },
    ],
  })
  assert.equal(parsed.images[0].source, 'edited')
}

// --- max 1 image ---
{
  const parsed = parseImageGenerationCalls({
    output: [
      {
        type: 'image_generation_call',
        status: 'completed',
        result: tinyPngB64,
      },
      {
        type: 'image_generation_call',
        status: 'completed',
        result: tinyPngB64,
      },
    ],
  })
  assert.equal(MAX_GENERATED_IMAGES_PER_TURN, 1)
  assert.equal(parsed.images.length, 1)
}

// --- empty / malformed ---
{
  const empty = parseImageGenerationCalls({
    output: [{ type: 'image_generation_call', status: 'completed', result: '' }],
  })
  assert.equal(empty.images.length, 0)
  assert.equal(empty.technicalFailure, true)

  const refused = parseImageGenerationCalls({
    output: [
      {
        type: 'image_generation_call',
        status: 'failed',
        error: 'safety policy blocked',
      },
    ],
  })
  assert.equal(refused.images.length, 0)
  assert.equal(refused.safetyRefused, true)
}

// --- toChatApiImages omits revised_prompt ---
{
  const wire = toChatApiImages([
    {
      id: 'x',
      mimeType: 'image/png',
      dataUrl: `data:image/png;base64,${tinyPngB64}`,
      source: 'generated',
      providerCallId: 'ig_1',
    },
  ])
  assert.equal('revised_prompt' in wire[0], false)
  assert.equal(wire[0].source, 'generated')
}

assert.equal(mimeTypeForGeneratedImage('jpeg'), 'image/jpeg')
assert.equal(mimeTypeForGeneratedImage('png'), 'image/png')

assert.equal(contentClaimsImageWithoutPayload('Ho creato un’immagine di Saturno.', 0), true)
assert.equal(contentClaimsImageWithoutPayload('Ho creato un’immagine di Saturno.', 1), false)
assert.equal(contentClaimsImageWithoutPayload('Ecco una descrizione.', 0), false)

// --- appendix LANGUAGE isolation ---
{
  const appendix = buildImageGenerationAppendix()
  assert.match(appendix, /LANGUAGE/)
  assert.match(appendix, /revised_prompt/)
  assert.match(appendix, /Memory/)
  assert.match(appendix, /not a second conversational brain/)
}

// --- assistant generated attachment allowed; spoof without source rejected ---
{
  const ok = sanitizeMultimodalMessages([
    {
      role: 'assistant',
      content: 'Logo',
      attachments: [
        {
          type: 'image',
          mimeType: 'image/jpeg',
          dataUrl: tinyJpeg,
          source: 'generated',
        },
      ],
    },
  ])
  assert.equal(ok.ok, true)
  assert.equal(ok.messages[0].attachments?.[0].source, 'generated')

  const spoof = sanitizeMultimodalMessages([
    {
      role: 'assistant',
      content: 'Logo',
      attachments: [{ type: 'image', mimeType: 'image/jpeg', dataUrl: tinyJpeg }],
    },
  ])
  assert.equal(spoof.ok, false)
  assert.equal(spoof.code, 'assistant_image_forbidden')

  const legacyForbid = sanitizeMultimodalMessages([
    {
      role: 'assistant',
      content: 'hi',
      attachments: [{ type: 'file', fileId: 'file-abc', name: 'a.pdf', mimeType: 'application/pdf', size: 10 }],
    },
  ])
  assert.equal(legacyForbid.ok, false)
  assert.equal(legacyForbid.code, 'image_role_forbidden')
}

// --- edit context: prior assistant image injected on follow-up user turn ---
{
  const hist = [
    { role: 'user', content: 'Genera un logo' },
    {
      role: 'assistant',
      content: 'Ecco',
      attachments: [
        { type: 'image', mimeType: 'image/jpeg', dataUrl: tinyJpeg, source: 'generated' },
      ],
    },
    { role: 'user', content: 'Rendilo più scuro' },
  ]
  const sanitized = sanitizeMultimodalMessages(hist)
  assert.equal(sanitized.ok, true)
  const mapped = mapMessagesToResponsesInput(sanitized.messages)
  const last = mapped.at(-1)
  assert.equal(last.role, 'user')
  assert.ok(Array.isArray(last.content))
  assert.equal(last.content[0].text, 'Rendilo più scuro')
  assert.equal(last.content[1].type, 'input_image')
  assert.equal(last.content[1].image_url, tinyJpeg)

  const prior = collectPriorImagesForEditContext(sanitized.messages, sanitized.messages.length - 1)
  assert.equal(prior.length, 1)
}

// --- api/chat invariants ---
{
  const chatSrc = readFileSync(path.join(root, '../../api/chat.ts'), 'utf8')
  const createCalls = chatSrc.match(/\.responses\.create\s*\(/g) || []
  assert.equal(createCalls.length, 1, 'W — one conversational responses.create')
  assert.match(chatSrc, /buildImageGenerationTools/)
  assert.match(chatSrc, /parseImageGenerationCalls/)
  assert.match(chatSrc, /maxDuration:\s*120/)
  assert.match(chatSrc, /reasoning/)
  assert.doesNotMatch(chatSrc, /Images\.generate|images\.generate/)
  assert.match(chatSrc, /images\.length > 0/)
}

console.log('ok: image-generation #289 helpers')
