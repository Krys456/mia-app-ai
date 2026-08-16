/**
 * Conversational Memory Control — specific forget (PR1) + forget-all (PR2).
 *
 * Deterministic gate: detect forget intents, mutate owner-scoped memories,
 * return truthful acks. No second LLM call for resolved control turns.
 */

import {
  buildCofavoriteFactKey,
  cleanFavoritePreferenceValue,
  deleteAllMemories,
  detectMemoryTopic,
  favoriteValueSlugFromContent,
  hasMetaNegationCue,
  isTerminalInterrogativeUtterance,
  listActiveMemoriesForOwner,
  listActiveRowsForFactKey,
  markMemoriesObsolete,
  normalizeFavoriteSubjectKey,
  readFactKeyFromTags,
  scoreMemoryRelevance,
  slugifyFactKeyPart,
  stripExplicitMemoryIntent,
} from './brain-memory.js'
import { resolveControlReplyLanguage } from './language-awareness.js'
import { getServiceSupabase } from './supabase.js'

/** Minimum relevance score for search-fallback forget targets. */
export const FORGET_MIN_SCORE = 8

/** Exact confirmation prompts — used as the pending-confirmation marker. */
export const FORGET_ALL_CONFIRM_PROMPT_IT =
  'Vuoi davvero che dimentichi tutte le informazioni che ho memorizzato su di te?'
export const FORGET_ALL_CONFIRM_PROMPT_EN =
  'Do you really want me to forget everything I have stored about you?'

export const ACK_SPECIFIC_FORGET_IT = "Fatto, l'ho dimenticato."
export const ACK_SPECIFIC_FORGET_EN = "Done — I've forgotten that."
export const ACK_SPECIFIC_FORGET_ES = 'Hecho, lo he olvidado.'
export const ACK_SPECIFIC_FORGET_FR = "C'est fait, je l'ai oublié."
export const ACK_SPECIFIC_FORGET_DE = 'Erledigt, ich habe es vergessen.'
export const ACK_FORGET_ALL_SUCCESS_IT =
  'Fatto. Ho dimenticato tutte le informazioni che avevo memorizzato su di te.'
export const ACK_FORGET_ALL_SUCCESS_EN =
  'Done. I have forgotten everything I had stored about you.'
export const ACK_FORGET_ALL_SUCCESS_ES =
  'Hecho. He olvidado toda la información que había guardado sobre ti.'
export const ACK_FORGET_ALL_SUCCESS_FR =
  "C'est fait. J'ai oublié toutes les informations que j'avais mémorisées sur toi."
export const ACK_FORGET_ALL_SUCCESS_DE =
  'Erledigt. Ich habe alle Informationen vergessen, die ich über dich gespeichert hatte.'

const FORGET_ALL_CONFIRM_PROMPT_ES =
  '¿De verdad quieres que olvide toda la información que he guardado sobre ti?'
const FORGET_ALL_CONFIRM_PROMPT_FR =
  'Veux-tu vraiment que j’oublie toutes les informations que j’ai mémorisées sur toi ?'
const FORGET_ALL_CONFIRM_PROMPT_DE =
  'Möchtest du wirklich, dass ich alle Informationen vergesse, die ich über dich gespeichert habe?'

const PET_NAME_SPECIES = {
  cane: 'dog',
  cagna: 'dog',
  cagnolino: 'dog',
  dog: 'dog',
  puppy: 'dog',
  gatto: 'cat',
  micetto: 'cat',
  micia: 'cat',
  cat: 'cat',
  kitten: 'cat',
}

/**
 * Normalize control text for intent / prompt matching (spaces, quotes, punctuation).
 * @param {string} text
 */
