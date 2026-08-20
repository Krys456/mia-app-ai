/**
 * #322 — Client API helper for /api/translation.
 */

import { resolveChatAuthForRequest } from '../chatAuth'

function resolveBase() {
  try {
    const env = typeof import.meta !== 'undefined' ? import.meta.env : null
    const raw = env && typeof env.VITE_API_BASE_URL === 'string' ? env.VITE_API_BASE_URL.trim() : ''
    return raw.replace(/\/$/, '')
  } catch {
    return ''
  }
}

/**
 * @param {{
 *   text: string
 *   targetLanguage: string
 *   sourceLanguage?: string
 *   mode?: string
 *   language?: 'it'|'en'
 * }} body
 */
export async function requestTranslation(body) {
  const auth = await resolveChatAuthForRequest()
  if (!auth.authorization) {
    return {
      status: 'error',
      failureCode: 'auth_required',
      translatedText: null,
    }
  }

  const url = `${resolveBase()}/api/translation`
  let res
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: auth.authorization,
      },
      body: JSON.stringify({
        text: body.text,
        targetLanguage: body.targetLanguage,
        sourceLanguage: body.sourceLanguage || 'auto',
        mode: body.mode || 'preserve',
        language: body.language || 'it',
      }),
    })
  } catch {
    return { status: 'offline', failureCode: 'offline', translatedText: null }
  }

  let json = {}
  try {
    json = await res.json()
  } catch {
    json = {}
  }

  if (res.status === 429) {
    return {
      status: 'rate_limited',
      failureCode: 'rate_limited',
      translatedText: null,
    }
  }

  if (!res.ok) {
    return {
      status: typeof json.status === 'string' ? json.status : 'provider_error',
      failureCode:
        typeof json.code === 'string'
          ? json.code
          : typeof json.failureCode === 'string'
            ? json.failureCode
            : 'provider_error',
      translatedText: null,
      model: json.model || null,
    }
  }

  return {
    status: json.status || 'ok',
    translatedText: typeof json.translatedText === 'string' ? json.translatedText : null,
    detectedSourceLanguage: json.detectedSourceLanguage || null,
    targetLanguage: json.targetLanguage || body.targetLanguage,
    mode: json.mode || body.mode || 'preserve',
    model: json.model || null,
    failureCode: json.failureCode || null,
  }
}
