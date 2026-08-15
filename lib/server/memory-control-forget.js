/**
 * Conversational Memory Control PR1 — specific forget only.
 *
 * Deterministic gate: detect forget intent, resolve exactly one owner-scoped
 * target (fact_key or unique search), mark obsolete. No second LLM call.
 */

import {
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
 * Explicit SAVE wrappers must never be treated as forget.
 * @param {string} message
 */
export function isExplicitSaveMemoryIntent(message) {
  const raw = String(message || '').trim()
  if (!raw) return false
  if (/^non\s+dimenticare(?:\s+che)?\b/i.test(raw)) return true
  const stripped = stripExplicitMemoryIntent(raw)
  return stripped.explicitIntent === true
}

/**
 * @param {string} message
 * @returns {boolean}
 */
export function isSpecificForgetIntent(message) {
  const raw = String(message || '').trim()
  if (!raw) return false
  if (isExplicitSaveMemoryIntent(raw)) return false

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

  // Trailing / mid-sentence clitics: "... , dimenticalo" / "forget it"
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
    /\b(forget|don't\s+remember|do\s+not\s+remember|stop\s+remembering|favorite)\b/i.test(raw)
  ) {
    return 'en'
  }
  return 'it'
}

/**
 * Vague plural/demonstrative references must not multi-delete.
 * @param {string} target
 */
export function isVagueForgetReference(target) {
  const t = String(target || '').trim()
  if (!t) return true
  if (
    /^(quello|quella|quelli|quelle|this|that|those|these|it)\b/i.test(t) &&
    /\b(sugli?|sulle?|sui|su|about|on|regarding)\b/i.test(t)
  ) {
    return true
  }
  if (/^(le\s+cose|i\s+ricordi|everything|tutto)\b/i.test(t)) return true
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
    // "Naruto e Dragon Ball" / "Naruto and Dragon Ball"
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

  // Favorite color / animal / subject
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

  // Qual è il mio colore preferito-style leftover after strip
  if (/\b(?:colore|color|colour)\s+preferit|\bfavorite\s+colou?r\b|\bcolou?r\b/i.test(t)) {
    if (/\bpreferit|favorite|favourite\b/i.test(t) || /^(?:il\s+)?mi[oa]\s+colore\b/i.test(t)) {
      return 'preferences.favorite.color'
    }
  }
  if (/\b(?:animale|animal)\s+preferit|\bfavorite\s+animal\b/i.test(t)) {
    return 'preferences.favorite.animal'
  }

  // Pet name
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
  const content = String(row?.content || '')
    .replace(/^User(?:'s)?\s+/i, '')
    .replace(/\binterested in:\s*/i, '')
    .replace(/\blikes\s*\/\s*prefers:\s*/i, '')
    .replace(/\bfavorite\s+[^:]+:\s*/i, '')
    .replace(/\bis named\s+/i, '')
    .replace(/[.]+$/g, '')
    .trim()
  if (content.length >= 2 && content.length <= 80) return content
  const title = String(row?.title || '').trim()
  if (title) return title
  return 'un ricordo'
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

    // Strong exact-token boost for proper nouns / short targets ("Naruto")
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

    // fact_key slug match (preferences.interest.naruto)
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
  return lang === 'en' ? "Done — I've forgotten that." : "Fatto, l'ho dimenticato."
}

function ackNotFound(lang) {
  return lang === 'en'
    ? "I couldn't find a matching memory."
    : 'Non ho trovato un ricordo corrispondente.'
}

function ackAmbiguous(lang, labels) {
  const list = labels.filter(Boolean).slice(0, 6)
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
 * @returns {Promise<{
 *   handled: boolean
 *   status:
 *     | 'forgotten'
 *     | 'not_found'
 *     | 'ambiguous'
 *     | 'unauthenticated'
 *     | 'error'
 *     | 'not_forget'
 *   message: string
 *   obsoletedIds: string[]
 *   candidates?: string[]
 *   factKey?: string | null
 *   skippedModel: boolean
 * }>}
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

  // Explicit multi-target → clarify (no silent multi-delete in PR1)
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
        const labels = prefs.map(memoryForgetLabel)
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

      // Unique strong target: top score clearly alone, or single hit
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
