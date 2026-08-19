/**
 * #317 — Deterministic WMO mapping (server mirror of client; keep in sync).
 * Open-Meteo / WMO WW codes → IT/EN + category.
 */

/** @type {Record<number, { it: string, en: string, category: string }>} */
export const WMO_CODE_MAP = Object.freeze({
  0: { it: 'Sereno', en: 'Clear', category: 'clear' },
  1: { it: 'Prevalentemente sereno', en: 'Mainly clear', category: 'mainly_clear' },
  2: { it: 'Parzialmente nuvoloso', en: 'Partly cloudy', category: 'partly_cloudy' },
  3: { it: 'Coperto', en: 'Overcast', category: 'overcast' },
  45: { it: 'Nebbia', en: 'Fog', category: 'fog' },
  48: { it: 'Nebbia con brina', en: 'Depositing rime fog', category: 'fog' },
  51: { it: 'Pioggerella leggera', en: 'Light drizzle', category: 'drizzle' },
  53: { it: 'Pioggerella', en: 'Drizzle', category: 'drizzle' },
  55: { it: 'Pioggerella intensa', en: 'Dense drizzle', category: 'drizzle' },
  56: { it: 'Pioggerella gelata leggera', en: 'Light freezing drizzle', category: 'freezing_rain' },
  57: { it: 'Pioggerella gelata', en: 'Freezing drizzle', category: 'freezing_rain' },
  61: { it: 'Pioggia leggera', en: 'Slight rain', category: 'rain' },
  63: { it: 'Pioggia', en: 'Rain', category: 'rain' },
  65: { it: 'Pioggia intensa', en: 'Heavy rain', category: 'rain' },
  66: { it: 'Pioggia gelata leggera', en: 'Light freezing rain', category: 'freezing_rain' },
  67: { it: 'Pioggia gelata', en: 'Freezing rain', category: 'freezing_rain' },
  71: { it: 'Neve leggera', en: 'Slight snow', category: 'snow' },
  73: { it: 'Neve', en: 'Snow', category: 'snow' },
  75: { it: 'Neve intensa', en: 'Heavy snow', category: 'snow' },
  77: { it: 'Grani di neve', en: 'Snow grains', category: 'snow' },
  80: { it: 'Rovesci di pioggia leggeri', en: 'Slight rain showers', category: 'rain_showers' },
  81: { it: 'Rovesci di pioggia', en: 'Rain showers', category: 'rain_showers' },
  82: { it: 'Rovesci di pioggia violenti', en: 'Violent rain showers', category: 'rain_showers' },
  85: { it: 'Rovesci di neve leggeri', en: 'Slight snow showers', category: 'snow_showers' },
  86: { it: 'Rovesci di neve intensi', en: 'Heavy snow showers', category: 'snow_showers' },
  95: { it: 'Temporale', en: 'Thunderstorm', category: 'thunderstorm' },
  96: { it: 'Temporale con grandine', en: 'Thunderstorm with hail', category: 'thunderstorm_hail' },
  99: {
    it: 'Temporale con grandine intensa',
    en: 'Thunderstorm with heavy hail',
    category: 'thunderstorm_hail',
  },
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
      category: 'unknown',
    }
  }
  const entry = WMO_CODE_MAP[n]
  if (!entry) {
    return {
      weatherCode: n,
      description: lang === 'en' ? `Code ${n}` : `Codice ${n}`,
      category: 'unknown',
    }
  }
  return {
    weatherCode: n,
    description: lang === 'en' ? entry.en : entry.it,
    category: entry.category,
  }
}
