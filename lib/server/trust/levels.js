/**
 * Trust levels for external actions.
 *
 * low  — read weather, read calendar, search files
 * medium — send message, create calendar event, create reminder
 * high — unlock door, open garage, spend money, delete files
 *
 * @typedef {'low'|'medium'|'high'} TrustLevel
 */

/** @type {readonly TrustLevel[]} */
export const TRUST_LEVELS = Object.freeze(['low', 'medium', 'high'])

/**
 * Default capability → trust level (used when a plugin does not override).
 * Keys are capability / action ids.
 * @type {Record<string, TrustLevel>}
 */
export const DEFAULT_ACTION_TRUST = Object.freeze({
  // Low — read / search / navigate info
  query: 'low',
  list: 'low',
  search: 'low',
  draft: 'low',
  eta: 'low',
  navigate: 'low',
  pause: 'low',
  play: 'low',
  skip: 'low',
  queue: 'low',
  locate: 'low',
  invoke: 'low',

  // Medium — create / send / set (non-destructive)
  create: 'medium',
  update: 'medium',
  send: 'medium',
  set: 'medium',
  append: 'medium',
  upload: 'medium',
  share: 'medium',
  complete: 'medium',
  alert: 'medium',
  schedule: 'medium',
  run_scene: 'medium',
  scene: 'medium',
  climate: 'medium',
  charge: 'medium',
  optimize: 'medium',
  rename: 'medium',
  move: 'medium',
  start: 'medium',
  stop: 'medium',

  // High — irreversible / physical / financial
  delete: 'high',
  unlock: 'high',
  lock: 'high',
  purchase: 'high',
  spend: 'high',
  pay: 'high',
  transfer: 'high',
  open_garage: 'high',
  garage: 'high',
})

/**
 * Category-flavored overrides for known high-risk physical actions.
 * @type {Record<string, Record<string, TrustLevel>>}
 */
export const CATEGORY_TRUST_OVERRIDES = Object.freeze({
  'Smart Home': {
    set: 'medium', // lights/thermostat — medium by default; door locks should use unlock/lock
  },
  Vehicles: {
    unlock: 'high',
    lock: 'high',
    climate: 'medium',
  },
  'File Management': {
    delete: 'high',
    move: 'medium',
    list: 'low',
  },
  Messaging: {
    send: 'medium',
    draft: 'low',
  },
  Email: {
    send: 'medium',
    draft: 'low',
    list: 'low',
  },
  Calendar: {
    create: 'medium',
    list: 'low',
    delete: 'high',
  },
  Tasks: {
    create: 'medium',
    list: 'low',
  },
  Weather: {
    query: 'low',
    alert: 'medium',
  },
})

/**
 * @param {string} level
 * @returns {level is TrustLevel}
 */
export function isTrustLevel(level) {
  return level === 'low' || level === 'medium' || level === 'high'
}

/**
 * Resolve trust level for a plugin action.
 *
 * Priority:
 * 1. explicit actionTrust on plugin config
 * 2. category override
 * 3. global DEFAULT_ACTION_TRUST
 * 4. mutating → medium, else low
 *
 * @param {object} args
 * @param {string} args.pluginId
 * @param {string} [args.category]
 * @param {string} args.actionId
 * @param {Record<string, TrustLevel>} [args.actionTrust]
 * @param {boolean} [args.mutating]
 * @returns {TrustLevel}
 */
export function resolveTrustLevel(args) {
  const actionId = String(args.actionId || '').toLowerCase()
  const custom = args.actionTrust || {}

  if (isTrustLevel(custom[actionId])) return custom[actionId]
  // also allow original case keys
  if (isTrustLevel(custom[args.actionId])) return /** @type {TrustLevel} */ (custom[args.actionId])

  const cat = args.category || ''
  const catMap = CATEGORY_TRUST_OVERRIDES[cat]
  if (catMap && isTrustLevel(catMap[actionId])) return catMap[actionId]

  if (isTrustLevel(DEFAULT_ACTION_TRUST[actionId])) return DEFAULT_ACTION_TRUST[actionId]

  // Heuristic fallbacks from action name
  if (/\b(delete|unlock|purchase|spend|pay|garage|wipe|format)\b/i.test(actionId)) return 'high'
  if (/\b(send|create|update|set|share|move|upload)\b/i.test(actionId)) return 'medium'
  if (args.mutating) return 'medium'
  return 'low'
}
