/**
 * #334C — Daily Briefing preference helpers (deterministic, device-local).
 */

/**
 * Sanitize an explicit city name for briefing weather preference.
 * @param {unknown} raw
 * @returns {string | null}
 */
export function sanitizeBriefingCity(raw) {
  if (raw == null) return null
  const s = String(raw)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!s) return null
  if (s.length < 2 || s.length > 60) return null
  if (/^[0-9.,\s+-]+$/.test(s)) return null
  if (/\b(http|www\.|@)\b/i.test(s)) return null
  return s.slice(0, 60)
}

/**
 * Normalize briefing settings blob.
 * @param {Partial<object> | undefined} raw
 */
export function normalizeBriefingSettings(raw) {
  const length =
    raw?.length === 'concise' || raw?.length === 'detailed' || raw?.length === 'balanced'
      ? raw.length
      : 'balanced'
  return {
    length,
    weatherEnabled: raw?.weatherEnabled !== false,
    calendarEnabled: raw?.calendarEnabled !== false,
    remindersEnabled: raw?.remindersEnabled !== false,
    preferredWeatherCity: sanitizeBriefingCity(raw?.preferredWeatherCity),
  }
}

/**
 * Apply presentation toggles to a verified briefing model (shallow copy).
 * Does not invent data — only hides sources for rendering/priority.
 *
 * @param {object} model
 * @param {object} prefs normalizeBriefingSettings result
 */
export function applyBriefingPresentationPrefs(model, prefs) {
  const next = {
    ...model,
    calendar: { ...(model.calendar || { status: 'unavailable', items: [] }) },
    reminders: {
      ...(model.reminders || { status: 'unavailable', overdue: [], today: [] }),
    },
    weather: { ...(model.weather || { status: 'unavailable' }) },
  }

  if (!prefs.calendarEnabled) {
    next.calendar = { status: 'empty', items: [], hiddenByPref: true }
  }
  if (!prefs.remindersEnabled) {
    next.reminders = { status: 'empty', overdue: [], today: [], hiddenByPref: true }
  }
  if (!prefs.weatherEnabled) {
    next.weather = { status: 'unavailable', snapshot: null, hiddenByPref: true }
  }

  return next
}

/**
 * Detect explicit persistent / temporary preference commands (folded text).
 * Conservative patterns — Italian first.
 *
 * @param {string} raw
 * @returns {null | {
 *   intent: 'briefing-preference'
 *   persist: boolean
 *   patch?: object
 *   oneShotLength?: 'concise'|'detailed'|'balanced'
 *   language: 'it'|'en'
 * }}
 */
