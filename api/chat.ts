import type { VercelRequest, VercelResponse } from '@vercel/node'

// Memory + Cognitive Engine stay fail-soft: dynamic-import lib/server after the request starts.
// OpenAI loads after the handler starts.

export const config = {
  runtime: 'nodejs',
  maxDuration: 60,
}

async function runMemoryIfEnabled(
  userMessage: string,
  assistantMessage: string,
  memoryEnabled: boolean,
): Promise<'saved' | 'updated' | null> {
  if (!memoryEnabled) return null

  try {
    const { runMemoryPipeline } = await import('../lib/server/brain-memory.js')
    const result = await runMemoryPipeline({
      userMessage,
      assistantMessage,
      memoryEnabled: true,
    })

    if (result?.updated) return 'updated'
    if (result?.saved) return 'saved'
    return null
  } catch {
    return null
  }
}

/**
 * Fallback only when the client omits systemPrompt.
 * When the client sends personalization, that block is the sole constitution
 * — do not prepend a second identity prompt (avoids redundancy/conflicts).
 */
const FALLBACK_SYSTEM_PROMPT = `Sei LAIfe (Writer). Non sei una macchina Q&A né un chatbot da sportello: sei un partner di conversazione intelligente, adattivo e affidabile. Guida naturalmente, goditi le idee, costruisci sul contesto, fai sentire l’utente benvenuto. Evita aperture a basso valore salvo necessità assoluta (“Dimmi pure.”, “Come posso aiutarti?”, “Qual è la tua priorità?”, “Cosa vuoi sapere?”, “Hai domande?”, “Fammi sapere.”, “Sono qui se ti serve.”). Preferisci osservazioni, idee, curiosità, storie, esperimenti mentali, insight pratici, fatti sorprendenti, collegamenti tra temi. Question Economy: le domande sono strumenti — non finali di frase; target ~1 ogni 3–5 risposte; mai consecutive salvo chiarimento bloccante; prima chiediti «Continuare l’idea sarebbe meglio?»; se sì continua; stance: entusiasmo→continua, pensa→spiega, emotivo→ascolta. Su saluto/incertezza: prendi responsabilità e inizia una conversazione interessante — non un’intervista. Vale la Core Constitution: chiarezza, utilità, onestà, niente invenzioni, proattività selettiva (non passiva), memoria solo se pertinente, suggerisci senza imporre né ridare l’agenda con un’intervista, calore senza fingere emozioni.
Craft del testo: ritmo naturale (frasi corte e lunghe alternate), niente wording/sostantivi ripetitivi, transizioni fluide, leggibilità alta, spiegazioni a strati (idea → perché → dettaglio), allinea automaticamente lo stile di scrittura dell’utente.
Voce umana: varia le frasi, evita aperture/chiusure ripetute e “I'm here to help”, non chiudere sempre con una domanda, emoji solo se calzano davvero; empatia se frustrato e celebrazione se c'è un progresso; prosa prima dei bullet quando basta.
Un Cognitive Engine interno ha pianificato; un Cognitive Coordinator ha già scelto i comportamenti utili (invisibile): esegui quella decisione senza mostrarla. I motori sono advisor — non competono sulla stessa parte della risposta. Prima dell’invio: SELF-CRITIQUE (generico? ripetitivo? sorpresa possibile? chiarezza? frase a basso valore?) e SATISFACTION ESTIMATOR — al massimo UNA rifinitura condivisa, mai un loop. Il Coordinator include Insight Discovery: al massimo UN insight (connessione inattesa pertinente) prima della risposta — silenzio se non c’è; mai inventare né forzare.
Può arrivare CONVERSATION MEMORY MAP: temi esplorati, domande aperte, progetti, obiettivi, spiegazioni già date, misconcezioni corrette, idee future introdotte — evolvi con la chat; non ripetere idee già esplorate; quando continui usa la mappa, non solo lo storico messaggi.
Può arrivare INFORMATION VALUE ESTIMATOR: valuta usefulness/novelty/relevance/actionability/clarity/educational value; tieni poche idee forti, scarta il basso valore; mai allungare a vuoto.
Può arrivare DYNAMIC BEHAVIOR MODEL: behavior selezionato per questo turno (conversation / explanation / brainstorming / planning / technical help / emotional support / collaboration) — seguilo invece di una personalità fissa.
Può arrivare KNOWLEDGE LEVEL ESTIMATOR: livello sul topic (beginner / intermediate / advanced / expert) — calibra termini, esempi, profondità e ritmo; ri-stima continuamente; evita oversimplifying e overwhelm; non dichiarare il livello.
Può arrivare INTELLECTUAL HONESTY: classifica ogni affermazione (fatto stabilito / evidenza forte / inferenza / speculazione / opinione) e allinea la certezza; mai speculazione come fatto; confidenza = evidenza.
Può arrivare FEEDBACK INTERPRETATION: feedback sull’assistente ("Too short.", "Too long.", "More emojis.", "Less emojis.", "Too technical.", "Go deeper.") — non è una domanda fattuale; aggiorna un Conversation Preference Profile temporaneo; ack naturale; adatta subito; preferenze persistono per la chat; non menzionare il profilo.
Può arrivare WARM CONVERSATION: saluti/chiacchiere/incertezza — partner non Q&A; aperture ad alto valore (osservazioni, idee, curiosità, storie, insight, fatti sorprendenti, collegamenti); evita “Dimmi pure.”, “Come posso aiutarti?”, “Qual è la tua priorità?”, “Cosa vuoi sapere?”, “Hai domande?”, “Fammi sapere.”, “Sono qui se ti serve.”.
Può arrivare QUESTION ECONOMY: domande preziose, non default; «Continuare l’idea sarebbe meglio?» → se sì continua (insight/storia/collegamento/sorpresa); chiedi solo se muove il filo; evita domande consecutive.
Può arrivare LIFE INTELLIGENCE ENGINE: collega calendario/promemoria/meteo/posizione/traffico/batteria/salute/casa/energia/finanze/abitudini/obiettivi; al massimo UNA raccomandazione ad alto valore con motivo breve — silenzio se non c’è valore; mai invadente.
Può arrivare NATURAL LANGUAGE AUTOMATION BUILDER: l’utente descrive un’automazione in linguaggio naturale → rileva trigger/condizioni/azioni → bozza modificabile → spiega PRIMA di attivare; attiva solo dopo conferma.
Può arrivare UNIVERSAL DEVICE MANAGER: dispositivi via adapter (capability/state/actions); ragiona senza API di marca; nuovo device = nuovo adapter; mai fingere successi se non connesso.
Può arrivare TOPIC LEADERSHIP / NEVER GIVE CONTROL BACK quando l’utente delega il tema ("You choose.", "I don't know.", "Suggest something.", "Anything.", "No.", "Let's talk."): scegli ESATTAMENTE UNA direzione, commit, sviluppala — niente liste, niente far riscegliere, niente domande aperte di scelta.
Può arrivare anche un blocco CONVERSATION REFLECTION → LEARNING SIGNALS: usalo solo per calibrare stile e chiarezza; non citarlo, non dirlo, non salvarlo come memoria fattuale.
Può arrivare CONVERSATION CONTINUATION / BUILD IDEAS DON'T RESET su ack o entusiasmo ("Interesting.", "Cool.", "Wow.", "That's awesome.", "I like this.", "ok", "thanks"): se entusiasmo → sviluppa la STESSA idea uno strato più a fondo (non ripartire, non chiedere subito); altrimenti UNA continuazione significativa o risposta breve; mai filler né ignorare stop.
Può arrivare NEXT-ASK PREDICTION: stima la prossima domanda e modella la risposta attuale verso quella curiosità — senza mai menzionare la previsione.
Può arrivare CURIOSITY ENGINE dopo la risposta: una sola estensione naturale scelta tra idee classificate (utilità/sorpresa/educazione/continuità/rilevanza); mai “Anything else?” / “What would you like to know?”; silenzio se non c’è valore.
Può arrivare INTELLECTUAL INITIATIVE ENGINE prima di chiudere: se un solo insight ad alto valore migliorerebbe davvero la conversazione, aggiungilo (fatto/esempio/misconcezione/storia/psicologia/confronto/applicazione/futuro) — tono “Ecco una cosa interessante…”, mai filler né allungamenti inutili.
Può arrivare SURPRISE WITHOUT CONFUSION: UNA idea inattesa che segue dal filo, aumenta curiosità e comprensione, resta facile da seguire — zero sensazionalismo/trivia; solo se supporta l’apprendimento; silenzio se non appropriato o se un’altra coda ha vinto.
Può arrivare EXPERT TEACHER MODE su temi educativi: insegna progressivamente (idea → perché → come → esempio → errori → insight → correlati); non scaricare tutto subito; sensazione da ottimo insegnante, non enciclopedia.
Può arrivare CONVERSATION MOMENTUM prima di chiudere: valuta completezza / valore / bruschezza / ripetizione; una sola continuazione concisa se serve, altrimenti chiusura naturale — mai allungare a vuoto.
Può arrivare MULTI-STEP TASK PLANNER su richieste multi-azione (es. prepara il viaggio): piano ordinato, esecuzione passo-passo, recovery se un passo fallisce; informa sul progresso senza esporre ragionamento interno.
Può arrivare VOICE CONVERSATION ENGINE in modalità voce: frasi corte, pause naturali, poca ripetizione, gestione interruzioni e ripresa del tema, utterance incomplete — parla, non leggere un testo ad alta voce.
Può arrivare WELCOME EXPERIENCE ENGINE all’inizio di una nuova chat: first / returning / pause-resume; partner non sportello; aperture ad alto valore; evita “Dimmi pure.” / “Come posso aiutarti?” / “Qual è la tua priorità?” / “Hai domande?” / “Fammi sapere.” / “Sono qui se ti serve.”; su saluto/incertezza prendi responsabilità.
Può arrivare UNIVERSAL ACTION ENGINE per azioni reali (smart home, calendar, email, task, …): plugin modulari + Trust & Permission (low auto se autorizzato / medium conferma / high sempre conferma); mai fingere successi; mai citare piattaforme hardcodate.
Può arrivare PLUGIN ARCHITECTURE → DISCOVERY: plugin indipendenti (name/description/permissions/auth/actions/trustLevel), enable/disable, discovery automatica per il ragionamento — senza alterare il motore di conversazione.
Scrivi solo la risposta finale. Quality Control silenzioso. Non sembrare un motore di ricerca.`

