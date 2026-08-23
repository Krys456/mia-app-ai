/**
 * #369B — Deterministic thread decision evidence (Core).
 *
 * Scans recent USER messages only for go/no-go markers (CI/tests, Preview/deploy,
 * conflicts, review, hedges). Assistant text never establishes evidence.
 * Newer user statements override older ones. No LLM, no Memory, no persistence.
 */

export const THREAD_DECISION_EVIDENCE_BUILD = '369b-1'

/** Message lookback for evidence (user+assistant rows; only user content applies). */
export const THREAD_EVIDENCE_LOOKBACK = 16

/**
 * @typedef {'green'|'red'|'unknown'} CiStatus
 * @typedef {'ready'|'failed'|'unknown'} PreviewStatus
 * @typedef {'none'|'present'|'unknown'} ConflictsStatus
 * @typedef {'approved'|'unknown'} ReviewStatus
 *
 * @typedef {{
 *   ci: CiStatus
 *   preview: PreviewStatus
 *   conflicts: ConflictsStatus
 *   review: ReviewStatus
 *   hedged: boolean
 *   hasAny: boolean
 *   blocking: boolean
 *   completeGo: boolean
 * }} ThreadDecisionEvidence
 */

/**
 * @param {string} text
 */
function normalize(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Explicit uncertainty / hedge language in a user turn.
 * @param {string} text
 * @returns {boolean}
 */
export function looksLikeEvidenceHedge(text) {
  const t = normalize(text)
  if (!t) return false
  return /\b(?:credo(?:\s+che)?|forse|mi\s+sembra|probabilmente|non\s+sono\s+(?:molto\s+)?sicur[oa]|i\s+think|i'?m\s+not\s+sure|maybe|probably|perhaps)\b/i.test(
    t,
  )
}

/**
 * @param {string} text
 * @returns {{
 *   ci?: CiStatus
 *   preview?: PreviewStatus
 *   conflicts?: ConflictsStatus
 *   review?: ReviewStatus
 *   touched: boolean
 * }}
 */
export function extractDecisionEvidenceFromUserText(text) {
  const t = normalize(text)
  /** @type {{ ci?: CiStatus, preview?: PreviewStatus, conflicts?: ConflictsStatus, review?: ReviewStatus, touched: boolean }} */
  const out = { touched: false }
  if (!t || t.length > 500) return out

  // --- CI / tests (red before green so "not green" style fails don't false-positive) ---
  if (
    /\bci\s+(?:[eè]\s+|is\s+)?(?:ross[ao]|red|fail(?:ed|ing)?|rotta|rotto)\b/i.test(t) ||
    /\b(?:i\s+)?tests?\s+(?:sono\s+|are\s+)?(?:ross[iao]|red|fail(?:ed|ing)?|fallit[ieoa]?)\b/i.test(
      t,
    ) ||
    /\b(?:ci|tests?)\s+(?:ha|have|has)\s+fail/i.test(t) ||
    /\btests?\s+non\s+(?:passano|passati)\b/i.test(t)
  ) {
    out.ci = 'red'
    out.touched = true
  } else if (
    /\bci\s+(?:[eè]\s+|is\s+)?(?:verde|green|ok|passing)\b/i.test(t) ||
    /\bci\s+verde\b/i.test(t) ||
    /\b(?:tutti\s+i\s+)?tests?\s+(?:sono\s+|siano\s+|are\s+)?(?:verdi|green|passati|passed|passing|ok)\b/i.test(
      t,
    ) ||
    /\b(?:tutti\s+i\s+)?tests?\s+(?:passano|passati|passed)\b/i.test(t) ||
    /\btests?\s+pass\b/i.test(t) ||
    /\bci\s+green\b/i.test(t)
  ) {
    out.ci = 'green'
    out.touched = true
  }

  // --- Preview / deployment ---
  if (
    /\bpreview\s+(?:fallisce|failed|failing|fallita|rossa|broken|ko|down)\b/i.test(t) ||
    /\bdeploy(?:ment)?\s+(?:fallit[oa]|failed|failing|broken|ko)\b/i.test(t) ||
    /\b(?:deployment|deploy)\s+failed\b/i.test(t) ||
    /\baspetta[,.]?\s+preview\s+fall/i.test(t)
  ) {
    out.preview = 'failed'
    out.touched = true
  } else if (
    /\bpreview\s+(?:ready|pronta|ok|verde|green)\b/i.test(t) ||
    /\bdeploy(?:ment)?\s+(?:ready|ok|riuscito|succeeded|successful)\b/i.test(t)
  ) {
    out.preview = 'ready'
    out.touched = true
  }

  // --- Conflicts / blockers ---
  if (
    /\b(?:ci\s+sono|there\s+are|has|have)\s+(?:dei\s+|delle\s+|dei\s+)?(?:merge\s+)?conflitti?\b/i.test(
      t,
    ) ||
    /\b(?:merge\s+)?conflicts?\s+(?:presenti|aperti|present|open)\b/i.test(t) ||
    /\bmerge\s+conflicts?\b/i.test(t) ||
    /\bconflitti?\s+(?:da\s+risolvere|aperti)\b/i.test(t)
  ) {
    out.conflicts = 'present'
    out.touched = true
  } else if (
    /\bnessun(?:o)?\s+conflitt[oi]\b/i.test(t) ||
    /\bsenza\s+conflitt[oi]\b/i.test(t) ||
    /\b(?:zero|no|senza)\s+(?:merge\s+)?conflicts?\b/i.test(t) ||
    /\bno\s+merge\s+conflicts?\b/i.test(t)
  ) {
    out.conflicts = 'none'
    out.touched = true
  }

  // --- Review / approval (explicit only) ---
  if (
    /\breview\s+(?:approvat[oa]|approved)\b/i.test(t) ||
    /\b(?:approvat[oa]|approved)\s+(?:dalla\s+|by\s+)?review\b/i.test(t) ||
    /\bpr\s+approvat[oa]\b/i.test(t)
  ) {
    out.review = 'approved'
    out.touched = true
  }

  return out
}

/**
 * Empty / unknown evidence baseline.
 * @returns {ThreadDecisionEvidence}
 */
export function emptyThreadDecisionEvidence() {
  return {
    ci: 'unknown',
    preview: 'unknown',
    conflicts: 'unknown',
    review: 'unknown',
    hedged: false,
    hasAny: false,
    blocking: false,
    completeGo: false,
  }
}

/**
 * Derive thread decision evidence from recent messages + current user text.
 * USER-only. Chronological: newer overrides older. Hedge on evidence-bearing turns.
 *
 * @param {{
 *   userMessage?: string
 *   recentMessages?: Array<{ role?: string, content?: string }>
 *   lookback?: number
 * }} [input]
 * @returns {ThreadDecisionEvidence}
 */
export function deriveThreadDecisionEvidence(input = {}) {
  const lookback =
    typeof input.lookback === 'number' && input.lookback > 0
      ? Math.floor(input.lookback)
      : THREAD_EVIDENCE_LOOKBACK

  const list = Array.isArray(input.recentMessages) ? input.recentMessages : []
  const sliced = list.length > lookback ? list.slice(-lookback) : list

  /** @type {Array<{ role?: string, content?: string }>} */
  const userTurns = []
  for (const m of sliced) {
    if (!m || m.role !== 'user') continue
    const content = typeof m.content === 'string' ? m.content.trim() : ''
    if (!content || /^data:[^;]+;base64,/i.test(content)) continue
    userTurns.push({ role: 'user', content })
  }

  const current =
    typeof input.userMessage === 'string' ? input.userMessage.trim() : ''
  if (current) {
    const last = userTurns[userTurns.length - 1]
    if (!last || last.content !== current) {
      userTurns.push({ role: 'user', content: current })
    }
  }

  const state = emptyThreadDecisionEvidence()
  /** @type {boolean | null} */
  let lastEvidenceHedged = null

  for (const turn of userTurns) {
    const extracted = extractDecisionEvidenceFromUserText(turn.content)
    if (!extracted.touched) continue

    if (extracted.ci) state.ci = extracted.ci
    if (extracted.preview) state.preview = extracted.preview
    if (extracted.conflicts) state.conflicts = extracted.conflicts
    if (extracted.review) state.review = extracted.review

    lastEvidenceHedged = looksLikeEvidenceHedge(turn.content)
  }

  state.hedged = Boolean(lastEvidenceHedged)
  state.hasAny =
    state.ci !== 'unknown' ||
    state.preview !== 'unknown' ||
    state.conflicts !== 'unknown' ||
    state.review !== 'unknown'

  state.blocking =
    state.ci === 'red' || state.preview === 'failed' || state.conflicts === 'present'

  // Complete go: core ship checks established green/ready/none, no hedge, no blockers.
  // Review stays optional (unknown OK) — do not invent a review requirement.
  state.completeGo =
    !state.hedged &&
    !state.blocking &&
    state.ci === 'green' &&
    state.preview === 'ready' &&
    state.conflicts === 'none'

  return state
}

/**
 * Compact THREAD EVIDENCE lines for Conversation State appendix (decision turns only).
 * @param {ThreadDecisionEvidence | null | undefined} evidence
 * @returns {string}
 */
export function formatThreadEvidenceAppendixLines(evidence) {
  if (!evidence || !evidence.hasAny) return ''
  const lines = [
    'THREAD EVIDENCE (user-established in this thread; assistant guesses do not count):',
    `- CI: ${evidence.ci}`,
    `- Preview: ${evidence.preview}`,
    `- Conflicts: ${evidence.conflicts}`,
    `- Review: ${evidence.review}`,
    `- Hedge: ${evidence.hedged ? 'true' : 'false'}`,
  ]
  if (evidence.blocking) {
    lines.push(
      '- Decision hint: blocking evidence present → recommend wait/no; do not invent fixes.',
    )
  } else if (evidence.completeGo) {
    lines.push(
      '- Decision hint: complete go evidence → decisive recommendation OK; brief reason; stop.',
    )
  } else if (evidence.hedged) {
    lines.push(
      '- Decision hint: hedged user evidence → qualify; do not high-confidence yes.',
    )
  } else {
    lines.push(
      '- Decision hint: partial evidence → decide only on known checks; name missing gaps; never invent.',
    )
  }
  return lines.join('\n')
}
