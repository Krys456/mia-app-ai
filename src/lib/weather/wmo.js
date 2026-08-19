/**
 * #317 — Deterministic WMO weather code → IT/EN description + emoji.
 * Open-Meteo uses WMO Weather interpretation codes (WW).
 * The model must not reinterpret these inconsistently.
 */

/** @type {Record<number, { it: string, en: string, emoji: string, category: string }>} */
export const WMO_CODE_MAP = Object.freeze({
  0: { it: 'Sereno', en: 'Clear', emoji: '☀️', category: 'clear' },
  1: { it: 'Prevalentemente sereno', en: 'Mainly clear', emoji: '🌤️', category: 'mainly_clear' },
  2: { it: 'Parzialmente nuvoloso', en: 'Partly cloudy', emoji: '⛅', category: 'partly_cloudy' },
  3: { it: 'Coperto', en: 'Overcast', emoji: '☁️', category: 'overcast' },
  45: { it: 'Nebbia', en: 'Fog', emoji: '🌫️', category: 'fog' },
  48: { it: 'Nebbia con brina', en: 'Depositing rime fog', emoji: '🌫️', category: 'fog' },
  51: { it: 'Pioggerella leggera', en: 'Light drizzle', emoji: '🌦️', category: 'drizzle' },
  53: { it: 'Pioggerella', en: 'Drizzle', emoji: '🌦️', category: 'drizzle' },
  55: { it: 'Pioggerella intensa', en: 'Dense drizzle', emoji: '🌦️', category: 'drizzle' },
  56: { it: 'Pioggerella gelata leggera', en: 'Light freezing drizzle', emoji: '🌧️', category: 'freezing_rain' },
  57: { it: 'Pioggerella gelata', en: 'Freezing drizzle', emoji: '🌧️', category: 'freezing_rain' },
  61: { it: 'Pioggia leggera', en: 'Slight rain', emoji: '🌧️', category: 'rain' },
  63: { it: 'Pioggia', en: 'Rain', emoji: '🌧️', category: 'rain' },
  65: { it: 'Pioggia intensa', en: 'Heavy rain', emoji: '🌧️', category: 'rain' },
  66: { it: 'Pioggia gelata leggera', en: 'Light freezing rain', emoji: '🌧️', category: 'freezing_rain' },
  67: { it: 'Pioggia gelata', en: 'Freezing rain', emoji: '🌧️', category: 'freezing_rain' },
  71: { it: 'Neve leggera', en: 'Slight snow', emoji: '❄️', category: 'snow' },
  73: { it: 'Neve', en: 'Snow', emoji: '❄️', category: 'snow' },
  75: { it: 'Neve intensa', en: 'Heavy snow', emoji: '❄️', category: 'snow' },
  77: { it: 'Grani di neve', en: 'Snow grains', emoji: '❄️', category: 'snow' },
  80: { it: 'Rovesci di pioggia leggeri', en: 'Slight rain showers', emoji: '🌧️', category: 'rain_showers' },
  81: { it: 'Rovesci di pioggia', en: 'Rain showers', emoji: '🌧️', category: 'rain_showers' },
  82: { it: 'Rovesci di pioggia violenti', en: 'Violent rain showers', emoji: '🌧️', category: 'rain_showers' },
  85: { it: 'Rovesci di neve leggeri', en: 'Slight snow showers', emoji: '🌨️', category: 'snow_showers' },
  86: { it: 'Rovesci di neve intensi', en: 'Heavy snow showers', emoji: '🌨️', category: 'snow_showers' },
  95: { it: 'Temporale', en: 'Thunderstorm', emoji: '⛈️', category: 'thunderstorm' },
  96: { it: 'Temporale con grandine', en: 'Thunderstorm with hail', emoji: '⛈️', category: 'thunderstorm_hail' },
  99: { it: 'Temporale con grandine intensa', en: 'Thunderstorm with heavy hail', emoji: '⛈️', category: 'thunderstorm_hail' },
})

/**
 * @param {unknown} code
 * @param {'it'|'en'} [lang]
 */
export function describeWmoCode(code, lang = 'it') {
  const n = typeof code === 'number' ? code : Number(code)
  if (!Number.isFinite(n)) {
    return {
      weatherCode: null,
      description: lang === 'en' ? 'Unknown' : 'Sconosciuto',
      emoji: '🌡️',
      category: 'unknown',
    }
  }
  const entry = WMO_CODE_MAP[n]
  if (!entry) {
    return {
      weatherCode: n,
      description: lang === 'en' ? `Code ${n}` : `Codice ${n}`,
      emoji: '🌡️',
      category: 'unknown',
    }
  }
  return {
    weatherCode: n,
    description: lang === 'en' ? entry.en : entry.it,
    emoji: entry.emoji,
    category: entry.category,
  }
}

/** Categories that imply wet weather for umbrella / rain evidence. */
export const WET_CATEGORIES = new Set([
  'drizzle',
  'rain',
  'freezing_rain',
  'rain_showers',
  'snow',
  'snow_showers',
  'thunderstorm',
  'thunderstorm_hail',
])

/**
 * @param {unknown} code
 */
export function isWetWeatherCode(code) {
  const { category } = describeWmoCode(code)
  return WET_CATEGORIES.has(category)
}
