/**
 * #298C — Mailto-based closed-beta support (reuses privacy contact email).
 * Never auto-attaches conversation, Memory, prompts, or files.
 */

import { PRIVACY_CONTACT_PLACEHOLDER, resolvePrivacyContactEmail } from './privacyCopy'
import { getClientBuildId } from './buildInfo'
import { shortRequestRef } from './apiError'

export function isPrivacyContactConfigured(
  email = resolvePrivacyContactEmail(),
): boolean {
  const value = String(email || '').trim()
  if (!value) return false
  if (value === PRIVACY_CONTACT_PLACEHOLDER) return false
  if (value.startsWith('[')) return false
  return value.includes('@')
}

export type BetaSupportMailtoInput = {
  surface?: string
  requestId?: string | null
  buildId?: string
  timestamp?: string
  contactEmail?: string
}

/**
 * Build a mailto URL with safe diagnostic metadata only.
 * Returns null when contact is a placeholder / unset.
 */
export function buildBetaSupportMailto(input: BetaSupportMailtoInput = {}): string | null {
  const email = (input.contactEmail ?? resolvePrivacyContactEmail()).trim()
  if (!isPrivacyContactConfigured(email)) return null

  const buildId = (input.buildId ?? getClientBuildId()).slice(0, 7)
  const surface = (input.surface || 'app').slice(0, 40)
  const ts = input.timestamp || new Date().toISOString()
  const ref = shortRequestRef(input.requestId)

  const subject = `ShinkAIdo beta — segnalazione (${surface})`
  const lines = [
    'Descrivi il problema qui sotto:',
    '',
    '',
    '---',
    'Metadati diagnostici (non includono chat, Memoria o file):',
    `Prodotto: ShinkAIdo beta`,
    `Build: ${buildId}`,
    `Superficie: ${surface}`,
    `Timestamp: ${ts}`,
  ]
  if (ref) lines.push(`Riferimento: ${ref}`)

  const body = lines.join('\n')
  return `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}
