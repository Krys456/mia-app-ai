/**
 * Temporary Reference Context (#279).
 *
 * Pure, deterministic, request-scoped hints derived from the SAME selected
 * Core messages used for this request (#277 window + multimodal sanitize).
 *
 * No DB, localStorage, client map, OpenAI call, Memory write, or V1/V2 runtime.
 *
 * Responsibilities (separate from #278 Working State):
 * - recent ordered option lists from ASSISTANT turns (for "la seconda")
 * - recent artifact metadata + honest evidenceAvailable after attachment caps
 *
 * Does NOT bind referents. Ambiguity stays with CONTINUITY / the model.
 */

import {
  SERVER_MAX_RECENT_FILE_TURNS,
  SERVER_MAX_RECENT_IMAGE_TURNS,
} from './chat-image-input.js'

export const REFERENCE_CONTEXT_VERSION = 1
export const MAX_ORDERED_OPTIONS = 5
export const MAX_OPTION_CHARS = 120
export const MAX_ARTIFACTS = 8
export const MAX_APPENDIX_CHARS = 1500
export const PREFERRED_APPENDIX_CHARS = 1000
export const MAX_ALTERNATIVE_CHARS = 80

/**
 * @typedef {{
 *   kind: 'image' | 'file'
 *   name?: string
 *   evidenceAvailable: boolean
 * }} ReferenceArtifact
 */

/**
 * @typedef {{
 *   version: 1
 *   recentOrderedOptions?: string[]
 *   recentAlternatives?: string[]
 *   recentArtifacts?: ReferenceArtifact[]
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
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i]
    if (!msg || String(msg.role || '').toLowerCase() !== 'assistant') continue
    const opts = extractOrderedOptionsFromText(messageText(msg.content))
    if (opts && opts.length >= 2) return opts
  }
  return null
}

/**
 * Optional alternatives from the most recent high-confidence assistant contrast.
 * @param {ChatLike[] | null | undefined} messages
 * @returns {string[] | null}
 */
export function deriveRecentAlternatives(messages) {
  if (!Array.isArray(messages)) return null
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i]
    if (!msg || String(msg.role || '').toLowerCase() !== 'assistant') continue
    // Prefer ordered lists over alternatives when both exist on the same turn.
    if (extractOrderedOptionsFromText(messageText(msg.content))) continue
    const alts = extractAlternativesFromText(messageText(msg.content))
    if (alts && alts.length === 2) return alts
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
    if (!msg || String(msg.role || '').toLowerCase() !== 'user') continue
    const meta = primaryAttachmentMeta(msg)
    if (!meta) continue
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
 * @param {ChatLike[] | null | undefined} messages
 * @param {{ maxImageTurns?: number, maxFileTurns?: number }} [limits]
 * @returns {ReferenceContext | null}
 */
export function deriveReferenceContext(messages, limits = {}) {
  const recentOrderedOptions = deriveRecentOrderedOptions(messages)
  const recentAlternatives = deriveRecentAlternatives(messages)
  const recentArtifacts = deriveRecentArtifacts(messages, limits)

  if (!recentOrderedOptions && !recentAlternatives && !recentArtifacts) {
    return null
  }

  /** @type {ReferenceContext} */
  const ctx = { version: REFERENCE_CONTEXT_VERSION }
  if (recentOrderedOptions) ctx.recentOrderedOptions = recentOrderedOptions
  if (recentAlternatives) ctx.recentAlternatives = recentAlternatives
  if (recentArtifacts) ctx.recentArtifacts = recentArtifacts
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
      (ctx.recentArtifacts && ctx.recentArtifacts.length > 0),
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
    'Do not invent a referent when multiple candidates remain plausible.',
    'Ask a concise clarification when required.',
    'Artifact metadata is not visual/document evidence.',
    'If evidenceAvailable is false/unavailable, do not claim to inspect or re-read the artifact; you may refer to known metadata/name only and ask the user to reattach when inspection is necessary.',
    'Do not treat this as durable Memory.',
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
