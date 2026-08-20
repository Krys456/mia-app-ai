/**
 * Temporary Reference Context (#279 + #328 Continuity Intelligence binders).
 *
 * Pure, deterministic, request-scoped hints derived from the SAME selected
 * Core messages used for this request (#277 window + multimodal sanitize).
 *
 * No DB, localStorage, client map, OpenAI call, Memory write, or V1/V2 runtime.
 *
 * Responsibilities (separate from #278 Working State):
 * - recent ordered option lists from ASSISTANT turns (for "la seconda")
 * - recent alternatives (assistant + user A-or-B)
 * - recent artifact metadata + honest evidenceAvailable after attachment caps
 * - HIGH-CONFIDENCE ephemeral likely_referent binding (#328) — never Memory
 *
 * Ambiguity / low confidence: leave unbound; CONTINUITY / model clarify if material.
 */

import {
  SERVER_MAX_RECENT_FILE_TURNS,
  SERVER_MAX_RECENT_IMAGE_TURNS,
} from './chat-image-input.js'
import { looksLikeBinaryChoice, looksLikeStopDecline } from './conversation-state.js'

export const REFERENCE_CONTEXT_VERSION = 1
/** #328 Continuity Intelligence binder build. */
export const REFERENCE_CONTEXT_BUILD = '328-1'
export const MAX_ORDERED_OPTIONS = 5
export const MAX_OPTION_CHARS = 120
export const MAX_ARTIFACTS = 8
export const MAX_APPENDIX_CHARS = 1500
export const PREFERRED_APPENDIX_CHARS = 1000
export const MAX_ALTERNATIVE_CHARS = 80
/** Binder lookback: recent relevant turns only. */
export const REFERENCE_BIND_LOOKBACK = 8
/** Soft cap for conditional likely_referent lines. */
export const LIKELY_REFERENT_APPENDIX_MAX_CHARS = 200

/**
 * @typedef {{
 *   kind: 'image' | 'file'
 *   name?: string
 *   evidenceAvailable: boolean
 * }} ReferenceArtifact
 */

/**
 * @typedef {{
 *   type: 'ordinal' | 'alternative' | 'previous' | 'named'
 *   value: string
 *   ordinal?: number
 *   source?: string
 *   correction?: boolean
 * }} LikelyReferent
 */

/**
 * @typedef {{
 *   version: 1
 *   recentOrderedOptions?: string[]
 *   recentAlternatives?: string[]
 *   recentArtifacts?: ReferenceArtifact[]
 *   likelyReferent?: LikelyReferent | null
 *   pivotDetected?: boolean
 *   correctionCueDetected?: boolean
 *   dimensionContinuationDetected?: boolean
 *   ambiguityCandidateCount?: number
 * }} ReferenceContext
 */

/**
 * @typedef {{
 *   role?: string
 *   content?: string
 *   attachments?: Array<{
 *     type?: string
 *     kind?: string
 *     name?: string
 *     fileId?: string
 *     file_id?: string
 *     dataUrl?: string
 *     mimeType?: string
 *   }>
 * }} ChatLike
 */

/**
 * @param {string} text
 * @param {number} max
 */
function clip(text, max) {
  const t = String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!t) return ''
  if (t.length <= max) return t
  const cut = t.slice(0, max)
  const sp = cut.lastIndexOf(' ')
  if (sp >= Math.floor(max * 0.6)) return cut.slice(0, sp).trim()
  return cut.trim()
}

/**
 * @param {unknown} raw
 */
function messageText(raw) {
  return typeof raw === 'string' ? raw : ''
}

/**
 * Strip leading list markers / "Option A:" labels from an option body.
 * @param {string} body
 */
function cleanOptionBody(body) {
  return clip(
    String(body || '')
      .replace(/^(?:option|opzione)\s*[a-z0-9]+\s*[:.)\-–—]\s*/i, '')
      .replace(/^[:.)\-–—]\s*/, ''),
    MAX_OPTION_CHARS,
  )
}

/**
 * High-confidence ordered list extraction from a single assistant message.
 * Supports:
 *   1. ...
 *   2. ...
 * and
 *   - Option A: ...
 *   - Option B: ...
 * Returns null when not clearly an ordered option set (≥2 items).
 *
 * @param {string} text
 * @returns {string[] | null}
 */