export function normalizeControlText(text) {
  return String(text || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * @param {string} text
 */
export function normalizeControlPrompt(text) {
  return normalizeControlText(text)
    .replace(/[.!?…]+$/u, '')
    .trim()
}

/**
 * Explicit SAVE wrappers must never be treated as forget.
 * @param {string} message
 */
export function isExplicitSaveMemoryIntent(message) {
  const raw = normalizeControlText(message)
  if (!raw) return false
  if (/^non\s+dimenticare(?:\s+che)?\b/i.test(raw)) return true
  const stripped = stripExplicitMemoryIntent(raw)
  return stripped.explicitIntent === true
}

/**
 * Wipe-all shape (self-scoped). Used by global parser and as a hard Specific-Forget ban.
 * @param {string} message
 */
export function isSelfScopedWipeShape(message) {
  const raw = normalizeControlText(message)
  if (!raw) return false
  if (isExplicitSaveMemoryIntent(raw)) return false

  const hasEraseVerb =
    /\b(?:dimentica|dimenticati|cancella|elimina|forget|delete|clear)\b/i.test(raw) ||
    /\bnon\s+ricord(?:are|arti)\s+pi[uù]\b/i.test(raw) ||
    /\bdon['\u2019]?t\s+remember\b/i.test(raw) ||
    /\bdo\s+not\s+remember\b/i.test(raw)

  const hasAll =
    /\b(?:tutto|tutti|tutta|tutte|everything|all)\b/i.test(raw) ||
    /\bniente\s+di\s+me\b/i.test(raw) ||
    /\bnulla\s+di\s+me\b/i.test(raw) ||
    /\banything\s+about\s+me\b/i.test(raw)

  const hasSelfScope =
    /\b(?:su\s+di\s+me|di\s+me|about\s+me|miei\s+ricordi|my\s+memories)\b/i.test(raw) ||
    /\bquello\s+che\s+(?:sai|ricordi|conosci)(?:\s+(?:su\s+di\s+me|di\s+me))?\b/i.test(raw)

  return hasEraseVerb && hasAll && hasSelfScope
}

/**
 * Global wipe intent — must be checked before specific forget.
 * @param {string} message
 */
export function isGlobalForgetIntent(message) {
  const raw = normalizeControlText(message)
  if (!raw) return false
  if (isExplicitSaveMemoryIntent(raw)) return false
  // #265: descriptive / third-party / meta / negated must never enter Forget All.
  // Confirmation UX for valid wipe directives is unchanged.
  if (isTerminalInterrogativeUtterance(raw)) return false
  if (isThirdPartyForgetIntent(raw)) return false
  if (isMetaOrQuotedForgetGuard(raw)) return false
  if (isNegatedForgetDirective(raw)) return false
  if (isConversationalForgetAbout(raw)) return false
  if (isDescriptiveForgetUse(raw)) return false

  if (isSelfScopedWipeShape(raw)) return true

  // Extra explicit EN/IT forms (belt-and-suspenders)
  if (
    /\bforget\s+everything\s+(?:you\s+know\s+)?about\s+me\b/i.test(raw) ||
    /\bforget\s+all\s+(?:of\s+)?my\s+memories\b/i.test(raw) ||
    /\bdelete\s+all\s+(?:of\s+)?my\s+memories\b/i.test(raw) ||
    /\bclear\s+all\s+(?:of\s+)?my\s+memories\b/i.test(raw)
  ) {
    return true
  }

  return false
}

/**
 * Third-party / quoted forget intent — not a direct user command to LAIfe.
 * @param {string} message
 */
export function isThirdPartyForgetIntent(message) {
  const raw = normalizeControlText(message)
  if (!raw) return false
  if (
    /\b(?:amico|amica|fratello|sorella|madre|padre|marito|moglie|partner|figlio|figlia|friend|brother|sister|mom|dad|husband|wife|son|daughter)\b/i.test(
      raw,
    ) &&
    /\b(?:dimentic|forget|cancella|elimina)\w*\b/i.test(raw)
  ) {
    return true
  }
  if (/\b(?:vuole|voluto|vuoi)\s+(?:che\s+)?(?:tu\s+)?dimentich/i.test(raw)) return true
  if (/\bwants?\s+(?:me\s+)?to\s+forget\b/i.test(raw)) return true
  if (/\b(?:mi\s+ha\s+detto|told\s+me)\s+(?:di\s+)?(?:to\s+)?forget\b/i.test(raw)) return true
  if (/\bmi\s+ha\s+detto\s+di\s+dimenticare\b/i.test(raw)) return true
  if (/\bi\s+told\s+(?:him|her|them)\s+to\s+forget\b/i.test(raw)) return true
  if (/\b(?:he|she|they)\s+(?:said|says|told)\b[\s\S]{0,48}\bforget\b/i.test(raw)) return true
  if (/\bha\s+detto\b[\s\S]{0,48}\bdimentic/i.test(raw)) return true
  return false
}

/**
 * Narrow meta / example / negation-of-request / conditional guards (no NLP engine).
 * @param {string} message
 */
export function isMetaOrQuotedForgetGuard(message) {
  const raw = normalizeControlText(message)
  if (!raw) return false
  if (hasMetaNegationCue(raw)) return true
  if (/\bcome\s+esempio\b|\bas\s+an\s+example\b/i.test(raw)) return true
  if (/\bnon\s+ti\s+sto\s+chiedendo\b|\bi\s*['']?m\s+not\s+asking\s+you\s+to\s+forget\b/i.test(raw)) {
    return true
  }
  if (/\bnon\s+(?:ti\s+)?(?:sto\s+)?chiedendo\s+di\s+dimenticare\b/i.test(raw)) return true
  if (/\bse\s+ti\s+dicessi\b|\bif\s+i\s+(?:were\s+to\s+)?(?:tell\s+you|said)\b/i.test(raw)) {
    return true
  }
  if (/\bho\s+detto\b[\s\S]{0,40}\bdimentic/i.test(raw)) return true
  if (/\bi\s+said\b[\s\S]{0,40}\bforget\b/i.test(raw)) return true
  if (/\b[eè]\s+falso\s+che\b.*\bdimentic/i.test(raw)) return true
  // Conditionals / hypotheticals (directive must not fire)
  if (/\bif\s+i\s+forget\b|\bif\s+you\s+forget\b|\bwhat\s+if\s+i\s+forget\b/i.test(raw)) {
    return true
  }
  if (/\bse\s+(?:io\s+)?dimentic/i.test(raw)) return true
  // Quoted mention of a forget command (not a live directive)
  if (/["“”'«»].{0,80}\b(?:forget|dimentica)\b.{0,80}["“”'«»]/i.test(raw)) return true
  return false
}

/**
 * Negated "do not delete" phrasings that must never mutate.
 * Complements save-wrapper (`Don't forget that…` / `Non dimenticare…`).
 * @param {string} message
 */
export function isNegatedForgetDirective(message) {
  const raw = normalizeControlText(message)
  if (!raw) return false
  if (/\bnever\s+forget\b/i.test(raw)) return true
  if (/\bi\s+don['\u2019]?t\s+want\s+you\s+to\s+forget\b/i.test(raw)) return true
  if (/\bi\s+didn['\u2019]?t\s+tell\s+you\s+to\s+forget\b/i.test(raw)) return true
  if (/\bnon\s+voglio\s+che\s+(?:tu\s+)?dimentich/i.test(raw)) return true
  if (/\bnon\s+ti\s+ho\s+detto\s+di\s+dimenticare\b/i.test(raw)) return true
  return false
}

/**
 * Conversational topic drop — not durable Memory deletion.
 * @param {string} message
 */
export function isConversationalForgetAbout(message) {
  const raw = normalizeControlText(message)
  if (!raw) return false
  if (/\blet['\u2019]?s\s+forget\s+about\b/i.test(raw)) return true
  if (/\bdimentichiamoci\b/i.test(raw)) return true
  return false
}

/**
 * Descriptive / cognitive / third-person occurrence of forget — not USER→LAIfe directive.
 * @param {string} message
 */
export function isDescriptiveForgetUse(message) {
  const raw = normalizeControlText(message)
  if (!raw) return false

  // First-person cognitive English
  if (/\bi\s+forget\b/i.test(raw)) return true
  if (/\bi\s+forgot\b/i.test(raw)) return true
  if (/\bi\s+(?:keep\s+)?forgetting\b/i.test(raw)) return true
  if (/\bsometimes\s+i\s+forget\b/i.test(raw)) return true

  // Generic / third-person English subjects
  if (
    /\b(?:people|someone|everybody|everyone|they|he|she)\s+forget(?:s|ting)?\b/i.test(raw)
  ) {
    return true
  }

  // Italian first-person / non-imperative stems (not leading "Dimentica …")
  if (/\b(?:ho\s+)?dimenticat[oaie]\b/i.test(raw)) return true
  if (/\b(?:mi\s+)?dimentico\b/i.test(raw)) return true
  if (/\ba\s+volte\s+dimentico\b/i.test(raw)) return true

  // Mid-sentence IT "dimentica" as 3rd-person indicative (not leading imperative,
  // not trailing clitic dimenticalo/a/i).
  if (
    /\bdimentica\b/i.test(raw) &&
    !/^(?:per\s+favore\s+)?dimentica\b/i.test(raw) &&
    !/\bdimentical(?:o|a|i|e|ne)\b/i.test(raw)
  ) {
    return true
  }

  return false
}

/**
 * Positive USER → LAIfe destructive-forget directive shapes only.
 * Does NOT use bare occurrence `/\bforget\b/`.
 * @param {string} message
 */
export function matchesSpecificForgetDirective(message) {
  const raw = normalizeControlText(message)
  if (!raw) return false

  // —— English leading directives ——
  if (/^(?:please\s+)?forget\b/i.test(raw)) return true
  if (/^i\s+want\s+you\s+to\s+forget\b/i.test(raw)) return true
  if (/^i(?:['\u2019]d|\s+would)\s+like\s+you\s+to\s+forget\b/i.test(raw)) return true
  if (/^don['\u2019]?t\s+remember\b/i.test(raw)) return true
  if (/^do\s+not\s+remember\b/i.test(raw)) return true
  if (/^stop\s+remembering\b/i.test(raw)) return true

  // —— Italian leading directives (imperative / want-you-to) ——
  if (/^(?:per\s+favore\s+)?dimentica\b/i.test(raw)) return true
  if (/^(?:per\s+favore\s+)?dimenticati\b/i.test(raw)) return true
  if (/^(?:per\s+favore\s+)?puoi\s+dimenticare\b/i.test(raw)) return true
  if (/^voglio\s+che\s+(?:tu\s+)?dimentichi\b/i.test(raw)) return true
  // Note: do not use \b after "più" — JS \w excludes accented letters.
  if (/^non\s+ricord(?:are|arti)\s+pi[uù](?=\s|$|[.,!?])/i.test(raw)) return true

  // —— Trailing clitics / "forget it" after a statement (existing product) ——
  if (/\bdimentical(?:o|a|i|e|ne)\b\s*[.!]?\s*$/i.test(raw)) return true
  if (/\bforget\s+(?:it|that)\b\s*[.!]?\s*$/i.test(raw)) return true

  return false
}

/**
 * Specific Forget requires a clear USER → LAIfe directive (#265).
 * Mere occurrence of forget/dimentica is not enough.
 *
 * @param {string} message
 * @returns {boolean}
 */
export function isSpecificForgetIntent(message) {
  const raw = normalizeControlText(message)
  if (!raw) return false
  if (isExplicitSaveMemoryIntent(raw)) return false
  // HARD PRECEDENCE: wipe-all shapes never enter Specific Forget.
  if (isGlobalForgetIntent(raw) || isSelfScopedWipeShape(raw)) return false
  // Questions / third-party / meta / descriptive must never mutate via Specific Forget.
  if (isTerminalInterrogativeUtterance(raw)) return false
  if (isThirdPartyForgetIntent(raw)) return false
  if (isMetaOrQuotedForgetGuard(raw)) return false
  if (isNegatedForgetDirective(raw)) return false
  if (isConversationalForgetAbout(raw)) return false
  if (isDescriptiveForgetUse(raw)) return false

  return matchesSpecificForgetDirective(raw)
}

/**
 * @param {string} text
 * @returns {'it' | 'en' | 'es' | 'fr' | 'de' | null}
 */
export function matchForgetAllConfirmPrompt(text) {
  const raw = normalizeControlPrompt(text)
  if (!raw) return null
  if (raw === normalizeControlPrompt(FORGET_ALL_CONFIRM_PROMPT_IT)) return 'it'
  if (raw === normalizeControlPrompt(FORGET_ALL_CONFIRM_PROMPT_EN)) return 'en'
  if (raw === normalizeControlPrompt(FORGET_ALL_CONFIRM_PROMPT_ES)) return 'es'
  if (raw === normalizeControlPrompt(FORGET_ALL_CONFIRM_PROMPT_FR)) return 'fr'
  if (raw === normalizeControlPrompt(FORGET_ALL_CONFIRM_PROMPT_DE)) return 'de'
  return null
}

/**
 * Conservative explicit confirmation of wipe.
 * @param {string} message
 */
export function isForgetAllConfirmReply(message) {
  const raw = normalizeControlPrompt(message)
  if (!raw) return false
  return /^(?:s[iì]|s[iì]\s*,?\s*confermo|confermo|certo|procedi|fallo|yes|yes\s*,?\s*confirm|i\s+confirm|confirm|proceed|do\s+it|sí|si\s*,?\s*confirmo|oui|oui\s*,?\s*je\s+confirme|ja|ja\s*,?\s*bestätige)$/i.test(
    raw,
  )
}

/**
 * Conservative explicit rejection of wipe.
 * @param {string} message
 */
export function isForgetAllRejectReply(message) {
  const raw = normalizeControlPrompt(message)
  if (!raw) return false
  return /^(?:no|annulla|lascia\s+stare|non\s+farlo|cancel|never\s+mind|don['\u2019]?t\s+do\s+it)$/i.test(
    raw,
  )
}

/**
 * Find pending forget-all confirmation from recent chat messages.
 * Only the assistant turn immediately before the current user message counts.
 *
 * @param {Array<{ role?: string, content?: string }>} messages
 * @returns {{ pending: boolean, lang: 'it' | 'en' | null }}
 */
export function findPendingForgetAllConfirmation(messages) {
  const list = Array.isArray(messages) ? messages : []
  if (list.length < 2) return { pending: false, lang: null }

  let lastUserIdx = -1
  for (let i = list.length - 1; i >= 0; i -= 1) {
    if (list[i]?.role === 'user' && String(list[i]?.content || '').trim()) {
      lastUserIdx = i
      break
    }
  }
  if (lastUserIdx <= 0) return { pending: false, lang: null }

  for (let i = lastUserIdx - 1; i >= 0; i -= 1) {
    const role = list[i]?.role
    const content = String(list[i]?.content || '').trim()
    if (!content) continue
    if (role === 'assistant') {
      const lang = matchForgetAllConfirmPrompt(content)
      return lang ? { pending: true, lang } : { pending: false, lang: null }
    }
    return { pending: false, lang: null }
  }

  return { pending: false, lang: null }
}

function ackForgetAllConfirmAsk(lang) {
  if (lang === 'en') return FORGET_ALL_CONFIRM_PROMPT_EN
  if (lang === 'es') return FORGET_ALL_CONFIRM_PROMPT_ES
  if (lang === 'fr') return FORGET_ALL_CONFIRM_PROMPT_FR
  if (lang === 'de') return FORGET_ALL_CONFIRM_PROMPT_DE
  return FORGET_ALL_CONFIRM_PROMPT_IT
}

function ackForgetAllSuccess(lang) {
  if (lang === 'en') return ACK_FORGET_ALL_SUCCESS_EN
  if (lang === 'es') return ACK_FORGET_ALL_SUCCESS_ES
  if (lang === 'fr') return ACK_FORGET_ALL_SUCCESS_FR
  if (lang === 'de') return ACK_FORGET_ALL_SUCCESS_DE
  return ACK_FORGET_ALL_SUCCESS_IT
}

function ackForgetAllCancel(lang) {
  if (lang === 'en') return "Okay — I didn't delete any memories."
  if (lang === 'es') return 'Vale — no he borrado ningún recuerdo.'
  if (lang === 'fr') return "D'accord — je n'ai supprimé aucun souvenir."
  if (lang === 'de') return 'Okay — ich habe keine Erinnerungen gelöscht.'
  return 'Va bene, non ho cancellato nessuna memoria.'
}

function ackForgetAllError(lang) {
  if (lang === 'en') return "I couldn't delete the memories right now."
  if (lang === 'es') return 'No pude borrar los recuerdos ahora mismo.'
  if (lang === 'fr') return "Je n'ai pas pu supprimer les souvenirs pour le moment."
  if (lang === 'de') return 'Ich konnte die Erinnerungen gerade nicht löschen.'
  return 'Non sono riuscito a cancellare le memorie in questo momento.'
}

function ackForgetAllUnauthenticated(lang) {
  if (lang === 'en') return "I can't erase saved memories without a signed-in session."
  if (lang === 'es') return 'No puedo borrar recuerdos guardados sin una sesión iniciada.'
  if (lang === 'fr') return 'Je ne peux pas effacer les souvenirs enregistrés sans session connectée.'
  if (lang === 'de') return 'Ohne angemeldete Sitzung kann ich gespeicherte Erinnerungen nicht löschen.'
  return 'Non posso cancellare i ricordi salvati senza una sessione autenticata.'
}

function ackMetaAfterSpecific(lang) {
  if (lang === 'en') {
    return 'No. That memory was removed from active memory, so it should not be recalled in new chats.'
  }
  if (lang === 'es') {
    return 'No. Ese recuerdo se eliminó de la memoria activa, así que no debería recuperarse en chats nuevos.'
  }
  if (lang === 'fr') {
    return "Non. Ce souvenir a été retiré de la mémoire active, donc il ne devrait pas être rappelé dans de nouveaux chats."
  }
  if (lang === 'de') {
    return 'Nein. Diese Erinnerung wurde aus dem aktiven Speicher entfernt und sollte in neuen Chats nicht abgerufen werden.'
  }
  return 'No. Quella memoria è stata rimossa dalla memoria attiva, quindi non dovrebbe essere recuperata nelle nuove chat.'
}

function ackMetaAfterAll(lang) {
  if (lang === 'en') {
    return 'No. The saved memories were deleted, so they should not be recalled in new chats.'
  }
  if (lang === 'es') {
    return 'No. Los recuerdos guardados se eliminaron, así que no deberían recuperarse en chats nuevos.'
  }
  if (lang === 'fr') {
    return 'Non. Les souvenirs enregistrés ont été supprimés, donc ils ne devraient pas être rappelés dans de nouveaux chats.'
  }
  if (lang === 'de') {
    return 'Nein. Die gespeicherten Erinnerungen wurden gelöscht und sollten in neuen Chats nicht abgerufen werden.'
  }
  return 'No. Le memorie salvate sono state cancellate, quindi non dovrebbero essere recuperate nelle nuove chat.'
}

/**
 * @param {string} text
 * @returns {{ kind: string, lang: 'it' | 'en' | 'es' | 'fr' | 'de' } | null}
 */
export function classifyPriorMemoryControlAck(text) {
  const raw = normalizeControlPrompt(text)
  if (!raw) return null

  const confirmLang = matchForgetAllConfirmPrompt(raw)
  if (confirmLang) return { kind: 'forget_all_confirm', lang: confirmLang }

  const allSuccess = [
    [ACK_FORGET_ALL_SUCCESS_IT, 'it'],
    [ACK_FORGET_ALL_SUCCESS_EN, 'en'],
    [ACK_FORGET_ALL_SUCCESS_ES, 'es'],
    [ACK_FORGET_ALL_SUCCESS_FR, 'fr'],
    [ACK_FORGET_ALL_SUCCESS_DE, 'de'],
  ]
  for (const [prompt, lang] of allSuccess) {
    if (raw === normalizeControlPrompt(prompt)) return { kind: 'forgotten_all', lang }
  }

  const specificSuccess = [
    [ACK_SPECIFIC_FORGET_IT, 'it'],
    [ACK_SPECIFIC_FORGET_EN, 'en'],
    [ACK_SPECIFIC_FORGET_ES, 'es'],
    [ACK_SPECIFIC_FORGET_FR, 'fr'],
    [ACK_SPECIFIC_FORGET_DE, 'de'],
  ]
  for (const [prompt, lang] of specificSuccess) {
    if (raw === normalizeControlPrompt(prompt)) return { kind: 'forgotten_specific', lang }
  }
  return null
}

/**
 * User asking whether a just-performed memory control persists across chats.
 * @param {string} message
 */
export function isMemoryPersistenceFollowUp(message) {
  const raw = normalizeControlText(message)
  if (!raw) return false
  if (isGlobalForgetIntent(raw) || isSpecificForgetIntent(raw)) return false
  return (
    /\b(?:nuova\s+chat|new\s+chat)\b/i.test(raw) ||
    /\b(?:ricorderai|ricordi\s+ancora|still\s+remember|will\s+you\s+remember)\b/i.test(raw) ||
    /\b(?:assicuri|assicur|sure\s+that)\b/i.test(raw) ||
    /\bnon\s+(?:lo|la|li|le)?\s*ricord/i.test(raw) ||
    /\b(?:recuper|recalled?|memorizzat)\b/i.test(raw)
  )
}

/**
 * @param {Array<{ role?: string, content?: string }>} messages
 */
function priorAssistantContent(messages) {
  const list = Array.isArray(messages) ? messages : []
  let lastUserIdx = -1
  for (let i = list.length - 1; i >= 0; i -= 1) {
    if (list[i]?.role === 'user' && String(list[i]?.content || '').trim()) {
      lastUserIdx = i
      break
    }
  }
  if (lastUserIdx <= 0) return ''
  for (let i = lastUserIdx - 1; i >= 0; i -= 1) {
    const role = list[i]?.role
    const content = String(list[i]?.content || '').trim()
    if (!content) continue
    if (role === 'assistant') return content
    return ''
  }
  return ''
}

/**
 * Deterministic meta answer after a successful memory-control ack in the prior turn.
 * @param {{ userMessage: string, messages?: Array<{ role?: string, content?: string }> }} input
 */
export function tryHandleMemoryMetaFollowUp(input) {
  const userMessage = typeof input?.userMessage === 'string' ? input.userMessage.trim() : ''
  if (!userMessage || !isMemoryPersistenceFollowUp(userMessage)) {
    return { handled: false, status: 'not_meta', message: '', skippedModel: false }
  }

  const prior = classifyPriorMemoryControlAck(priorAssistantContent(input.messages))
  if (!prior) {
    return { handled: false, status: 'not_meta', message: '', skippedModel: false }
  }

  if (prior.kind === 'forgotten_specific') {
    return {
      handled: true,
      status: 'meta_after_specific_forget',
      message: ackMetaAfterSpecific(prior.lang),
      skippedModel: true,
    }
  }
  if (prior.kind === 'forgotten_all') {
    return {
      handled: true,
      status: 'meta_after_forget_all',
      message: ackMetaAfterAll(prior.lang),
      skippedModel: true,
    }
  }

  return { handled: false, status: 'not_meta', message: '', skippedModel: false }
}

/**
 * Handle global forget request / pending confirmation / rejection.
 *
 * @param {{
 *   userMessage: string
 *   userId: string | null | undefined
 *   messages?: Array<{ role?: string, content?: string }>
 *   supabase?: any
 *   deleteAllMemories?: typeof deleteAllMemories
 * }} input
 */
export async function tryHandleForgetAll(input) {
  const userMessage = typeof input?.userMessage === 'string' ? input.userMessage.trim() : ''
  const messages = Array.isArray(input?.messages) ? input.messages : []
  const pending = findPendingForgetAllConfirmation(messages)
  const deleteAll = input.deleteAllMemories ?? deleteAllMemories

  // 1) Pending confirmation chain
  if (pending.pending) {
    const lang = pending.lang || 'it'

    if (isForgetAllConfirmReply(userMessage)) {
      const userId = typeof input?.userId === 'string' ? input.userId.trim() : ''
      if (!userId) {
        return {
          handled: true,
          status: 'unauthenticated',
          message: ackForgetAllUnauthenticated(lang),
          deletedCount: 0,
          skippedModel: true,
        }
      }

      try {
        const deletedCount = await deleteAll({
          userId,
          requireExplicitUserId: true,
          ...(input.supabase ? { supabase: input.supabase } : {}),
        })
        if (typeof deletedCount !== 'number' || deletedCount < 0) {
          return {
            handled: true,
            status: 'error',
            message: ackForgetAllError(lang),
            deletedCount: 0,
            skippedModel: true,
          }
        }
        return {
          handled: true,
          status: 'forgotten_all',
          message: ackForgetAllSuccess(lang),
          deletedCount,
          skippedModel: true,
        }
      } catch {
        return {
          handled: true,
          status: 'error',
          message: ackForgetAllError(lang),
          deletedCount: 0,
          skippedModel: true,
        }
      }
    }

    if (isForgetAllRejectReply(userMessage)) {
      return {
        handled: true,
        status: 'forget_all_cancelled',
        message: ackForgetAllCancel(lang),
        deletedCount: 0,
        skippedModel: true,
      }
    }

    // New wipe request while a prior confirm was pending → restart confirm (do not
    // fall through to Specific Forget).
    if (isGlobalForgetIntent(userMessage)) {
      const userId = typeof input?.userId === 'string' ? input.userId.trim() : ''
      const askLang = detectForgetLanguage(userMessage)
      if (!userId) {
        return {
          handled: true,
          status: 'unauthenticated',
          message: ackForgetAllUnauthenticated(askLang),
          deletedCount: 0,
          skippedModel: true,
        }
      }
      return {
        handled: true,
        status: 'forget_all_confirm_required',
        message: ackForgetAllConfirmAsk(askLang),
        deletedCount: 0,
        skippedModel: true,
      }
    }

    // Unrelated reply → abandon pending; let normal Core handle the message.
    return {
      handled: false,
      status: 'forget_all_abandoned',
      message: '',
      deletedCount: 0,
      skippedModel: false,
    }
  }

  // 2) New global forget request
  if (!userMessage || !isGlobalForgetIntent(userMessage)) {
    return {
      handled: false,
      status: 'not_forget_all',
      message: '',
      deletedCount: 0,
      skippedModel: false,
    }
  }

  const lang = detectForgetLanguage(userMessage)
  const userId = typeof input?.userId === 'string' ? input.userId.trim() : ''
  if (!userId) {
    return {
      handled: true,
      status: 'unauthenticated',
      message: ackForgetAllUnauthenticated(lang),
      deletedCount: 0,
      skippedModel: true,
    }
  }

  return {
    handled: true,
    status: 'forget_all_confirm_required',
    message: ackForgetAllConfirmAsk(lang),
    deletedCount: 0,
    skippedModel: true,
  }
}

/**
 * Unified memory-control gate:
 * pending forget-all → new forget-all → meta follow-up → specific forget.
 *
 * @param {{
 *   userMessage: string
 *   userId: string | null | undefined
 *   messages?: Array<{ role?: string, content?: string }>
 *   supabase?: any
 *   deleteAllMemories?: typeof deleteAllMemories
 *   onBeforeSpecificForget?: () => void
 * }} input
 */
export async function tryHandleMemoryControl(input) {
  const forgetAll = await tryHandleForgetAll(input)
  if (forgetAll.handled) {
    return {
      handled: true,
      status: forgetAll.status,
      message: forgetAll.message,
      skippedModel: forgetAll.skippedModel === true,
      deletedCount: forgetAll.deletedCount ?? 0,
      obsoletedIds: [],
      specificForgetInvoked: false,
    }
  }

  // Belt-and-suspenders: wipe shapes must never reach Specific Forget.
  if (isGlobalForgetIntent(input?.userMessage) || isSelfScopedWipeShape(input?.userMessage)) {
    const lang = detectForgetLanguage(String(input?.userMessage || ''))
    const userId = typeof input?.userId === 'string' ? input.userId.trim() : ''
    if (!userId) {
      return {
        handled: true,
        status: 'unauthenticated',
        message: ackForgetAllUnauthenticated(lang),
        skippedModel: true,
        deletedCount: 0,
        obsoletedIds: [],
        specificForgetInvoked: false,
      }
    }
    return {
      handled: true,
      status: 'forget_all_confirm_required',
      message: ackForgetAllConfirmAsk(lang),
      skippedModel: true,
      deletedCount: 0,
      obsoletedIds: [],
      specificForgetInvoked: false,
    }
  }

  const meta = tryHandleMemoryMetaFollowUp(input)
  if (meta.handled) {
    return {
      handled: true,
      status: meta.status,
      message: meta.message,
      skippedModel: true,
      deletedCount: 0,
      obsoletedIds: [],
      specificForgetInvoked: false,
    }
  }

  if (typeof input?.onBeforeSpecificForget === 'function') {
    input.onBeforeSpecificForget()
  }

  const specific = await tryHandleSpecificForget(input)
  if (specific.handled) {
    return {
      handled: true,
      status: specific.status,
      message: specific.message,
      skippedModel: specific.skippedModel === true,
      obsoletedIds: specific.obsoletedIds || [],
      candidates: specific.candidates,
      factKey: specific.factKey,
      deletedCount: 0,
      specificForgetInvoked: true,
    }
  }

  return {
    handled: false,
    status: 'none',
    message: '',
    skippedModel: false,
    obsoletedIds: [],
    deletedCount: 0,
    specificForgetInvoked: false,
  }
}

/**
 * Strip forget wrappers / trailing clitics to leave the target phrase.
 * @param {string} message
 * @returns {string}
 */
export function stripForgetWrapper(message) {
  let text = String(message || '').trim()
  if (!text) return ''

  text = text
    .replace(/^[.!\s]+|[.!\s]+$/g, '')
    .replace(
      /^(?:per\s+favore|please|puoi\s+(?:per\s+favore\s+)?|can\s+you\s+|could\s+you\s+)\s*/i,
      '',
    )
    .trim()

  const leading = [
    /^i\s+want\s+you\s+to\s+forget\s+(?:that\s+)?/i,
    /^i(?:['\u2019]d|\s+would)\s+like\s+you\s+to\s+forget\s+(?:that\s+)?/i,
    /^voglio\s+che\s+(?:tu\s+)?dimentichi\s+(?:che\s+)?/i,
    /^dimenticati\s+(?:di\s+)?/i,
    /^dimentica\s+(?:di\s+)?/i,
    /^dimenticare\s+(?:di\s+)?/i,
    /^non\s+ricord(?:are|arti)\s+pi[uù]\s+(?:che\s+)?/i,
    /^puoi\s+dimenticare\s+(?:che\s+)?/i,
    /^forget\s+that\s+/i,
    /^forget\s+about\s+/i,
    /^forget\s+my\s+/i,
    /^forget\s+/i,
    /^don'?t\s+remember\s+that\s+/i,
    /^don'?t\s+remember\s+/i,
    /^do\s+not\s+remember\s+that\s+/i,
    /^do\s+not\s+remember\s+/i,
    /^stop\s+remembering\s+(?:that\s+)?/i,
  ]

  for (const pattern of leading) {
    if (pattern.test(text)) {
      text = text.replace(pattern, '').trim()
      break
    }
  }

  text = text
    .replace(/[,;:]?\s*(?:dimenticalo|dimenticala|dimenticali|dimenticarne)\s*[.!]?\s*$/i, '')
    .replace(/[,;:]?\s*(?:forget\s+it|forget\s+that)\s*[.!]?\s*$/i, '')
    .replace(/^(?:che\s+|that\s+I\s+|that\s+)/i, '')
    .replace(/^[.!\s]+|[.!\s]+$/g, '')
    .trim()

  return text
}

/**
 * Detect language lightly from the original forget phrasing.
 * Uses shared language-awareness; clearly non-Italian must not default to Italian.
 * @param {string} message
 * @returns {'it' | 'en' | 'es' | 'fr' | 'de'}
 */
export function detectForgetLanguage(message) {
  return resolveControlReplyLanguage(message)
}

/**
 * Vague plural/demonstrative references must not multi-delete.
 * Do NOT treat "tutto..." wipe shapes as vague specific-forget targets.
 * @param {string} target
 */
export function isVagueForgetReference(target) {
  const t = normalizeControlText(target)
  if (!t) return true
  if (isSelfScopedWipeShape(`dimentica ${t}`) || isGlobalForgetIntent(`dimentica ${t}`)) {
    return false
  }
  if (
    /^(quello|quella|quelli|quelle|this|that|those|these|it)\b/i.test(t) &&
    /\b(sugli?|sulle?|sui|su|about|on|regarding)\b/i.test(t)
  ) {
    return true
  }
  if (/^(le\s+cose|i\s+ricordi)\b/i.test(t)) return true
  return false
}

/**
 * Explicit multi-target ("Naruto e Dragon Ball") — defer in PR1.
 * @param {string} target
 */
export function isExplicitMultiForgetTarget(target) {
  const t = String(target || '').trim()
  if (!t) return false
  if (/\b(?:\s+e\s+|\s+and\s+|,\s*)\b/i.test(t) && t.split(/\s+/).length >= 3) {
    return /\b(e|and)\b/i.test(t)
  }
  return false
}

/** EN plural favorite subjects → cofavorite set (not singular TYPE A slot). */
const EN_PLURAL_FAVORITE_SUBJECTS = new Set([
  'characters',
  'animals',
  'books',
  'games',
  'movies',
  'films',
  'series',
  'colors',
  'colours',
  'artists',
  'foods',
  'animes',
])

/**
 * @param {string} valueRaw
 * @returns {{ value: string, valueSlug: string } | null}
 */
function normalizeForgetValue(valueRaw) {
  const value = cleanFavoritePreferenceValue(valueRaw)
  if (!value || value.length < 2) return null
  const valueSlug = slugifyFactKeyPart(value)
  if (!valueSlug || valueSlug.length < 2) return null
  return { value, valueSlug }
}

/**
 * Deterministic typed Specific Forget classifier (no LLM).
 *
 * Precedence (most specific first):
 * 1. cofavorite_member
 * 2. cofavorite_set
 * 3. dislike
 * 4. like
 * 5. interest
 * 6. favorite_value (unless trailing clitic → slot)
 * 7. favorite_slot
 * 8. legacy exact (primary project / pet) via deriveForgetFactKey
 * 9. bare_entity
 * 10. unsupported (search fallback only)
 *
 * @param {string} message
 * @returns {{
 *   kind:
 *     | 'like'
 *     | 'dislike'
 *     | 'favorite_slot'
 *     | 'favorite_value'
 *     | 'cofavorite_set'
 *     | 'cofavorite_member'
 *     | 'interest'
 *     | 'bare_entity'
 *     | 'exact_key'
 *     | 'unsupported',
 *   subject?: string,
 *   value?: string,
 *   valueSlug?: string,
 *   factKey?: string | null,
 *   factKeyPrefix?: string | null,
 * }}
 */
export function classifySpecificForgetTarget(message) {
  const raw = normalizeControlText(message)
  if (!raw) return { kind: 'unsupported' }

  const hadClitic =
    /[,;:]?\s*(?:dimenticalo|dimenticala|dimenticali|dimenticarne)\s*[.!]?\s*$/i.test(raw) ||
    /[,;:]?\s*(?:forget\s+it|forget\s+that)\s*[.!]?\s*$/i.test(raw)

  const target = stripForgetWrapper(raw)
  const hay = `${raw}\n${target}`

  // —— 1. Cofavorite member ——
  {
    const member =
      target.match(
        /^(.+?)\s+(?:dai|tra)\s+(?:(?:i|gli|le)\s+)?mi(?:ei|e)\s+([A-Za-zÀ-ÖØ-öø-ÿ][\wÀ-ÖØ-öø-ÿ'-]{1,40})\s+preferit/i,
      ) ||
      target.match(
        /(?:che\s+)?(.+?)\s+[eè]\s+un[oa]\s+(?:dei|degli|delle)\s+mi(?:ei|e)\s+([A-Za-zÀ-ÖØ-öø-ÿ][\wÀ-ÖØ-öø-ÿ'-]{1,40})\s+preferit/i,
      ) ||
      target.match(
        /^(.+?)\s+from\s+my\s+favorite\s+([A-Za-z][\w'-]{1,40})\b/i,
      ) ||
      target.match(
        /(?:that\s+)?(.+?)\s+is\s+one\s+of\s+my\s+favorite\s+([A-Za-z][\w'-]{1,40})\b/i,
      )
    if (member?.[1] && member?.[2]) {
      const subject = normalizeFavoriteSubjectKey(member[2])
      const norm = normalizeForgetValue(member[1])
      if (subject && subject !== 'item' && norm) {
        return {
          kind: 'cofavorite_member',
          subject,
          value: norm.value,
          valueSlug: norm.valueSlug,
          factKey: buildCofavoriteFactKey(subject, norm.value),
        }
      }
    }
  }

  // —— 2. Cofavorite set (plural possessives / EN plural subjects / all) ——
  {
    const setIt = target.match(
      /(?:tutti\s+|tutte\s+)?(?:i|gli|le)\s+mi(?:ei|e)\s+([A-Za-zÀ-ÖØ-öø-ÿ][\wÀ-ÖØ-öø-ÿ'-]{1,40})\s+preferit[ie]\b/i,
    )
    const setEnAll = target.match(
      /(?:all\s+)?(?:of\s+)?my\s+favorite\s+([A-Za-z][\w'-]{1,40})\b/i,
    )
    const setEnBare = target.match(/^favorite\s+([A-Za-z][\w'-]{1,40})\b/i)
    let subjectRaw = setIt?.[1] || null
    if (!subjectRaw && setEnAll?.[1]) {
      const subj = setEnAll[1]
      const forcedAll = /\ball\s+(?:of\s+)?my\s+favorite\b/i.test(target)
      if (forcedAll || EN_PLURAL_FAVORITE_SUBJECTS.has(subj.toLowerCase())) {
        subjectRaw = subj
      }
    }
    if (!subjectRaw && setEnBare?.[1]) {
      const subj = setEnBare[1]
      if (EN_PLURAL_FAVORITE_SUBJECTS.has(subj.toLowerCase())) subjectRaw = subj
    }
    if (subjectRaw) {
      const subject = normalizeFavoriteSubjectKey(subjectRaw)
      if (subject && subject !== 'item') {
        return {
          kind: 'cofavorite_set',
          subject,
          factKeyPrefix: `preferences.cofavorite.${subject}.`,
        }
      }
    }
  }

  // —— 3. Dislike (before like — "non mi piace" contains "mi piace") ——
  {
    const dislike =
      target.match(/^non\s+mi\s+piace(?:\s+pi[uù])?\s+(.+)$/i) ||
      target.match(/^i\s+don['\u2019]?t\s+like\s+(.+)$/i) ||
      target.match(/^i\s+do\s+not\s+like\s+(.+)$/i) ||
      hay.match(
        /\b(?:dimentica|forget|non\s+ricord(?:are|arti)\s+pi[uù])\s+(?:che\s+|that\s+)?(?:non\s+mi\s+piace(?:\s+pi[uù])?\s+|i\s+don['\u2019]?t\s+like\s+|i\s+do\s+not\s+like\s+)(.+?)(?:[.!]|$)/i,
      )
    if (dislike?.[1]) {
      const valueRaw = String(dislike[1])
        .replace(/\s+anymore\b/gi, '')
        .replace(/\s+pi[uù]\b/gi, '')
        .trim()
      const norm = normalizeForgetValue(valueRaw)
      if (norm) {
        return {
          kind: 'dislike',
          value: norm.value,
          valueSlug: norm.valueSlug,
          factKey: `preferences.dislike.${norm.valueSlug}`,
        }
      }
    }
  }

  // —— 4. Like ——
  {
    const like =
      target.match(/^(?:mi\s+piace|preferisco)\s+(.+)$/i) ||
      target.match(/^i\s+(?:like|love)\s+(.+)$/i) ||
      hay.match(
        /\b(?:dimentica|forget|non\s+ricord(?:are|arti)\s+pi[uù])\s+(?:che\s+|that\s+)?(?:mi\s+piace|preferisco|i\s+like|i\s+love)\s+(.+?)(?:[.!]|$)/i,
      )
    if (like?.[1] && !/^non\s+mi\s+piace/i.test(target)) {
      const norm = normalizeForgetValue(like[1])
      if (norm) {
        return {
          kind: 'like',
          value: norm.value,
          valueSlug: norm.valueSlug,
          factKey: `preferences.like.${norm.valueSlug}`,
        }
      }
    }
  }

  // —— 5. Interest ——
  {
    const interest =
      target.match(/^(?:adoro|amo)\s+(.+)$/i) ||
      target.match(/^mi\s+interessa\s+(.+)$/i) ||
      target.match(/^i(?:'m|\s+am)\s+(?:really\s+)?(?:interested\s+in|into)\s+(.+)$/i) ||
      hay.match(
        /\b(?:dimentica|forget)\s+(?:che\s+|that\s+)?(?:adoro|amo|mi\s+interessa|i(?:'m|\s+am)\s+(?:really\s+)?(?:interested\s+in|into))\s+(.+?)(?:[.!]|$)/i,
      )
    if (interest?.[1]) {
      const norm = normalizeForgetValue(interest[1])
      if (norm) {
        return {
          kind: 'interest',
          value: norm.value,
          valueSlug: norm.valueSlug,
          factKey: `preferences.interest.${norm.valueSlug}`,
        }
      }
    }
  }

  // —— 6. Favorite value-gated (not trailing clitic "dimenticalo") ——
  if (!hadClitic) {
    const favVal =
      target.match(
        /^(.+?)\s+[eè]\s+(?:il|la)\s+mi[oa]\s+([A-Za-zÀ-ÖØ-öø-ÿ][\wÀ-ÖØ-öø-ÿ'-]{1,40})\s+preferit[oa]\b/i,
      ) ||
      target.match(/^(.+?)\s+is\s+my\s+favorite\s+([A-Za-z][\w'-]{1,40})\b/i) ||
      hay.match(
        /\b(?:dimentica|forget)\s+(?:che\s+|that\s+)?(.+?)\s+(?:[eè]\s+(?:il|la)\s+mi[oa]\s+([A-Za-zÀ-ÖØ-öø-ÿ][\wÀ-ÖØ-öø-ÿ'-]{1,40})\s+preferit[oa]|is\s+my\s+favorite\s+([A-Za-z][\w'-]{1,40}))\b/i,
      )
    if (favVal) {
      const valueRaw = favVal[1]
      const subjectRaw = favVal[2] || favVal[3]
      const subject = normalizeFavoriteSubjectKey(subjectRaw || '')
      const norm = normalizeForgetValue(valueRaw)
      if (subject && subject !== 'item' && norm) {
        return {
          kind: 'favorite_value',
          subject,
          value: norm.value,
          valueSlug: norm.valueSlug,
          factKey: `preferences.favorite.${subject}`,
        }
      }
    }
  }

  // —— 7. Favorite slot ——
  {
    const slot =
      target.match(
        /(?:(?:il|la)\s+)?mi[oa]\s+([A-Za-zÀ-ÖØ-öø-ÿ][\wÀ-ÖØ-öø-ÿ'-]{1,40})\s+preferit[oa]\b/i,
      ) ||
      target.match(/(?:my\s+)?favorite\s+([A-Za-z][\w'-]{1,40})\b/i) ||
      (hadClitic &&
        raw.match(
          /(?:(?:il|la)\s+)?mi[oa]\s+([A-Za-zÀ-ÖØ-öø-ÿ][\wÀ-ÖØ-öø-ÿ'-]{1,40})\s+preferit[oa]\b/i,
        ))
    if (slot?.[1]) {
      const subject = normalizeFavoriteSubjectKey(slot[1])
      // Plural EN subjects already handled as set; belt-and-suspenders.
      if (
        subject &&
        subject !== 'item' &&
        !EN_PLURAL_FAVORITE_SUBJECTS.has(String(slot[1]).toLowerCase())
      ) {
        return {
          kind: 'favorite_slot',
          subject,
          factKey: `preferences.favorite.${subject}`,
        }
      }
    }
  }

  // —— 8. Legacy exact keys (primary project / pet / color helpers) ——
  {
    const legacy = deriveForgetFactKey(target)
    if (legacy) {
      return { kind: 'exact_key', factKey: legacy }
    }
  }

  // —— 9. Bare entity ——
  {
    // Demonstrative / vague refs must not become bare-entity search.
    if (!isVagueForgetReference(target)) {
      const bare = target.replace(/[.!?]+$/g, '').trim()
      if (
        bare &&
        !/\s+(?:e|and|o|or)\s+/i.test(bare) &&
        /^[A-Za-zÀ-ÖØ-öø-ÿ0-9][\wÀ-ÖØ-öø-ÿ0-9'’\- ]{0,60}$/u.test(bare) &&
        bare.split(/\s+/).length <= 4 &&
        !/\b(?:preferit|favorite|piace|like|dislike|interess|adoro|project|progetto|nome|name|quello|quella|quelli|quelle|this|that|those|these)\b/i.test(
          bare,
        )
      ) {
        const norm = normalizeForgetValue(bare)
        if (norm) {
          return {
            kind: 'bare_entity',
            value: norm.value,
            valueSlug: norm.valueSlug,
          }
        }
      }
    }
  }

  return { kind: 'unsupported' }
}

/**
 * Family-aware ambiguity label (no ids / fact_keys).
 * @param {{ title?: string, content?: string, factKey?: string | null, tags?: any }} row
 * @param {'it' | 'en'} lang
 */
export function familyAwareForgetLabel(row, lang = 'it') {
  const key = String(row?.factKey || readFactKeyFromTags(row?.tags || []) || '')
  const content = String(row?.content || '')
  const favValue = (() => {
    const m = content.match(/:\s*(.+?)(?:\.|$)/)
    return cleanFavoritePreferenceValue(m?.[1] || '') || memoryForgetLabel(row)
  })()
  const en = lang !== 'it'

  if (key.startsWith('preferences.like.')) {
    return en ? `that you like ${favValue}` : `che ti piace ${favValue}`
  }
  if (key.startsWith('preferences.dislike.')) {
    return en ? `that you don't like ${favValue}` : `che non ti piace ${favValue}`
  }
  if (key.startsWith('preferences.interest.')) {
    return en ? `your interest in ${favValue}` : `il tuo interesse per ${favValue}`
  }
  if (key.startsWith('preferences.favorite.')) {
    const subject = key.slice('preferences.favorite.'.length) || 'item'
    return en
      ? `${favValue} as favorite ${subject}`
      : `${favValue} come ${subject} preferito`
  }
  if (key.startsWith('preferences.cofavorite.')) {
    const parts = key.split('.')
    const subject = parts[2] || 'item'
    return en
      ? `${favValue} among your favorite ${subject}s`
      : `${favValue} tra i tuoi ${subject} preferiti`
  }
  if (key === 'projects.primary') {
    return en
      ? `your primary project (${favValue})`
      : `il tuo progetto principale (${favValue})`
  }
  if (key.startsWith('projects.')) {
    return en ? `your project ${favValue}` : `il tuo progetto ${favValue}`
  }
  return memoryForgetLabel(row)
}

/**
 * Gather structured bare-entity candidates across preference families.
 * Also includes project rows whose stored value slug matches (keeps primary vs
 * generic project ambiguity from Specific Forget PR1 / #252).
 * @param {any[]} rows
 * @param {string} valueSlug
 * @returns {any[]}
 */
export function gatherBareEntityForgetCandidates(rows, valueSlug) {
  const slug = String(valueSlug || '')
    .trim()
    .toLowerCase()
  if (!slug) return []
  const out = []
  const seen = new Set()

  for (const row of rows || []) {
    const key = String(readFactKeyFromTags(row.tags || []) || row.factKey || '')
    let hit = false
    if (key === `preferences.like.${slug}`) hit = true
    else if (key === `preferences.dislike.${slug}`) hit = true
    else if (key === `preferences.interest.${slug}`) hit = true
    else if (/^preferences\.cofavorite\.[^.]+\./i.test(key) && key.endsWith(`.${slug}`)) hit = true
    else if (
      /^preferences\.favorite\./i.test(key) &&
      favoriteValueSlugFromContent(row.content || '') === slug
    ) {
      hit = true
    } else if (key === `projects.${slug}`) {
      hit = true
    } else if (
      key === 'projects.primary' &&
      favoriteValueSlugFromContent(row.content || '') === slug
    ) {
      hit = true
    }
    if (!hit) continue
    const id = String(row.id || '')
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push({ ...row, factKey: key || readFactKeyFromTags(row.tags || []) })
  }
  return out
}

/**
 * Active rows whose fact_key starts with prefix (owner list already scoped).
 * @param {any[]} rows
 * @param {string} prefix
 */
export function filterRowsByFactKeyPrefix(rows, prefix) {
  const p = String(prefix || '')
  if (!p) return []
  return (rows || []).filter((row) => {
    const key = String(readFactKeyFromTags(row.tags || []) || row.factKey || '')
    return key.startsWith(p)
  })
}

/**
 * Map a stripped forget target to a confident single-valued fact_key.
 * @param {string} target
 * @returns {string | null}
 */
export function deriveForgetFactKey(target) {
  const t = String(target || '').trim()
  if (!t) return null

  const favIt = t.match(
    /(?:il\s+|la\s+)?mi[oa]\s+([A-Za-zÀ-ÖØ-öø-ÿ][\wÀ-ÖØ-öø-ÿ'-]{1,40})\s+preferit[oa]\b/i,
  )
  const favEn = t.match(/(?:my\s+)?favorite\s+([A-Za-z][\w'-]{1,40})\b/i)
  const favSubject = favIt?.[1] || favEn?.[1]
  if (favSubject) {
    // Plural EN subjects are cofavorite-set, not singular favorite slot.
    if (EN_PLURAL_FAVORITE_SUBJECTS.has(String(favSubject).toLowerCase())) return null
    const subject = normalizeFavoriteSubjectKey(favSubject)
    if (subject && subject !== 'item') {
      return `preferences.favorite.${subject}`
    }
  }

  if (/\b(?:colore|color|colour)\s+preferit|\bfavorite\s+colou?r\b|\bcolou?r\b/i.test(t)) {
    if (/\bpreferit|favorite|favourite\b/i.test(t) || /^(?:il\s+)?mi[oa]\s+colore\b/i.test(t)) {
      return 'preferences.favorite.color'
    }
  }
  if (/\b(?:animale|animal)\s+preferit|\bfavorite\s+animal\b/i.test(t)) {
    return 'preferences.favorite.animal'
  }

  // Primary project (single-valued) — explicit main/primary phrasing only.
  if (
    /\bprogetto\s+principale\b/i.test(t) ||
    /\b(?:main|primary)\s+project\b/i.test(t)
  ) {
    return 'projects.primary'
  }

  const petIt = t.match(
    /(?:il\s+)?nome\s+del\s+mi[oa]\s+(cane|cagna|cagnolino|gatto|micetto|micia)\b/i,
  )
  const petEn =
    t.match(/my\s+(dog|puppy|cat|kitten)(?:'s)?\s+name\b/i) ||
    t.match(/(?:the\s+)?name\s+of\s+my\s+(dog|puppy|cat|kitten)\b/i)
  const speciesRaw = petIt?.[1] || petEn?.[1]
  if (speciesRaw) {
    const species =
      PET_NAME_SPECIES[String(speciesRaw).toLowerCase()] || slugifyFactKeyPart(speciesRaw)
    return `relationships.pet.${species}.name`
  }

  return null
}

/**
 * @param {string} factKey
 */
export function categoryHintForFactKey(factKey) {
  const key = String(factKey || '')
  if (key.startsWith('relationships.')) return 'relationships'
  if (key.startsWith('identity.')) return 'identity'
  if (key.startsWith('settings.')) return 'settings'
  if (key.startsWith('projects.')) return 'projects'
  if (key.startsWith('goals.')) return 'goals'
  if (key.startsWith('skills.')) return 'skills'
  if (key.startsWith('habits.')) return 'habits'
  if (key.startsWith('events.')) return 'events'
  return 'preferences'
}

/**
 * Human-facing label for clarification (never exposes ids/fact_key).
 * @param {{ title?: string, content?: string, factKey?: string | null }} row
 */
export function memoryForgetLabel(row) {
  let content = String(row?.content || '').trim()
  content = content
    .replace(/^User(?:'s)?\s+/i, '')
    .replace(/^(?:is|are)\s+/i, '')
    .replace(/\b(?:is\s+)?interested in:\s*/i, '')
    .replace(/\blikes\s*\/\s*prefers:\s*/i, '')
    .replace(/\bfavorite\s+[^:]+:\s*/i, '')
    .replace(/\bprimary\s+project:\s*/i, '')
    .replace(/\bproject:\s*/i, '')
    .replace(/\bis named\s+/i, '')
    .replace(/[.]+$/g, '')
    .trim()

  const afterColon = content.match(/:\s*(.+)$/)
  if (afterColon?.[1]) content = afterColon[1].trim()

  content = content.replace(/^(?:is|are|the|il|la|lo|i|gli|le)\s+/i, '').trim()

  if (content.length >= 2 && content.length <= 80) return content
  const title = String(row?.title || '').trim()
  if (title) return title
  return 'un ricordo'
}

/**
 * @param {string[]} labels
 * @returns {string[]}
 */
export function dedupeForgetLabels(labels) {
  const seen = new Set()
  const out = []
  for (const raw of labels || []) {
    const cleaned = String(raw || '')
      .replace(/^(?:is|are|the|il|la|lo)\s+/i, '')
      .trim()
    const key = normalizeControlText(cleaned).toLowerCase()
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(cleaned || String(raw))
  }
  return out
}

/**
 * @param {any[]} rows
 * @param {string} query
 * @returns {Array<{ row: any, score: number }>}
 */
export function scoreForgetCandidates(rows, query) {
  const topic = detectMemoryTopic(query)
  const q = String(query || '')
    .toLowerCase()
    .trim()
  const scored = []

  for (const row of rows || []) {
    const relevance = scoreMemoryRelevance(row, query, topic)
    let score = relevance.matched ? relevance.score : 0

    const haystack = `${row.title || ''} ${row.content || ''} ${(row.tags || []).join(' ')}`.toLowerCase()
    const tokens = q
      .split(/[^a-z0-9àèéìòù]+/i)
      .map((t) => t.trim().toLowerCase())
      .filter((t) => t.length >= 3)

    let exactHits = 0
    for (const token of tokens) {
      if (haystack.includes(token)) {
        exactHits += 1
        score += 10
      }
    }

    const factKey = row.factKey || readFactKeyFromTags(row.tags)
    if (factKey && tokens.some((t) => String(factKey).includes(t))) {
      score += 6
      exactHits += 1
    }

    if (exactHits === 0 && !relevance.matched) continue
    if (score < FORGET_MIN_SCORE && exactHits === 0) continue
    if (score < FORGET_MIN_SCORE) continue

    scored.push({ row, score })
  }

  scored.sort((a, b) => b.score - a.score)
  return scored
}

function ackSuccess(lang) {
  if (lang === 'en') return ACK_SPECIFIC_FORGET_EN
  if (lang === 'es') return ACK_SPECIFIC_FORGET_ES
  if (lang === 'fr') return ACK_SPECIFIC_FORGET_FR
  if (lang === 'de') return ACK_SPECIFIC_FORGET_DE
  return ACK_SPECIFIC_FORGET_IT
}

function ackNotFound(lang) {
  if (lang === 'en') return "I couldn't find a matching memory."
  if (lang === 'es') return 'No encontré un recuerdo correspondiente.'
  if (lang === 'fr') return "Je n'ai trouvé aucun souvenir correspondant."
  if (lang === 'de') return 'Ich habe keine passende Erinnerung gefunden.'
  return 'Non ho trovato un ricordo corrispondente.'
}

function ackAmbiguous(lang, labels) {
  const list = dedupeForgetLabels(labels.filter(Boolean)).slice(0, 6)
  if (lang === 'en') {
    if (list.length >= 2) {
      return `I found more than one. Which should I forget: ${list.join(' or ')}?`
    }
    return 'I found more than one matching memory. Which one should I forget?'
  }
  if (lang === 'es') {
    if (list.length >= 2) {
      return `Encontré más de uno. ¿Cuál debo olvidar: ${list.join(' o ')}?`
    }
    return 'Encontré más de un recuerdo coincidente. ¿Cuál debo olvidar?'
  }
  if (lang === 'fr') {
    if (list.length >= 2) {
      return `J'en ai trouvé plusieurs. Lequel dois-je oublier : ${list.join(' ou ')} ?`
    }
    return 'J’ai trouvé plusieurs souvenirs correspondants. Lequel dois-je oublier ?'
  }
  if (lang === 'de') {
    if (list.length >= 2) {
      return `Ich habe mehrere gefunden. Welche soll ich vergessen: ${list.join(' oder ')}?`
    }
    return 'Ich habe mehrere passende Erinnerungen gefunden. Welche soll ich vergessen?'
  }
  if (list.length >= 2) {
    return `Ne ho trovati più di uno. Quale vuoi che dimentichi: ${list.join(' o ')}?`
  }
  return 'Ne ho trovati più di uno. Quale vuoi che dimentichi?'
}

function ackUnauthenticated(lang) {
  if (lang === 'en') return "I can't change saved memories without a signed-in session."
  if (lang === 'es') return 'No puedo cambiar recuerdos guardados sin una sesión iniciada.'
  if (lang === 'fr') return 'Je ne peux pas modifier les souvenirs enregistrés sans session connectée.'
  if (lang === 'de') return 'Ohne angemeldete Sitzung kann ich gespeicherte Erinnerungen nicht ändern.'
  return 'Non posso modificare i ricordi salvati senza una sessione autenticata.'
}

function ackError(lang) {
  if (lang === 'en') return "I couldn't update that memory right now."
  if (lang === 'es') return 'No pude actualizar ese recuerdo ahora mismo.'
  if (lang === 'fr') return "Je n'ai pas pu mettre à jour ce souvenir pour le moment."
  if (lang === 'de') return 'Ich konnte diese Erinnerung gerade nicht aktualisieren.'
  return 'Non sono riuscito ad aggiornare quel ricordo in questo momento.'
}

/**
 * Resolve + mutate specific forget for a verified owner.
 *
 * @param {{
 *   userMessage: string
 *   userId: string | null | undefined
 *   supabase?: any
 * }} input
 */
export async function tryHandleSpecificForget(input) {
  const userMessage = typeof input?.userMessage === 'string' ? input.userMessage.trim() : ''
  const lang = detectForgetLanguage(userMessage)

  if (!userMessage || !isSpecificForgetIntent(userMessage)) {
    return {
      handled: false,
      status: 'not_forget',
      message: '',
      obsoletedIds: [],
      skippedModel: false,
    }
  }

  const userId = typeof input?.userId === 'string' ? input.userId.trim() : ''
  if (!userId) {
    return {
      handled: true,
      status: 'unauthenticated',
      message: ackUnauthenticated(lang),
      obsoletedIds: [],
      skippedModel: true,
    }
  }

  const target = stripForgetWrapper(userMessage)
  const supabase = input.supabase ?? (await getServiceSupabase())

  if (isExplicitMultiForgetTarget(target)) {
    return {
      handled: true,
      status: 'ambiguous',
      message: ackAmbiguous(lang, []),
      obsoletedIds: [],
      candidates: [],
      skippedModel: true,
    }
  }

  const classified = classifySpecificForgetTarget(userMessage)

  /** @type {any[]} */
  let toObsolete = []
  /** @type {string | null} */
  let factKey = classified.factKey || null
  const reasonTag = factKey || classified.factKeyPrefix || classified.kind || 'user_forget'

  const obsoleteExactKey = async (key) => {
    const listed = await listActiveRowsForFactKey(
      supabase,
      userId,
      key,
      categoryHintForFactKey(key),
    )
    if (listed.error) {
      return { error: true, rows: [], key }
    }
    return { error: false, rows: listed.rows || [], key }
  }

  // —— Typed families: NEVER fall through to fuzzy search ——
  if (
    classified.kind === 'like' ||
    classified.kind === 'dislike' ||
    classified.kind === 'interest' ||
    classified.kind === 'favorite_slot' ||
    classified.kind === 'cofavorite_member' ||
    classified.kind === 'exact_key'
  ) {
    if (!factKey) {
      return {
        handled: true,
        status: 'not_found',
        message: ackNotFound(lang),
        obsoletedIds: [],
        factKey: null,
        skippedModel: true,
        kind: classified.kind,
      }
    }
    const listed = await obsoleteExactKey(factKey)
    if (listed.error) {
      return {
        handled: true,
        status: 'error',
        message: ackError(lang),
        obsoletedIds: [],
        factKey,
        skippedModel: true,
        kind: classified.kind,
      }
    }
    toObsolete = listed.rows
    if (toObsolete.length === 0) {
      return {
        handled: true,
        status: 'not_found',
        message: ackNotFound(lang),
        obsoletedIds: [],
        factKey,
        skippedModel: true,
        kind: classified.kind,
      }
    }
  } else if (classified.kind === 'favorite_value') {
    if (!factKey || !classified.valueSlug) {
      return {
        handled: true,
        status: 'not_found',
        message: ackNotFound(lang),
        obsoletedIds: [],
        factKey,
        skippedModel: true,
        kind: classified.kind,
      }
    }
    const listed = await obsoleteExactKey(factKey)
    if (listed.error) {
      return {
        handled: true,
        status: 'error',
        message: ackError(lang),
        obsoletedIds: [],
        factKey,
        skippedModel: true,
        kind: classified.kind,
      }
    }
    const matched = (listed.rows || []).filter(
      (row) => favoriteValueSlugFromContent(row.content || '') === classified.valueSlug,
    )
    if (matched.length === 0) {
      return {
        handled: true,
        status: 'not_found',
        message: ackNotFound(lang),
        obsoletedIds: [],
        factKey,
        skippedModel: true,
        kind: classified.kind,
      }
    }
    toObsolete = matched
  } else if (classified.kind === 'cofavorite_set') {
    const prefix = classified.factKeyPrefix
    if (!prefix) {
      return {
        handled: true,
        status: 'not_found',
        message: ackNotFound(lang),
        obsoletedIds: [],
        skippedModel: true,
        kind: classified.kind,
      }
    }
    const active = await listActiveMemoriesForOwner(supabase, userId)
    if (active.error) {
      return {
        handled: true,
        status: 'error',
        message: ackError(lang),
        obsoletedIds: [],
        skippedModel: true,
        kind: classified.kind,
      }
    }
    toObsolete = filterRowsByFactKeyPrefix(active.rows || [], prefix)
    factKey = prefix
    if (toObsolete.length === 0) {
      return {
        handled: true,
        status: 'not_found',
        message: ackNotFound(lang),
        obsoletedIds: [],
        factKey: prefix,
        skippedModel: true,
        kind: classified.kind,
      }
    }
  } else if (classified.kind === 'bare_entity') {
    const active = await listActiveMemoriesForOwner(supabase, userId)
    if (active.error) {
      return {
        handled: true,
        status: 'error',
        message: ackError(lang),
        obsoletedIds: [],
        skippedModel: true,
        kind: classified.kind,
      }
    }
    const candidates = gatherBareEntityForgetCandidates(active.rows || [], classified.valueSlug)
    if (candidates.length === 0) {
      return {
        handled: true,
        status: 'not_found',
        message: ackNotFound(lang),
        obsoletedIds: [],
        skippedModel: true,
        kind: classified.kind,
      }
    }
    if (candidates.length >= 2) {
      const labels = dedupeForgetLabels(
        candidates.map((row) => familyAwareForgetLabel(row, lang)),
      )
      return {
        handled: true,
        status: 'ambiguous',
        message: ackAmbiguous(lang, labels),
        obsoletedIds: [],
        candidates: labels,
        skippedModel: true,
        kind: classified.kind,
      }
    }
    toObsolete = [candidates[0]]
    factKey = candidates[0].factKey || readFactKeyFromTags(candidates[0].tags || []) || null
  } else {
    // unsupported — legacy vague / search fallback only (never for typed kinds above)
    const active = await listActiveMemoriesForOwner(supabase, userId)
    if (active.error) {
      return {
        handled: true,
        status: 'error',
        message: ackError(lang),
        obsoletedIds: [],
        skippedModel: true,
        kind: classified.kind,
      }
    }

    if (isVagueForgetReference(target)) {
      const prefs = (active.rows || []).filter((row) => {
        const cat = String(row.category || '').toLowerCase()
        return cat === 'preferences' || cat === 'tastes'
      })
      if (prefs.length === 0) {
        return {
          handled: true,
          status: 'not_found',
          message: ackNotFound(lang),
          obsoletedIds: [],
          skippedModel: true,
        }
      }
      if (prefs.length !== 1) {
        const labels = dedupeForgetLabels(prefs.map((row) => familyAwareForgetLabel(row, lang)))
        return {
          handled: true,
          status: 'ambiguous',
          message: ackAmbiguous(lang, labels),
          obsoletedIds: [],
          candidates: labels,
          skippedModel: true,
        }
      }
      toObsolete = prefs
    } else {
      const scored = scoreForgetCandidates(active.rows || [], target)
      if (scored.length === 0) {
        return {
          handled: true,
          status: 'not_found',
          message: ackNotFound(lang),
          obsoletedIds: [],
          skippedModel: true,
        }
      }

      const top = scored[0]
      const second = scored[1]
      const unique =
        scored.length === 1 ||
        (top && second && top.score >= FORGET_MIN_SCORE && top.score >= second.score + 6)

      const primaryGenericCollision =
        scored.length >= 2 &&
        (() => {
          const q = String(target || '')
            .toLowerCase()
            .trim()
          if (q.length < 2) return false
          const keyed = scored
            .map((item) => ({
              key: String(item.row.factKey || readFactKeyFromTags(item.row.tags || []) || ''),
              content: String(item.row.content || '').toLowerCase(),
            }))
            .filter((item) => item.content.includes(q))
          const hasPrimary = keyed.some((item) => item.key === 'projects.primary')
          const hasGeneric = keyed.some(
            (item) => item.key.startsWith('projects.') && item.key !== 'projects.primary',
          )
          return hasPrimary && hasGeneric
        })()

      if (!unique || primaryGenericCollision) {
        const labels = scored
          .slice(0, 5)
          .map((item) => familyAwareForgetLabel(item.row, lang))
        return {
          handled: true,
          status: 'ambiguous',
          message: ackAmbiguous(lang, labels),
          obsoletedIds: [],
          candidates: labels,
          skippedModel: true,
        }
      }

      toObsolete = [top.row]
    }
  }

  const mutation = await markMemoriesObsolete(supabase, userId, toObsolete, reasonTag)
  // Partial failure (e.g. cofavorite set): never claim full success if any remain / failed.
  if (!mutation.ok || mutation.obsoletedIds.length === 0) {
    return {
      handled: true,
      status: 'error',
      message: ackError(lang),
      obsoletedIds: mutation.obsoletedIds || [],
      factKey: factKey || null,
      skippedModel: true,
      kind: classified.kind,
      failedIds: mutation.failedIds || [],
    }
  }
  if (
    classified.kind === 'cofavorite_set' &&
    mutation.obsoletedIds.length < toObsolete.length
  ) {
    return {
      handled: true,
      status: 'error',
      message: ackError(lang),
      obsoletedIds: mutation.obsoletedIds || [],
      factKey: factKey || null,
      skippedModel: true,
      kind: classified.kind,
      failedIds: mutation.failedIds || [],
    }
  }

  return {
    handled: true,
    status: 'forgotten',
    message: ackSuccess(lang),
    obsoletedIds: mutation.obsoletedIds,
    factKey: factKey || null,
    skippedModel: true,
    kind: classified.kind,
  }
}
