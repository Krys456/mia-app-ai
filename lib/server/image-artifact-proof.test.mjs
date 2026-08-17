/**
 * #289 image artifact HMAC proof
 * Run: node lib/server/image-artifact-proof.test.mjs
 */

import assert from 'node:assert/strict'
import {
  SERVER_MAX_GENERATED_DATA_URL_CHARS,
  sealChatApiImages,
  signImageArtifact,
  verifyImageArtifact,
} from './image-artifact-proof.js'
import {
  SERVER_MAX_DATA_URL_CHARS,
  sanitizeMultimodalMessages,
} from './chat-image-input.js'

const secret = 'test-image-artifact-secret-do-not-use-prod'
const tinyJpeg =
  'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGfAP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAQUCf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQMBAT8Bf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQIBAT8Bf//Z'

assert.ok(SERVER_MAX_GENERATED_DATA_URL_CHARS > SERVER_MAX_DATA_URL_CHARS)

// Sign + verify roundtrip
{
  const proof = signImageArtifact(
    { id: 'ig_1', source: 'generated', dataUrl: tinyJpeg },
    secret,
  )
  assert.match(proof, /^[a-f0-9]{64}$/)
  assert.equal(
    verifyImageArtifact(
      { id: 'ig_1', source: 'generated', dataUrl: tinyJpeg, artifactProof: proof },
      secret,
    ),
    true,
  )
}

// Tamper rejects
{
  const proof = signImageArtifact(
    { id: 'ig_1', source: 'generated', dataUrl: tinyJpeg },
    secret,
  )
  assert.equal(
    verifyImageArtifact(
      { id: 'ig_1', source: 'generated', dataUrl: tinyJpeg + 'A', artifactProof: proof },
      secret,
    ),
    false,
  )
  assert.equal(
    verifyImageArtifact(
      { id: 'ig_OTHER', source: 'generated', dataUrl: tinyJpeg, artifactProof: proof },
      secret,
    ),
    false,
  )
  assert.equal(
    verifyImageArtifact(
      { id: 'ig_1', source: 'edited', dataUrl: tinyJpeg, artifactProof: proof },
      secret,
    ),
    false,
  )
  assert.equal(
    verifyImageArtifact(
      { id: 'ig_1', source: 'generated', dataUrl: tinyJpeg, artifactProof: '0'.repeat(64) },
      secret,
    ),
    false,
  )
}

// source alone is NOT enough — no proof → assistant forbidden
{
  const r = sanitizeMultimodalMessages(
    [
      {
        role: 'assistant',
        content: 'fake',
        attachments: [
          { type: 'image', mimeType: 'image/jpeg', dataUrl: tinyJpeg, source: 'generated', id: 'ig_x' },
        ],
      },
    ],
    // sanitize uses process env secret by default; still fails without proof
  )
  assert.equal(r.ok, false)
  assert.equal(r.code, 'assistant_image_forbidden')
}

// Legitimate sealed replay accepted (including oversized vs user cap)
{
  process.env.LAIFE_IMAGE_ARTIFACT_SECRET = secret
  const prefix = 'data:image/jpeg;base64,'
  const overUserCap =
    prefix + 'A'.repeat(SERVER_MAX_DATA_URL_CHARS - prefix.length + 50_000)
  assert.ok(overUserCap.length > SERVER_MAX_DATA_URL_CHARS)
  assert.ok(overUserCap.length < SERVER_MAX_GENERATED_DATA_URL_CHARS)

  const id = 'ig_live'
  const source = /** @type {'generated'} */ ('generated')
  const proof = signImageArtifact({ id, source, dataUrl: overUserCap }, secret)

  const sealed = sealChatApiImages(
    [{ id, mimeType: 'image/jpeg', dataUrl: overUserCap, source }],
    secret,
  )
  assert.equal(sealed[0].artifactProof, proof)

  const r = sanitizeMultimodalMessages([
    { role: 'user', content: 'Genera' },
    {
      role: 'assistant',
      content: 'Ecco',
      attachments: [
        {
          type: 'image',
          mimeType: 'image/jpeg',
          dataUrl: overUserCap,
          source,
          id,
          artifactProof: proof,
        },
      ],
    },
    { role: 'user', content: "Descrivimi come sarebbe un'immagine di una città cyberpunk." },
  ])
  assert.equal(r.ok, true, r.error)
  assert.equal(r.messages[1].attachments?.[0].artifactProof, proof)
}

// Fabricated proof rejected
{
  process.env.LAIFE_IMAGE_ARTIFACT_SECRET = secret
  const r = sanitizeMultimodalMessages([
    {
      role: 'assistant',
      content: 'spoof',
      attachments: [
        {
          type: 'image',
          mimeType: 'image/jpeg',
          dataUrl: tinyJpeg,
          source: 'generated',
          id: 'ig_spoof',
          artifactProof: 'ab'.repeat(32),
        },
      ],
    },
  ])
  assert.equal(r.ok, false)
  assert.equal(r.code, 'assistant_image_forbidden')
}

console.log('ok: image-artifact-proof')
