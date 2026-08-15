/**
 * Conversational Memory Control — specific forget (PR1) + forget-all (PR2).
 *
 * Deterministic gate: detect forget intents, mutate owner-scoped memories,
 * return truthful acks. No second LLM call for resolved control turns.
 */

import {
  deleteAllMemories,
  detectMemoryTopic,
  listActiveMemoriesForOwner,
  listActiveRowsForFactKey,
  markMemoriesObsolete,
  normalizeFavoriteSubjectKey,
  readFactKeyFromTags,
  scoreMemoryRelevance,
  slugifyFactKeyPart,
  stripExplicitMemoryIntent,
} from './brain-memory.js'
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
export const ACK_FORGET_ALL_SUCCESS_IT =
  'Fatto. Ho dimenticato tutte le informazioni che avevo memorizzato su di te.'
export const ACK_FORGET_ALL_SUCCESS_EN =
  'Done. I have forgotten everything I had stored about you.'

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
 * @param {string} message
 * @returns {boolean}
 */
export function isSpecificForgetIntent(message) {
  const raw = normalizeControlText(message)
  if (!raw) return false
  if (isExplicitSaveMemoryIntent(raw)) return false
  // HARD PRECEDENCE: wipe-all shapes never enter Specific Forget.
  if (isGlobalForgetIntent(raw) || isSelfScopedWipeShape(raw)) return false

  // Italian
  if (
    /\b(?:dimentica|dimenticati|dimenticalo|dimenticala|dimenticali|dimenticar(?:e|lo|la|li|le|ne))\b/i.test(
      raw,
    )
  ) {
    return true
  }
  if (/\bnon\s+ricord(?:are|arti)\s+pi[uù]/i.test(raw)) return true
  if (/\bpuoi\s+dimenticare\b/i.test(raw)) return true
  if (/\bvoglio\s+che\s+(?:tu\s+)?dimentichi\b/i.test(raw)) return true

  // English
  if (/\bforget(?:\s+that|\s+my|\s+about)?\b/i.test(raw)) return true
  if (/\bdon['\u2019]?t\s+remember(?:\s+that|\s+my)?\b/i.test(raw)) return true
  if (/\bdo\s+not\s+remember(?:\s+that|\s+my)?\b/i.test(raw)) return true
  if (/\bstop\s+remembering\b/i.test(raw)) return true

  return false
}

/**
 * @param {string} text
 * @returns {'it' | 'en' | null}
 */
export function matchForgetAllConfirmPrompt(text) {
  const raw = normalizeControlPrompt(text)
  if (!raw) return null
  if (raw === normalizeControlPrompt(FORGET_ALL_CONFIRM_PROMPT_IT)) return 'it'
  if (raw === normalizeControlPrompt(FORGET_ALL_CONFIRM_PROMPT_EN)) return 'en'
  return null
}

/**
 * Conservative explicit confirmation of wipe.
 * @param {string} message
 */
export function isForgetAllConfirmReply(message) {
  const raw = normalizeControlPrompt(message)
  if (!raw) return false
  return /^(?:s[iì]|s[iì]\s*,?\s*confermo|confermo|certo|procedi|fallo|yes|yes\s*,?\s*confirm|i\s+confirm|confirm|proceed|do\s+it)$/i.test(
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
  return lang === 'en' ? FORGET_ALL_CONFIRM_PROMPT_EN : FORGET_ALL_CONFIRM_PROMPT_IT
}

function ackForgetAllSuccess(lang) {
  return lang === 'en' ? ACK_FORGET_ALL_SUCCESS_EN : ACK_FORGET_ALL_SUCCESS_IT
}

function ackForgetAllCancel(lang) {
  return lang === 'en'
    ? "Okay — I didn't delete any memories."
    : 'Va bene, non ho cancellato nessuna memoria.'
}

function ackForgetAllError(lang) {
  return lang === 'en'
    ? "I couldn't delete the memories right now."
    : 'Non sono riuscito a cancellare le memorie in questo momento.'
}

function ackForgetAllUnauthenticated(lang) {
  return lang === 'en'
    ? "I can't erase saved memories without a signed-in session."
    : 'Non posso cancellare i ricordi salvati senza una sessione autenticata.'
}

function ackMetaAfterSpecific(lang) {
  return lang === 'en'
    ? 'No. That memory was removed from active memory, so it should not be recalled in new chats.'
    : 'No. Quella memoria è stata rimossa dalla memoria attiva, quindi non dovrebbe essere recuperata nelle nuove chat.'
}

function ackMetaAfterAll(lang) {
  return lang === 'en'
    ? 'No. The saved memories were deleted, so they should not be recalled in new chats.'
    : 'No. Le memorie salvate sono state cancellate, quindi non dovrebbero essere recuperate nelle nuove chat.'
}

/**
 * @param {string} text
 * @returns {{ kind: string, lang: 'it' | 'en' } | null}
 */
export function classifyPriorMemoryControlAck(text) {
  const raw = normalizeControlPrompt(text)
  if (!raw) return null

  if (raw === normalizeControlPrompt(FORGET_ALL_CONFIRM_PROMPT_IT)) {
    return { kind: 'forget_all_confirm', lang: 'it' }
  }
  if (raw === normalizeControlPrompt(FORGET_ALL_CONFIRM_PROMPT_EN)) {
    return { kind: 'forget_all_confirm', lang: 'en' }
  }
  if (raw === normalizeControlPrompt(ACK_FORGET_ALL_SUCCESS_IT)) {
    return { kind: 'forgotten_all', lang: 'it' }
  }
  if (raw === normalizeControlPrompt(ACK_FORGET_ALL_SUCCESS_EN)) {
    return { kind: 'forgotten_all', lang: 'en' }
  }
  if (raw === normalizeControlPrompt(ACK_SPECIFIC_FORGET_IT)) {
    return { kind: 'forgotten_specific', lang: 'it' }
  }
  if (raw === normalizeControlPrompt(ACK_SPECIFIC_FORGET_EN)) {
    return { kind: 'forgotten_specific', lang: 'en' }
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
      /^(?:per\s+favore|please|puoi\s+(?:per\s+favore\s+)?|can\s+you\s+|could\s+you\s+|voglio\s+che\s+(?:tu\s+)?)\s*/i,
      '',
    )
    .trim()

  const leading = [
    /^dimenticati\s+(?:di\s+)?/i,
    /^dimentica\s+(?:di\s+)?/i,
    /^dimenticare\s+(?:di\s+)?/i,
    /^non\s+ricord(?:are|arti)\s+pi[uù]\s+(?:che\s+)?/i,
    /^puoi\s+dimenticare\s+(?:che\s+)?/i,
    /^voglio\s+che\s+(?:tu\s+)?dimentichi\s+(?:che\s+)?/i,
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
 * @param {string} message
 * @returns {'it' | 'en'}
 */
export function detectForgetLanguage(message) {
  const raw = String(message || '')
  if (
    /\b(forget|don't\s+remember|do\s+not\s+remember|stop\s+remembering|favorite|everything|memories|delete|clear)\b/i.test(
      raw,
    )
  ) {
    return 'en'
  }
  return 'it'
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
  return lang === 'en' ? ACK_SPECIFIC_FORGET_EN : ACK_SPECIFIC_FORGET_IT
}

function ackNotFound(lang) {
  return lang === 'en'
    ? "I couldn't find a matching memory."
    : 'Non ho trovato un ricordo corrispondente.'
}

function ackAmbiguous(lang, labels) {
  const list = dedupeForgetLabels(labels.filter(Boolean)).slice(0, 6)
  if (lang === 'en') {
    if (list.length >= 2) {
      return `I found more than one. Which should I forget: ${list.join(' or ')}?`
    }
    return 'I found more than one matching memory. Which one should I forget?'
  }
  if (list.length >= 2) {
    return `Ne ho trovati più di uno. Quale vuoi che dimentichi: ${list.join(' o ')}?`
  }
  return 'Ne ho trovati più di uno. Quale vuoi che dimentichi?'
}

function ackUnauthenticated(lang) {
  return lang === 'en'
    ? "I can't change saved memories without a signed-in session."
    : 'Non posso modificare i ricordi salvati senza una sessione autenticata.'
}

function ackError(lang) {
  return lang === 'en'
    ? "I couldn't update that memory right now."
    : 'Non sono riuscito ad aggiornare quel ricordo in questo momento.'
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

  const factKey = deriveForgetFactKey(target)

  /** @type {any[]} */
  let toObsolete = []

  if (factKey) {
    const listed = await listActiveRowsForFactKey(
      supabase,
      userId,
      factKey,
      categoryHintForFactKey(factKey),
    )
    if (listed.error) {
      return {
        handled: true,
        status: 'error',
        message: ackError(lang),
        obsoletedIds: [],
        factKey,
        skippedModel: true,
      }
    }
    toObsolete = listed.rows || []
    if (toObsolete.length === 0) {
      return {
        handled: true,
        status: 'not_found',
        message: ackNotFound(lang),
        obsoletedIds: [],
        factKey,
        skippedModel: true,
      }
    }
  } else {
    const active = await listActiveMemoriesForOwner(supabase, userId)
    if (active.error) {
      return {
        handled: true,
        status: 'error',
        message: ackError(lang),
        obsoletedIds: [],
        skippedModel: true,
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
        const labels = dedupeForgetLabels(prefs.map(memoryForgetLabel))
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

      if (!unique) {
        const labels = scored.slice(0, 5).map((item) => memoryForgetLabel(item.row))
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

  const mutation = await markMemoriesObsolete(supabase, userId, toObsolete, factKey || 'user_forget')
  if (!mutation.ok || mutation.obsoletedIds.length === 0) {
    return {
      handled: true,
      status: 'error',
      message: ackError(lang),
      obsoletedIds: mutation.obsoletedIds || [],
      factKey: factKey || null,
      skippedModel: true,
    }
  }

  return {
    handled: true,
    status: 'forgotten',
    message: ackSuccess(lang),
    obsoletedIds: mutation.obsoletedIds,
    factKey: factKey || null,
    skippedModel: true,
  }
}
