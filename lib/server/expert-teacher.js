/**
 * LAIfe Expert Teacher Mode
 *
 * When explaining educational topics, teach progressively:
 * 1. Core idea
 * 2. Why it matters
 * 3. How it works
 * 4. Practical example
 * 5. Common mistakes
 * 6. Advanced insight
 * 7. Related concepts
 *
 * Do not dump every detail immediately.
 * Reveal complexity gradually.
 * Feel like an excellent teacher — not an encyclopedia.
 *
 * Invisible. No factual memory writes. Fail-soft.
 */

/**
 * @typedef {{ role: string, content: string }} ChatTurn
 */

/**
 * @typedef {'core'|'why'|'how'|'example'|'mistakes'|'advanced'|'related'} TeachingLayerId
 */

/**
 * @typedef {object} TeachingLayer
 * @property {TeachingLayerId} id
 * @property {number} order
 * @property {string} label
 * @property {string} writerHint
 */

/**
 * @typedef {object} ExpertTeacherPlan
 * @property {boolean} enabled
 * @property {'full'|'partial'|'continue'|'off'} mode
 * @property {TeachingLayer[]} sequence
 * @property {TeachingLayer[]} layersThisTurn
 * @property {TeachingLayerId[]} alreadyCovered
 * @property {TeachingLayerId[]} remaining
 * @property {string} topic
 * @property {string} writerBrief
 * @property {string[]} structureHints
 * @property {string[]} reasons
 */

/** @type {readonly TeachingLayer[]} */
export const TEACHING_SEQUENCE = Object.freeze([
  {
    id: 'core',
    order: 1,
    label: 'Core idea',
    writerHint: 'Idea centrale in 1–2 frasi chiare — ancora prima di qualsiasi dettaglio',
  },
  {
    id: 'why',
    order: 2,
    label: 'Why it matters',
    writerHint: 'Perché conta / a cosa serve nella vita reale dell’utente',
  },
  {
    id: 'how',
    order: 3,
    label: 'How it works',
    writerHint: 'Come funziona — meccanismo essenziale, ancora senza eccezioni rare',
  },
  {
    id: 'example',
    order: 4,
    label: 'Practical example',
    writerHint: 'Un esempio pratico concreto e calzante (non una lista di esempi)',
  },
  {
    id: 'mistakes',
    order: 5,
    label: 'Common mistakes',
    writerHint: 'Errori comuni da evitare — pochi, ad alto segnale',
  },
  {
    id: 'advanced',
    order: 6,
    label: 'Advanced insight',
    writerHint: 'Un insight avanzato — solo se il terreno è pronto; una rivelazione, non un trattato',
  },
  {
    id: 'related',
    order: 7,
    label: 'Related concepts',
    writerHint: 'Concetti correlati — una porta, non un nuovo corso',
  },
])

