/**
 * #319 — Allowlisted unit registry (canonical base units + aliases).
 * Linear units: value → base → target via toBase / fromBase factors.
 * Temperature uses a special affine path (see convert.js).
 *
 * Future composition note: Power × Time → Energy can multiply
 * canonical watt × second → joule without blurring dimensions here.
 */

/** @typedef {'length'|'mass'|'temperature'|'volume'|'area'|'speed'|'time'|'energy'|'power'|'pressure'|'digital_storage'} UnitDimension */

/**
 * @typedef {{
 *   id: string
 *   dimension: UnitDimension
 *   symbol: string
 *   aliases: string[]
 *   toBase: number | null
 *   fromBase?: number | null
 *   family?: 'decimal' | 'binary' | null
 *   temperature?: boolean
 * }} UnitDef
 */

/** @type {UnitDef[]} */
const UNITS = [
  // --- Length (base: meter) ---
  {
    id: 'mm',
    dimension: 'length',
    symbol: 'mm',
    aliases: ['mm', 'millimetro', 'millimetri', 'millimeter', 'millimeters'],
    toBase: 1e-3,
  },
  {
    id: 'cm',
    dimension: 'length',
    symbol: 'cm',
    aliases: ['cm', 'centimetro', 'centimetri', 'centimeter', 'centimeters'],
    toBase: 1e-2,
  },
  {
    id: 'm',
    dimension: 'length',
    symbol: 'm',
    aliases: ['m', 'metro', 'metri', 'meter', 'meters', 'metre', 'metres'],
    toBase: 1,
  },
  {
    id: 'km',
    dimension: 'length',
    symbol: 'km',
    aliases: [
      'km',
      'chilometro',
      'chilometri',
      'kilometro',
      'kilometri',
      'kilometer',
      'kilometers',
      'kilometre',
      'kilometres',
    ],
    toBase: 1e3,
  },
  {
    id: 'in',
    dimension: 'length',
    symbol: 'in',
    aliases: ['in', 'inch', 'inches', 'pollice', 'pollici', '"'],
    toBase: 0.0254,
  },
  {
    id: 'ft',
    dimension: 'length',
    symbol: 'ft',
    aliases: ['ft', 'foot', 'feet', 'piede', 'piedi'],
    toBase: 0.3048,
  },
  {
    id: 'yd',
    dimension: 'length',
    symbol: 'yd',
    aliases: ['yd', 'yard', 'yards', 'iarda', 'iarde'],
    toBase: 0.9144,
  },
  {
    id: 'mi',
    dimension: 'length',
    symbol: 'mi',
    aliases: ['mi', 'mile', 'miles', 'miglio', 'miglia'],
    toBase: 1609.344,
  },

  // --- Mass (base: kilogram) ---
  {
    id: 'mg',
    dimension: 'mass',
    symbol: 'mg',
    aliases: ['mg', 'milligrammo', 'milligrammi', 'milligram', 'milligrams'],
    toBase: 1e-6,
  },
  {
    id: 'g',
    dimension: 'mass',
    symbol: 'g',
    aliases: ['g', 'grammo', 'grammi', 'gram', 'grams', 'gramme', 'grammes'],
    toBase: 1e-3,
  },
  {
    id: 'kg',
    dimension: 'mass',
    symbol: 'kg',
    aliases: [
      'kg',
      'chilogrammo',
      'chilogrammi',
      'kilogrammo',
      'kilogrammi',
      'kilogram',
      'kilograms',
      'kilo',
      'kilos',
    ],
    toBase: 1,
  },
  {
    id: 't',
    dimension: 'mass',
    symbol: 't',
    aliases: [
      't',
      'tonne',
      'tonnes',
      'tonnellata',
      'tonnellate',
      'metric ton',
      'metric tons',
      'metric tonne',
      'metric tonnes',
    ],
    toBase: 1e3,
  },
  {
    id: 'oz',
    dimension: 'mass',
    symbol: 'oz',
    aliases: ['oz', 'ounce', 'ounces', 'oncia', 'once'],
    toBase: 0.028349523125,
  },
  {
    id: 'lb',
    dimension: 'mass',
    symbol: 'lb',
    aliases: ['lb', 'lbs', 'pound', 'pounds', 'libbra', 'libbre'],
    toBase: 0.45359237,
  },
  {
    id: 'st',
    dimension: 'mass',
    symbol: 'st',
    aliases: ['st', 'stone', 'stones'],
    toBase: 6.35029318,
  },

  // --- Temperature (affine; toBase unused) ---
  {
    id: 'celsius',
    dimension: 'temperature',
    symbol: '°C',
    aliases: [
      'c',
      '°c',
      'ºc',
      'celsius',
      'centigrade',
      'gradi celsius',
      'grado celsius',
      'degrees celsius',
      'degree celsius',
      'gradi centigradi',
      'centigradi',
    ],
    toBase: null,
    temperature: true,
  },
  {
    id: 'fahrenheit',
    dimension: 'temperature',
    symbol: '°F',
    aliases: [
      'f',
      '°f',
      'ºf',
      'fahrenheit',
      'gradi fahrenheit',
      'grado fahrenheit',
      'degrees fahrenheit',
      'degree fahrenheit',
    ],
    toBase: null,
    temperature: true,
  },
  {
    id: 'kelvin',
    dimension: 'temperature',
    symbol: 'K',
    aliases: ['k', 'kelvin', 'kelvins', 'gradi kelvin', 'grado kelvin', 'degrees kelvin'],
    toBase: null,
    temperature: true,
  },

  // --- Volume (base: cubic meter); US customary liquid ---
  {
    id: 'ml',
    dimension: 'volume',
    symbol: 'mL',
    aliases: ['ml', 'millilitro', 'millilitri', 'milliliter', 'milliliters', 'cc'],
    toBase: 1e-6,
  },
  {
    id: 'l',
    dimension: 'volume',
    symbol: 'L',
    aliases: ['l', 'lt', 'litro', 'litri', 'liter', 'liters', 'litre', 'litres'],
    toBase: 1e-3,
  },
  {
    id: 'm3',
    dimension: 'volume',
    symbol: 'm³',
    aliases: ['m3', 'm³', 'm^3', 'metro cubo', 'metri cubi', 'cubic meter', 'cubic meters', 'cubic metre', 'cubic metres'],
    toBase: 1,
  },
  {
    id: 'floz_us',
    dimension: 'volume',
    symbol: 'fl oz',
    aliases: [
      'fl oz',
      'floz',
      'fluid ounce',
      'fluid ounces',
      'us fluid ounce',
      'us fluid ounces',
      'oncia liquida',
      'once liquide',
    ],
    toBase: 2.95735295625e-5,
  },
  {
    id: 'cup_us',
    dimension: 'volume',
    symbol: 'cup',
    aliases: ['cup', 'cups', 'us cup', 'us cups', 'tazza', 'tazze'],
    toBase: 2.365882365e-4,
  },
  {
    id: 'pint_us',
    dimension: 'volume',
    symbol: 'pt',
    aliases: ['pt', 'pint', 'pints', 'us pint', 'us pints'],
    toBase: 4.73176473e-4,
  },
  {
    id: 'quart_us',
    dimension: 'volume',
    symbol: 'qt',
    aliases: ['qt', 'quart', 'quarts', 'us quart', 'us quarts'],
    toBase: 9.46352946e-4,
  },
  {
    id: 'gal_us',
    dimension: 'volume',
    symbol: 'gal',
    aliases: [
      'gal',
      'gallon',
      'gallons',
      'us gallon',
      'us gallons',
      'gallone',
      'galloni',
      'gallone us',
      'galloni us',
    ],
    toBase: 0.003785411784,
  },

  // --- Area (base: square meter) ---
  {
    id: 'mm2',
    dimension: 'area',
    symbol: 'mm²',
    aliases: ['mm2', 'mm²', 'mm^2'],
    toBase: 1e-6,
  },
  {
    id: 'cm2',
    dimension: 'area',
    symbol: 'cm²',
    aliases: ['cm2', 'cm²', 'cm^2'],
    toBase: 1e-4,
  },
  {
    id: 'm2',
    dimension: 'area',
    symbol: 'm²',
    aliases: ['m2', 'm²', 'm^2', 'metro quadro', 'metri quadri', 'square meter', 'square meters', 'square metre', 'square metres'],
    toBase: 1,
  },
  {
    id: 'km2',
    dimension: 'area',
    symbol: 'km²',
    aliases: ['km2', 'km²', 'km^2', 'chilometro quadro', 'chilometri quadri', 'square kilometer', 'square kilometers'],
    toBase: 1e6,
  },
  {
    id: 'in2',
    dimension: 'area',
    symbol: 'in²',
    aliases: ['in2', 'in²', 'in^2', 'sq in', 'square inch', 'square inches'],
    toBase: 0.00064516,
  },
  {
    id: 'ft2',
    dimension: 'area',
    symbol: 'ft²',
    aliases: ['ft2', 'ft²', 'ft^2', 'sq ft', 'square foot', 'square feet'],
    toBase: 0.09290304,
  },
  {
    id: 'yd2',
    dimension: 'area',
    symbol: 'yd²',
    aliases: ['yd2', 'yd²', 'yd^2', 'sq yd', 'square yard', 'square yards'],
    toBase: 0.83612736,
  },
  {
    id: 'acre',
    dimension: 'area',
    symbol: 'ac',
    aliases: ['ac', 'acre', 'acres'],
    toBase: 4046.8564224,
  },
  {
    id: 'ha',
    dimension: 'area',
    symbol: 'ha',
    aliases: ['ha', 'hectare', 'hectares', 'ettaro', 'ettari'],
    toBase: 1e4,
  },

  // --- Speed (base: m/s) ---
  {
    id: 'mps',
    dimension: 'speed',
    symbol: 'm/s',
    aliases: ['m/s', 'mps', 'metro al secondo', 'metri al secondo', 'meters per second', 'metres per second'],
    toBase: 1,
  },
  {
    id: 'kmh',
    dimension: 'speed',
    symbol: 'km/h',
    aliases: [
      'km/h',
      'kmh',
      'kph',
      'chilometri orari',
      'chilometro orario',
      'kilometers per hour',
      'kilometres per hour',
    ],
    toBase: 1 / 3.6,
  },
  {
    id: 'mph',
    dimension: 'speed',
    symbol: 'mph',
    aliases: ['mph', 'mi/h', 'miles per hour', 'miglia orarie', 'miglio orario'],
    toBase: 0.44704,
  },
  {
    id: 'kn',
    dimension: 'speed',
    symbol: 'kn',
    aliases: ['kn', 'kt', 'knot', 'knots', 'nodo', 'nodi'],
    toBase: 1852 / 3600,
  },

  // --- Time (base: second) ---
  {
    id: 'ms',
    dimension: 'time',
    symbol: 'ms',
    aliases: ['ms', 'millisecond', 'milliseconds', 'millisecondo', 'millisecondi'],
    toBase: 1e-3,
  },
  {
    id: 's',
    dimension: 'time',
    symbol: 's',
    aliases: ['s', 'sec', 'second', 'seconds', 'secondo', 'secondi'],
    toBase: 1,
  },
  {
    id: 'min',
    dimension: 'time',
    symbol: 'min',
    aliases: ['min', 'mins', 'minute', 'minutes', 'minuto', 'minuti'],
    toBase: 60,
  },
  {
    id: 'h',
    dimension: 'time',
    symbol: 'h',
    aliases: ['h', 'hr', 'hrs', 'hour', 'hours', 'ora', 'ore'],
    toBase: 3600,
  },
  {
    id: 'd',
    dimension: 'time',
    symbol: 'd',
    aliases: ['d', 'day', 'days', 'giorno', 'giorni'],
    toBase: 86400,
  },

  // --- Energy (base: joule) ---
  {
    id: 'j',
    dimension: 'energy',
    symbol: 'J',
    aliases: ['j', 'joule', 'joules'],
    toBase: 1,
  },
  {
    id: 'kj',
    dimension: 'energy',
    symbol: 'kJ',
    aliases: ['kj', 'kilojoule', 'kilojoules'],
    toBase: 1e3,
  },
  {
    id: 'mj',
    dimension: 'energy',
    symbol: 'MJ',
    aliases: ['mj', 'megajoule', 'megajoules'],
    toBase: 1e6,
  },
  {
    id: 'wh',
    dimension: 'energy',
    symbol: 'Wh',
    aliases: ['wh', 'wattora', 'wattora', 'watt hour', 'watt hours', 'watt-hour', 'watt-hours'],
    toBase: 3600,
  },
  {
    id: 'kwh',
    dimension: 'energy',
    symbol: 'kWh',
    aliases: [
      'kwh',
      'kw/h',
      'kilowattora',
      'kilowattora',
      'kilowatt hour',
      'kilowatt hours',
      'kilowatt-hour',
      'kilowatt-hours',
    ],
    toBase: 3.6e6,
  },
  {
    id: 'mwh',
    dimension: 'energy',
    symbol: 'MWh',
    aliases: ['mwh', 'megawattora', 'megawatt hour', 'megawatt hours', 'megawatt-hour', 'megawatt-hours'],
    toBase: 3.6e9,
  },

  // --- Power (base: watt) ---
  {
    id: 'w',
    dimension: 'power',
    symbol: 'W',
    aliases: ['w', 'watt', 'watts'],
    toBase: 1,
  },
  {
    id: 'kw',
    dimension: 'power',
    symbol: 'kW',
    aliases: ['kw', 'kilowatt', 'kilowatts'],
    toBase: 1e3,
  },
  {
    id: 'mw_power',
    dimension: 'power',
    symbol: 'MW',
    aliases: ['mw', 'megawatt', 'megawatts'],
    toBase: 1e6,
  },

  // --- Pressure (base: pascal) ---
  {
    id: 'pa',
    dimension: 'pressure',
    symbol: 'Pa',
    aliases: ['pa', 'pascal', 'pascals'],
    toBase: 1,
  },
  {
    id: 'kpa',
    dimension: 'pressure',
    symbol: 'kPa',
    aliases: ['kpa', 'kilopascal', 'kilopascals'],
    toBase: 1e3,
  },
  {
    id: 'mpa',
    dimension: 'pressure',
    symbol: 'MPa',
    aliases: ['mpa', 'megapascal', 'megapascals'],
    toBase: 1e6,
  },
  {
    id: 'bar',
    dimension: 'pressure',
    symbol: 'bar',
    aliases: ['bar', 'bars'],
    toBase: 1e5,
  },
  {
    id: 'psi',
    dimension: 'pressure',
    symbol: 'psi',
    aliases: ['psi', 'pound per square inch', 'pounds per square inch'],
    toBase: 6894.757293168361,
  },
  {
    id: 'atm',
    dimension: 'pressure',
    symbol: 'atm',
    aliases: ['atm', 'atmosphere', 'atmospheres', 'atmosfera', 'atmosfere'],
    toBase: 101325,
  },

  // --- Digital storage (base: byte); decimal vs binary ---
  {
    id: 'b',
    dimension: 'digital_storage',
    symbol: 'B',
    aliases: ['b', 'byte', 'bytes'],
    toBase: 1,
    family: 'decimal',
  },
  {
    id: 'kb',
    dimension: 'digital_storage',
    symbol: 'KB',
    aliases: ['kb', 'kilobyte', 'kilobytes'],
    toBase: 1e3,
    family: 'decimal',
  },
  {
    id: 'mb',
    dimension: 'digital_storage',
    symbol: 'MB',
    aliases: ['mb', 'megabyte', 'megabytes'],
    toBase: 1e6,
    family: 'decimal',
  },
  {
    id: 'gb',
    dimension: 'digital_storage',
    symbol: 'GB',
    aliases: ['gb', 'gigabyte', 'gigabytes'],
    toBase: 1e9,
    family: 'decimal',
  },
  {
    id: 'tb',
    dimension: 'digital_storage',
    symbol: 'TB',
    aliases: ['tb', 'terabyte', 'terabytes'],
    toBase: 1e12,
    family: 'decimal',
  },
  {
    id: 'kib',
    dimension: 'digital_storage',
    symbol: 'KiB',
    aliases: ['kib', 'kibibyte', 'kibibytes'],
    toBase: 1024,
    family: 'binary',
  },
  {
    id: 'mib',
    dimension: 'digital_storage',
    symbol: 'MiB',
    aliases: ['mib', 'mebibyte', 'mebibytes'],
    toBase: 1024 ** 2,
    family: 'binary',
  },
  {
    id: 'gib',
    dimension: 'digital_storage',
    symbol: 'GiB',
    aliases: ['gib', 'gibibyte', 'gibibytes'],
    toBase: 1024 ** 3,
    family: 'binary',
  },
  {
    id: 'tib',
    dimension: 'digital_storage',
    symbol: 'TiB',
    aliases: ['tib', 'tebibyte', 'tebibytes'],
    toBase: 1024 ** 4,
    family: 'binary',
  },
]

