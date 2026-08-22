/**
 * #337B — Deno shared: AES-256-GCM token encryption (Edge only).
 * Mirrors supabase/functions/_shared/calendar-token-crypto.ts — keep algorithms in sync.
 *
 * Runtime key env (passed by callers): SHINKAIDO_EMAIL_ENCRYPTION_KEY
 * (32 raw bytes as base64/base64url or 64-char hex). Never log key material.
 *
 * NOTE: the old #311 draft used EMAIL_TOKEN_ENCRYPTION_KEY — that name is
 * retired. This module never reads env vars itself; callers must pass
 * SHINKAIDO_EMAIL_ENCRYPTION_KEY explicitly as `keyEnv`.
 */

const VERSION = 'v1'
const IV_BYTES = 12
const TAG_BYTES = 16
const KEY_BYTES = 32

function toB64Url(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i])
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function fromB64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/')
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4))
  const bin = atob(b64 + pad)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i)
  return out
}

export type KeyParseResult = { ok: true; key: Uint8Array } | { ok: false; code: string }

export function parseEncryptionKey(raw: string | null | undefined): KeyParseResult {
  const value = typeof raw === 'string' ? raw.trim() : ''
  if (!value) return { ok: false, code: 'encryption_key_missing' }
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

async function importAesKey(keyBytes: Uint8Array) {
  return crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ])
}

export async function encryptToken(
  plaintext: string,
  keyEnv: string | null | undefined,
): Promise<{ ok: true; ciphertext: string } | { ok: false; code: string }> {
  if (typeof plaintext !== 'string' || plaintext.length === 0) {
    return { ok: false, code: 'plaintext_empty' }
  }
  const parsed = parseEncryptionKey(keyEnv)
  if (!parsed.ok) return parsed
  try {
    const iv = new Uint8Array(IV_BYTES)
    crypto.getRandomValues(iv)
    const key = await importAesKey(parsed.key)
    const encoded = new TextEncoder().encode(plaintext)
    const sealed = new Uint8Array(
      await crypto.subtle.encrypt({ name: 'AES-GCM', iv, tagLength: 128 }, key, encoded),
    )
    if (sealed.length < TAG_BYTES) return { ok: false, code: 'encrypt_failed' }
    const ct = sealed.slice(0, sealed.length - TAG_BYTES)
    const tag = sealed.slice(sealed.length - TAG_BYTES)
    return {
      ok: true,
      ciphertext: `${VERSION}.${toB64Url(iv)}.${toB64Url(ct)}.${toB64Url(tag)}`,
    }
  } catch {
    return { ok: false, code: 'encrypt_failed' }
  }
}

export async function decryptToken(
  ciphertext: string,
  keyEnv: string | null | undefined,
): Promise<{ ok: true; plaintext: string } | { ok: false; code: string }> {
  if (typeof ciphertext !== 'string' || !ciphertext.trim()) {
    return { ok: false, code: 'ciphertext_empty' }
  }
  const parts = ciphertext.trim().split('.')
  if (parts.length !== 4 || parts[0] !== VERSION) {
    return { ok: false, code: 'ciphertext_format_invalid' }
  }
  const parsed = parseEncryptionKey(keyEnv)
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
    const plainBuf = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, tagLength: 128 },
      key,
      combined,
    )
    return { ok: true, plaintext: new TextDecoder().decode(plainBuf) }
  } catch {
    return { ok: false, code: 'decrypt_failed' }
  }
}

export function redactTokenFields(fields: Record<string, unknown>): Record<string, unknown> {
  const forbidden =
    /token|secret|cipher|verifier|refresh|access_token|authorization|password|key_material|subject|snippet|body/i
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(fields || {})) {
    out[k] = forbidden.test(k) ? '[redacted]' : v
  }
  return out
}

export const EMAIL_TOKEN_CIPHER_VERSION = VERSION
