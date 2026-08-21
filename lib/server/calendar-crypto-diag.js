/**
 * #336B TEMPORARY — Safe calendar encryption key fingerprints only.
 * REMOVE BEFORE MERGE. Never logs or returns secret material.
 */

import { createHash } from 'node:crypto'
import { parseEncryptionKey } from './calendar-token-crypto.js'

export const CALENDAR_ENCRYPTION_ENV_NAME = 'SHINKAIDO_CALENDAR_ENCRYPTION_KEY'

/**
 * @param {string} text
 */
function stringFingerprint12(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 12)
}

/**
 * @param {Uint8Array} bytes
 */
function effectiveFingerprint12(bytes) {
  return createHash('sha256').update(Buffer.from(bytes)).digest('hex').slice(0, 12)
}

/**
 * Safe metadata for live Preview/Edge key comparison.
 * @param {Record<string, string | undefined> | NodeJS.ProcessEnv} [env]
 * @returns {{
 *   exists: boolean,
 *   trimmedLength: number,
 *   stringFingerprint12: string | null,
 *   parseOk: boolean,
 *   effectiveByteLength: number | null,
 *   effectiveFingerprint12: string | null,
 * }}
 */
export function buildCalendarCryptoDiag(env = process.env) {
  const raw = env?.[CALENDAR_ENCRYPTION_ENV_NAME]
  const exists = typeof raw === 'string' && raw.length > 0
  const trimmed = exists ? String(raw).trim() : ''
  const stringFp = exists ? stringFingerprint12(trimmed) : null
  const parsed = parseEncryptionKey(trimmed)
  if (!parsed.ok) {
    return {
      exists,
      trimmedLength: trimmed.length,
      stringFingerprint12: stringFp,
      parseOk: false,
      effectiveByteLength: null,
      effectiveFingerprint12: null,
    }
  }
  return {
    exists,
    trimmedLength: trimmed.length,
    stringFingerprint12: stringFp,
    parseOk: true,
    effectiveByteLength: parsed.key.length,
    effectiveFingerprint12: effectiveFingerprint12(parsed.key),
  }
}
