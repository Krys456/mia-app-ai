/**
 * Conversational Memory Control PR3 — Memory Overview.
 *
 * Explicit "what do you remember about me?" inspection.
 * Owner-scoped active memories only. Not Recall V1.
 */

import {
  listActiveMemoriesForOwner,
  readFactKeyFromTags,
} from './brain-memory.js'
import { isUiOnlySettingsContent } from './core-memory-recall.js'
import { resolveControlReplyLanguage } from './language-awareness.js'
import { getServiceSupabase } from './supabase.js'

export const OVERVIEW_MAX_MEMORIES = 15
export const OVERVIEW_MAX_FACT_CHARS = 2000
export const OVERVIEW_POOL_LIMIT = 80
/** Conservative token-overlap threshold for paraphrase dedupe. */
export const OVERVIEW_SEMANTIC_OVERLAP = 0.75

/** Fill order: higher priority first until the total pack limit is reached. */
export const OVERVIEW_CATEGORY_ORDER = [
  'identity',
  'relationships',
  'projects',
  'goals',
  'preferences',
  'skills',
  'habits',
  'events',
  'settings',
]

/**
 * Per-category caps (sum > 15). Allocation is priority-fill, not proportional:
 * walk OVERVIEW_CATEGORY_ORDER, take up to each cap, stop at OVERVIEW_MAX_MEMORIES.
 * Lower-priority categories may receive zero slots when higher ones fill the pack.
 * Preference domination is limited by mid-rank + preferences cap 4 — not by
 * reserving slots for lower categories.
 */
export const OVERVIEW_CATEGORY_CAPS = {
  identity: 2,
  relationships: 3,
  projects: 3,
  goals: 3,
  preferences: 4,
  skills: 3,
  habits: 2,
  events: 2,
  settings: 2,
}

const CATEGORY_ALIASES = {
  tastes: 'preferences',
  hobbies: 'habits',
  profession: 'skills',
  important: 'events',
}

/**
 * @param {string} text
 */