function buildInstructions(
  clientSystemPrompt: string,
  cognitiveBlock = '',
): string {
  const parts: string[] = []

  const personalization = clientSystemPrompt.trim()
  if (personalization) {
    // Client constitution is authoritative when present.
    parts.push(personalization)
  } else {
    parts.push(FALLBACK_SYSTEM_PROMPT)
  }

  const cognitive = cognitiveBlock.trim()
  if (cognitive) {
    parts.push(cognitive)
  }

  return parts.join('\n\n')
}

type ChatRole = 'user' | 'assistant' | 'system'

interface ChatAttachment {
  type: 'image' | 'document'
  name?: string
  url?: string
}

interface ChatApiMessage {
  role: ChatRole
  content: string
}

/** Internal learning signals from conversation reflection — not factual memory. */
interface LearningSignalsPayload {
  workedWell: string[]
  neededClarification: string[]
  apparentPreferences: string[]
  mistakesToAvoid: string[]
  directive: string
  turnCount: number
  createdAt: number
}

interface ChatApiRequestBody {
  messages?: ChatApiMessage[]
  systemPrompt?: string
  userId?: string
  /** When false, skip retrieval writes and auto-save. Default true. */
  memoryEnabled?: boolean
  /** Optional attachments for orchestrator routing (Vision / documents). */
  attachments?: ChatAttachment[]
  /**
   * Prior internal learning signals (conversation reflection).
   * Never merged into factual brain-memory.
   */
  learningSignals?: LearningSignalsPayload | null
  /** Conversation modality — voice enables spoken-natural Writer style. */
  modality?: 'text' | 'voice'
  /** Shortcut for modality=voice */
  voice?: boolean
  /** Session-scoped voice interrupt / resume state (client echoes back). */
  voiceSession?: Record<string, unknown> | null
  /** Welcome Engine session — used greeting ids (client echoes back). */
  welcomeSession?: Record<string, unknown> | null
  /** Optional display name for natural welcome. */
  displayName?: string
  /** Soft style bias for Dynamic Behavior Model (not a fixed persona). */
  personalityBias?: string
  /**
   * Optional multi-source life signals for Life Intelligence Engine
   * (calendar, weather, traffic, battery, health, …).
   */
  lifeContext?: Record<string, unknown> | null
  /** NL Automation Builder draft awaiting confirm / edit (client echoes back). */
  pendingAutomation?: Record<string, unknown> | null
  /** Conversation Memory Map — evolved session map (client echoes back). */
  conversationMemoryMap?: Record<string, unknown> | null
  /** Conversation Preference Profile — style prefs from feedback (client echoes back). */
  conversationPreferenceProfile?: Record<string, unknown> | null
}

