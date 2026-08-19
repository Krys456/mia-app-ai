/**
 * #314 — Localized timer copy (IT/EN).
 */

import { formatDurationLabel, formatRemainingSpoken } from './duration.js'

export function timerStartedMessage(durationMs, lang) {
  const label = formatDurationLabel(durationMs, lang)
  if (lang === 'en') return `Done — timer set for ${label}. ⏱️`
  return `Fatto — timer impostato per ${label}. ⏱️`
}

export function timerNeedsDurationMessage(lang) {
  if (lang === 'en') return 'How long should the timer be? For example: 10 minutes.'
  return 'Per quanto tempo vuoi il timer? Ad esempio: 10 minuti.'
}

export function timerFailedMessage(lang) {
  if (lang === 'en') return "I couldn't set the timer."
  return 'Non sono riuscito a impostare il timer.'
}

export function timerRemainingMessage(timer, lang, nowMs = Date.now()) {
  const left = Math.max(0, timer.endsAt - nowMs)
  const spoken = formatRemainingSpoken(left, lang)
  if (lang === 'en') return left <= 0 ? "Time's up." : `${spoken} remaining.`
  return left <= 0 ? 'Tempo scaduto.' : `Restano ${spoken}.`
}

export function timerCancelledMessage(lang) {
  if (lang === 'en') return 'Timer stopped.'
  return 'Timer fermato.'
}

export function timerNoActiveMessage(lang) {
  if (lang === 'en') return "There's no active timer right now."
  return "Non c'è un timer attivo al momento."
}

export function timerAddedMessage(addMs, lang) {
  const label = formatDurationLabel(addMs, lang)
  if (lang === 'en') return `Added ${label} to the timer.`
  return `Aggiunti ${label} al timer.`
}

export function timerReplacePrompt(remaining, newDurationMs, lang) {
  const left = formatDurationLabel(Math.max(1000, remaining), lang)
  const next = formatDurationLabel(newDurationMs, lang)
  if (lang === 'en') {
    return `A timer with about ${left} left is already running. Replace it with ${next}? (yes / no)`
  }
  return `È già attivo un timer (restano circa ${left}). Vuoi sostituirlo con quello di ${next}? (sì / no)`
}

export function timerReplaceDeclinedMessage(lang) {
  if (lang === 'en') return 'Okay — keeping the current timer.'
  return 'Ok — lascio il timer attuale.'
}

export function timerCompletedMessage(lang) {
  if (lang === 'en') return "⏱️ Time's up."
  return '⏱️ Tempo scaduto.'
}

export function alarmHonestMessage(lang) {
  if (lang === 'en') {
    return "I can't set a native phone alarm from the web app yet. You can create a Reminder in Settings → Reminders, or use your phone's Clock app. True alarms need native phone integration later."
  }
  return "Non posso ancora impostare una sveglia nativa del telefono dall'app web. Puoi creare un Promemoria in Impostazioni → Promemoria, oppure usare l'app Orologio del telefono. Le sveglie vere richiederanno l'integrazione nativa più avanti."
}
