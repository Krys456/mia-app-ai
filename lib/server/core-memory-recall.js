/**
 * Memory Recall V1 — ephemeral context pack for the live single-shot Core.
 *
 * Soft-fail: never throws into chat. Requires verified auth.uid() — never
 * brain-api@local. Does not edit the compact companion system prompt.
 *
 * Memory 2.1 PR1: durable-memory provenance + empty-durable signal for
 * personal memory probes (ephemeral appendix only).
 */

import { searchMemories } from './brain-memory.js'

/** Prefer high-value conversational categories for Recall V1. */
export const RECALL_PREFERRED_CATEGORIES = new Set([
  'identity',
  'preferences',
  'projects',
  'goals',
  'relationships',
  'skills',
  // legacy aliases still present in some rows
  'tastes',
  'profession',
])

export const RECALL_MAX_MEMORIES = 3
export const RECALL_MAX_PACK_CHARS = 600
export const RECALL_MAX_LINE_CHARS = 160

export const EMPTY_DURABLE_MEMORY_RESULT_LINE =
  'DURABLE MEMORY RESULT: no relevant persisted Memory 2.0 fact was found for this question.'

/**
 * @param {string} text
 */
export function normalizeMemoryProbeText(text) {
  return String(text || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .toLowerCase()
    .replace(/[.!?…,;:]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Narrow personal-memory probe (specific "what do you remember about MY X?").
 * Not Memory Overview ("about me"), not ordinary factual questions, not forget.
 *
 * @param {string} message
 */
export function isPersonalMemoryProbe(message) {
  const raw = normalizeMemoryProbeText(message)
  if (!raw) return false

  if (
    /\b(?:dimentica|dimenticati|cancella|elimina|forget|delete|clear)\b/i.test(raw) ||
    /\bnon\s+ricord(?:are|arti)\s+pi[uù]\b/i.test(raw)
  ) {
    return false
  }

  // Memory Overview inventory ("di me" / "about me") — separate path.
  if (
    /\b(?:su\s+di\s+me|di\s+me|about\s+me)\b/i.test(raw) &&
    /\b(?:ricordi|sai|conosci|remember|know)\b/i.test(raw)
  ) {
    return false
  }

  // Italian: ti ricordi / ricordi + personal possessive question
  if (
    /\b(?:ti\s+)?ricord(?:i|are)?\b/i.test(raw) &&
    /\b(?:mio|mia|miei|mie)\b/i.test(raw) &&
    /\b(?:qual|quale|quali|cosa|che\s+cosa)\b/i.test(raw)
  ) {
    return true
  }

  // Italian: ti ricordi cosa ti ho detto su…
  if (/\b(?:ti\s+)?ricord(?:i|are)?\s+cosa\s+ti\s+ho\s+detto\b/i.test(raw)) {
    return true
  }

  // Italian: cosa ti ho detto su/di… (personal topic probe)
  if (/\bcosa\s+ti\s+ho\s+detto\s+(?:su|di|del|della|dei|delle|sul|sulla)\b/i.test(raw)) {
    return true
  }

  // Italian: cosa ti ricordi del mio…
  if (
    /\bcosa\s+ti\s+ricordi\s+(?:del|della|dei|delle|sul|sulla|su|di)\s+(?:mio|mia|miei|mie)\b/i.test(
      raw,
    )
  ) {
    return true
  }

  // Italian: qual è il mio… / quali sono i miei… (also qual'è)
  if (
    /\bqual(?:e|'?\s*[eè]|'?è)?\s+(?:[eè]\s+)?(?:il|la)\s+mi(?:o|a)\b/i.test(raw) ||
    /\bquali\s+(?:sono\s+)?(?:i|le)\s+mi(?:ei|e)\b/i.test(raw)
  ) {
    return true
  }

  // Italian: chi è il mio… / chi sono i miei…
  if (
    /\bchi\s+(?:[eè]\s+)?(?:il|la)\s+mi(?:o|a)\b/i.test(raw) ||
    /\bchi\s+(?:sono\s+)?(?:i|le)\s+mi(?:ei|e)\b/i.test(raw)
  ) {
    return true
  }

  // Italian: cosa mi piace
  if (/^cosa\s+mi\s+piace\b/i.test(raw)) {
    return true
  }

  // English: do you remember my… / what do you remember about my…
  if (
    /\b(?:do\s+you\s+)?remember\s+(?:my|what\s+my)\b/i.test(raw) ||
    /\bwhat\s+do\s+you\s+remember\s+about\s+my\b/i.test(raw) ||
    /\btell\s+me\s+what\s+you\s+remember\s+about\s+my\b/i.test(raw)
  ) {
    return true
  }

  // English: what is/are my…
  if (/\bwhat\s+(?:is|are)\s+my\b/i.test(raw)) {
    return true
  }

  // English: who is/are my…
  if (/\bwho\s+(?:is|are)\s+my\b/i.test(raw)) {
    return true
  }

  return false
}

/**
 * UI-only settings are not useful conversational recall.
 * @param {string} content
 * @returns {boolean}
 */
export function isUiOnlySettingsContent(content) {
  const text = String(content || '')
  return /\b(theme|tema|dark\s+mode|light\s+mode|tema\s+scuro|tema\s+chiaro|scuro|chiaro|emoji|markdown|rispost[ea]\s+(brevi|concis|dettagliat)|detailed\s+replies|concise\s+replies|reply\s+preference)\b/i.test(
    text,
  )
}

/**
 * @param {{ category?: string, content?: string, status?: string } | null | undefined} row
 * @returns {boolean}
 */
export function isRecallEligibleMemory(row) {
  if (!row || typeof row !== 'object') return false
  const status = String(row.status || 'active').toLowerCase()
  if (status === 'obsolete' || status === 'archived' || status === 'inactive' || status === 'deleted') {
    return false
  }

  const category = String(row.category || '')
    .trim()
    .toLowerCase()
  const content = String(row.content || '').trim()
  if (!content) return false

  if (RECALL_PREFERRED_CATEGORIES.has(category)) return true

  if (category === 'settings') {
    return !isUiOnlySettingsContent(content)
  }

  return false
}

/**
 * Provenance rules shared by non-empty durable packs and empty-probe signals.
 * Ephemeral Core appendix only — never shown as user-facing copy.
 */
export function durableMemoryProvenanceRules() {
  return [
    'Provenance (ephemeral — do not mention these labels to the user):',
    '- DURABLE MEMORY 2.0 = only the persisted facts listed in this appendix (if any).',
    '- CURRENT THREAD = messages in this conversation; separate from durable memory.',
    '- Inference = your reasoning; not durable memory.',
    '- Never present thread-only or inferred information as a durable remembered Memory 2.0 fact.',
    '- You may refer to something said earlier in THIS conversation as current-thread context, but do not claim it is saved/remembered/persisted unless it appears as a durable fact below.',
    '- Do not say or imply "I remember", "I saved", or "your main/favorite X is…" as durable memory unless grounded in a durable fact listed here.',
    '- Do not mention retrieval, databases, packs, or storage mechanics.',
  ].join('\n')
}

/**
 * Empty durable-memory appendix for personal probes with zero Recall hits.
 * @returns {string}
 */
export function formatEmptyDurableMemorySignal() {
  return [
    'DURABLE LAIFE MEMORY 2.0',
    '',
    EMPTY_DURABLE_MEMORY_RESULT_LINE,
    '',
    durableMemoryProvenanceRules(),
    '- For this question, answer truthfully: there is no relevant persisted Memory 2.0 fact.',
    '- If the current thread mentioned something related, you may note that as current-thread context only — never as durable memory.',
  ].join('\n')
}

/**
 * Build the ephemeral durable-memory appendix (category + content only).
 * Returns '' when there is nothing useful / within budget.
 *
 * @param {Array<{ category?: string, content?: string, status?: string }>} memories
 * @param {{ maxMemories?: number, maxPackChars?: number, maxLineChars?: number }} [limits]
 * @returns {string}
 */
export function formatCoreMemoryPack(memories, limits = {}) {
  const maxMemories = Math.min(
    Math.max(limits.maxMemories ?? RECALL_MAX_MEMORIES, 1),
    RECALL_MAX_MEMORIES,
  )
  const maxPackChars = limits.maxPackChars ?? RECALL_MAX_PACK_CHARS
  const maxLineChars = limits.maxLineChars ?? RECALL_MAX_LINE_CHARS

  const eligible = (Array.isArray(memories) ? memories : [])
    .filter(isRecallEligibleMemory)
    .slice(0, maxMemories)

  if (eligible.length === 0) return ''

  const header = [
    'DURABLE LAIFE MEMORY 2.0',
    '',
    'The following facts are persistently stored LAIfe Memory 2.0 facts for this user.',
    'Treat ONLY these facts as durable persisted memory for this answer.',
    '- Use a durable fact when it helps answer the current message; do not dump the list.',
    '- Current chat history is separate from this durable pack.',
    '- Do not invent durable facts beyond this pack.',
    '- If the user explicitly corrects a fact in the current user message, prefer that correction for this turn — still do not invent other durable memories from the thread.',
    '',
    durableMemoryProvenanceRules(),
    '',
    'Persisted durable facts:',
  ].join('\n')

  const lines = []
  let factChars = 0

  for (const row of eligible) {
    const category = String(row.category || '')
      .trim()
      .toLowerCase()
      .slice(0, 32)
    let content = String(row.content || '')
      .replace(/\s+/g, ' ')
      .trim()
    if (!content) continue

    const prefix = `- [${category}] `
    const room = Math.min(maxLineChars, maxPackChars - factChars) - prefix.length
    if (room < 12) break

    if (content.length > room) {
      content = `${content.slice(0, Math.max(0, room - 1)).trim()}…`
    }

    const line = `${prefix}${content}`
    if (factChars + line.length > maxPackChars && lines.length > 0) break
    lines.push(line)
    factChars += line.length + 1
  }

  if (lines.length === 0) return ''
  return `${header}\n${lines.join('\n')}`
}

/**
 * Soft-load a Core memory pack for the verified owner.
 * Never falls back to brain-api@local.
 *
 * When Memory is ON, owner is verified, the turn is a personal memory probe,
 * and Recall returns zero rows → append empty-durable signal (not silent '').
 *
 * @param {{
 *   userMessage: string
 *   ownerUserId: string | null | undefined
 *   memoryEnabled?: boolean
 *   searchMemories?: typeof searchMemories
 * }} input
 * @returns {Promise<string>}
 */
export async function loadCoreMemoryPack(input) {
  if (input?.memoryEnabled === false) return ''

  const ownerUserId =
    typeof input?.ownerUserId === 'string' ? input.ownerUserId.trim() : ''
  const userMessage = typeof input?.userMessage === 'string' ? input.userMessage.trim() : ''
  if (!ownerUserId || !userMessage) return ''

  const probe = isPersonalMemoryProbe(userMessage)

  try {
    const search = input.searchMemories ?? searchMemories
    const memories = await search(userMessage, {
      userId: ownerUserId,
      requireExplicitUserId: true,
      limit: RECALL_MAX_MEMORIES,
      includeObsolete: false,
    })

    if (Array.isArray(memories) && memories.length > 0) {
      const pack = formatCoreMemoryPack(memories)
      if (pack) return pack
    }

    if (probe) return formatEmptyDurableMemorySignal()
    return ''
  } catch (error) {
    console.warn(
      '[core-memory-recall] skip recall:',
      error instanceof Error ? error.message.slice(0, 180) : String(error).slice(0, 180),
    )
    // Soft-fail: for personal probes still prefer an empty-durable signal over silence,
    // so Core does not invent durable memory from the thread alone.
    if (probe) return formatEmptyDurableMemorySignal()
    return ''
  }
}

/**
 * Append pack to already-assembled Core instructions (does not edit base prompt).
 * @param {string} instructions
 * @param {string} memoryPack
 * @returns {string}
 */
export function appendMemoryPackToInstructions(instructions, memoryPack) {
  const base = String(instructions || '')
  const pack = String(memoryPack || '').trim()
  if (!pack) return base
  if (!base) return pack
  return `${base}\n\n${pack}`
}
