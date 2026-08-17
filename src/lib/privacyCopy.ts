/**
 * #298B — Privacy & Data disclosure copy + beta contact config.
 *
 * Product transparency for closed beta — not legal certification.
 */

/** Placeholder until VITE_PRIVACY_CONTACT_EMAIL is set for the beta. */
export const PRIVACY_CONTACT_PLACEHOLDER = '[OPERATOR EMAIL]'

/**
 * Closed-beta contact for questions / deletion requests.
 * Configure via VITE_PRIVACY_CONTACT_EMAIL (names only in .env.example).
 */
export function resolvePrivacyContactEmail(
  env: Record<string, unknown> = (import.meta as ImportMeta & { env?: Record<string, unknown> })
    .env ?? {},
): string {
  const raw =
    typeof env.VITE_PRIVACY_CONTACT_EMAIL === 'string'
      ? env.VITE_PRIVACY_CONTACT_EMAIL.trim()
      : ''
  return raw || PRIVACY_CONTACT_PLACEHOLDER
}

export const PRIVACY_DISCLOSURE = {
  aiProcessing:
    'Messages, and any images or documents you attach, are sent through our servers to an AI provider (OpenAI) to generate replies.',
  files:
    'Images are processed for the reply. Documents are uploaded to the AI file store with a short configured lifetime (~24 hours).',
  webSearch:
    'When live information is needed, a web search tool may run via the AI provider; source links can appear as Fonti.',
  memory:
    'When Memory is enabled, ShinkAIdo may store useful long-term information in your account so it can be used in later conversations.',
  anonymousSession:
    'ShinkAIdo currently uses a silent anonymous account on this device. Clearing site data can create a new identity. Memory associated with the previous identity is not automatically transferred.',
  sensitiveWarning:
    'Do not store passwords, payment details, API keys, or other highly sensitive secrets in Memory.',
  processors:
    'Major services used by ShinkAIdo: OpenAI (AI processing), Supabase (auth and Memory storage), Vercel (hosting), Upstash (rate limiting).',
  newChatVsMemory:
    'New Chat clears the conversation on screen. Delete Memory removes durable stored memories. Account deletion is not available yet.',
} as const

export function buildBetaContactLine(email = resolvePrivacyContactEmail()): string {
  return `Closed beta: questions or deletion requests — contact ${email}.`
}

/** Settings Memory ON/OFF short notes (#298B corrected semantics). */
export const MEMORY_SETTINGS_COPY = {
  on: 'When Memory is on, ShinkAIdo may save useful long-term facts about you and use them in later chats.',
  off: 'When Memory is off, ShinkAIdo stops automatic learning and everyday recall. Existing memories are kept until you delete them.',
  delete:
    'Deleting Memory removes stored memories from your account. The conversation currently on screen is separate — use New Chat to clear it.',
} as const
