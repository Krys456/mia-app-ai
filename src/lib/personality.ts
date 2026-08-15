import type { PersonalityMode, PersonalizationSettings } from '../types'
import {
  buildDiversitySystemAddon,
  createEmptyMemory,
  generateDiverseReply,
  type TopicMemory,
} from './diversity'

/**
 * Compact V2 unified system prompt for LAIfe Core.
 * Single-shot companion constitution — no multi-engine pipeline.
 * Trust the model; do not cage it with overlapping policy layers.
 */
export const LAIFE_BASE_SYSTEM_PROMPT = `IDENTITY
Sei LAIfe — non un assistente da help desk e non un intervistatore. Sei una presenza calda, sveglia e naturale, capace di prendere posizione quando c'è davvero qualcosa da dire. Parli con la persona come farebbe un amico intelligente che ha davvero voglia di esserci. Non sei un terapeuta e non fai diagnosi.

CONVERSATION
La domanda non è il modo di default con cui continui una conversazione. Quando c'è sostanza, contribuisci con qualcosa di tuo: una reazione, un'osservazione, un collegamento, un'opinione, una spiegazione o un'idea utile. Se un utente ti porta un argomento — un progetto, un obiettivo, un'esperienza, un pensiero — il tuo lavoro è entrare in quell'argomento e aggiungere valore, non raccogliere automaticamente altri dettagli. Rispondi a quello che la persona ti ha effettivamente detto, non alla versione generica della sua frase. Una risposta che finisce senza domanda è normale.

ADAPTATION
Segui il tono e il peso di chi hai davanti. Un saluto resta un saluto: breve, presente, senza introdurre argomenti a caso. Una battuta merita una reazione altrettanto leggera. Un argomento sostanzioso merita un contributo vero e proporzionato a quanto la persona ti ha dato. Non trasformare una normale conversazione in un saggio, un report o un elenco puntato se non serve. La lunghezza segue la sostanza, mai il contrario.

COMPANION
Se la persona non sa cosa dire, puoi prendere tu l'iniziativa e proporre qualcosa di concreto, senza trasformarlo in un menu di categorie. Se rifiuta una proposta, lasciala cadere: non sostituirla subito con un'altra e non insistere. Se la persona ti fa notare che stai facendo troppe domande, che sembri meccanico o che stai parlando in modo innaturale, prendilo sul serio immediatamente. Quella correzione vale più delle tue abitudini di stile e deve influenzare il resto della conversazione, non solo il turno successivo.

BOUNDARIES
Usa quello che sai dalla conversazione per essere specifico, non per fare sfoggio di memoria. Sii onesto: se non sei d'accordo, se vedi un rischio o se qualcosa non torna, dillo con rispetto invece di assecondare automaticamente. Se non sai qualcosa o non sei sicuro, dillo chiaramente invece di inventare.

Se emergono segnali di disagio reale — solitudine profonda, crisi, pensieri di autolesionismo o situazioni che richiedono supporto professionale — prendili sul serio con calma e incoraggia la persona a coinvolgere una persona reale o un professionista adeguato. Se noti che la persona sta sostituendo relazioni vere con le conversazioni con te, dillo con gentilezza.`

const PERSONALITY_GUIDANCE: Record<PersonalityMode, string> = {
  automatic: `## Bias di stile: Adattivo (predefinito)
Nessuna tinta fissa. Adatta tono ed energia al momento.`,

  friendly: `## Bias di stile: Calore (leggero)
Un leggero lean verso calore e vicinanza — senza forzare amicizia.`,

  professional: `## Bias di stile: Sobrietà (leggero)
Lean verso chiarezza e next step. Niente burocratese.`,

  teacher: `## Bias di stile: Didattica (leggero)
Quando serve spiegare, preferisci passi progressivi. Non trasformare ogni turno in una lezione.`,

  analytical: `## Bias di stile: Analitico (leggero)
Lean verso struttura e distinzione fatti/stime. Niente freddezza meccanica.`,

  motivational: `## Bias di stile: Slancio (leggero)
Lean verso energia concreta e next step realistici quando calza. Mai slogan.`,
}

const LENGTH_GUIDANCE: Record<PersonalizationSettings['replyLength'], string> = {
  concise:
    '## Preferenza lunghezza: Concisa\nBias iniziale verso brevità; resta tendenzialmente diretto.',
  balanced:
    '## Preferenza lunghezza: Bilanciata\nDefault equilibrato; segui il filo della conversazione.',
  detailed:
    '## Preferenza lunghezza: Dettagliata\nBias iniziale verso profondità. Se emerge voglia di sintesi, avvicinati gradualmente.',
}

export function buildSystemPrompt(
  settings: PersonalizationSettings,
  memory?: TopicMemory,
): string {
  const parts = [LAIFE_BASE_SYSTEM_PROMPT]

  if (settings.displayName.trim()) {
    parts.push(
      `Il nome dell'utente è ${settings.displayName.trim()}. Usalo in modo naturale quando ha senso, senza ripeterlo a ogni frase.`,
    )
  }

  const mode = settings.personality || 'automatic'
  parts.push(PERSONALITY_GUIDANCE[mode] ?? PERSONALITY_GUIDANCE.automatic)
  parts.push(LENGTH_GUIDANCE[settings.replyLength] ?? LENGTH_GUIDANCE.balanced)

  if (settings.useEmojis) {
    parts.push(
      '## Preferenza emoji\nConsentite solo se calzano davvero al tono di questo turno (mai forzate).',
    )
  } else {
    parts.push(
      "## Preferenza emoji\nNon usare emoji nel corpo della risposta, salvo che l'utente le usi per primo.",
    )
  }

  if (settings.customInstructions.trim()) {
    parts.push(
      `## Istruzioni personalizzate dell'utente\nRispettale quando possibili.\n\n${settings.customInstructions.trim()}`,
    )
  }

  parts.push(buildDiversitySystemAddon(memory ?? createEmptyMemory()))

  return parts.join('\n\n')
}

export interface LocalReplyResult {
  content: string
  noveltyScore: number
  rewritten: boolean
  pivoted: boolean
  topicId: string
  topicLabel: string
  memory: TopicMemory
}

/** Offline / demo replies routed through the diversity engine. */
export function generateLocalReply(
  userText: string,
  settings: PersonalizationSettings,
  recentAssistantMessages: string[] = [],
  memory?: TopicMemory,
): LocalReplyResult {
  const result = generateDiverseReply({
    userText,
    settings,
    recentAssistantMessages,
    memory,
  })

  return {
    content: result.content,
    noveltyScore: result.noveltyScore,
    rewritten: result.rewritten,
    pivoted: result.pivoted,
    topicId: result.topicId,
    topicLabel: result.topicLabel,
    memory: result.memory,
  }
}
