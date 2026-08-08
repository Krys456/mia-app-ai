/**
 * LAIfe Welcome Engine
 *
 * When a new conversation starts:
 * 1. Detect whether the user is new or returning
 * 2. If returning: recall the most relevant ongoing project — mention only one naturally
 * 3. Adapt enthusiasm to the user's writing style
 * 4. Generate a warm greeting (never reuse the same one)
 * 5. Suggest the single most relevant continuation
 *
 * Avoid generic openings. Feel like continuing an existing relationship.
 * Invisible — Writer guidance only.
 */

/**
 * @typedef {object} WelcomeSessionState
 * @property {string[]} usedGreetingIds
 * @property {number} welcomeCount
 * @property {number} updatedAt
 */

/**
 * @typedef {'calm'|'warm'|'bright'|'terse'|'formal'} EnthusiasmStyle
 */

/**
 * @typedef {object} OngoingProject
 * @property {string} label
 * @property {string} detail
 * @property {number} score
 * @property {string} [source]
 */

/**
 * @typedef {object} WelcomePlan
 * @property {boolean} active
 * @property {boolean} isConversationStart
 * @property {'new'|'returning'} userKind
 * @property {EnthusiasmStyle} enthusiasm
 * @property {string | null} greetingId
 * @property {string} greetingSeed          Concrete opening line seed (Writer may lightly adapt)
 * @property {OngoingProject | null} project
 * @property {string | null} continuation   Single relevant continuation suggestion
 * @property {'full_welcome'|'warm_handoff'} mode
 * @property {string} writerBrief
 * @property {string[]} reasons
 * @property {WelcomeSessionState} session
 */