export function detectBriefingPreferenceIntent(raw) {
  const text = String(raw || '').trim()
  if (!text) return null
  const t = text
    .normalize('NFKC')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()

  const lang = /\b(briefing|weather|city|shorter|detailed|hide)\b/.test(t) &&
    !/\b(briefing|meteo|citta|brevi|dettagliat|nascondi)\b/.test(t)
    ? 'en'
    : 'it'

  // Persistent city
  let m =
    t.match(
      /^(?:usa|imposta|imposta come)\s+([a-zà-öø-ÿ'’-]{2,40}(?:\s+[a-zà-öø-ÿ'’-]{2,40})?)\s+per\s+il\s+meteo\s+(?:del\s+)?briefing\.?$/,
    ) ||
    t.match(
      /^use\s+([a-z'’-]{2,40}(?:\s+[a-z'’-]{2,40})?)\s+for\s+(?:the\s+)?briefing\s+weather\.?$/,
    )
  if (m) {
    // Preserve user casing from the original utterance.
    const rawMatch =
      text.match(
        /^(?:usa|imposta(?:\s+come)?)\s+([A-Za-zÀ-ÖØ-öø-ÿ'’-]{2,40}(?:\s+[A-Za-zÀ-ÖØ-öø-ÿ'’-]{2,40})?)\s+per\s+il\s+meteo\s+(?:del\s+)?briefing\.?$/i,
      ) ||
      text.match(
        /^use\s+([A-Za-z'’-]{2,40}(?:\s+[A-Za-z'’-]{2,40})?)\s+for\s+(?:the\s+)?briefing\s+weather\.?$/i,
      )
    const city = sanitizeBriefingCity(rawMatch?.[1] || m[1])
    if (city) {
      return {
        intent: 'briefing-preference',
        persist: true,
        patch: { preferredWeatherCity: city },
        language: lang,
      }
    }
  }

  if (
    /^(rimuovi|cancella)\s+(la\s+)?(citta|citta meteo|citta del briefing)|clear\s+(the\s+)?briefing\s+(weather\s+)?city/.test(
      t,
    )
  ) {
    return {
      intent: 'briefing-preference',
      persist: true,
      patch: { preferredWeatherCity: null },
      language: lang,
    }
  }

  // Persistent weather toggle
  if (
    /^(non\s+mostrarmi\s+il\s+meteo\s+(nel|dal)\s+briefing|disattiva\s+il\s+meteo\s+(nel\s+)?briefing|hide\s+weather\s+(in|from)\s+(the\s+)?briefing)/.test(
      t,
    )
  ) {
    return {
      intent: 'briefing-preference',
      persist: true,
      patch: { weatherEnabled: false },
      language: lang,
    }
  }
  if (
    /^(mostrami\s+il\s+meteo\s+nel\s+briefing|attiva\s+il\s+meteo\s+(nel\s+)?briefing|show\s+weather\s+in\s+(the\s+)?briefing)/.test(
      t,
    )
  ) {
    return {
      intent: 'briefing-preference',
      persist: true,
      patch: { weatherEnabled: true },
      language: lang,
    }
  }

  // Persistent length
  if (
    /^(da\s+ora\s+voglio\s+briefing\s+brevi|voglio\s+briefing\s+brevi|imposta\s+briefing\s+concis[oi]|i\s+want\s+short\s+briefings)/.test(
      t,
    )
  ) {
    return {
      intent: 'briefing-preference',
      persist: true,
      patch: { length: 'concise' },
      language: lang,
    }
  }
  if (
    /^(da\s+ora\s+voglio\s+briefing\s+dettagliat[oi]|voglio\s+briefing\s+dettagliat[oi]|i\s+want\s+detailed\s+briefings)/.test(
      t,
    )
  ) {
    return {
      intent: 'briefing-preference',
      persist: true,
      patch: { length: 'detailed' },
      language: lang,
    }
  }
  if (
    /^(ripristina\s+il\s+briefing\s+bilanciato|voglio\s+briefing\s+bilanciat[oi]|reset\s+(to\s+)?balanced\s+briefing)/.test(
      t,
    )
  ) {
    return {
      intent: 'briefing-preference',
      persist: true,
      patch: { length: 'balanced' },
      language: lang,
    }
  }

  // One-shot (temporary) length — do NOT persist
  if (
    /^(riassumilo\s+piu\s+brevemente|fammi\s+(la\s+)?versione\s+breve|piu\s+breve|make\s+it\s+shorter|shorter\s+version)/.test(
      t,
    )
  ) {
    return {
      intent: 'briefing-preference',
      persist: false,
      oneShotLength: 'concise',
      language: lang,
    }
  }
  if (
    /^(fammi\s+(la\s+)?versione\s+dettagliata|piu\s+dettagli|make\s+it\s+detailed|detailed\s+version)/.test(
      t,
    )
  ) {
    return {
      intent: 'briefing-preference',
      persist: false,
      oneShotLength: 'detailed',
      language: lang,
    }
  }
  // One-shot hide weather for this re-render only
  if (/^(nascondi\s+il\s+meteo\s+(dal|nel)\s+briefing|hide\s+the\s+weather\s+(for\s+now)?)$/.test(t)) {
    return {
      intent: 'briefing-preference',
      persist: false,
      oneShotHideWeather: true,
      language: lang,
    }
  }

  return null
}

/**
 * Confirmation reply for preference changes.
 */
export function preferenceAck(patch, language, persist) {
  const lang = language === 'en' ? 'en' : 'it'
  if (!persist) return null
  if (patch.preferredWeatherCity) {
    return lang === 'en'
      ? `Got it — I’ll use ${patch.preferredWeatherCity} for briefing weather.`
      : `Va bene — userò ${patch.preferredWeatherCity} per il meteo del briefing.`
  }
  if (patch.preferredWeatherCity === null && 'preferredWeatherCity' in patch) {
    return lang === 'en'
      ? 'Preferred briefing city cleared.'
      : 'Città meteo del briefing rimossa.'
  }
  if (patch.weatherEnabled === false) {
    return lang === 'en'
      ? 'I’ll leave weather out of the briefing.'
      : 'Non mostrerò il meteo nel briefing.'
  }
  if (patch.weatherEnabled === true) {
    return lang === 'en'
      ? 'Weather will appear in the briefing when available.'
      : 'Il meteo tornerà nel briefing quando disponibile.'
  }
  if (patch.length === 'concise') {
    return lang === 'en' ? 'I’ll keep briefings concise.' : 'Da ora i briefing saranno più brevi.'
  }
  if (patch.length === 'detailed') {
    return lang === 'en' ? 'I’ll keep briefings detailed.' : 'Da ora i briefing saranno più dettagliati.'
  }
  if (patch.length === 'balanced') {
    return lang === 'en' ? 'Briefings reset to balanced.' : 'Briefing ripristinato sullo stile bilanciato.'
  }
  return lang === 'en' ? 'Preference saved.' : 'Preferenza salvata.'
}