export function extractOrderedOptionsFromText(text) {
  const raw = messageText(text)
  if (!raw.trim()) return null

  const lines = raw.split(/\r?\n/)

  /** @type {string[]} */
  const numbered = []
  let expectNum = 1
  for (const line of lines) {
    const m = line.match(/^\s*(\d+)[.)]\s+(.+?)\s*$/)
    if (!m) {
      // Allow blank / non-list lines only before the list starts.
      if (numbered.length === 0) continue
      // Soft break: stop at first non-matching line after list began,
      // unless the line is blank (skip blanks inside list).
      if (!line.trim()) continue
      break
    }
    const n = Number(m[1])
    if (n !== expectNum) {
      // Restart only on a fresh 1. after a prior list; otherwise abort.
      if (n === 1) {
        numbered.length = 0
        expectNum = 1
      } else {
        return null
      }
    }
    const body = cleanOptionBody(m[2])
    if (!body) return null
    numbered.push(body)
    expectNum += 1
    if (numbered.length >= MAX_ORDERED_OPTIONS) break
  }
  if (numbered.length >= 2) return numbered

  /** @type {string[]} */
  const lettered = []
  let expectLetter = 0 // 0 = A
  for (const line of lines) {
    const m = line.match(
      /^\s*(?:[-*•]\s*)?(?:option|opzione)\s*([A-Za-z])\s*[:.)\-–—]\s*(.+?)\s*$/i,
    )
    if (!m) {
      if (lettered.length === 0) continue
      if (!line.trim()) continue
      break
    }
    const letterIdx = m[1].toUpperCase().charCodeAt(0) - 65
    if (letterIdx !== expectLetter) {
      if (letterIdx === 0) {
        lettered.length = 0
        expectLetter = 0
      } else {
        return null
      }
    }
    const body = cleanOptionBody(m[2])
    if (!body) return null
    lettered.push(body)
    expectLetter += 1
    if (lettered.length >= MAX_ORDERED_OPTIONS) break
  }
  if (lettered.length >= 2) return lettered

  // Bare lettered bullets: "- A: foo" / "* B) bar"
  /** @type {string[]} */
  const bareLetters = []
  let expectBare = 0
  for (const line of lines) {
    const m = line.match(/^\s*(?:[-*•]\s*)?([A-Za-z])\s*[:.)\-–—]\s*(.+?)\s*$/)
    if (!m) {
      if (bareLetters.length === 0) continue
      if (!line.trim()) continue
      break
    }
    const letterIdx = m[1].toUpperCase().charCodeAt(0) - 65
    if (letterIdx !== expectBare) {
      if (letterIdx === 0) {
        bareLetters.length = 0
        expectBare = 0
      } else {
        return null
      }
    }
    const body = cleanOptionBody(m[2])
    if (!body) return null
    bareLetters.push(body)
    expectBare += 1
    if (bareLetters.length >= MAX_ORDERED_OPTIONS) break
  }
  if (bareLetters.length >= 2) return bareLetters

  return null
}

/**
 * Optional high-confidence two-way contrast only.
 * e.g. "Option A / Option B", "Improve Memory or Improve UI"
 * Returns null when messy / not clearly binary.
 *
 * @param {string} text
 * @returns {string[] | null}
 */
export function extractAlternativesFromText(text) {
  const t = messageText(text).replace(/\s+/g, ' ').trim()
  if (!t || t.length > 280) return null

  // "Option A: X / Option B: Y" or "Option A / Option B"
  const optionSlash = t.match(
    /(?:option|opzione)\s*A\s*(?::\s*([^/|]+?))?\s*[/|]\s*(?:option|opzione)\s*B\s*(?::\s*(.+))?$/i,
  )
  if (optionSlash) {
    const a = clip(optionSlash[1] || 'A', MAX_ALTERNATIVE_CHARS)
    const b = clip(optionSlash[2] || 'B', MAX_ALTERNATIVE_CHARS)
    if (a && b && a.toLowerCase() !== b.toLowerCase()) return [a, b]
  }

  // Single-line "X or Y" / "X oppure Y" with short sides (no nested clauses).
  // Avoid bare Italian "o" — too easy to false-positive in prose.
  const orPair = t.match(
    /^(?:(?:you\s+can\s+)?(?:choose|pick|consider)\s+)?(.{2,60}?)\s+(?:or|oppure|o\s+invece)\s+(.{2,60}?)\.?$/i,
  )
  if (orPair) {
    const a = clip(orPair[1], MAX_ALTERNATIVE_CHARS)
    const b = clip(orPair[2], MAX_ALTERNATIVE_CHARS)
    if (!a || !b) return null
    // Reject prose-y leftovers and questions.
    if (/[?]/.test(t)) return null
    if (/\b(because|since|when|if|perché|perche|quando|se)\b/i.test(t)) return null
    if (a.split(/\s+/).length > 8 || b.split(/\s+/).length > 8) return null
    if (a.toLowerCase() === b.toLowerCase()) return null
    return [a, b]
  }

  return null
}