export function normalizeOverviewText(text) {
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
 * Narrow IT/EN self-scoped memory inspection. Not topic recall, not forget.
 * @param {string} message
 */
export function isMemoryOverviewIntent(message) {
  const raw = normalizeOverviewText(message)
  if (!raw) return false

  // Never steal Forget-All / Specific Forget / wipe shapes.
  if (
    /\b(?:dimentica|dimenticati|cancella|elimina|forget|delete|clear)\b/i.test(raw) ||
    /\bnon\s+ricord(?:are|arti)\s+pi[uù]\b/i.test(raw) ||
    /\bdon['\u2019]?t\s+remember\b/i.test(raw) ||
    /\bdo\s+not\s+remember\b/i.test(raw)
  ) {
    return false
  }

  // Require explicit self scope (di me / su di me / about me).
  if (!/\b(?:su\s+di\s+me|di\s+me|about\s+me)\b/i.test(raw)) {
    return false
  }

  // Italian inspection frames
  if (
    /^(?:(?:per\s+favore|please)\s+)?(?:(?:dimmi|raccontami)\s+)?(?:che\s+cosa|cosa|quali\s+cose)\s+(?:ti\s+)?(?:ricordi|sai|conosci)\s+(?:su\s+)?di\s+me\b/i.test(
      raw,
    )
  ) {
    return true
  }
  if (
    /^(?:(?:dimmi|raccontami)\s+)?cosa\s+ti\s+ricordi\s+(?:su\s+)?di\s+me\b/i.test(raw)
  ) {
    return true
  }

  // English inspection frames
  if (
    /^(?:(?:please\s+)?(?:tell\s+me\s+)?)?what\s+(?:do\s+you\s+)?(?:remember|know)\s+about\s+me(?:\s+so\s+far)?\b/i.test(
      raw,
    )
  ) {
    return true
  }
  if (
    /^(?:please\s+)?tell\s+me\s+what\s+you\s+(?:remember|know)\s+about\s+me(?:\s+so\s+far)?\b/i.test(
      raw,
    )
  ) {
    return true
  }

  return false
}

/**
 * @param {string} message
 * @returns {'it' | 'en' | 'es' | 'fr' | 'de'}
 */
export function detectOverviewLanguage(message) {
  return resolveControlReplyLanguage(message)
}

export function ackOverviewEmpty(lang) {
  if (lang === 'en') return "I don't currently have any saved information about you."
  if (lang === 'es') return 'Ahora mismo no tengo información guardada sobre ti.'
  if (lang === 'fr') return "Je n'ai actuellement aucune information enregistrée sur toi."
  if (lang === 'de') return 'Ich habe derzeit keine gespeicherten Informationen über dich.'
  return 'Al momento non ho informazioni salvate su di te.'
}

export function ackOverviewUnauthenticated(lang) {
  if (lang === 'en') {
    return "I can't inspect saved memories for this session without a signed-in account."
  }
  if (lang === 'es') {
    return 'No puedo inspeccionar recuerdos guardados en esta sesión sin una cuenta iniciada.'
  }
  if (lang === 'fr') {
    return 'Je ne peux pas inspecter les souvenirs enregistrés pour cette session sans compte connecté.'
  }
  if (lang === 'de') {
    return 'Ohne angemeldetes Konto kann ich gespeicherte Erinnerungen für diese Sitzung nicht einsehen.'
  }
  return 'Non posso ispezionare i ricordi salvati per questa sessione senza un account autenticato.'
}

/**
 * @param {string} category
 */
export function normalizeOverviewCategory(category) {
  const key = String(category || '')
    .trim()
    .toLowerCase()
  if (!key) return 'preferences'
  if (CATEGORY_ALIASES[key]) return CATEGORY_ALIASES[key]
  if (OVERVIEW_CATEGORY_ORDER.includes(key)) return key
  return key
}

/**
 * @param {{ category?: string, content?: string, status?: string } | null | undefined} row
 */
export function isOverviewEligibleMemory(row) {
  if (!row || typeof row !== 'object') return false
  // Match listActiveMemoriesForOwner / isActiveMemoryStatus semantics.
  const status = String(row.status || 'active').toLowerCase()
  if (
    status === 'obsolete' ||
    status === 'archived' ||
    status === 'inactive' ||
    status === 'deleted'
  ) {
    return false
  }

  const content = String(row.content || '').trim()
  if (!content) return false

  const category = normalizeOverviewCategory(row.category)
  if (category === 'settings' && isUiOnlySettingsContent(content)) return false

  return true
}

/**
 * @param {string} content
 */
export function normalizeOverviewFactContent(content) {
  return String(content || '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Strip common extraction glosses for semantic comparison only.
 * @param {string} content
 */
export function normalizeOverviewSemanticKey(content) {
  let text = normalizeOverviewFactContent(content).toLowerCase()
  text = text
    .replace(/^user(?:'s)?\s+/i, '')
    .replace(/^(?:is|are)\s+/i, '')
    .replace(/\b(?:is\s+)?interested in:\s*/i, '')
    .replace(/\blikes\s*\/\s*prefers:\s*/i, '')
    .replace(/\blikes\s+/i, '')
    .replace(/\bprefers\s+/i, '')
    .replace(/\bfavorite\s+[^:]+:\s*/i, '')
    .replace(/\bis (?:named|developing|working on|learning)\s+/i, '')
    .replace(/[.]+$/g, '')
    .trim()
  const afterColon = text.match(/:\s*(.+)$/)
  if (afterColon?.[1]) text = afterColon[1].trim()
  return text.replace(/^(?:is|are|the|il|la|lo|i|gli|le)\s+/i, '').trim()
}

/**
 * @param {string} a
 * @param {string} b
 */
function tokenOverlapScore(a, b) {
  const tokenize = (value) =>
    String(value || '')
      .toLowerCase()
      .split(/[^a-z0-9àèéìòù]+/i)
      .map((t) => t.trim())
      .filter((t) => t.length > 1)

  const aTokens = new Set(tokenize(a))
  const bTokens = tokenize(b)
  if (aTokens.size === 0 || bTokens.length === 0) return 0
  let overlap = 0
  for (const token of bTokens) {
    if (aTokens.has(token)) overlap += 1
  }
  return overlap / Math.max(aTokens.size, bTokens.length)
}

/**
 * @param {any} row
 */
function rowUpdatedAtMs(row) {
  const raw = row?.updatedAt || row?.updated_at || row?.createdAt || row?.created_at || 0
  const ms = Date.parse(String(raw))
  return Number.isFinite(ms) ? ms : 0
}

/**
 * @param {any} a
 * @param {any} b
 * @returns {number} negative if a is better
 */
function compareOverviewCandidates(a, b) {
  const updatedDiff = rowUpdatedAtMs(b) - rowUpdatedAtMs(a)
  if (updatedDiff !== 0) return updatedDiff
  return (Number(b.importance) || 0) - (Number(a.importance) || 0)
}

/**
 * Stage 1: one row per fact_key (best by updated_at, then importance).
 * @param {any[]} rows
 */
export function dedupeOverviewByFactKey(rows) {
  /** @type {Map<string, any>} */
  const byKey = new Map()
  /** @type {any[]} */
  const unkeyed = []

  for (const row of rows || []) {
    const factKey =
      (typeof row.factKey === 'string' && row.factKey.trim()) ||
      readFactKeyFromTags(row.tags) ||
      null
    if (!factKey) {
      unkeyed.push(row)
      continue
    }
    const prev = byKey.get(factKey)
    if (!prev || compareOverviewCandidates(row, prev) < 0) {
      byKey.set(factKey, row)
    }
  }

  return [...byKey.values(), ...unkeyed]
}

/**
 * Stage 2: conservative paraphrase collapse (same durable fact, different gloss).
 * Distinct multi-valued interests (Naruto vs Dragon Ball) survive.
 * @param {any[]} rows
 */
export function dedupeOverviewSemantically(rows) {
  /** @type {any[]} */
  const kept = []

  for (const row of rows || []) {
    const key = normalizeOverviewSemanticKey(row.content)
    if (!key) continue

    let duplicate = false
    for (let i = 0; i < kept.length; i += 1) {
      const other = kept[i]
      const otherKey = normalizeOverviewSemanticKey(other.content)
      if (!otherKey) continue

      if (key === otherKey) {
        duplicate = true
        if (compareOverviewCandidates(row, other) < 0) kept[i] = row
        break
      }

      // Near-paraphrase only when payloads match (same core value) and tokens overlap heavily.
      const payload = overviewSemanticPayload(key)
      const otherPayload = overviewSemanticPayload(otherKey)
      const overlap = tokenOverlapScore(key, otherKey)
      if (
        payload &&
        otherPayload &&
        payload === otherPayload &&
        overlap >= OVERVIEW_SEMANTIC_OVERLAP
      ) {
        duplicate = true
        if (compareOverviewCandidates(row, other) < 0) kept[i] = row
        break
      }
    }

    if (!duplicate) kept.push(row)
  }

  return kept
}

/**
 * Core value for conservative paraphrase matching.
 * Only used for short gloss-like keys (≤3 tokens). Longer freeform facts
 * require exact semantic-key equality so distinct rows are not collapsed.
 * @param {string} key
 */
function overviewSemanticPayload(key) {
  const tokens = String(key || '')
    .toLowerCase()
    .split(/[^a-z0-9àèéìòù]+/i)
    .map((t) => t.trim())
    .filter((t) => t.length > 1 || /^\d+$/.test(t))
  if (tokens.length === 0 || tokens.length > 3) return ''
  return tokens.join(' ')
}

/**
 * Priority-fill selection with per-category caps and hard total/char limits.
 * @param {any[]} rows
 * @param {{ maxMemories?: number, maxFactChars?: number }} [limits]
 */
export function selectOverviewMemories(rows, limits = {}) {
  const maxMemories = Math.min(
    Math.max(limits.maxMemories ?? OVERVIEW_MAX_MEMORIES, 1),
    OVERVIEW_MAX_MEMORIES,
  )
  const maxFactChars = limits.maxFactChars ?? OVERVIEW_MAX_FACT_CHARS

  const eligible = (Array.isArray(rows) ? rows : []).filter(isOverviewEligibleMemory)
  const keyed = dedupeOverviewByFactKey(eligible)
  const deduped = dedupeOverviewSemantically(keyed)

  /** @type {Record<string, any[]>} */
  const buckets = {}
  for (const cat of OVERVIEW_CATEGORY_ORDER) buckets[cat] = []
  /** @type {any[]} */
  const other = []

  for (const row of deduped) {
    const cat = normalizeOverviewCategory(row.category)
    if (buckets[cat]) buckets[cat].push(row)
    else other.push(row)
  }

  for (const cat of OVERVIEW_CATEGORY_ORDER) {
    buckets[cat].sort(compareOverviewCandidates)
  }
  other.sort(compareOverviewCandidates)

  /** @type {any[]} */
  const selected = []
  let factChars = 0

  const tryTake = (row) => {
    if (selected.length >= maxMemories) return false
    const content = normalizeOverviewFactContent(row.content)
    if (!content) return false
    if (factChars + content.length > maxFactChars) return false
    selected.push(row)
    factChars += content.length
    return true
  }

  for (const cat of OVERVIEW_CATEGORY_ORDER) {
    const cap = OVERVIEW_CATEGORY_CAPS[cat] ?? 2
    let taken = 0
    for (const row of buckets[cat]) {
      if (taken >= cap) break
      if (selected.length >= maxMemories) break
      if (tryTake(row)) taken += 1
    }
    if (selected.length >= maxMemories) break
  }

  // Do not backfill "other" categories beyond the known order — keeps pack deterministic.
  // If room remains and we somehow have unknown categories, append conservatively.
  if (selected.length < maxMemories) {
    for (const row of other) {
      if (selected.length >= maxMemories) break
      tryTake(row)
    }
  }

  return selected
}

/**
 * Ephemeral overview pack for the existing single responses.create.
 * Semantic content only — no ids, fact_key, tags, status, timestamps.
 *
 * @param {any[]} memories
 * @param {{ maxFactChars?: number }} [limits]
 */
export function formatMemoryOverviewPack(memories, limits = {}) {
  const maxFactChars = limits.maxFactChars ?? OVERVIEW_MAX_FACT_CHARS
  const list = Array.isArray(memories) ? memories : []
  if (list.length === 0) return ''

  const header = [
    'MEMORY OVERVIEW',
    '',
    'The user explicitly asked what LAIfe persistently remembers about them.',
    'The facts below are the persisted Memory 2.0 facts available for this overview.',
    'Treat ONLY these facts as persisted memories for this answer.',
    '- summarize them naturally in the companion voice',
    '- do not expose storage/database syntax or raw gloss prefixes',
    '- do not mention ids, tags, fact_key, confidence, status, or metadata',
    '- do not infer additional remembered facts from the current conversation',
    '- do not invent missing details',
    '- do not claim a fact is remembered unless it appears below',
    '- do not mention ChatGPT/OpenAI memory settings',
    '- speak as LAIfe in the normal companion voice',
    '',
    'Persisted facts:',
  ].join('\n')

  const lines = []
  let used = 0

  for (const row of list) {
    let content = normalizeOverviewFactContent(row.content)
    if (!content) continue
    const room = maxFactChars - used
    if (room < 8) break
    if (content.length > room) {
      content = `${content.slice(0, Math.max(0, room - 1)).trim()}…`
    }
    lines.push(`- ${content}`)
    used += content.length
  }

  if (lines.length === 0) return ''
  return `${header}\n${lines.join('\n')}`
}

/**
 * Load + select overview memories for a verified owner.
 *
 * @param {{
 *   ownerUserId: string
 *   supabase?: any
 *   listActiveMemoriesForOwner?: typeof listActiveMemoriesForOwner
 * }} input
 */
export async function loadOverviewMemories(input) {
  const ownerUserId =
    typeof input?.ownerUserId === 'string' ? input.ownerUserId.trim() : ''
  if (!ownerUserId) {
    return { rows: [], error: 'ownerUserId required', queried: false }
  }

  const list = input.listActiveMemoriesForOwner ?? listActiveMemoriesForOwner
  const supabase = input.supabase ?? (await getServiceSupabase())
  const listed = await list(supabase, ownerUserId, { limit: OVERVIEW_POOL_LIMIT })
  if (listed.error) {
    return { rows: [], error: listed.error, queried: true }
  }
  return {
    rows: selectOverviewMemories(listed.rows || []),
    error: null,
    queried: true,
  }
}

/**
 * Unified Overview gate for /api/chat.
 *
 * - not overview → handled: false
 * - unauthenticated → deterministic, zero model, no DB
 * - empty → deterministic, zero model
 * - non-empty → pack for existing single responses.create (skippedModel: false)
 *
 * @param {{
 *   userMessage: string
 *   userId: string | null | undefined
 *   supabase?: any
 *   listActiveMemoriesForOwner?: typeof listActiveMemoriesForOwner
 * }} input
 */
export async function tryHandleMemoryOverview(input) {
  const userMessage = typeof input?.userMessage === 'string' ? input.userMessage.trim() : ''
  if (!userMessage || !isMemoryOverviewIntent(userMessage)) {
    return {
      handled: false,
      status: 'not_overview',
      message: '',
      pack: '',
      skippedModel: false,
      selectedCount: 0,
      queried: false,
    }
  }

  const lang = detectOverviewLanguage(userMessage)
  const userId = typeof input?.userId === 'string' ? input.userId.trim() : ''

  if (!userId) {
    return {
      handled: true,
      status: 'overview_unauthenticated',
      message: ackOverviewUnauthenticated(lang),
      pack: '',
      skippedModel: true,
      selectedCount: 0,
      queried: false,
    }
  }

  try {
    const loaded = await loadOverviewMemories({
      ownerUserId: userId,
      supabase: input.supabase,
      listActiveMemoriesForOwner: input.listActiveMemoriesForOwner,
    })

    if (loaded.error) {
      // Soft-fail: truthful empty rather than inventing via Core.
      return {
        handled: true,
        status: 'overview_empty',
        message: ackOverviewEmpty(lang),
        pack: '',
        skippedModel: true,
        selectedCount: 0,
        queried: true,
      }
    }

    if (!loaded.rows.length) {
      return {
        handled: true,
        status: 'overview_empty',
        message: ackOverviewEmpty(lang),
        pack: '',
        skippedModel: true,
        selectedCount: 0,
        queried: true,
      }
    }

    const pack = formatMemoryOverviewPack(loaded.rows)
    if (!pack) {
      return {
        handled: true,
        status: 'overview_empty',
        message: ackOverviewEmpty(lang),
        pack: '',
        skippedModel: true,
        selectedCount: 0,
        queried: true,
      }
    }

    return {
      handled: true,
      status: 'overview',
      message: '',
      pack,
      skippedModel: false,
      selectedCount: loaded.rows.length,
      queried: true,
      memories: loaded.rows,
    }
  } catch (error) {
    console.warn(
      '[memory-control-overview] skip:',
      error instanceof Error ? error.message.slice(0, 180) : String(error).slice(0, 180),
    )
    return {
      handled: true,
      status: 'overview_empty',
      message: ackOverviewEmpty(lang),
      pack: '',
      skippedModel: true,
      selectedCount: 0,
      queried: true,
    }
  }
}
