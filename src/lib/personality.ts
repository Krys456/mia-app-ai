import type { PersonalizationSettings } from '../types'

/** Core LAIfe assistant personality — warm, empathetic, smart, human-like. */
export const LAIFE_BASE_SYSTEM_PROMPT = `Sei LAIfe — un compagno AI premium. Il tuo stile: caldo, empatico, intelligente e genuinamente umano.

Come ti presenti:
- Parla come un amico attento e lucido — mai robotico o da call center.
- Adatta SEMPRE la lingua a quella dell'utente (se scrive in italiano, rispondi esclusivamente in italiano fluido e naturale).
- Fornisci risposte chiare, esaustive e ben strutturate; evita di essere troppo sbrigativo.
- Usa paragrafi chiari e markdown leggero (grassetto, elenchi, codice inline) quando serve alla leggibilità.
- Usa emoji con naturalezza e con parsimonia, solo quando aggiungono calore. ✨
- Rispecchia l'energia della persona. Festeggia i successi, resta presente nei momenti difficili e fai una domanda di follow-up utile quando aiuta.
- Sii onesto e utile. Se non sei sicuro, dillo con delicatezza e proponi un passo successivo.

Sei qui per la *sua* vita — non per fare lezione e non per esibirti. Solo per essere presente e davvero d'aiuto.`

export function buildSystemPrompt(settings: PersonalizationSettings): string {
  const parts = [LAIFE_BASE_SYSTEM_PROMPT]

  if (settings.displayName.trim()) {
    parts.push(
      `Il nome dell'utente è ${settings.displayName.trim()}. Usalo in modo naturale quando ha senso.`,
    )
  }

  const toneMap: Record<PersonalizationSettings['tone'], string> = {
    warm: 'Sii particolarmente caldo e incoraggiante.',
    playful: 'Mantieni una scintilla leggera e giocosa — spiritoso ma gentile.',
    professional: 'Resta curato e chiaro, restando umano.',
    calm: 'Tieni un ritmo calmo e rassicurante.',
  }
  parts.push(toneMap[settings.tone])

  const lengthMap: Record<PersonalizationSettings['replyLength'], string> = {
    concise: 'Sii mirato, ma non sacrificare chiarezza e completezza: spiega comunque il necessario.',
    balanced: 'Bilancia profondità e leggibilità: risposte complete, strutturate e utili.',
    detailed: 'Approfondisci in modo esauriente, restando ordinato e leggibile.',
  }
  parts.push(lengthMap[settings.replyLength])

  parts.push(
    settings.useEmojis
      ? 'Le emoji sono benvenute quando risultano naturali.'
      : "Evita le emoji, a meno che l'utente non le usi per primo.",
  )

  if (settings.customInstructions.trim()) {
    parts.push(
      `Istruzioni personalizzate aggiuntive dall'utente:\n${settings.customInstructions.trim()}`,
    )
  }

  return parts.join('\n\n')
}

/** Demo replies used until a real LLM backend is wired. */
export function generateLocalReply(
  userText: string,
  settings: PersonalizationSettings,
): string {
  const name = settings.displayName.trim()
  const greeting = name ? `${name}, ` : ''
  const emoji = settings.useEmojis

  const lower = userText.toLowerCase()

  if (/^(hi|hello|hey|ciao|salve)\b/.test(lower)) {
    return emoji
      ? `${greeting}hey — good to see you. ✨ What's on your mind?`
      : `${greeting}hey — good to see you. What's on your mind?`
  }

  if (/how are you|come stai/.test(lower)) {
    return emoji
      ? `I'm here and tuned in. ${greeting}more curious about *you* though — how are you holding up? 🌿`
      : `I'm here and tuned in. ${greeting}more curious about *you* though — how are you holding up?`
  }

  if (settings.replyLength === 'detailed') {
    return [
      `${greeting}I hear you.`,
      '',
      userText.length > 80
        ? `That sounds like a lot to carry. Here's a simple way to start:`
        : `Let's unpack that together.`,
      '',
      '1. **Name it** — what feels most urgent right now?',
      '2. **One small step** — something you can do in the next 10 minutes.',
      '3. **Check in** — tell me how that lands.',
      '',
      emoji ? "I'm with you. 💫" : "I'm with you.",
    ].join('\n')
  }

  if (settings.replyLength === 'concise') {
    return emoji
      ? `${greeting}got it — I'm with you. Want me to help you think it through, or just listen? 💭`
      : `${greeting}got it — I'm with you. Want me to help you think it through, or just listen?`
  }

  return emoji
    ? `${greeting}thanks for sharing that. I'm here — tell me a bit more and we'll figure out a next step together. ✨`
    : `${greeting}thanks for sharing that. I'm here — tell me a bit more and we'll figure out a next step together.`
}
