/**
 * Shared discourse-prefix stripping for Phone Action outer clauses.
 */

import { normalizeTimerText } from './parse.js'

/** Strip leading discourse markers so "Ok, allora copia…" still matches. */
export function stripDiscoursePrefix(raw) {
  let s = normalizeTimerText(raw)
  // Allow missing space after comma: "Ok,allora"
  s = s.replace(/,\s*/g, ', ')
  for (let i = 0; i < 3; i += 1) {
    const next = s.replace(
      /^(ok|okay|va bene|bene|allora|quindi|perfetto|certo|right|well|so|then|please|per\s+favore)[,.]?\s+/i,
      '',
    )
    if (next === s) break
    s = next
  }
  return s
}