/** @type {Array<{ id: string, style: EnthusiasmStyle[], kind: 'new'|'returning'|'both', line: (ctx: { name?: string, project?: string }) => string }>} */
const GREETING_BANK = [
  // Returning — warm
  {
    id: 'ret-warm-1',
    style: ['warm', 'bright'],
    kind: 'returning',
    line: ({ name, project }) =>
      project
        ? `${name ? `${name}, c` : 'C'}he bello rivederti — ${project} ti aspetta ancora, se vuoi riprenderlo.`
        : `${name ? `${name}, c` : 'C'}he bello rivederti. Dimmi dove riprendiamo.`,
  },
  {
    id: 'ret-warm-2',
    style: ['warm', 'calm'],
    kind: 'returning',
    line: ({ name, project }) =>
      project
        ? `Eccoti${name ? `, ${name}` : ''}. Se vuoi, possiamo riprendere da ${project}.`
        : `Eccoti${name ? `, ${name}` : ''}. Sono qui — dimmi pure.`,
  },
  {
    id: 'ret-warm-3',
    style: ['warm', 'bright'],
    kind: 'returning',
    line: ({ project }) =>
      project
        ? `Bentornato. Mi è venuto in mente ${project} — vuoi continuare da lì?`
        : `Bentornato. Di cosa ti occupiamo oggi?`,
  },
  {
    id: 'ret-calm-1',
    style: ['calm', 'terse'],
    kind: 'returning',
    line: ({ project }) =>
      project ? `Ciao. Riprendiamo ${project}?` : `Ciao. Dimmi pure.`,
  },
  {
    id: 'ret-calm-2',
    style: ['calm', 'formal'],
    kind: 'returning',
    line: ({ name, project }) =>
      project
        ? `Piacere di rivederti${name ? `, ${name}` : ''}. Possiamo riprendere ${project}, se ti è utile.`
        : `Piacere di rivederti${name ? `, ${name}` : ''}. Come posso esserti utile?`,
  },
  {
    id: 'ret-bright-1',
    style: ['bright'],
    kind: 'returning',
    line: ({ project }) =>
      project
        ? `Hey! Pronto a dare un’altra spinta a ${project}?`
        : `Hey! Dimmi — da dove partiamo?`,
  },
  {
    id: 'ret-bright-2',
    style: ['bright', 'warm'],
    kind: 'returning',
    line: ({ name, project }) =>
      project
        ? `Ciao${name ? ` ${name}` : ''}! ${project} è ancora lì: riprendiamo?`
        : `Ciao${name ? ` ${name}` : ''}! Sono contento di rivederti.`,
  },
  {
    id: 'ret-terse-1',
    style: ['terse'],
    kind: 'returning',
    line: ({ project }) => (project ? `Ciao. ${project}?` : `Ciao.`),
  },
  {
    id: 'ret-formal-1',
    style: ['formal'],
    kind: 'returning',
    line: ({ name, project }) =>
      project
        ? `Buongiorno${name ? ` ${name}` : ''}. Se desideri, possiamo riprendere il lavoro su ${project}.`
        : `Buongiorno${name ? ` ${name}` : ''}. Sono a disposizione.`,
  },
  {
    id: 'ret-warm-4',
    style: ['warm', 'calm'],
    kind: 'returning',
    line: ({ project }) =>
      project
        ? `Ci siamo. L’ultima cosa aperta che mi viene in mente è ${project} — ci torniamo?`
        : `Ci siamo. Continuiamo da dove ha senso per te.`,
  },
  // New users
  {
    id: 'new-warm-1',
    style: ['warm', 'bright'],
    kind: 'new',
    line: ({ name }) =>
      `Ciao${name ? ` ${name}` : ''}. Sono LAIfe — dimmi pure da dove vuoi partire.`,
  },
  {
    id: 'new-warm-2',
    style: ['warm', 'calm'],
    kind: 'new',
    line: () => `Ciao. Piacere — sono qui per aiutarti sul serio, senza giri di parole.`,
  },
  {
    id: 'new-calm-1',
    style: ['calm', 'terse'],
    kind: 'new',
    line: () => `Ciao. Dimmi pure cosa ti serve.`,
  },
  {
    id: 'new-bright-1',
    style: ['bright'],
    kind: 'new',
    line: ({ name }) =>
      `Hey${name ? ` ${name}` : ''}! Pronto quando lo sei tu — cosa affrontiamo per primo?`,
  },
  {
    id: 'new-formal-1',
    style: ['formal'],
    kind: 'new',
    line: ({ name }) =>
      `Buongiorno${name ? ` ${name}` : ''}. Sono LAIfe: dimmi pure come posso esserti utile.`,
  },
  {
    id: 'new-terse-1',
    style: ['terse'],
    kind: 'new',
    line: () => `Ciao. Dimmi.`,
  },
  {
    id: 'new-warm-3',
    style: ['warm'],
    kind: 'new',
    line: () => `Ciao. Iniziamo con calma — cosa hai in mente?`,
  },
  // Handoff seeds (substance first message) — short warmth, not a full social greeting
  {
    id: 'hand-warm-1',
    style: ['warm', 'bright', 'calm'],
    kind: 'both',
    line: ({ project }) =>
      project
        ? `Ok — ci sono. Se serve, dopo torniamo anche a ${project}.`
        : `Ok — ci sono.`,
  },
  {
    id: 'hand-terse-1',
    style: ['terse', 'calm'],
    kind: 'both',
    line: () => `Ok.`,
  },
  {
    id: 'hand-formal-1',
    style: ['formal'],
    kind: 'both',
    line: () => `D’accordo — procediamo.`,
  },
  {
    id: 'hand-bright-1',
    style: ['bright', 'warm'],
    kind: 'both',
    line: () => `Perfetto, andiamo.`,
  },
  {
    id: 'hand-ret-1',
    style: ['warm', 'calm', 'bright'],
    kind: 'returning',
    line: ({ project }) =>
      project ? `Ci sono. (E se vuoi, dopo riprendiamo ${project}.)` : `Ci sono.`,
  },
]

