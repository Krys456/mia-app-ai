/**
 * Memory Recall V1 — ephemeral context pack for the live single-shot Core.
 *
 * Soft-fail: never throws into chat. Requires verified auth.uid() — never
 * brain-api@local. Does not edit the compact companion system prompt.
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
 * Build the ephemeral memory appendix (category + content only).
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
    'Remembered user facts (ephemeral context for this turn only):',
    '- Use a fact only when it helps answer the current message; do not dump the list.',
    '- Do not mention memory retrieval or that these came from storage.',
    '- Do not invent facts beyond this pack.',
    '- If the current user message conflicts with a remembered fact, prefer the current message.',
    '',
  ].join('\n')

  const lines = []
  let used = header.length

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
    const room = Math.min(maxLineChars, maxPackChars - used - 1) - prefix.length
    if (room < 12) break

    if (content.length > room) {
      content = `${content.slice(0, Math.max(0, room - 1)).trim()}…`
    }

    const line = `${prefix}${content}`
    if (used + line.length + 1 > maxPackChars) break
    lines.push(line)
    used += line.length + 1
  }

  if (lines.length === 0) return ''
  return `${header}${lines.join('\n')}`
}

/**
 * Soft-load a Core memory pack for the verified owner.
 * Never falls back to brain-api@local. Returns '' on any failure / miss.
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

  try {
    const search = input.searchMemories ?? searchMemories
    const memories = await search(userMessage, {
      userId: ownerUserId,
      requireExplicitUserId: true,
      limit: RECALL_MAX_MEMORIES,
      includeObsolete: false,
    })

    if (!Array.isArray(memories) || memories.length === 0) return ''
    return formatCoreMemoryPack(memories)
  } catch (error) {
    console.warn(
      '[core-memory-recall] skip recall:',
      error instanceof Error ? error.message.slice(0, 180) : String(error).slice(0, 180),
    )
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