/** Ambiguous informal storage words — never silently map to GB/GiB. */
export const AMBIGUOUS_STORAGE_ALIASES = Object.freeze([
  'giga',
  'mega',
  'tera',
  'gigas',
  'megas',
  'teras',
])

function foldAlias(s) {
  return String(s || '')
    .normalize('NFKC')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** @type {Map<string, UnitDef>} */
const BY_ID = new Map()
/** @type {Map<string, UnitDef>} */
const BY_ALIAS = new Map()

for (const u of UNITS) {
  BY_ID.set(u.id, u)
  for (const a of u.aliases) {
    const key = foldAlias(a)
    if (!key) continue
    // Prefer first registration; longer multi-word aliases still win via sorted match
    if (!BY_ALIAS.has(key)) BY_ALIAS.set(key, u)
  }
}

/** Aliases longest-first for greedy matching. */
export const ALIAS_LIST = Object.freeze(
  [...BY_ALIAS.keys()].sort((a, b) => b.length - a.length || a.localeCompare(b)),
)

export function getUnitById(id) {
  return BY_ID.get(id) || null
}

/**
 * Resolve an allowlisted unit from an alias / symbol fragment.
 * @param {string} raw
 * @returns {UnitDef | null}
 */
export function resolveUnit(raw) {
  const key = foldAlias(raw)
  if (!key) return null
  if (BY_ALIAS.has(key)) return BY_ALIAS.get(key)
  // Tolerate optional trailing punctuation
  const stripped = key.replace(/[.,;:!?]+$/g, '')
  if (stripped !== key && BY_ALIAS.has(stripped)) return BY_ALIAS.get(stripped)
  return null
}

/**
 * Try to match a unit alias at the start of `text` (already folded).
 * @param {string} foldedText
 * @returns {{ unit: UnitDef, matched: string, rest: string } | null}
 */
export function matchUnitAtStart(foldedText) {
  const t = String(foldedText || '').trim()
  if (!t) return null
  for (const alias of ALIAS_LIST) {
    if (t === alias) {
      const unit = BY_ALIAS.get(alias)
      if (unit) return { unit, matched: alias, rest: '' }
      continue
    }
    if (t.startsWith(alias)) {
      const next = t[alias.length]
      // Boundary: end, whitespace, or punctuation — not mid-token letters/digits
      if (next == null || /[\s,.;:!?)\]}]/.test(next) || next === '/') {
        // Allow km/h style already in alias; if alias doesn't include slash, don't eat into next letter
        if (/[a-z0-9]/i.test(next || '') && next !== '/') continue
      }
      // Word boundary for alphabetic aliases
      if (/^[a-z]/.test(alias) && /[a-z0-9]/i.test(next || '') && !alias.includes(' ') && !alias.includes('/')) {
        continue
      }
      const unit = BY_ALIAS.get(alias)
      if (unit) return { unit, matched: alias, rest: t.slice(alias.length).trim() }
    }
  }
  return null
}

