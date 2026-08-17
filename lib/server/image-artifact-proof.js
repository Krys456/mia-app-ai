/**
 * #289 session-only generated-image artifact proof.
 *
 * No Storage/DB: HMAC over (id|source|sha256(dataUrl)) with a server secret.
 * Clients can replay legitimate server-issued images; they cannot forge proof
 * for arbitrary assistant dataUrls. `source` alone is NEVER a trust boundary.
 */

import crypto from 'node:crypto'

/** Generated/edited dataUrls may exceed the user-upload 1.5MB cap (tool PNGs ~4MB). */
export const SERVER_MAX_GENERATED_DATA_URL_CHARS = 8 * 1024 * 1024

/**
 * @param {NodeJS.ProcessEnv} [env]
 */
export function resolveImageArtifactSecret(env = process.env) {
  const dedicated =
    typeof env.LAIFE_IMAGE_ARTIFACT_SECRET === 'string'
      ? env.LAIFE_IMAGE_ARTIFACT_SECRET.trim()
      : ''
  if (dedicated) return dedicated
  // Fallback: OPENAI_API_KEY is always present on the chat path; proof is
  // session-scoped replay only (not a durable public URL).
  const apiKey = typeof env.OPENAI_API_KEY === 'string' ? env.OPENAI_API_KEY.trim() : ''
  return apiKey
}

/**
 * @param {string} dataUrl
 */
export function hashImageDataUrl(dataUrl) {
  return crypto.createHash('sha256').update(String(dataUrl || ''), 'utf8').digest('hex')
}

/**
 * @param {{
 *   id: string
 *   source: 'generated' | 'edited'
 *   dataUrl: string
 * }} artifact
 * @param {string} secret
 */
export function signImageArtifact(artifact, secret) {
  const id = String(artifact?.id || '').trim()
  const source = artifact?.source === 'edited' ? 'edited' : artifact?.source === 'generated' ? 'generated' : ''
  const dataUrl = typeof artifact?.dataUrl === 'string' ? artifact.dataUrl : ''
  if (!secret || !id || !source || !dataUrl) return ''
  const payload = `${id}|${source}|${hashImageDataUrl(dataUrl)}`
  return crypto.createHmac('sha256', secret).update(payload, 'utf8').digest('hex')
}

/**
 * Timing-safe verify of a client-replayed generated/edited image.
 * @param {{
 *   id?: unknown
 *   source?: unknown
 *   dataUrl?: unknown
 *   artifactProof?: unknown
 * }} artifact
 * @param {string} secret
 */
export function verifyImageArtifact(artifact, secret) {
  const id = typeof artifact?.id === 'string' ? artifact.id.trim() : ''
  const source =
    artifact?.source === 'edited'
      ? 'edited'
      : artifact?.source === 'generated'
        ? 'generated'
        : ''
  const dataUrl = typeof artifact?.dataUrl === 'string' ? artifact.dataUrl : ''
  const proof = typeof artifact?.artifactProof === 'string' ? artifact.artifactProof.trim() : ''
  if (!secret || !id || !source || !dataUrl || !proof) return false
  const expected = signImageArtifact({ id, source, dataUrl }, secret)
  if (!expected || expected.length !== proof.length) return false
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(proof, 'utf8'))
  } catch {
    return false
  }
}

/**
 * Attach proof to wire images[] (mutates copies only).
 * @param {Array<Record<string, unknown>>} images
 * @param {string} [secret]
 */
export function sealChatApiImages(images, secret = resolveImageArtifactSecret()) {
  if (!Array.isArray(images) || !secret) return images
  return images.map((img) => {
    if (!img || typeof img !== 'object') return img
    const id = typeof img.id === 'string' ? img.id : ''
    const source = img.source === 'edited' ? 'edited' : img.source === 'generated' ? 'generated' : null
    const dataUrl = typeof img.dataUrl === 'string' ? img.dataUrl : ''
    if (!id || !source || !dataUrl) return img
    const artifactProof = signImageArtifact({ id, source, dataUrl }, secret)
    return artifactProof ? { ...img, artifactProof } : img
  })
}