const GREETING_ONLY =
  /^(ciao|hey|hi|hello|buongiorno|buonasera|salve|hola|yo|ehi)([\s!,.]|$)/i

const SUBSTANCE =
  /\b(aiut|help|come\s+|how\s+|perch|why|fix|bug|crea|build|scriv|write|spieg|explain|piano|plan|debug|codice|code|errore|error)\b/i

/**
 * @returns {WelcomeSessionState}
 */
export function emptyWelcomeSession() {
  return {
    usedGreetingIds: [],
    welcomeCount: 0,
    updatedAt: Date.now(),
  }
}

/**
 * @param {unknown} raw
 * @returns {WelcomeSessionState}
 */
export function sanitizeWelcomeSession(raw) {
  const base = emptyWelcomeSession()
  if (!raw || typeof raw !== 'object') return base
  const s = /** @type {Record<string, unknown>} */ (raw)
  return {
    usedGreetingIds: Array.isArray(s.usedGreetingIds)
      ? s.usedGreetingIds.filter((x) => typeof x === 'string').map((x) => x.slice(0, 40)).slice(-40)
      : [],
    welcomeCount:
      typeof s.welcomeCount === 'number' && Number.isFinite(s.welcomeCount) ? s.welcomeCount : 0,
    updatedAt:
      typeof s.updatedAt === 'number' && Number.isFinite(s.updatedAt) ? s.updatedAt : Date.now(),
  }
}

/**
 * True when this turn opens a fresh conversation (no prior assistant turns).
 * @param {Array<{ role?: string, content?: string }> | null | undefined} messages
 */
export function isConversationStart(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return true
  const turns = messages.filter(
    (m) =>
      m &&
      (m.role === 'user' || m.role === 'assistant') &&
      typeof m.content === 'string' &&
      m.content.trim(),
  )
  const assistants = turns.filter((m) => m.role === 'assistant')
  const users = turns.filter((m) => m.role === 'user')
  return assistants.length === 0 && users.length <= 1
}

/**
 * @param {string} text
 * @param {{ apparentPreferences?: string[] } | null} [signals]
 * @returns {EnthusiasmStyle}
 */
export function detectEnthusiasmStyle(text, signals) {
  const t = String(text || '')
  const prefs = (signals?.apparentPreferences || []).join(' ').toLowerCase()

  if (
    /\b(formale|formal|cortese)\b/i.test(prefs) ||
    /\b(per\s+favore|gentil(?:e|mente)|cordiali|please\s+could|potrebbe|vorrei\s+chiederle)\b/i.test(t)
  ) {
    return 'formal'
  }
  if (/\b(breve|concis|terse|short)\b/i.test(prefs) || (t.length < 24 && !/[!]/.test(t))) {
    if (GREETING_ONLY.test(t.trim()) && t.length < 16) return 'terse'
  }
  if (
    (t.match(/!/g) || []).length >= 1 ||
    /\b(!!|wow|yay|super|dai)\b/i.test(t) ||
    /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(t)
  ) {
    return 'bright'
  }
  if (/\b(hey|yo|raga|lol|ahah)\b/i.test(t)) return 'bright'
  if (t.length > 140 || /\b(vorrei|potresti|mi\s+chiedevo)\b/i.test(t)) return 'calm'
  if (/\b(breve|tl;dr|in\s+sintesi)\b/i.test(t)) return 'terse'
  return 'warm'
}

/**
 * @param {object} input
 * @returns {'new'|'returning'}
 */
export function detectUserKind(input) {
  if (input?.userKind === 'returning' || input?.isReturning === true) return 'returning'
  if (input?.userKind === 'new' || input?.isReturning === false) return 'new'

  const session = sanitizeWelcomeSession(input?.welcomeSession)
  if (session.welcomeCount > 0) return 'returning'

  const signals = input?.learningSignals
  if (signals && (signals.turnCount > 0 || (signals.apparentPreferences || []).length > 0)) {
    return 'returning'
  }

  if (Array.isArray(input?.projects) && input.projects.length > 0) return 'returning'
  if (typeof input?.displayName === 'string' && input.displayName.trim()) {
    // Name alone isn't enough — but with any memory hint → returning
    if (input?.hasMemories === true) return 'returning'
  }
  if (input?.hasMemories === true) return 'returning'

  return 'new'
}