/**
 * Prefer the most recent clear ordered option set from ASSISTANT messages.
 * @param {ChatLike[] | null | undefined} messages
 * @returns {string[] | null}
 */
export function deriveRecentOrderedOptions(messages) {
  if (!Array.isArray(messages)) return null
  const slice = messages.slice(-REFERENCE_BIND_LOOKBACK * 2)
  for (let i = slice.length - 1; i >= 0; i -= 1) {
    const msg = slice[i]
    if (!msg || String(msg.role || '').toLowerCase() !== 'assistant') continue
    const opts = extractOrderedOptionsFromText(messageText(msg.content))
    if (opts && opts.length >= 2) return opts
  }
  return null
}

/**
 * Extract A-or-B pair from a short user/assistant utterance (#328).
 * @param {string} text
 * @returns {string[] | null}
 */
export function extractUserBinaryAlternatives(text) {
  const t = messageText(text).replace(/\s+/g, ' ').trim()
  if (!t || t.length > 140) return null
  if (!looksLikeBinaryChoice(t)) return null
  if (/^(true|false|yes|no|s[iì]|0|1)\s+(?:o|or)\s+(true|false|yes|no|s[iì]|0|1)\b/i.test(t)) {
    return null
  }
  const m = t.match(
    /\b([A-Za-zÀ-ÖØ-öø-ÿ0-9][\wÀ-ÖØ-öø-ÿ0-9'’.-]{0,40})\s+(?:o|or|vs\.?|versus)\s+([A-Za-zÀ-ÖØ-öø-ÿ0-9][\wÀ-ÖØ-öø-ÿ0-9'’.-]{0,40})\b/i,
  )
  if (!m) return null
  const a = clip(m[1], MAX_ALTERNATIVE_CHARS)
  const b = clip(m[2], MAX_ALTERNATIVE_CHARS)
  if (!a || !b || a.toLowerCase() === b.toLowerCase()) return null
  return [a, b]
}

/**
 * Optional alternatives from the most recent high-confidence contrast.
 * Prefers assistant ordered lists skip; then assistant binary; then user A-or-B.
 * @param {ChatLike[] | null | undefined} messages
 * @returns {string[] | null}
 */
export function deriveRecentAlternatives(messages) {
  if (!Array.isArray(messages)) return null
  const slice = messages.slice(-REFERENCE_BIND_LOOKBACK * 2)

  for (let i = slice.length - 1; i >= 0; i -= 1) {
    const msg = slice[i]
    if (!msg || String(msg.role || '').toLowerCase() !== 'assistant') continue
    if (extractOrderedOptionsFromText(messageText(msg.content))) continue
    const alts = extractAlternativesFromText(messageText(msg.content))
    if (alts && alts.length === 2) return alts
    const userStyle = extractUserBinaryAlternatives(messageText(msg.content))
    if (userStyle) return userStyle
  }

  // #328 — ingest recent USER A-or-B when assistant didn't list alternatives.
  for (let i = slice.length - 1; i >= 0; i -= 1) {
    const msg = slice[i]
    if (!msg || String(msg.role || '').toLowerCase() !== 'user') continue
    const alts = extractUserBinaryAlternatives(messageText(msg.content))
    if (alts) return alts
  }
  return null
}

/**
 * @param {ChatLike} msg
 * @returns {{ kind: 'image' | 'file', name?: string, hasPayload: boolean } | null}
 */
