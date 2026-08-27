/**
 * Read raw request bytes for Stripe webhook signature verification.
 *
 * #388B.1: Prefer Web Fetch `request.text()` via rawBodyFromWebRequest
 * (lib/server/web-request.js). On Vite + @vercel/node, Next.js-only
 * `api.bodyParser:false` is ignored — application/json is auto-parsed into
 * req.body and the original bytes are lost. Do NOT re-stringify parsed JSON.
 *
 * This helper remains for Node IncomingMessage test shims / legacy paths.
 *
 * @param {import('http').IncomingMessage & { body?: unknown }} req
 * @returns {Promise<Buffer>}
 */
export async function readRawBody(req) {
  if (Buffer.isBuffer(req.body)) {
    return req.body
  }
  if (typeof req.body === 'string') {
    return Buffer.from(req.body, 'utf8')
  }

  // Prefer stream when bodyParser is false (body unset / not consumed).
  if (req.readable && (req.body == null || req.body === undefined)) {
    /** @type {Buffer[]} */
    const chunks = []
    for await (const chunk of req) {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
    }
    return Buffer.concat(chunks)
  }

  // Fail closed — never JSON.stringify a parsed object for Stripe signatures.
  if (req.body && typeof req.body === 'object') {
    throw Object.assign(new Error('raw_body_unavailable'), { code: 'raw_body_unavailable' })
  }

  return Buffer.alloc(0)
}

/**
 * Parse JSON from a raw buffer (checkout/portal POST after bodyParser:false).
 * @param {Buffer} buf
 * @returns {Record<string, unknown>}
 */
export function parseJsonFromRawBody(buf) {
  if (!buf || buf.length === 0) return {}
  const text = buf.toString('utf8').trim()
  if (!text) return {}
  const parsed = JSON.parse(text)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('json_object_required')
  }
  return /** @type {Record<string, unknown>} */ (parsed)
}