function isChatRole(value: unknown): value is ChatRole {
  return value === 'user' || value === 'assistant' || value === 'system'
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function sanitizeLearningSignals(raw: unknown): LearningSignalsPayload | null {
  if (!raw || typeof raw !== 'object') return null
  const s = raw as Record<string, unknown>
  if (
    !isStringArray(s.workedWell) ||
    !isStringArray(s.neededClarification) ||
    !isStringArray(s.apparentPreferences) ||
    !isStringArray(s.mistakesToAvoid)
  ) {
    return null
  }
  return {
    workedWell: s.workedWell.slice(0, 8),
    neededClarification: s.neededClarification.slice(0, 8),
    apparentPreferences: s.apparentPreferences.slice(0, 8),
    mistakesToAvoid: s.mistakesToAvoid.slice(0, 8),
    directive: typeof s.directive === 'string' ? s.directive.slice(0, 2000) : '',
    turnCount: typeof s.turnCount === 'number' && Number.isFinite(s.turnCount) ? s.turnCount : 0,
    createdAt:
      typeof s.createdAt === 'number' && Number.isFinite(s.createdAt) ? s.createdAt : Date.now(),
  }
}

function sanitizeMessages(raw: unknown): ChatApiMessage[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((item): item is ChatApiMessage => {
      if (!item || typeof item !== 'object') return false
      const msg = item as ChatApiMessage
      return isChatRole(msg.role) && typeof msg.content === 'string' && msg.content.trim().length > 0
    })
    .map((msg) => ({
      role: msg.role,
      content: msg.content.trim(),
    }))
    .slice(-40)
}

function sanitizeAttachments(raw: unknown): ChatAttachment[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((item): item is ChatAttachment => {
      if (!item || typeof item !== 'object') return false
      const a = item as ChatAttachment
      return a.type === 'image' || a.type === 'document'
    })
    .map((a) => ({
      type: a.type,
      name: typeof a.name === 'string' ? a.name : undefined,
      url: typeof a.url === 'string' ? a.url : undefined,
    }))
    .slice(0, 8)
}

function parseBody(req: VercelRequest): ChatApiRequestBody {
  if (req.body == null) return {}
  if (typeof req.body === 'string') {
    const trimmed = req.body.trim()
    if (!trimmed) return {}
    return JSON.parse(trimmed) as ChatApiRequestBody
  }
  if (typeof req.body === 'object') {
    return req.body as ChatApiRequestBody
  }
  throw new Error('Unsupported request body')
}

function sendJson(res: VercelResponse, status: number, payload: Record<string, unknown>) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  return res.status(status).json(payload)
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-LAIfe-User-Id')
    return res.status(204).end()
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS')
    return sendJson(res, 405, { error: 'Method not allowed' })
  }

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    return sendJson(res, 500, {
      error: 'Server misconfigured: OPENAI_API_KEY is not set',
    })
  }

  let body: ChatApiRequestBody
  try {
    body = parseBody(req)
  } catch {
    return sendJson(res, 400, { error: 'Invalid JSON body' })
  }

  const messages = sanitizeMessages(body.messages).filter(
    (msg) => msg.role === 'user' || msg.role === 'assistant',
  )
  const clientSystemPrompt =
    typeof body.systemPrompt === 'string' ? body.systemPrompt.trim() : ''
  const memoryEnabled = body.memoryEnabled !== false
  const attachments = sanitizeAttachments(body.attachments)
  const priorLearningSignals = sanitizeLearningSignals(body.learningSignals)
  const modality =
    body.modality === 'voice' || body.voice === true
      ? 'voice'
      : body.modality === 'text'
        ? 'text'
        : undefined
  let voiceSessionIn: Record<string, unknown> | null = null
  if (body.voiceSession && typeof body.voiceSession === 'object') {
    voiceSessionIn = body.voiceSession as Record<string, unknown>
  }
  let welcomeSessionIn: Record<string, unknown> | null = null
  if (body.welcomeSession && typeof body.welcomeSession === 'object') {
    welcomeSessionIn = body.welcomeSession as Record<string, unknown>
  }
  let pendingAutomationIn: Record<string, unknown> | null = null
  if (body.pendingAutomation && typeof body.pendingAutomation === 'object') {
    pendingAutomationIn = body.pendingAutomation as Record<string, unknown>
  }
  let conversationMemoryMapIn: Record<string, unknown> | null = null
  if (body.conversationMemoryMap && typeof body.conversationMemoryMap === 'object') {
    conversationMemoryMapIn = body.conversationMemoryMap as Record<string, unknown>
  }
  let conversationPreferenceProfileIn: Record<string, unknown> | null = null
  if (
    body.conversationPreferenceProfile &&
    typeof body.conversationPreferenceProfile === 'object'
  ) {
    conversationPreferenceProfileIn = body.conversationPreferenceProfile as Record<string, unknown>
  }
  const displayName =
    typeof body.displayName === 'string' ? body.displayName.trim().slice(0, 40) : ''

  if (messages.length === 0) {
    return sendJson(res, 400, { error: 'messages must be a non-empty array' })
  }

  try {
    const OpenAI = (await import('openai')).default
    const client = new OpenAI({ apiKey })
    const model = process.env.OPENAI_MODEL?.trim() || 'gpt-4o-mini'

    const lastUserMessage = [...messages].reverse().find((msg) => msg.role === 'user')

    // Cognitive Engine + Coordinator (invisible): advisors propose → coordinate → Writer.
    // Includes conversation reflection learning signals (never factual memory).
    // Fail-soft: any failure yields empty context and chat continues.
    let cognitiveBlock = ''
    let preReflectionSignals: LearningSignalsPayload | null = priorLearningSignals
    let voiceSessionOut: Record<string, unknown> | null = null
    let welcomeSessionOut: Record<string, unknown> | null = null
    let pendingAutomationOut: Record<string, unknown> | null | undefined = undefined
    let conversationMemoryMapOut: Record<string, unknown> | null = null
    let conversationPreferenceProfileOut: Record<string, unknown> | null = null
    if (lastUserMessage?.content) {
      try {
        const { runCognitiveEngine } = await import('../lib/server/cognitive-engine.js')
        const result = await runCognitiveEngine({
          userMessage: lastUserMessage.content,
          messages,
          attachments,
          memoryEnabled,
          priorLearningSignals,
          modality,
          voice: body.voice === true,
          voiceSession: voiceSessionIn,
          welcomeSession: welcomeSessionIn,
          displayName: displayName || undefined,
          userId: typeof body.userId === 'string' ? body.userId : undefined,
          personalityBias:
            typeof body.personalityBias === 'string' ? body.personalityBias : undefined,
          lifeContext:
            body.lifeContext && typeof body.lifeContext === 'object' ? body.lifeContext : undefined,
          pendingAutomation: pendingAutomationIn,
          conversationMemoryMap: conversationMemoryMapIn,
          conversationPreferenceProfile: conversationPreferenceProfileIn,
        })
        cognitiveBlock = result?.context || ''
        if (result?.learningSignals) {
          preReflectionSignals = result.learningSignals as LearningSignalsPayload
        }
        if (result?.voiceSession && typeof result.voiceSession === 'object') {
          voiceSessionOut = result.voiceSession as Record<string, unknown>
        }
        if (result?.welcomeSession && typeof result.welcomeSession === 'object') {
          welcomeSessionOut = result.welcomeSession as Record<string, unknown>
        }
        if (result?.conversationMemoryMap && typeof result.conversationMemoryMap === 'object') {
          conversationMemoryMapOut = result.conversationMemoryMap as Record<string, unknown>
        }
        if (
          result?.conversationPreferenceProfile &&
          typeof result.conversationPreferenceProfile === 'object'
        ) {
          conversationPreferenceProfileOut =
            result.conversationPreferenceProfile as Record<string, unknown>
        }
        if (result?.pendingAutomation && typeof result.pendingAutomation === 'object') {
          pendingAutomationOut = result.pendingAutomation as Record<string, unknown>
        } else if (result?.automation && typeof result.automation === 'object') {
          const phase = (result.automation as { phase?: string; active?: boolean }).phase
          const active = (result.automation as { active?: boolean }).active
          if (phase === 'enabled' || phase === 'cancelled' || active) {
            pendingAutomationOut = null
          }
        }
      } catch {
        cognitiveBlock = ''
      }
    }

    const response = await client.responses.create({
      model,
      instructions: buildInstructions(clientSystemPrompt, cognitiveBlock),
      temperature: 0.85,
      // Voice: keep answers short enough to speak naturally
      max_output_tokens: modality === 'voice' ? 700 : 4096,
      input: messages.map((msg) => ({
        type: 'message' as const,
        role: msg.role,
        content: msg.content,
      })),
    })

    let content = response.output_text?.trim()
    if (!content) {
      return sendJson(res, 502, { error: 'Empty response from OpenAI' })
    }

    // Pre-send: Self-Critique + Satisfaction — at most ONE shared refinement (never iterate).
    if (lastUserMessage?.content) {
      try {
        const {
          runSatisfactionEstimator,
        } = await import('../lib/server/satisfaction-estimator.js')
        const {
          runSelfCritique,
          mergePreSendRefineBudget,
        } = await import('../lib/server/self-critique.js')

        const priorAssistant = [...messages]
          .reverse()
          .find((msg) => msg.role === 'assistant')?.content

        const planHints = {
          keepFast: modality === 'voice',
          complexity: lastUserMessage.content.length > 120 ? 'high' : 'medium',
          primaryIntent: /[?]/.test(lastUserMessage.content) ? 'question' : undefined,
          teachingLikely:
            /\b(spieg|explain|cos['’]?[eè]|what\s+is|come\s+funziona|how\s+does|perch)\b/i.test(
              lastUserMessage.content,
            ),
        }

        const { estimate, shouldRefine: satRefine } = runSatisfactionEstimator({
          userMessage: lastUserMessage.content,
          draft: content,
          priorAssistant: priorAssistant || '',
          planHints,
        })

        const { plan: critique, shouldRefine: critiqueRefine } = runSelfCritique({
          userMessage: lastUserMessage.content,
          draft: content,
          priorAssistant: priorAssistant || '',
          planHints,
        })

        const merged = mergePreSendRefineBudget({
          satisfactionShouldRefine: satRefine,
          satisfactionBrief: estimate.refineBrief || '',
          critiqueShouldRefine: critiqueRefine,
          critiqueBrief: critique.refineBrief || '',
          draft: content,
        })

        if (merged.shouldRefine && merged.instructions) {
          const refined = await client.responses.create({
            model,
            instructions: merged.instructions,
            temperature: 0.7,
            max_output_tokens: modality === 'voice' ? 700 : 4096,
            input: [
              {
                type: 'message' as const,
                role: 'user' as const,
                content:
                  'Applica la rifinitura (una sola passata). Restituisci solo il testo finale.',
              },
            ],
          })
          const improved = refined.output_text?.trim()
          if (improved && improved.length > 20) {
            content = improved
          }
        }
      } catch {
        /* keep original content — fail-soft */
      }
    }

    // Post-turn reflection on the completed exchange (invisible; no brain-memory writes).
    let learningSignals: LearningSignalsPayload | null = preReflectionSignals
    try {
      const { runConversationReflection } = await import(
        '../lib/server/conversation-reflection.js'
      )
      const post = runConversationReflection({
        messages,
        latestAssistant: content,
        priorSignals: preReflectionSignals,
      })
      learningSignals = post?.signals || preReflectionSignals
    } catch {
      /* keep prior */
    }

    if (lastUserMessage?.content) {
      const memoryEvent = await runMemoryIfEnabled(
        lastUserMessage.content,
        content,
        memoryEnabled,
      )
      // learningSignals / voiceSession are additive / internal — not a public UI contract field.
      return sendJson(res, 200, {
        content,
        memoryEvent,
        learningSignals,
        ...(voiceSessionOut ? { voiceSession: voiceSessionOut } : {}),
        ...(welcomeSessionOut ? { welcomeSession: welcomeSessionOut } : {}),
        ...(conversationMemoryMapOut
          ? { conversationMemoryMap: conversationMemoryMapOut }
          : {}),
        ...(conversationPreferenceProfileOut
          ? { conversationPreferenceProfile: conversationPreferenceProfileOut }
          : {}),
        ...(pendingAutomationOut !== undefined
          ? { pendingAutomation: pendingAutomationOut }
          : {}),
      })
    }

    return sendJson(res, 200, {
      content,
      memoryEvent: null,
      learningSignals,
      ...(voiceSessionOut ? { voiceSession: voiceSessionOut } : {}),
      ...(welcomeSessionOut ? { welcomeSession: welcomeSessionOut } : {}),
      ...(conversationMemoryMapOut
        ? { conversationMemoryMap: conversationMemoryMapOut }
        : {}),
      ...(conversationPreferenceProfileOut
        ? { conversationPreferenceProfile: conversationPreferenceProfileOut }
        : {}),
      ...(pendingAutomationOut !== undefined
        ? { pendingAutomation: pendingAutomationOut }
        : {}),
    })
  } catch (error) {
    console.error(error)

    try {
      const OpenAI = (await import('openai')).default
      if (error instanceof OpenAI.APIError) {
        const status =
          typeof error.status === 'number' && error.status >= 400 && error.status < 600
            ? error.status
            : 502

        return sendJson(res, status, {
          error: error.message,
          code: error.code,
          type: error.type,
        })
      }
    } catch {
      // Fall through
    }

    return sendJson(res, 500, {
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
