/**
 * #304A1 — AES-256-GCM token encryption (server / Edge only).
 *
 * Ciphertext format (versioned):
 *   v1.<iv_b64url>.<ciphertext_b64url>.<tag_b64url>
 *
 * Key: SHINKAIDO_CALENDAR_ENCRYPTION_KEY — 32 raw bytes as base64 or 64-char hex.
 * Fail closed on missing/invalid key or tampered material.
 *
 * NEVER log plaintext, ciphertext, or key material.
 */

const VERSION = 'v1'
const IV_BYTES = 12
const TAG_BYTES = 16
const KEY_BYTES = 32

/**
 * @param {string} name
 * @param {Uint8Array} bytes
 */
function toB64Url(bytes) {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i])
  const b64 =
    typeof btoa === 'function'
      ? btoa(bin)
      : Buffer.from(bytes).toString('base64')
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

/**
 * @param {string} s
 * @returns {Uint8Array}
 */
function fromB64Url(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/')
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4))
  const raw = b64 + pad
  if (typeof atob === 'function') {
    const bin = atob(raw)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i)
    return out
  }
  return new Uint8Array(Buffer.from(raw, 'base64'))
}

/**
 * Parse SHINKAIDO_CALENDAR_ENCRYPTION_KEY into 32 raw bytes.
 * @param {string | null | undefined} raw
 * @returns {{ ok: true, key: Uint8Array } | { ok: false, code: string }}
 */
export function parseEncryptionKey(raw) {
  const value = typeof raw === 'string' ? raw.trim() : ''
  if (!value) return { ok: false, code: 'encryption_key_missing' }

  // Prefer hex (64 chars) when unambiguous.
  if (/^[0-9a-fA-F]{64}$/.test(value)) {
    const key = new Uint8Array(KEY_BYTES)
    for (let i = 0; i < KEY_BYTES; i += 1) {
      key[i] = parseInt(value.slice(i * 2, i * 2 + 2), 16)
    }
    return { ok: true, key }
  }

  try {
    const decoded = fromB64Url(value)
    if (decoded.length !== KEY_BYTES) {
      return { ok: false, code: 'encryption_key_invalid_length' }
    }
    return { ok: true, key: decoded }
  } catch {
    return { ok: false, code: 'encryption_key_invalid' }
  }
}

/**
 * @param {Uint8Array} keyBytes
 */
async function importAesKey(keyBytes) {
  return globalThis.crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ])
}

/**
 * Encrypt a UTF-8 plaintext token. Fail closed.
 * @param {string} plaintext
 * @param {string | null | undefined} [keyEnv]
 * @returns {Promise<{ ok: true, ciphertext: string } | { ok: false, code: string }>}
 */
export async function encryptToken(plaintext, keyEnv = undefined) {
  if (typeof plaintext !== 'string' || plaintext.length === 0) {
    return { ok: false, code: 'plaintext_empty' }
  }
  const parsed = parseEncryptionKey(
    keyEnv !== undefined ? keyEnv : typeof process !== 'undefined' ? process.env.SHINKAIDO_CALENDAR_ENCRYPTION_KEY : '',
  )
  if (!parsed.ok) return parsed

  try {
    const iv = new Uint8Array(IV_BYTES)
    globalThis.crypto.getRandomValues(iv)
    const key = await importAesKey(parsed.key)
    const encoded = new TextEncoder().encode(plaintext)
    const sealed = new Uint8Array(
      await globalThis.crypto.subtle.encrypt({ name: 'AES-GCM', iv, tagLength: 128 }, key, encoded),
    )
    // WebCrypto appends tag to ciphertext.
    if (sealed.length < TAG_BYTES) return { ok: false, code: 'encrypt_failed' }
    const ct = sealed.slice(0, sealed.length - TAG_BYTES)
    const tag = sealed.slice(sealed.length - TAG_BYTES)
    const ciphertext = `${VERSION}.${toB64Url(iv)}.${toB64Url(ct)}.${toB64Url(tag)}`
    return { ok: true, ciphertext }
  } catch {
    return { ok: false, code: 'encrypt_failed' }
  }
}

/**
 * Decrypt versioned ciphertext. Fail closed on tamper / bad key / bad format.
 * @param {string} ciphertext
 * @param {string | null | undefined} [keyEnv]
 * @returns {Promise<{ ok: true, plaintext: string } | { ok: false, code: string }>}
 */
export async function decryptToken(ciphertext, keyEnv = undefined) {
  if (typeof ciphertext !== 'string' || !ciphertext.trim()) {
    return { ok: false, code: 'ciphertext_empty' }
  }
  const parts = ciphertext.trim().split('.')
  if (parts.length !== 4 || parts[0] !== VERSION) {
    return { ok: false, code: 'ciphertext_format_invalid' }
  }

  const parsed = parseEncryptionKey(
    keyEnv !== undefined ? keyEnv : typeof process !== 'undefined' ? process.env.SHINKAIDO_CALENDAR_ENCRYPTION_KEY : '',
  )
  if (!parsed.ok) return parsed

  try {
    const iv = fromB64Url(parts[1])
    const ct = fromB64Url(parts[2])
    const tag = fromB64Url(parts[3])
    if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES || ct.length === 0) {
      return { ok: false, code: 'ciphertext_format_invalid' }
    }
    const combined = new Uint8Array(ct.length + tag.length)
    combined.set(ct, 0)
    combined.set(tag, ct.length)
    const key = await importAesKey(parsed.key)
    const plainBuf = await globalThis.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, tagLength: 128 },
      key,
      combined,
    )
    return { ok: true, plaintext: new TextDecoder().decode(plainBuf) }
  } catch {
    return { ok: false, code: 'decrypt_failed' }
  }
}

/**
 * Redact any token-like material from a log fields object (defensive).
 * @param {Record<string, unknown>} fields
 */
export function redactTokenFields(fields) {
  const forbidden =
    /token|secret|cipher|verifier|refresh|access_token|authorization|password|key_material/i
  /** @type {Record<string, unknown>} */
  const out = {}
  for (const [k, v] of Object.entries(fields || {})) {
    if (forbidden.test(k)) {
      out[k] = '[redacted]'
      continue
    }
    out[k] = v
  }
  return out
}

export const CALENDAR_TOKEN_CIPHER_VERSION = VERSION
