/**
 * #357B — Fold Italian reminder text for intent/datetime matching.
 */

export function foldReminderText(raw) {
  return String(raw || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/['’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}