const EDUCATIONAL_ASK =
  /\b(cos['’]?è|cos['’]?e|che\s+cos['’]?è|what\s+is|what\s+are|explain|spieg[hia]|come\s+funziona|how\s+does|how\s+do\s+\w+\s+work|perch[eé]\s+|why\s+(is|do|does|are)|insegnami|teach\s+me|fammi\s+capire|help\s+me\s+understand|differenza\s+tra|difference\s+between|in\s+parole\s+semplici|eli5)\b/i

const CONTINUE_LEARN =
  /^(continua|continua\s+pure|vai\s+avanti|prosegui|avanti|go\s+on|continue|keep\s+going|dimmi\s+di\s+più|altro\??|and\s+then|tell\s+me\s+more|approfondisci)[\s!.]*$/i

const WANT_EXAMPLE = /\b(esempio|example|per\s+esempio|show\s+me)\b/i
const WANT_MISTAKES = /\b(errori|sbagl|mistakes?|pitfall|common\s+mistake)\b/i
const WANT_ADVANCED = /\b(avanzat|advanced|in\s+depth|profond|dettagliat|under\s+the\s+hood)\b/i

const LAYER_CUES = /** @type {Record<TeachingLayerId, RegExp>} */ ({
  core: /\b(in\s+sintesi|idea\s+centrale|sostanzialmente|simply\s+put|at\s+its\s+core|in\s+breve[,:]?\s)/i,
  why: /\b(perché\s+(conta|importa|serve)|why\s+it\s+matters|utile\s+perch|serve\s+a)\b/i,
  how: /\b(come\s+funziona|funziona\s+cos[iì]|mechanis|in\s+pratica\s+succede|sotto\s+il\s+cofano)\b/i,
  example: /\b(ad\s+esempio|per\s+esempio|for\s+example|es\.|e\.g\.|un\s+caso)\b/i,
  mistakes: /\b(errore\s+comune|errori\s+comuni|common\s+mistake|evita\s+di|pitfall|attenzione\s+a)\b/i,
  advanced: /\b(più\s+in\s+profond|advanced|insight|nota\s+avanzata|sotto\s+il\s+cofano|trade[\s-]?off)\b/i,
  related: /\b(collegat|related|in\s+relazione|simile\s+a|vicino\s+a|next\s+you['’]?d)\b/i,
})

/**
 * @param {string} text
 */
function normalize(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * @param {ChatTurn[]|undefined|null} messages
 */
function normalizeTurns(messages) {
  if (!Array.isArray(messages)) return []
  return messages
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map((m) => ({ role: m.role, content: normalize(m.content) }))
    .filter((m) => m.content.length > 0)
}

/**
 * @param {object} args
 */
export function isEducationalTopic(args) {
  const userMessage = normalize(args?.userMessage)
  const intent = args?.primaryIntent || ''
  const secondary = args?.secondaryRequests || []
  const topic = normalize(args?.topic || '')

  if (!userMessage) return false
  if (intent === 'greeting' || intent === 'thanks' || intent === 'calculation') return false
  if (intent === 'creation' && !EDUCATIONAL_ASK.test(userMessage)) return false

  if (intent === 'explanation') return true
  if (intent === 'how_to' && EDUCATIONAL_ASK.test(userMessage)) return true
  if (intent === 'comparison' && EDUCATIONAL_ASK.test(userMessage)) return true
  if (intent === 'question' && EDUCATIONAL_ASK.test(userMessage)) return true
  if (EDUCATIONAL_ASK.test(userMessage)) return true
  if (secondary.includes('wants_examples') && intent === 'explanation') return true
  if (/\b(concetto|concept|teoria|theory|principio|principle|fondamenti|basics)\b/i.test(`${topic} ${userMessage}`)) {
    return true
  }
  return false
}

/**
 * Infer which layers already appeared in recent teaching turns.
 * @param {ChatTurn[]} turns
 * @param {string[]} [alreadyExplained]
 * @returns {TeachingLayerId[]}
 */
export function detectCoveredLayers(turns, alreadyExplained = []) {
  /** @type {Set<TeachingLayerId>} */
  const covered = new Set()
  const explainedBlob = (alreadyExplained || []).join('\n').toLowerCase()

  for (const layer of TEACHING_SEQUENCE) {
    if (explainedBlob.includes(layer.label.toLowerCase()) || explainedBlob.includes(layer.id)) {
      covered.add(layer.id)
    }
  }

  // Scan recent assistant teaching (last 2 substantive replies)
  let seen = 0
  for (let i = turns.length - 1; i >= 0 && seen < 2; i--) {
    const t = turns[i]
    if (t.role !== 'assistant') continue
    if (t.content.length < 80) continue
    seen += 1
    for (const layer of TEACHING_SEQUENCE) {
      if (LAYER_CUES[layer.id].test(t.content)) covered.add(layer.id)
    }
    // Long teaching replies almost always cover core
    if (t.content.length > 200) covered.add('core')
  }

  return TEACHING_SEQUENCE.map((l) => l.id).filter((id) => covered.has(id))
}

/**
 * How many new layers to reveal this turn.
 * @param {object} args
 */
function depthBudget(args) {
  const {
    technicalLevel,
    complexity,
    secondary = [],
    continueMode,
    keepFast,
  } = args

  if (keepFast || secondary.includes('wants_brief')) {
    return continueMode ? 1 : 2
  }

  if (continueMode) {
    if (secondary.includes('wants_depth') || technicalLevel === 'expert') return 2
    return 1
  }

  // First teaching turn — progressive, never all seven
  if (secondary.includes('wants_depth') || complexity === 'high') {
    return technicalLevel === 'beginner' ? 4 : 5
  }

  if (complexity === 'low' || technicalLevel === 'beginner') return 3

  if (technicalLevel === 'expert') return 5

  return 4
}

/**
 * Pick which layers to teach this turn.
 * @param {TeachingLayerId[]} covered
 * @param {number} budget
 * @param {string} userMessage
 * @returns {TeachingLayer[]}
 */
function selectLayersThisTurn(covered, budget, userMessage) {
  const coveredSet = new Set(covered)
  /** @type {TeachingLayer[]} */
  let remaining = TEACHING_SEQUENCE.filter((l) => !coveredSet.has(l.id))

  // Explicit user asks jump the queue (still progressive — include prerequisites lightly)
  if (WANT_EXAMPLE.test(userMessage) && !coveredSet.has('example')) {
    remaining = prioritize(remaining, ['core', 'example'])
  } else if (WANT_MISTAKES.test(userMessage) && !coveredSet.has('mistakes')) {
    remaining = prioritize(remaining, ['core', 'mistakes'])
  } else if (WANT_ADVANCED.test(userMessage) && !coveredSet.has('advanced')) {
    remaining = prioritize(remaining, ['core', 'how', 'advanced'])
  }

  // Always keep sequence order among chosen set
  const chosen = remaining.slice(0, Math.max(1, budget))
  return chosen.sort((a, b) => a.order - b.order)
}

/**
 * @param {TeachingLayer[]} remaining
 * @param {TeachingLayerId[]} preferIds
 */
function prioritize(remaining, preferIds) {
  const prefer = new Set(preferIds)
  const head = remaining.filter((l) => prefer.has(l.id))
  const tail = remaining.filter((l) => !prefer.has(l.id))
  // Keep relative order within each group (already sequenced)
  return [...head, ...tail]
}

/**
 * @param {object} input
 * @param {string} input.userMessage
 * @param {ChatTurn[]} [input.messages]
 * @param {{
 *   primaryIntent?: string,
 *   secondaryRequests?: string[],
 *   technicalLevel?: string,
 *   complexity?: string,
 *   topic?: string,
 * } | null} [input.understanding]
 * @param {{
 *   currentTopic?: string,
 *   alreadyExplained?: string[],
 *   followUpKind?: string,
 * } | null} [input.session]
 * @param {{ keepFast?: boolean } | null} [input.planHints]
 * @returns {ExpertTeacherPlan}
 */
export function analyzeExpertTeacher(input) {
  const userMessage = normalize(input?.userMessage)
  const understanding = input?.understanding || {}
  const session = input?.session || null
  const turns = normalizeTurns(input?.messages)
  const topic = session?.currentTopic || understanding.topic || 'il concetto'
  /** @type {string[]} */
  const reasons = []

  const educational = isEducationalTopic({
    userMessage,
    primaryIntent: understanding.primaryIntent,
    secondaryRequests: understanding.secondaryRequests,
    topic,
  })

  const follow = session?.followUpKind
  const continueMode =
    CONTINUE_LEARN.test(userMessage) ||
    follow === 'continue' ||
    follow === 'clarify' ||
    (follow === 'ack' && educational)

  if (!educational && !continueMode) {
    return {
      enabled: false,
      mode: 'off',
      sequence: [...TEACHING_SEQUENCE],
      layersThisTurn: [],
      alreadyCovered: [],
      remaining: TEACHING_SEQUENCE.map((l) => l.id),
      topic,
      writerBrief: '',
      structureHints: [],
      reasons: ['Non è un turno didattico: Expert Teacher Mode spento.'],
    }
  }

  // Pure thanks/stop — don't teach
  if (
    /^(grazie|thanks|thank\s+you|thx|basta|stop|fine)[\s!.]*$/i.test(userMessage) ||
    understanding.primaryIntent === 'thanks'
  ) {
    return {
      enabled: false,
      mode: 'off',
      sequence: [...TEACHING_SEQUENCE],
      layersThisTurn: [],
      alreadyCovered: [],
      remaining: [],
      topic,
      writerBrief: '',
      structureHints: [],
      reasons: ['Chiusura: niente lezione.'],
    }
  }

  reasons.push('Topic / intento educativo rilevato.')

  const covered = detectCoveredLayers(turns, session?.alreadyExplained || [])
  // On a fresh educational ask (not continue), don't over-skip from weak cues
  const effectiveCovered =
    continueMode || follow === 'example' || follow === 'clarify' ? covered : []

  if (follow === 'example') {
    // User asked for example — focus example (+ core if needed)
    const layers = selectLayersThisTurn(effectiveCovered.filter((id) => id !== 'example'), 2, 'esempio')
    return buildPlan({
      mode: 'partial',
      topic,
      covered: effectiveCovered,
      layersThisTurn: layers.length ? layers : TEACHING_SEQUENCE.filter((l) => l.id === 'example'),
      reasons: [...reasons, 'Richiesta esplicita di esempio.'],
      keepFast: Boolean(input?.planHints?.keepFast),
    })
  }

  const budget = depthBudget({
    technicalLevel: understanding.technicalLevel || 'intermediate',
    complexity: understanding.complexity || 'medium',
    secondary: understanding.secondaryRequests || [],
    continueMode,
    keepFast: Boolean(input?.planHints?.keepFast),
  })

  const layersThisTurn = selectLayersThisTurn(effectiveCovered, budget, userMessage)

  if (layersThisTurn.length === 0) {
    return {
      enabled: false,
      mode: 'off',
      sequence: [...TEACHING_SEQUENCE],
      layersThisTurn: [],
      alreadyCovered: effectiveCovered,
      remaining: [],
      topic,
      writerBrief:
        'Expert Teacher: sequenza già completa sul filo. Rispondi breve; non riesporre l’enciclopedia.',
      structureHints: [],
      reasons: [...reasons, 'Tutti i layer già coperti.'],
    }
  }

  const mode = continueMode ? 'continue' : layersThisTurn.length >= 5 ? 'full' : 'partial'

  return buildPlan({
    mode,
    topic,
    covered: effectiveCovered,
    layersThisTurn,
    reasons: [
      ...reasons,
      continueMode ? 'Continuazione progressiva: rivela i prossimi layer.' : 'Prima passata didattica progressiva.',
      `Budget layer questo turno: ${budget}.`,
    ],
    keepFast: Boolean(input?.planHints?.keepFast),
  })
}

/**
 * @param {object} args
 * @returns {ExpertTeacherPlan}
 */
function buildPlan(args) {
  const { mode, topic, covered, layersThisTurn, reasons, keepFast } = args
  const coveredSet = new Set(covered)
  for (const l of layersThisTurn) coveredSet.add(l.id)
  const remaining = TEACHING_SEQUENCE.map((l) => l.id).filter((id) => !coveredSet.has(id))

  const structureHints = layersThisTurn.map(
    (l) => `${l.order}. ${l.label}: ${l.writerHint}`,
  )

  const layerList = layersThisTurn.map((l) => `${l.order}. ${l.label}`).join(' → ')

  const writerBrief = [
    `EXPERT TEACHER MODE attivo su “${topic}”.`,
    `Insegna in modo progressivo — questo turno solo: ${layerList}.`,
    'Sequenza canonica: Core idea → Why it matters → How it works → Practical example → Common mistakes → Advanced insight → Related concepts.',
    'NON scaricare tutti i dettagli subito. NON scrivere un’enciclopedia.',
    'Rivela la complessità gradualmente; prosa da ottimo insegnante (guida, esempi vivi, ritmo umano).',
    keepFast
      ? 'Sintesi richiesta: tieni ogni layer a 1–2 frasi.'
      : 'Ogni layer: abbastanza per far capire, poi passa al successivo senza muri di testo.',
    remaining.length
      ? `Layer ancora in serbo (non forzare ora): ${remaining.join(', ')}.`
      : 'Sequenza completa dopo questo turno.',
    'Non numerare le fasi all’utente (niente “Passo 1/2/3” da manuale) salvo che chieda una lista.',
    'Non citare Expert Teacher Mode.',
  ].join(' ')

  return {
    enabled: true,
    mode,
    sequence: [...TEACHING_SEQUENCE],
    layersThisTurn,
    alreadyCovered: [...covered],
    remaining,
    topic,
    writerBrief,
    structureHints,
    reasons,
  }
}

/**
 * @param {ExpertTeacherPlan | null | undefined} plan
 */
export function formatExpertTeacherForWriter(plan) {
  if (!plan?.enabled) return ''

  const seq = TEACHING_SEQUENCE.map((l) => `${l.order}. ${l.label}`).join(' → ')
  const now = plan.layersThisTurn.map((l) => `${l.order}. ${l.label}`).join(' → ')

  return `══════════════════════════════════════
EXPERT TEACHER MODE (INVISIBILE)
══════════════════════════════════════
Insegna progressivamente. Non scaricare tutto subito.
Sequenza completa: ${seq}
Questo turno: ${now || '(silenzio)'}
Mode: ${plan.mode} · Topic: ${plan.topic}

${plan.writerBrief}

Regole assolute:
- Core idea prima di tutto
- Complessità rivelata gradualmente
- Sensazione: ottimo insegnante, non enciclopedia
- Mai citare questo motore all’utente`
}

/**
 * @param {object} input
 * @returns {{ plan: ExpertTeacherPlan, context: string }}
 */
export function runExpertTeacher(input) {
  try {
    const plan = analyzeExpertTeacher(input)
    return {
      plan,
      context: formatExpertTeacherForWriter(plan),
    }
  } catch {
    return {
      plan: {
        enabled: false,
        mode: 'off',
        sequence: [...TEACHING_SEQUENCE],
        layersThisTurn: [],
        alreadyCovered: [],
        remaining: [],
        topic: '',
        writerBrief: '',
        structureHints: [],
        reasons: ['fallback'],
      },
      context: '',
    }
  }
}
