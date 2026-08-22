/**
 * #364C — Ephemeral local-capability awareness for Core (mixed-turn honesty).
 * INFORMATION ONLY — never authorizes or triggers Timer/Reminder/etc.
 *
 * Mirrors phone-action-capability-appendix.js: inject when the turn is
 * capability-adjacent so Core does not falsely deny product abilities.
 * #364B may route mixed turns to Core without executing the local action.
 */

export const LOCAL_CAPABILITY_AWARENESS_BUILD = '364c-1'

const LOCAL_CAPABILITY_AWARENESS_APPENDIX = [
  'LOCAL CAPABILITIES — CURRENT TRUTH (information only; do not invent execution):',
  'ShinkAIdo has real deterministic local capabilities (dedicated routers — not you pretending):',
  '- Timer (set / adjust / cancel countdown)',
  '- Reminders (create / list / complete — with confirmation when required)',
  '- Calculator, Unit conversion, Weather, Translation, Daily Briefing',
  'Critical honesty rules:',
  '- NEVER say you cannot set timers, create reminders, calculate, convert units, check weather, or translate — those capabilities exist in this product.',
  '- NEVER claim a timer started, a reminder was saved, a calculation card was shown, weather was fetched, or a translation completed UNLESS the conversation history already shows that local result for THIS request.',
  '- When a mixed message reaches you (capability ask + advice/other ask): answer ALL material parts. For the capability side: acknowledge the capability exists; state clearly it was not executed in this turn if no local result is present; the user can send a dedicated single-purpose request to run it. Do not deny the product ability.',
  '- This appendix NEVER triggers actions by itself.',
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
