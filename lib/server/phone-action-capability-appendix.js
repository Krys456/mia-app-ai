/**
 * #315B — Ephemeral capability-truth appendix for Core.
 * INFORMATION ONLY — never authorizes or triggers Phone Actions.
 *
 * #325 — Inject only when the turn/recent thread is phone/capability-adjacent
 * (avoids ~1.8k always-on bloat on unrelated chat). Broad triggers prefer
 * honesty over omission.
 */

const PHONE_CAPABILITY_APPENDIX = [
  'PHONE ACTIONS — CURRENT CAPABILITY TRUTH (information only; do not invent device control):',
  'ShinkAIdo can attempt these REAL deterministic browser/OS handoffs when the user explicitly asks (a dedicated router executes them — not you pretending):',
  '- Open HTTPS handoffs: Spotify, YouTube, Google Maps, Gmail, WhatsApp (web/app)',
  '- Maps navigation directions handoff',
  '- Dialer handoff (tel:) — opens dialer only; never claim a call was placed',
  '- SMS composer handoff (sms:) — opens composer only; never claim SMS sent',
  '- WhatsApp compose handoff (wa.me) — opens chat ready; never claim WhatsApp message sent',
  '- mailto: mail composer handoff — never claim email sent',
  '- Clipboard copy of the last assistant reply',
  '- Web Share of the last assistant reply (when the browser supports it)',
  '- Open Vision AI camera (in-app)',
  'NOT available on this Web/PWA (say so honestly; do not claim they work):',
  '- Automatic send of SMS / WhatsApp / email',
  '- Native phone Notes app opening',
  '- Bluetooth / Wi-Fi / airplane / system volume / silent mode toggles',
  '- Native Clock alarms (web Timer exists separately; alarms need native integration)',
  '- Contact-name resolution (“Chiama Marco”) without an explicit number',
  'Critical consistency rules:',
  '- NEVER claim that Gmail open, clipboard copy, SMS/WhatsApp composer, Maps, Spotify, YouTube, dialer, mailto, Share, or Vision are impossible if the user just used them or asks whether they exist — they ARE implemented as handoffs.',
  '- NEVER say you “mistakenly pretended” those handoffs worked when describing past turns — those were real deterministic actions.',
  '- When asked “puoi aprire WhatsApp?”, explain you can open/hand off WhatsApp (and compose with a number) but cannot send messages automatically.',
  '- This appendix NEVER triggers actions by itself. Only the user’s explicit request via the Phone Action router performs handoffs.',
].join('\n')

/**
 * Broad phone/capability-adjacent detector (IT/EN). Prefer false positives
 * (include appendix) over false negatives (omit truth when needed).
 *
 * @param {string} text
 * @returns {boolean}
 */
export function isPhoneCapabilityRelevantText(text) {
  const t = String(text || '')
  if (!t.trim()) return false
  return /\b(?:apri|aprire|open|phone|telefono|chiama|chiamare|call|dial|sms|whatsapp|wa\.me|gmail|mailto|email|mail|clipboard|copia|copy|share|condividi|maps|mappe|naviga|navigation|spotify|youtube|vision\s*ai|fotocamera|camera|bluetooth|wi-?fi|aereo|airplane|volume|sveglia|alarm|puoi\s+aprire|can\s+you\s+open|on\s+my\s+(?:phone|device)|sul\s+mio\s+telefono|handoff|composer|compos(?:er|izione))\b/i.test(
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
export function shouldInjectPhoneCapabilityAppendix(input = {}) {
  if (input.force === true) return true
  if (isPhoneCapabilityRelevantText(input.userMessage || '')) return true
  const recent = Array.isArray(input.recentMessages) ? input.recentMessages : []
  // Scan last few turns for capability talk (broad honesty net).
  for (const m of recent.slice(-6)) {
    if (isPhoneCapabilityRelevantText(m?.content || '')) return true
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
export function buildPhoneActionCapabilityAppendix(input = {}) {
  // Backward-compatible: no-arg / empty → always return (legacy callers).
  // When options object is passed (even empty), apply conditional gating.
  if (arguments.length === 0) return PHONE_CAPABILITY_APPENDIX
  if (!shouldInjectPhoneCapabilityAppendix(input)) return ''
  return PHONE_CAPABILITY_APPENDIX
}
