/**
 * #298B/#298D — Privacy & Data disclosure copy + beta contact config (Italian UI).
 *
 * Product transparency for closed beta — not legal certification.
 */

/** Placeholder until VITE_PRIVACY_CONTACT_EMAIL is set for the beta. */
export const PRIVACY_CONTACT_PLACEHOLDER = '[OPERATOR EMAIL]'

/**
 * Closed-beta contact for questions / deletion requests.
 * Configure via VITE_PRIVACY_CONTACT_EMAIL (names only in .env.example).
 */
export function resolvePrivacyContactEmail(
  env: Record<string, unknown> = (import.meta as ImportMeta & { env?: Record<string, unknown> })
    .env ?? {},
): string {
  const raw =
    typeof env.VITE_PRIVACY_CONTACT_EMAIL === 'string'
      ? env.VITE_PRIVACY_CONTACT_EMAIL.trim()
      : ''
  return raw || PRIVACY_CONTACT_PLACEHOLDER
}

export const PRIVACY_DISCLOSURE = {
  aiProcessing:
    'I messaggi e le eventuali immagini o documenti che alleghi passano dai nostri server a un provider di AI (OpenAI) per generare le risposte.',
  files:
    'Le immagini vengono elaborate per la risposta. I documenti vengono caricati nello store file dell’AI con una durata configurata breve (~24 ore).',
  webSearch:
    'Quando servono informazioni aggiornate, può essere usata una ricerca web tramite il provider di AI; i link alle fonti possono comparire come Fonti.',
  memory:
    'Quando la Memoria è attiva, ShinkAIdo può salvare informazioni utili a lungo termine nel tuo account per usarle nelle conversazioni successive.',
  reminders:
    'I promemoria che confermi vengono salvati nel tuo account ShinkAIdo (titolo, dettaglio e orario). Restano disponibili in app e al prossimo accesso. Le notifiche push sono opzionali.',
  pushNotifications:
    'Se attivi le notifiche, ShinkAIdo chiede il permesso del browser e salva una sottoscrizione push (endpoint e chiavi tecniche del browser) collegata al tuo account anonimo su questo dispositivo. Il titolo del promemoria può comparire sulla schermata di blocco. La consegna passa dai servizi push della piattaforma (ad es. Chrome/FCM). Puoi disattivare le notifiche in Impostazioni; i promemoria in app restano disponibili. Su un altro telefono o dopo aver cancellato i dati del sito l’identità anonima può cambiare e le sottoscrizioni precedenti non si trasferiscono automaticamente.',
  googleCalendar:
    'Puoi collegare opzionalmente Google Calendar da Impostazioni → Integrazioni. ShinkAIdo chiede solo il permesso di lettura (sola lettura): non può creare, modificare o eliminare eventi in questa versione. I token di accesso Google sono crittografati lato server e non vengono salvati nel browser. In #304A1 i dati del Calendar non sono ancora usati in chat. Puoi scollegare in qualsiasi momento; Memoria, promemoria e notifiche restano indipendenti. Con una sessione anonima su questo dispositivo, cancellare i dati del sito può richiedere di collegare di nuovo Google.',
  anonymousSession:
    'ShinkAIdo usa un account anonimo silenzioso su questo browser. Cancellare i dati del sito può creare una nuova identità. La Memoria e i promemoria collegati all’identità precedente non vengono trasferiti automaticamente.',
  sharedDevice:
    'Questa beta usa una sessione anonima salvata su questo browser. Evita di condividere lo stesso profilo browser con un altro tester.',
  sensitiveWarning:
    'Non salvare in Memoria password, dati di pagamento, chiavi API o altri segreti sensibili. Evita titoli di promemoria troppo sensibili se attivi le notifiche sulla schermata di blocco.',
  processors:
    'Servizi principali usati da ShinkAIdo: OpenAI (elaborazione AI), Supabase (autenticazione, Memoria, promemoria, sottoscrizioni push e, se collegato, connessione Calendar), Vercel (hosting), Upstash (limite di richieste), i servizi push del browser/sistema operativo per le notifiche opzionali, e Google (OAuth Calendar, solo se colleghi Calendar).',
  newChatVsMemory:
    'Nuova chat chiude la conversazione sullo schermo. Eliminare la Memoria rimuove i ricordi salvati. L’eliminazione dell’account non è ancora disponibile.',
  highStakes:
    'ShinkAIdo può commettere errori. Per decisioni mediche, legali, finanziarie o altre decisioni critiche, verifica sempre con fonti o professionisti qualificati.',
  conversationSession:
    'La conversazione sullo schermo resta nella sessione corrente del browser: un aggiornamento della pagina può cancellarla. La Memoria è separata e persistente.',
} as const

export function buildBetaContactLine(email = resolvePrivacyContactEmail()): string {
  return `Closed Beta: domande o richieste di cancellazione — contatta ${email}.`
}

/** Settings Memory ON/OFF short notes (#298B/#298D). */
export const MEMORY_SETTINGS_COPY = {
  on: 'Con la Memoria attiva, ShinkAIdo può salvare fatti utili a lungo termine su di te e usarli nelle chat successive.',
  off: 'Con la Memoria disattivata, ShinkAIdo interrompe l’apprendimento automatico e il richiamo quotidiano. I ricordi già salvati restano finché non li elimini.',
  delete:
    'Eliminare la Memoria rimuove i ricordi salvati dal tuo account. La conversazione sullo schermo è separata — usa Nuova chat per chiuderla.',
} as const

/** #298D — calm empty-state guidance (not an onboarding tour). */
export const FIRST_RUN_HINT =
  'Scrivi liberamente qui sotto. Memoria, privacy e altre opzioni sono disponibili nelle Impostazioni.'
