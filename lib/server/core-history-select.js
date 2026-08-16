/**
 * Core conversation history selector (#277).
 *
 * Deterministic raw-history window: message ceiling + text character budget.
 * No summarization, no Memory semantics, no model calls, no attachment mutation.
 *
 * Future note (not implemented here): Conversation Working State would be a
 * separate ephemeral layer if expanded raw history is still insufficient.
 */

/** Individual sanitized messages (user+assistant), newest-priority. */
export const MAX_HISTORY_MESSAGES = 80

/**
 * Visible text character budget (captions + assistant text only).
 * Attachment payloads (dataUrl / fileId / bytes) are excluded.
 *
 * Rationale vs old slice(-40) (~20 turns):
 * - 80 messages ≈ up to ~40 U/A turns — 2× effective thread depth
 * - 120_000 chars ≈ ~30–40k tokens text proxy; leaves headroom for instructions,
 *   Memory pack, LANGUAGE/CONTINUITY, and up to 2 image dataUrls under Vercel
 * - Far below GPT-5.6 Sol (~1.05M) and practical gpt-4o limits; not full-window use
 */
export const MAX_HISTORY_TEXT_CHARS = 120_000

/**
 * @typedef {{
 *   role: string
 *   content?: string
 *   attachments?: unknown[]
 * }} HistoryMessage
 */

/**
 * Count only visible conversation text toward the budget.
 * Never counts image dataUrls, fileIds, filenames, or mime metadata.
 * @param {HistoryMessage | null | undefined} msg
 */
export function historyVisibleTextChars(msg) {
  if (!msg || typeof msg.content !== 'string') return 0
  return msg.content.length
}

/**
 * Select Core conversation history after sanitization.
 *
 * Policy:
 * 1. Walk newest → oldest while count ≤ maxMessages and chars ≤ maxTextChars
 * 2. Newest message always survives (even if alone it exceeds the char budget)
 * 3. Reverse to chronological order
 * 4. Pair-boundary: if the oldest kept message is an orphaned assistant
 *    (no immediately preceding user in the selected window), drop it —
 *    unless it is the only remaining message
 *
 * Synthetic model-only nudges are applied later in mapMessagesToResponsesInput
 * and never participate in this budget.
 *
 * @param {HistoryMessage[]} messages
 * @param {{ maxMessages?: number, maxTextChars?: number }} [opts]
 * @returns {HistoryMessage[]}
 */
export function selectCoreConversationHistory(messages, opts = {}) {
  const list = Array.isArray(messages) ? messages : []
  if (list.length === 0) return []

  const maxMessages =
    typeof opts.maxMessages === 'number' && opts.maxMessages > 0
      ? Math.floor(opts.maxMessages)
      : MAX_HISTORY_MESSAGES
  const maxTextChars =
    typeof opts.maxTextChars === 'number' && opts.maxTextChars > 0
      ? Math.floor(opts.maxTextChars)
      : MAX_HISTORY_TEXT_CHARS

  /** @type {HistoryMessage[]} */
  const pickedNewestFirst = []
  let textChars = 0

  for (let i = list.length - 1; i >= 0; i -= 1) {
    const msg = list[i]
    if (!msg || typeof msg !== 'object') continue

    const chars = historyVisibleTextChars(msg)
    const isNewest = pickedNewestFirst.length === 0

    if (!isNewest) {
      if (pickedNewestFirst.length >= maxMessages) break
      if (textChars + chars > maxTextChars) break
    }

    pickedNewestFirst.push(msg)
    textChars += chars
  }

  const chronological = pickedNewestFirst.reverse()

  // Pair-boundary safeguard: do not leave a leading orphaned assistant
  // when the budget cut between a user→assistant pair.
  while (
    chronological.length > 1 &&
    chronological[0]?.role === 'assistant'
  ) {
    chronological.shift()
  }

  return chronological
}