function primaryAttachmentMeta(msg) {
  const atts = Array.isArray(msg?.attachments) ? msg.attachments : []
  if (!atts.length) return null

  for (const att of atts) {
    if (!att || typeof att !== 'object') continue
    const type = String(att.type || att.kind || '').toLowerCase()
    if (type === 'image') {
      const dataUrl = typeof att.dataUrl === 'string' ? att.dataUrl.trim() : ''
      return {
        kind: 'image',
        hasPayload: Boolean(dataUrl && /^data:image\//i.test(dataUrl)),
      }
    }
    if (type === 'file') {
      const fileId =
        (typeof att.fileId === 'string' && att.fileId.trim()) ||
        (typeof att.file_id === 'string' && att.file_id.trim()) ||
        ''
      const name = typeof att.name === 'string' ? att.name.trim().slice(0, 120) : ''
      /** @type {{ kind: 'file', name?: string, hasPayload: boolean }} */
      const meta = { kind: 'file', hasPayload: Boolean(fileId) }
      if (name) meta.name = name
      return meta
    }
  }
  return null
}

/**
 * Derive recent artifact reference metadata in chronological order.
 * evidenceAvailable reflects whether the payload/ref survives the same
 * image/file caps used by mapMessagesToResponsesInput (default 2/2).
 *
 * @param {ChatLike[] | null | undefined} messages
 * @param {{ maxImageTurns?: number, maxFileTurns?: number }} [limits]
 * @returns {ReferenceArtifact[] | null}
 */
export function deriveRecentArtifacts(messages, limits = {}) {
  if (!Array.isArray(messages)) return null

  const maxImageTurns = limits.maxImageTurns ?? SERVER_MAX_RECENT_IMAGE_TURNS
  const maxFileTurns = limits.maxFileTurns ?? SERVER_MAX_RECENT_FILE_TURNS

  /** @type {Array<{ kind: 'image' | 'file', name?: string, hasPayload: boolean, index: number }>} */
  const found = []
  for (let i = 0; i < messages.length; i += 1) {
    const msg = messages[i]
    if (!msg) continue
    const role = String(msg.role || '').toLowerCase()
    // User uploads + assistant generated/edited images (#289) for reference grounding.
    if (role !== 'user' && role !== 'assistant') continue
    const meta = primaryAttachmentMeta(msg)
    if (!meta) continue
    // Assistant may only contribute images (never files).
    if (role === 'assistant' && meta.kind !== 'image') continue
    found.push({ ...meta, index: i })
  }
  if (!found.length) return null

  // Same newest-first retention as applyRecentAttachmentHistoryLimit.
  let remainingImages = maxImageTurns
  let remainingFiles = maxFileTurns
  /** @type {Set<number>} */
  const evidenceIndexes = new Set()
  for (let i = found.length - 1; i >= 0; i -= 1) {
    const item = found[i]
    if (item.kind === 'image') {
      if (remainingImages > 0 && item.hasPayload) {
        remainingImages -= 1
        evidenceIndexes.add(item.index)
      }
    } else if (item.kind === 'file') {
      if (remainingFiles > 0 && item.hasPayload) {
        remainingFiles -= 1
        evidenceIndexes.add(item.index)
      }
    }
  }

  /** @type {ReferenceArtifact[]} */
  const artifacts = found.slice(-MAX_ARTIFACTS).map((item) => {
    /** @type {ReferenceArtifact} */
    const out = {
      kind: item.kind,
      evidenceAvailable: evidenceIndexes.has(item.index),
    }
    if (item.kind === 'file' && item.name) out.name = item.name
    return out
  })

  return artifacts.length ? artifacts : null
}

/**
 * Explicit topic pivot / stop that must suppress stale referent binding (#328).
 * @param {string} message
 * @returns {boolean}
 */
export function looksLikeContinuityPivot(message) {
  const t = messageText(message).replace(/\s+/g, ' ').trim()
  if (!t) return false
  if (looksLikeStopDecline(t)) return true
  if (looksLikeMultiClauseStopPivot(t)) return true
  if (
    /\b(cambiamo\s+argomento|parliamo\s+d['']altro|parliamo\s+di\s+\S|cambiando\s+argomento|invece\s+parliamo|torniamo\s+a\s+\S|let'?s\s+(?:talk|speak)\s+about|change\s+(?:the\s+)?topic|forget\s+it)\b/i.test(
      t,
    )
  ) {
    return true
  }
  // Strong new substantive informational ask (e.g. Cos'è l'entropia?) — not a referent follow-up.
  if (
    /\b(cos[''][eè]\s+\S|che\s+cos[''][eè]\s+\S|what\s+is\s+\S|what'?s\s+a\s+\S|definizione\s+di\s+\S)\b/i.test(
      t,
    ) &&
    !/\b(quello|quella|questo|prima|secondo|terza|altro|altra|it|that|this)\b/i.test(t)
  ) {
    return true
  }
  return false
}

/**
 * Multi-clause stop/pivot (#328) — conservative.
 * @param {string} message
 * @returns {boolean}
 */
export function looksLikeMultiClauseStopPivot(message) {
  const t = messageText(message).replace(/\s+/g, ' ').trim()
  if (!t || t.length > 120) return false
  return /(?:^|[.!,;]\s*)(?:lascia(?:mo)?\s+stare|basta(?:\s+con\s+(?:questo|cos[iì]))?|forget\s+it|never\s+mind|drop\s+it)\b[\s,.;:!]*(?:let'?s\s+talk\s+about\s+)?(?:parliamo\s+(?:d['']altro|di\s+altro)|cambiamo\s+argomento|passiamo\s+oltre|let'?s\s+(?:talk|move)\s+on|change\s+topic|something\s+else)\b/i.test(
    t,
  )
}

/**
 * Dimension-change elliptical follow-up (same topic, new axis) (#328).
 * @param {string} message
 * @returns {boolean}
 */
export function looksLikeDimensionContinuation(message) {
  const t = messageText(message).replace(/\s+/g, ' ').trim()
  if (!t || t.length > 72) return false
  return /^(?:e\s+(?:su|per|su\s+)?|and\s+(?:on|for|about)\s+|what\s+about\s+|how\s+about\s+)[A-Za-zÀ-ÖØ-öø-ÿ0-9][\wÀ-ÖØ-öø-ÿ0-9'’.-]{1,40}\??$/i.test(
    t,
  )
}

/**
 * Correction cue for binding (#328).
 * @param {string} message
 * @returns {boolean}
 */
export function looksLikeReferenceCorrection(message) {
  const t = messageText(message).replace(/\s+/g, ' ').trim()
  if (!t) return false
  return /\b(?:no[,:]?\s+intendevo|non\s+quello|quello\s+prima|mi\s+sono\s+spiegat[oa]\s+male|volevo\s+dire|dicevo\s+l['']altro|I\s+meant|that'?s\s+not\s+what\s+I\s+meant|the\s+other\s+one)\b/i.test(
    t,
  )
}

/**
 * Parse ordinal index from user text (0-based). null if none / out of band.
 * @param {string} message
 * @param {number} optionCount
 * @returns {{ index: number, kind: 'ordinal'|'last'|'previous' } | null}
 */
export function parseOrdinalReference(message, optionCount) {
  const t = messageText(message)
    .replace(/\p{Extended_Pictographic}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!t || optionCount < 2) return null

  if (
    /\b(?:l['']ultimo|l['']ultima|the\s+last(?:\s+one)?)\b/i.test(t)
  ) {
    return { index: optionCount - 1, kind: 'last' }
  }
  if (
    /\b(?:quello\s+prima|quella\s+prima|il\s+precedente|la\s+precedente|the\s+previous(?:\s+one)?)\b/i.test(
      t,
    )
  ) {
    return { index: -1, kind: 'previous' }
  }

  /** @type {Array<[RegExp, number]>} */
  const map = [
    [/\b(?:il\s+primo|la\s+prima|the\s+first(?:\s+one)?)\b/i, 0],
    [/\b(?:il\s+secondo|la\s+seconda|the\s+second(?:\s+one)?)\b/i, 1],
    [/\b(?:il\s+terzo|la\s+terza|the\s+third(?:\s+one)?)\b/i, 2],
    [/\b(?:il\s+quarto|la\s+quarta|the\s+fourth(?:\s+one)?)\b/i, 3],
    [/\b(?:il\s+quinto|la\s+quinta|the\s+fifth(?:\s+one)?)\b/i, 4],
  ]
  for (const [re, idx] of map) {
    if (re.test(t)) {
      if (idx >= optionCount) return null
      return { index: idx, kind: 'ordinal' }
    }
  }
  return null
}

/**
 * Whether message looks like an "the other" alternative request.
 * @param {string} message
 */
export function looksLikeOtherAlternative(message) {
  const t = messageText(message).replace(/\s+/g, ' ').trim()
  if (!t || t.length > 72) return false
  return /\b(?:l['']altra|l['']altro|e\s+l['']altra|e\s+l['']altro|the\s+other(?:\s+one)?|e\s+invece\s+l['']altra)\b/i.test(
    t,
  )
}

/**
 * Find which of two alternatives was recently selected (user pick or assistant lean).
 * @param {string[]} alternatives
 * @param {ChatLike[]} recent
 * @returns {string | null} selected value
 */
function inferSelectedAlternative(alternatives, recent) {
  if (!alternatives || alternatives.length !== 2) return null
  const [a, b] = alternatives
  const aL = a.toLowerCase()
  const bL = b.toLowerCase()

  for (let i = recent.length - 1; i >= 0; i -= 1) {
    const msg = recent[i]
    if (!msg) continue
    const c = messageText(msg.content).replace(/\s+/g, ' ').trim()
    if (!c) continue
    // Skip the pure A-or-B question itself.
    if (extractUserBinaryAlternatives(c)) continue
    const hasA = new RegExp(`\\b${escapeRegExp(a)}\\b`, 'i').test(c)
    const hasB = new RegExp(`\\b${escapeRegExp(b)}\\b`, 'i').test(c)
    if (hasA && !hasB) return a
    if (hasB && !hasA) return b
    // Short bare pick
    if (/^[A-Za-zÀ-ÖØ-öø-ÿ0-9][\wÀ-ÖØ-öø-ÿ0-9'’.-]{1,40}\.?$/i.test(c)) {
      if (c.replace(/\.$/, '').toLowerCase() === aL) return a
      if (c.replace(/\.$/, '').toLowerCase() === bL) return b
    }
  }
  return null
}

/** @param {string} s */
function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Infer prior ordinal selection index from recent user turns.
 * @param {string[]} options
 * @param {ChatLike[]} recent
 * @returns {number | null}
 */
function inferPriorOrdinalIndex(options, recent) {
  if (!options || options.length < 2) return null
  for (let i = recent.length - 1; i >= 0; i -= 1) {
    const msg = recent[i]
    if (!msg || msg.role !== 'user') continue
    const parsed = parseOrdinalReference(messageText(msg.content), options.length)
    if (parsed && parsed.kind !== 'previous' && parsed.index >= 0) return parsed.index
  }
  return null
}

/**
 * High-confidence ephemeral referent bind (#328). Returns null when unsure.
 * @param {string} userMessage
 * @param {{
 *   orderedOptions?: string[] | null
 *   alternatives?: string[] | null
 *   recentMessages?: ChatLike[]
 * }} ctx
 * @returns {LikelyReferent | null}
 */
export function bindLikelyReferent(userMessage, ctx = {}) {
  const t = messageText(userMessage).replace(/\s+/g, ' ').trim()
  if (!t) return null
  if (looksLikeContinuityPivot(t)) return null

  const options = Array.isArray(ctx.orderedOptions) ? ctx.orderedOptions : null
  const alternatives =
    Array.isArray(ctx.alternatives) && ctx.alternatives.length === 2 ? ctx.alternatives : null
  const recent = Array.isArray(ctx.recentMessages)
    ? ctx.recentMessages.slice(-REFERENCE_BIND_LOOKBACK)
    : []

  const correction = looksLikeReferenceCorrection(t)

  // Named pick among known options/alternatives (e.g. "No, intendevo Nova.")
  if (correction || /^(?:no[,:]?\s+)?intendevo\s+/i.test(t)) {
    const pool = [...(options || []), ...(alternatives || [])]
    for (const cand of pool) {
      if (new RegExp(`\\b${escapeRegExp(cand)}\\b`, 'i').test(t)) {
        return {
          type: 'named',
          value: cand,
          source: 'named_correction',
          correction: true,
        }
      }
    }
  }

  // Ordinal against recent ordered options (including "continua dalla terza")
  if (options && options.length >= 2) {
    const ord = parseOrdinalReference(t, options.length)
    if (ord) {
      if (ord.kind === 'previous') {
        const prior = inferPriorOrdinalIndex(options, recent)
        if (prior == null || prior < 1) return null
        const prevIdx = prior - 1
        if (prevIdx < 0 || prevIdx >= options.length) return null
        return {
          type: 'previous',
          value: options[prevIdx],
          ordinal: prevIdx + 1,
          source: 'recent_assistant_list',
          correction,
        }
      }
      if (ord.index < 0 || ord.index >= options.length) return null
      return {
        type: 'ordinal',
        value: options[ord.index],
        ordinal: ord.index + 1,
        source: 'recent_assistant_list',
        correction,
      }
    }
    // "continua da quella/quello/lì" → last selected ordinal when unique
    if (
      /\b(?:continua\s+da\s+(?:quella|quello|l[iì])|continue\s+from\s+(?:that|there)|go\s+on\s+from\s+that)\b/i.test(
        t,
      )
    ) {
      const prior = inferPriorOrdinalIndex(options, recent)
      if (prior != null && prior >= 0 && prior < options.length) {
        return {
          type: 'ordinal',
          value: options[prior],
          ordinal: prior + 1,
          source: 'continue_prior_ordinal',
          correction,
        }
      }
    }
  }

  // "the other" against unique binary alternatives
  if (alternatives && looksLikeOtherAlternative(t)) {
    const selected = inferSelectedAlternative(alternatives, recent)
    if (!selected) return null
    const other = alternatives.find((x) => x.toLowerCase() !== selected.toLowerCase())
    if (!other) return null
    return {
      type: 'alternative',
      value: other,
      source: 'binary_other',
      correction,
    }
  }

  // Correction "non quello" / "quello prima" with unique prior ordinal
  if (correction && options && options.length >= 2) {
    const prior = inferPriorOrdinalIndex(options, recent)
    if (
      prior != null &&
      /\b(?:non\s+quello|quello\s+prima|the\s+previous)\b/i.test(t)
    ) {
      const prevIdx = Math.max(0, prior - 1)
      if (prevIdx !== prior && prevIdx < options.length) {
        return {
          type: 'previous',
          value: options[prevIdx],
          ordinal: prevIdx + 1,
          source: 'correction_previous',
          correction: true,
        }
      }
    }
  }

  return null
}

/**
 * Format tiny likely_referent appendix lines.
 * @param {LikelyReferent} ref
 */
export function formatLikelyReferentAppendixLines(ref) {
  if (!ref || !ref.value) return []
  const lines = ['', 'likely_referent:']
  lines.push(`- type: ${ref.type}`)
  if (ref.source) lines.push(`- source: ${ref.source}`)
  if (typeof ref.ordinal === 'number') lines.push(`- ordinal: ${ref.ordinal}`)
  lines.push(`- value: ${clip(ref.value, 80)}`)
  if (ref.correction) lines.push('- correction: true')
  let block = lines.join('\n')
  if (block.length > LIKELY_REFERENT_APPENDIX_MAX_CHARS) {
    block = block.slice(0, LIKELY_REFERENT_APPENDIX_MAX_CHARS - 1).trimEnd()
    return block.split('\n')
  }
  return lines
}

/**
 * @param {ChatLike[] | null | undefined} messages
 * @param {{ maxImageTurns?: number, maxFileTurns?: number }} [limits]
 * @returns {ReferenceContext | null}
 */
export function deriveReferenceContext(messages, limits = {}) {
  const list = Array.isArray(messages) ? messages : []
  const recentOrderedOptions = deriveRecentOrderedOptions(list)
  const recentAlternatives = deriveRecentAlternatives(list)
  const recentArtifacts = deriveRecentArtifacts(list, limits)

  const latestUser = [...list].reverse().find((m) => m && m.role === 'user')
  const userMessage = latestUser ? messageText(latestUser.content) : ''
  const pivotDetected = Boolean(userMessage && looksLikeContinuityPivot(userMessage))
  const correctionCueDetected = Boolean(
    userMessage && looksLikeReferenceCorrection(userMessage),
  )
  const dimensionContinuationDetected = Boolean(
    userMessage && looksLikeDimensionContinuation(userMessage),
  )

  let likelyReferent = null
  let ambiguityCandidateCount = 0
  if (!pivotDetected && userMessage) {
    likelyReferent = bindLikelyReferent(userMessage, {
      orderedOptions: recentOrderedOptions,
      alternatives: recentAlternatives,
      recentMessages: list.slice(-REFERENCE_BIND_LOOKBACK),
    })
    if (!likelyReferent) {
      if (recentOrderedOptions && parseOrdinalReference(userMessage, recentOrderedOptions.length)) {
        // Out-of-range ordinal → ambiguity / no bind
        ambiguityCandidateCount = recentOrderedOptions.length
      } else if (recentAlternatives && looksLikeOtherAlternative(userMessage)) {
        ambiguityCandidateCount = recentAlternatives.length
      }
    }
  }

  if (
    !recentOrderedOptions &&
    !recentAlternatives &&
    !recentArtifacts &&
    !likelyReferent
  ) {
    return null
  }

  /** @type {ReferenceContext} */
  const ctx = { version: REFERENCE_CONTEXT_VERSION }
  if (recentOrderedOptions) ctx.recentOrderedOptions = recentOrderedOptions
  if (recentAlternatives) ctx.recentAlternatives = recentAlternatives
  if (recentArtifacts) ctx.recentArtifacts = recentArtifacts
  if (likelyReferent) ctx.likelyReferent = likelyReferent
  ctx.pivotDetected = pivotDetected
  ctx.correctionCueDetected = correctionCueDetected
  ctx.dimensionContinuationDetected = dimensionContinuationDetected
  ctx.ambiguityCandidateCount = ambiguityCandidateCount
  return ctx
}

/**
 * @param {ReferenceContext | null | undefined} ctx
 */
export function referenceContextHasContent(ctx) {
  if (!ctx || ctx.version !== REFERENCE_CONTEXT_VERSION) return false
  return Boolean(
    (ctx.recentOrderedOptions && ctx.recentOrderedOptions.length >= 2) ||
      (ctx.recentAlternatives && ctx.recentAlternatives.length === 2) ||
      (ctx.recentArtifacts && ctx.recentArtifacts.length > 0) ||
      (ctx.likelyReferent && ctx.likelyReferent.value),
  )
}

/**
 * Build ephemeral Core appendix. Returns '' when empty.
 * @param {ChatLike[] | null | undefined} messages
 * @param {{ maxImageTurns?: number, maxFileTurns?: number }} [limits]
 */
export function buildReferenceContextAppendix(messages, limits = {}) {
  const ctx = deriveReferenceContext(messages, limits)
  if (!referenceContextHasContent(ctx) || !ctx) return ''

  const lines = [
    'TEMPORARY REFERENCE CONTEXT',
    'Derived from the supplied conversation only.',
    'Use this only as a reference-resolution hint.',
    'Prefer the latest explicit user message and raw conversation evidence.',
    'If this conflicts with raw recent history, raw history wins.',
    'When likely_referent is present, treat it as the high-confidence bind for THIS turn (unless the latest user message clearly overrides it).',
    'Do not invent a referent when multiple candidates remain plausible.',
    'Ask a concise clarification when required.',
    'Artifact metadata is not visual/document evidence.',
    'If evidenceAvailable is false/unavailable, do not claim to inspect or re-read the artifact; you may refer to known metadata/name only and ask the user to reattach when inspection is necessary.',
    'Do not treat this as durable Memory. Current thread beats durable Memory for referents.',
  ]

  if (ctx.recentOrderedOptions?.length) {
    lines.push('', 'Recent ordered options:')
    ctx.recentOrderedOptions.forEach((opt, i) => {
      lines.push(`${i + 1}. ${opt}`)
    })
  }

  if (ctx.recentAlternatives?.length === 2) {
    lines.push('', 'Recent alternatives:')
    lines.push(`- ${ctx.recentAlternatives[0]}`)
    lines.push(`- ${ctx.recentAlternatives[1]}`)
  }

  if (ctx.likelyReferent) {
    lines.push(...formatLikelyReferentAppendixLines(ctx.likelyReferent))
  }

  if (ctx.recentArtifacts?.length) {
    lines.push('', 'Recent artifacts:')
    ctx.recentArtifacts.forEach((art, i) => {
      const evidence = art.evidenceAvailable ? 'evidence available' : 'evidence unavailable'
      if (art.kind === 'file' && art.name) {
        lines.push(`${i + 1}. file: ${art.name} — ${evidence}`)
      } else if (art.kind === 'file') {
        lines.push(`${i + 1}. file — ${evidence}`)
      } else {
        lines.push(`${i + 1}. image — ${evidence}`)
      }
    })
  }

  let appendix = lines.join('\n').trim()
  if (appendix.length > MAX_APPENDIX_CHARS) {
    appendix = `${appendix.slice(0, MAX_APPENDIX_CHARS - 1).trim()}…`
  }
  return appendix
}

/**
 * Safe diagnostics — counts/types only, no full option text.
 * @param {ReferenceContext | null | undefined} ctx
 * @param {{ appendixChars?: number, env?: NodeJS.ProcessEnv | Record<string, string | undefined> }} [opts]
 */
export function buildReferenceContextDiagPayload(ctx, opts = {}) {
  const env = opts.env || process.env
  const sha =
    typeof env.VERCEL_GIT_COMMIT_SHA === 'string' ? env.VERCEL_GIT_COMMIT_SHA.trim() : ''
  const buildId = sha
    ? sha.slice(0, 7)
    : typeof env.VITE_BUILD_ID === 'string' && env.VITE_BUILD_ID.trim()
      ? env.VITE_BUILD_ID.trim()
      : 'dev'
  const ref = ctx?.likelyReferent || null
  return {
    diagBuild: REFERENCE_CONTEXT_BUILD,
    route: 'reference-context',
    phase: 'reference-context',
    timestamp: new Date().toISOString(),
    buildId,
    referenceContextInjected: Boolean(ctx && referenceContextHasContent(ctx)),
    orderedOptionsCount: ctx?.recentOrderedOptions?.length || 0,
    alternativesCount: ctx?.recentAlternatives?.length || 0,
    artifactCount: ctx?.recentArtifacts?.length || 0,
    likelyReferentPresent: Boolean(ref?.value),
    likelyReferentType: ref?.type || null,
    ordinalIndex: typeof ref?.ordinal === 'number' ? ref.ordinal : null,
    correctionCueDetected: Boolean(ctx?.correctionCueDetected),
    dimensionContinuationDetected: Boolean(ctx?.dimensionContinuationDetected),
    pivotDetected: Boolean(ctx?.pivotDetected),
    ambiguityCandidateCount:
      typeof ctx?.ambiguityCandidateCount === 'number' ? ctx.ambiguityCandidateCount : 0,
    appendixChars: typeof opts.appendixChars === 'number' ? opts.appendixChars : null,
  }
}