/**
 * Pick best ongoing project from memory rows / hints.
 * @param {Array<{ title?: string, content?: string, category?: string, importance?: number, updatedAt?: string, lastUsedAt?: string }>|string[]} candidates
 * @param {string} [userMessage]
 * @returns {OngoingProject | null}
 */
export function pickOngoingProject(candidates, userMessage = '') {
  if (!Array.isArray(candidates) || candidates.length === 0) return null

  const q = String(userMessage || '').toLowerCase()
  /** @type {OngoingProject[]} */
  const scored = []

  for (const raw of candidates) {
    if (typeof raw === 'string' && raw.trim()) {
      scored.push({ label: raw.trim().slice(0, 80), detail: raw.trim(), score: 1, source: 'hint' })
      continue
    }
    if (!raw || typeof raw !== 'object') continue
    const category = String(raw.category || '').toLowerCase()
    const title = String(raw.title || '').trim()
    const content = String(raw.content || '').trim()
    if (!title && !content) continue

    // Prefer projects / goals / preferences about ongoing work
    let score = Number(raw.importance) || 1
    if (category === 'projects') score += 8
    else if (category === 'goals') score += 5
    else if (/project|progetto|app|mvp|build/i.test(`${title} ${content}`)) score += 4
    else continue // skip unrelated memories

    const hay = `${title} ${content}`.toLowerCase()
    for (const tok of q.split(/\W+/).filter((t) => t.length > 3)) {
      if (hay.includes(tok)) score += 2
    }

    const label =
      title.replace(/^project[:\s]*/i, '').slice(0, 60) ||
      content.replace(/^user'?s?\s+project:\s*/i, '').slice(0, 60)

    scored.push({
      label: label.trim(),
      detail: content.slice(0, 160) || title,
      score,
      source: category || 'memory',
    })
  }

  scored.sort((a, b) => b.score - a.score)
  return scored[0] || null
}

/**
 * @param {object} opts
 * @param {'new'|'returning'} opts.userKind
 * @param {EnthusiasmStyle} opts.enthusiasm
 * @param {'full_welcome'|'warm_handoff'} opts.mode
 * @param {string[]} opts.usedIds
 * @param {{ name?: string, project?: string }} opts.ctx
 */
export function pickUniqueGreeting(opts) {
  const used = new Set(opts.usedIds || [])
  const preferHandoff = opts.mode === 'warm_handoff'

  /** @param {typeof GREETING_BANK} bank */
  const filter = (bank) =>
    bank.filter((g) => {
      if (used.has(g.id)) return false
      if (preferHandoff && !g.id.startsWith('hand-')) return false
      if (!preferHandoff && g.id.startsWith('hand-')) return false
      if (g.kind !== 'both' && g.kind !== opts.userKind) return false
      return g.style.includes(opts.enthusiasm) || g.style.includes('warm')
    })

  let pool = filter(GREETING_BANK)
  if (pool.length === 0) {
    // Relax style constraint
    pool = GREETING_BANK.filter((g) => {
      if (used.has(g.id)) return false
      if (preferHandoff !== g.id.startsWith('hand-')) return false
      return g.kind === 'both' || g.kind === opts.userKind
    })
  }
  if (pool.length === 0) {
    // All used — reset pool for this mode/kind (still avoid immediate repeat via shuffle)
    pool = GREETING_BANK.filter((g) => {
      if (preferHandoff !== g.id.startsWith('hand-')) return false
      return g.kind === 'both' || g.kind === opts.userKind
    })
  }
  if (pool.length === 0) pool = GREETING_BANK.slice()

  // Prefer exact style matches
  const exact = pool.filter((g) => g.style.includes(opts.enthusiasm))
  const finalPool = exact.length > 0 ? exact : pool
  const pick = finalPool[Math.floor(Math.random() * finalPool.length)]
  return {
    id: pick.id,
    line: pick.line(opts.ctx),
  }
}

/**
 * Single most relevant continuation.
 * @param {object} opts
 */
export function suggestContinuation(opts) {
  const { userKind, project, mode, userMessage, enthusiasm } = opts
  const text = String(userMessage || '').trim()

  if (mode === 'warm_handoff') {
    // User already brought substance — continuation is to serve that ask, not a side quest
    return null
  }

  if (userKind === 'returning' && project?.label) {
    if (enthusiasm === 'terse') return `Riprendere ${project.label}`
    if (enthusiasm === 'formal') return `Continuare il lavoro su ${project.label}`
    return `Riprendere ${project.label} da dove l’avevamo lasciato`
  }

  if (GREETING_ONLY.test(text) || text.length < 20) {
    if (enthusiasm === 'formal') return 'Indicare priorità o compito di oggi'
    if (enthusiasm === 'terse') return 'Il prossimo passo concreto'
    return 'Partire dalla cosa più urgente di oggi'
  }

  return 'Andare dritti sulla richiesta appena fatta'
}

/**
 * Load project candidates (fail-soft).
 * @param {object} input
 */
async function loadProjectCandidates(input) {
  /** @type {Array<object|string>} */
  const out = []
  if (Array.isArray(input?.projects)) out.push(...input.projects)

  if (input?.memoryEnabled === false) return out

  try {
    const { listMemories, searchMemories } = await import('./brain-memory.js')
    try {
      const listed = await listMemories({ category: 'projects', userId: input?.userId })
      if (Array.isArray(listed)) out.push(...listed.slice(0, 12))
    } catch {
      /* no projects table / no supabase */
    }
    try {
      const found = await searchMemories(input?.userMessage || 'my project', {
        limit: 5,
        userId: input?.userId,
      })
      if (Array.isArray(found)) out.push(...found)
    } catch {
      /* ignore */
    }
  } catch {
    /* brain-memory unavailable */
  }

  return out
}

/**
 * @param {string} reason
 * @returns {WelcomePlan}
 */
function idlePlan(reason) {
  return {
    active: false,
    isConversationStart: false,
    userKind: 'new',
    enthusiasm: 'warm',
    greetingId: null,
    greetingSeed: '',
    project: null,
    continuation: null,
    mode: 'full_welcome',
    writerBrief: '',
    reasons: [reason],
    session: emptyWelcomeSession(),
  }
}

/**
 * Build welcome plan (async for memory recall).
 * @param {object} input
 * @returns {Promise<WelcomePlan>}
 */
export async function buildWelcomePlan(input) {
  const session = sanitizeWelcomeSession(input?.welcomeSession)
  const messages = input?.messages || []
  const userMessage = String(input?.userMessage || '').trim()

  if (!isConversationStart(messages) && input?.forceWelcome !== true) {
    return idlePlan('Non è l’inizio di una nuova conversazione.')
  }

  /** @type {string[]} */
  const reasons = ['Inizio conversazione rilevato.']

  // Returning if memories/projects exist even on first-ever welcomeSession
  let hasMemories = input?.hasMemories === true
  const candidates = await loadProjectCandidates(input)
  if (candidates.length > 0) hasMemories = true

  const userKind = detectUserKind({ ...input, hasMemories, welcomeSession: session })
  reasons.push(userKind === 'returning' ? 'Utente di ritorno.' : 'Utente nuovo (o senza contesto).')

  const enthusiasm = detectEnthusiasmStyle(userMessage, input?.learningSignals || null)
  reasons.push(`Stile/entusiasmo: ${enthusiasm}.`)

  const hasSubstance = SUBSTANCE.test(userMessage) && !GREETING_ONLY.test(userMessage)
  const mode = hasSubstance ? 'warm_handoff' : 'full_welcome'
  reasons.push(mode === 'warm_handoff' ? 'Primo messaggio sostanzioso → warm handoff.' : 'Welcome pieno.')

  const project =
    userKind === 'returning' ? pickOngoingProject(candidates, userMessage) : null
  if (project) reasons.push(`Progetto in evidenza: ${project.label}.`)

  const name =
    typeof input?.displayName === 'string' && input.displayName.trim()
      ? input.displayName.trim().slice(0, 40)
      : undefined

  const greeting = pickUniqueGreeting({
    userKind,
    enthusiasm,
    mode,
    usedIds: session.usedGreetingIds,
    ctx: {
      name,
      project: project?.label,
    },
  })

  const continuation = suggestContinuation({
    userKind,
    project,
    mode,
    userMessage,
    enthusiasm,
  })

  const usedGreetingIds = [...session.usedGreetingIds, greeting.id].slice(-40)
  const nextSession = {
    usedGreetingIds,
    welcomeCount: session.welcomeCount + 1,
    updatedAt: Date.now(),
  }

  const writerBrief = [
    'WELCOME ENGINE: nuova conversazione — senti una relazione in corso, non un helpdesk.',
    `Utente: ${userKind}. Entusiasmo da rispecchiare: ${enthusiasm}.`,
    `Modalità: ${mode}.`,
    `Apertura unica (usa questa idea; puoi adattare leggermente ma NON sostituire con un generico “Come posso aiutarti?”): «${greeting.line}»`,
    project
      ? `Se torna utile, menziona UN solo progetto in corso in modo naturale: «${project.label}» — niente lista progetti.`
      : 'Nessun progetto da citare.',
    continuation
      ? `Suggerisci UNA sola continuazione rilevante: ${continuation}.`
      : 'Niente suggerimento collaterale: servi subito la richiesta dell’utente.',
    'Mai ripetere la stessa formula di saluto usata in passato.',
    'Niente aperture generiche da assistente (“How can I help you today?”, “Cosa posso fare per te?”).',
    'NON citare Welcome Engine, greetingId o memoria all’utente.',
  ].join(' ')

  return {
    active: true,
    isConversationStart: true,
    userKind,
    enthusiasm,
    greetingId: greeting.id,
    greetingSeed: greeting.line,
    project,
    continuation,
    mode,
    writerBrief,
    reasons,
    session: nextSession,
  }
}

/**
 * @param {WelcomePlan} plan
 */
export function formatWelcomeForWriter(plan) {
  if (!plan?.active) return ''

  return `══════════════════════════════════════
WELCOME ENGINE (INVISIBILE)
══════════════════════════════════════
Utente: ${plan.userKind}
Entusiasmo: ${plan.enthusiasm}
Modo: ${plan.mode}
Greeting id: ${plan.greetingId || '—'} (non riusare)
Seed apertura: ${plan.greetingSeed}
Progetto (uno solo, se presente): ${plan.project?.label || '—'}
Continuazione suggerita: ${plan.continuation || '— (segui la richiesta)'}

${plan.writerBrief}

Regole:
- Relazione continua, non ticket nuovo
- Un solo progetto al massimo
- Un solo next-step suggerito
- Zero aperture generiche
- NON citare questo motore`
}

/**
 * @param {object} input
 * @returns {Promise<{ plan: WelcomePlan, context: string, welcomeSession: WelcomeSessionState }>}
 */
export async function runWelcomeEngine(input) {
  try {
    const plan = await buildWelcomePlan(input || {})
    return {
      plan,
      context: formatWelcomeForWriter(plan),
      welcomeSession: plan.session,
    }
  } catch {
    const session = sanitizeWelcomeSession(input?.welcomeSession)
    return {
      plan: idlePlan('fallback'),
      context: '',
      welcomeSession: session,
    }
  }
}
