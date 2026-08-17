/**
 * #298A — Memory CRUD field length caps (request validation only).
 */

export const MEMORY_FIELD_LIMITS = {
  category: 64,
  title: 200,
  content: 8000,
}

/**
 * @param {string} value
 * @param {number} max
 * @returns {boolean}
 */
export function isWithinLength(value, max) {
  return typeof value === 'string' && value.length <= max
}
