/**
 * #357B — Deterministic Reminder reply copy (verified state only).
 */

export function reminderCopy(key, language = 'it') {
  const it = {
    clarify_time: 'A che ora vuoi il promemoria? Dimmi ad esempio «domani alle 9».',
    clarify_title: 'Cosa vuoi che ti ricordi?',
    past_time: 'Quel momento è già passato. Scegli un orario futuro.',
    too_far: 'La data è troppo lontana. Scegli un momento entro circa due anni.',
    invalid_time: 'Non ho capito data e ora. Prova con «domani alle 9» o «tra 20 minuti».',
    unsupported_recurrence:
      'I promemoria ricorrenti non sono ancora disponibili. Posso crearne uno una sola volta.',
    propose_intro: 'Confermi questo promemoria?',
    saved: 'Va bene, te lo ricorderò',
    saved_no_push:
      'Promemoria salvato. Per ricevere una notifica anche quando ShinkAIdo non è aperto, attiva le notifiche.',
    cancelled: 'Promemoria annullato.',
    completed: 'Segnato come fatto.',
    updated: 'Fatto. L’ho riprogrammato',
    empty_today: 'Non hai promemoria per oggi.',
    empty_upcoming: 'Non hai promemoria in arrivo.',
    empty_next: 'Non hai un prossimo promemoria.',
    not_found: 'Non ho trovato quel promemoria. Dimmi «che promemoria ho?» e riprova.',
    ambiguous: 'Quale promemoria intendi? Dimmi il primo, il secondo…',
    create_failed: 'Non sono riuscito a salvare il promemoria. Riprova tra poco.',
    list_failed: 'Non riesco a leggere i promemoria in questo momento.',
    update_failed: 'Non sono riuscito ad aggiornare il promemoria.',
    cancel_failed: 'Non sono riuscito ad annullare il promemoria.',
    discarded: 'Ok, non ho creato il promemoria.',
    disabled: 'I promemoria non sono disponibili in questo momento.',
  }
  const en = {
    clarify_time: 'What time should I set? For example “tomorrow at 9”.',
    clarify_title: 'What should I remind you about?',
    past_time: 'That time is already past. Choose a future time.',
    too_far: 'That date is too far out. Choose within about two years.',
    invalid_time: 'I couldn’t parse date and time. Try “tomorrow at 9” or “in 20 minutes”.',
    unsupported_recurrence:
      'Recurring reminders aren’t available yet. I can create a one-time reminder.',
    propose_intro: 'Confirm this reminder?',
    saved: 'Okay, I’ll remind you',
    saved_no_push:
      'Reminder saved. To get a notification when ShinkAIdo isn’t open, enable notifications.',
    cancelled: 'Reminder cancelled.',
    completed: 'Marked as done.',
    updated: 'Done. I rescheduled it',
    empty_today: 'You have no reminders for today.',
    empty_upcoming: 'You have no upcoming reminders.',
    empty_next: 'You have no next reminder.',
    not_found: 'I couldn’t find that reminder. Ask “what reminders do I have?” and try again.',
    ambiguous: 'Which reminder? Say the first, the second…',
    create_failed: 'I couldn’t save the reminder. Try again shortly.',
    list_failed: 'I can’t read reminders right now.',
    update_failed: 'I couldn’t update the reminder.',
    cancel_failed: 'I couldn’t cancel the reminder.',
    discarded: 'Okay, I didn’t create the reminder.',
    disabled: 'Reminders aren’t available right now.',
  }
  const table = language === 'en' ? en : it
  return table[key] || it[key] || key
}

export function failureReply(code, language = 'it') {
  switch (code) {
    case 'ambiguous_time':
      return reminderCopy('clarify_time', language)
    case 'missing_title':
      return reminderCopy('clarify_title', language)
    case 'past_time':
      return reminderCopy('past_time', language)
    case 'too_far':
      return reminderCopy('too_far', language)
    case 'invalid_time':
      return reminderCopy('invalid_time', language)
    case 'unsupported_recurrence':
      return reminderCopy('unsupported_recurrence', language)
    case 'not_found':
      return reminderCopy('not_found', language)
    case 'ambiguous':
      return reminderCopy('ambiguous', language)
    case 'reminders_disabled':
      return reminderCopy('disabled', language)
    case 'create_failed':
      return reminderCopy('create_failed', language)
    case 'list_failed':
      return reminderCopy('list_failed', language)
    case 'update_failed':
      return reminderCopy('update_failed', language)
    case 'cancel_failed':
      return reminderCopy('cancel_failed', language)
    default:
      return reminderCopy('invalid_time', language)
  }
}

export function formatReminderLine(r, index) {
  const time = r.localTimeLabel || ''
  const title = r.title || ''
  const n = typeof index === 'number' ? `${index + 1}. ` : ''
  if (time) return `${n}${time} — ${title}`
  return `${n}${title}`
}

export function renderReminderList(reminders, queryType, language = 'it') {
  const list = Array.isArray(reminders) ? reminders : []
  if (!list.length) {
    if (queryType === 'today') return reminderCopy('empty_today', language)
    if (queryType === 'next') return reminderCopy('empty_next', language)
    return reminderCopy('empty_upcoming', language)
  }
  if (queryType === 'next') {
    const r = list[0]
    const when = [r.localDateLabel, r.localTimeLabel].filter(Boolean).join(' · ')
    return language === 'en'
      ? `Next reminder: ${when} — ${r.title}`
      : `Prossimo promemoria: ${when} — ${r.title}`
  }
  const header =
    language === 'en'
      ? queryType === 'today'
        ? `You have ${list.length} reminder${list.length === 1 ? '' : 's'} for today:`
        : `You have ${list.length} upcoming reminder${list.length === 1 ? '' : 's'}:`
      : queryType === 'today'
        ? `Hai ${list.length} promemoria per oggi:`
        : `Hai ${list.length} promemoria in arrivo:`
  return `${header}\n${list.map((r, i) => formatReminderLine(r, i)).join('\n')}`
}

export function renderProposalText(proposal, language = 'it') {
  const when = [proposal.localDateLabel, proposal.localTimeLabel].filter(Boolean).join(' · ')
  const tz = proposal.timezone ? ` (${proposal.timezone})` : ''
  if (language === 'en') {
    return `${reminderCopy('propose_intro', 'en')}\n${when}${tz}\n${proposal.title}`
  }
  return `${reminderCopy('propose_intro', 'it')}\n${when}${tz}\n${proposal.title}`
}

export function renderSavedText(reminder, language = 'it', pushHint = false) {
  if (pushHint) return reminderCopy('saved_no_push', language)
  const when = [reminder.localDateLabel, reminder.localTimeLabel].filter(Boolean).join(' alle ')
  const base = reminderCopy('saved', language)
  if (language === 'en') {
    return `${base} ${when || reminder.fireAt}.`
  }
  // Italian: "Va bene, te lo ricorderò domani alle 09:00." — prefer local labels
  if (reminder.localDateLabel && reminder.localTimeLabel) {
    return `${base} ${humanDateIt(reminder.localDateLabel)} alle ${reminder.localTimeLabel}.`
  }
  return `${base}.`
}

function humanDateIt(isoDate) {
  // Keep ISO date if we lack relative labels; caller may pass "domani" via localDateLabel already.
  return isoDate
}

export function buildProposalUi() {
  return {
    kind: 'proposal',
    chip: 'Promemoria',
    actions: [
      { id: 'confirm', label: 'Conferma' },
      { id: 'cancel', label: 'Annulla' },
    ],
  }
}
