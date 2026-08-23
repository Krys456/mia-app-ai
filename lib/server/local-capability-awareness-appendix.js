/**
 * #364C — Ephemeral local-capability awareness for Core (mixed-turn honesty).
 * #366B — User-facing register: same truth, natural conversation (no status-report voice).
 * INFORMATION ONLY — never authorizes or triggers Timer/Reminder/etc.
 *
 * Mirrors phone-action-capability-appendix.js: inject when the turn is
 * capability-adjacent so Core does not falsely deny product abilities.
 * #364B may route mixed turns to Core without executing the local action.
 */

export const LOCAL_CAPABILITY_AWARENESS_BUILD = '366b-1'

const LOCAL_CAPABILITY_AWARENESS_APPENDIX = [
  'LOCAL CAPABILITIES — CURRENT TRUTH (information only; do not invent execution):',
  'ShinkAIdo can really set timers, create reminders, calculate, convert units, check weather, translate, and build a daily briefing via dedicated product actions (not by you pretending).',
  'Honesty (must hold):',
  '- NEVER say you cannot set timers, create reminders, calculate, convert units, check weather, or translate — those abilities exist.',
  '- NEVER claim a timer started, a reminder was saved, a calc/weather/translation result completed, UNLESS the conversation history already shows that product result for this ask.',
  '- This appendix NEVER triggers actions by itself.',
  'User-facing register (TRUTH ≠ INTERNAL JARGON):',
  '- Keep execution state INTERNAL. Speak only the natural consequence to the user.',
  '- FORBIDDEN in normal user-facing prose: "in this turn" / "in questo turno"; "not executed" / "non è stato eseguito" / "non sono stati eseguiti"; "capability"; "router"; "local result"; "dedicated request" / "richiesta dedicata"; "Posso farlo, ma…"; "Per procedere…"; "La richiesta…"; "Non risulta…"; similar status-report / implementation vocabulary.',
  '- When a message mixes an action ask (timer/reminder/…) with advice or another question: answer the conversational substance naturally; mention the action handoff briefly — do not center the reply on a disclaimer. Order by conversational flow, not a rigid template.',
  '- Style examples (not fixed output): "Mandami timer e promemoria in due messaggi separati e li imposto. Sul recupero invece…" / "Facciamo così: mandami il timer da solo e lo imposto. Intanto, sui 90 secondi di recupero…" / EN: "Send the timer alone and I\'ll set it. On the rest period…"',
  '- Same truth as before: action not run yet when no product result is in history → invite a separate clear message so it can be set — without narrating internal execution.',
].join('\n')

/**
 * Broad local-capability-adjacent detector (IT/EN). Prefer false positives.
 * @param {string} text
 * @returns {boolean}
 */
export function isLocalCapabilityRelevantText(text) {
  const t = String(text || '')
  if (!t.trim()) return false
  return /\b(?:timer|sveglia|countdown|ricordami|ricorda\s+mi|promemoria|remind(?:\s+me)?|quanto\s+fa|calcola(?:re|lo)?|calculate|converti|convert|che\s+tempo(?:\s+fa)?|meteo|weather|forecast|traduci|traduzione|translate|come\s+si\s+dice|how\s+do\s+you\s+say|briefing|riepilogo\s+(?:della\s+)?giornata)\b/i.test(
    t,
  )
}

/**
 * @param {{
 *   userMessage?: string
 *   recentMessages?: Array<{ role?: string, content?: string }>
 *   force?: boolean
 * }} [input]
 * @returns {boolean}
 */
export function shouldInjectLocalCapabilityAwareness(input = {}) {
  if (input.force === true) return true
  if (isLocalCapabilityRelevantText(input.userMessage || '')) return true
  const recent = Array.isArray(input.recentMessages) ? input.recentMessages : []
  for (const m of recent.slice(-4)) {
    if (isLocalCapabilityRelevantText(m?.content || '')) return true
  }
  return false
}

/**
 * @param {{
 *   userMessage?: string
 *   recentMessages?: Array<{ role?: string, content?: string }>
 *   force?: boolean
 * }} [input]
 * @returns {string}
 */
export function buildLocalCapabilityAwarenessAppendix(input = {}) {
  if (arguments.length === 0) return LOCAL_CAPABILITY_AWARENESS_APPENDIX
  if (!shouldInjectLocalCapabilityAwareness(input)) return ''
  return LOCAL_CAPABILITY_AWARENESS_APPENDIX
}