/**
 * Find a unit token anywhere; returns first longest match with index.
 * @param {string} foldedText
 */
export function findUnitInText(foldedText) {
  const t = String(foldedText || '')
  let best = null
  for (const alias of ALIAS_LIST) {
    let idx = 0
    while (idx < t.length) {
      const at = t.indexOf(alias, idx)
      if (at < 0) break
      const before = at === 0 ? ' ' : t[at - 1]
      const afterChar = t[at + alias.length] || ' '
      const okBefore = /[\s(]/.test(before) || at === 0
      const okAfter =
        /[\s,.;:!?)]/.test(afterChar) ||
        afterChar === '' ||
        (alias.includes('/') && true)
      // For single-letter C/F/K/W etc., require stricter boundaries
      if (alias.length <= 1) {
        if (!okBefore || !/[\s,.;:!?)]/.test(afterChar) && afterChar !== '') {
          idx = at + 1
          continue
        }
      } else if (!okBefore || (!okAfter && /[a-z0-9]/i.test(afterChar))) {
        idx = at + 1
        continue
      }
      if (!best || alias.length > best.matched.length || (alias.length === best.matched.length && at < best.index)) {
        best = { unit: BY_ALIAS.get(alias), matched: alias, index: at }
      }
      idx = at + alias.length
    }
  }
  return best && best.unit ? best : null
}

export function listUnits() {
  return UNITS.slice()
}

export function isAmbiguousStoragePhrase(foldedText) {
  const t = foldAlias(foldedText)
  return AMBIGUOUS_STORAGE_ALIASES.some((a) => new RegExp(`\\b${a}\\b`).test(t))
}

export { foldAlias, UNITS }
