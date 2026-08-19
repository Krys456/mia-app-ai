/**
 * #315 — Localized Phone Action confirmations (IT/EN).
 */

export function phoneCopy(key, lang, vars = {}) {
  const it = {
    open_spotify: 'Ti apro Spotify.',
    open_youtube: 'Ti apro YouTube.',
    open_maps: 'Ti apro Google Maps.',
    navigate: `Ho aperto le indicazioni per «${vars.destination || ''}» in Maps.`,
    call: `Ti apro il dialer con il numero ${vars.phone || ''} pronto.`,
    call_needs_number:
      'Per chiamare qualcuno per nome serve l’integrazione Contatti, non ancora disponibile. Dimmi il numero completo (es. +39…).',
    sms: 'Ho aperto il messaggio nell’app SMS con il testo pronto; puoi controllarlo e inviarlo.',
    sms_needs_number: 'Per l’SMS mi serve un numero di telefono valido (es. +39…).',
    email: 'Ho aperto il tuo client email con il messaggio pronto; puoi controllarlo e inviarlo.',
    email_needs_address: 'Per la mail mi serve un indirizzo email valido.',
    share_ok: 'Ho aperto la condivisione del sistema.',
    share_fallback_copy: 'Condivisione non disponibile qui — ho copiato il testo negli appunti.',
    share_empty: 'Non c’è una risposta recente da condividere.',
    copy_ok: 'Risposta copiata negli appunti.',
    copy_fail: 'Non sono riuscito a copiare il testo.',
    copy_empty: 'Non c’è una risposta recente da copiare.',
    vision: 'Ti apro Vision AI.',
    native_required:
      'Questa azione richiede l’integrazione nativa con il telefono, che ShinkAIdo non ha ancora.',
    native_alarm:
      'Non posso ancora impostare una sveglia nativa del telefono dall’app web. Puoi usare l’app Orologio o un Promemoria. Le sveglie vere richiederanno l’integrazione nativa più avanti.',
    failed: 'Non sono riuscito a completare questa azione.',
    blocked: 'Questa azione non è consentita.',
  }
  const en = {
    open_spotify: 'Opening Spotify for you.',
    open_youtube: 'Opening YouTube for you.',
    open_maps: 'Opening Google Maps for you.',
    navigate: `I've opened directions to “${vars.destination || ''}” in Maps.`,
    call: `Opening the dialer with ${vars.phone || ''} ready.`,
    call_needs_number:
      'Calling someone by name needs Contacts integration, which isn’t available yet. Please give the full number (e.g. +1…).',
    sms: 'I opened your SMS app with the message ready — review it and send when you want.',
    sms_needs_number: 'I need a valid phone number for SMS (e.g. +1…).',
    email: 'I opened your email app with the message ready — review it and send when you want.',
    email_needs_address: 'I need a valid email address.',
    share_ok: 'Opened the system share sheet.',
    share_fallback_copy: 'Sharing isn’t available here — I copied the text to the clipboard.',
    share_empty: 'There’s no recent reply to share.',
    copy_ok: 'Reply copied to the clipboard.',
    copy_fail: 'I couldn’t copy the text.',
    copy_empty: 'There’s no recent reply to copy.',
    vision: 'Opening Vision AI.',
    native_required:
      'This action needs native phone integration, which ShinkAIdo doesn’t have yet.',
    native_alarm:
      "I can't set a native phone alarm from the web app yet. Use your Clock app or a Reminder. True alarms need native integration later.",
    failed: "I couldn't complete this action.",
    blocked: 'This action isn’t allowed.',
  }
  const table = lang === 'en' ? en : it
  return table[key] || table.failed
}
