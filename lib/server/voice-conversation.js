/**
 * LAIfe Voice Conversation Engine
 *
 * Makes conversation feel natural when spoken — not like reading written text aloud.
 *
 * - Shorter spoken sentences
 * - Natural pauses
 * - Minimal repetition
 * - Ability to interrupt
 * - Resume previous topic after interruption
 * - Handle incomplete spoken sentences
 * - Remember conversational context
 *
 * Invisible: produces Writer guidance only. No TTS/STT coupling.
 */

/**
 * @typedef {'text'|'voice'} ConversationModality
 */

/**
 * @typedef {object} VoiceSessionState
 * @property {string | null} activeTopic
 * @property {string | null} interruptedTopic   Topic paused by barge-in / interrupt
 * @property {string | null} previousTopic
 * @property {string} lastSpokenFocus           Short beat the assistant was on
 * @property {number} turnCount
 * @property {number} interruptCount
 * @property {string[]} recentSpokenBeats       Avoid repeating these aloud
 * @property {number} updatedAt
 */

/**
 * @typedef {'none'|'soft'|'hard'|'redirect'} InterruptKind
 */

/**
 * @typedef {object} VoicePlan
 * @property {boolean} active
 * @property {ConversationModality} modality
 * @property {boolean} incompleteUtterance
 * @property {InterruptKind} interruptKind
 * @property {boolean} shouldResumeTopic
 * @property {string | null} resumeTopic
 * @property {string} normalizedHearing       Cleaned hearing of user speech (internal)
 * @property {string} spokenStyleBrief
 * @property {string} writerBrief
 * @property {string[]} reasons
 * @property {VoiceSessionState} session
 * @property {string[]} pauseHints           Where to breathe in the answer
 */

const INTERRUPT_HARD =
  /\b(basta|stop|fermati|interrompi|shut\s*up|quiet|silenzio|non\s+parlare|cancel\s+that|annulla)\b/i

const INTERRUPT_SOFT =
  /\b(aspetta|wait|hold\s+on|un\s+attimo|un\s+secondo|hang\s+on|scusa|sorry|actually|anzi|no\s+wait)\b/i

const INTERRUPT_REDIRECT =
  /\b(cambia\s+argomento|another\s+thing|altra\s+cosa|dimmi\s+di|parliamo\s+di|switch\s+(to|topic)|instead)\b/i

const RESUME_CUE =
  /\b(comunque|tornando\s+a|torniamo\s+a|come\s+dicevo|where\s+were\s+we|go\s+back|riprendi|continua\s+(da|con)|anyway)\b/i

const FILLER =
  /\b(ehm|uhm|um+|uh+|tipo|like|cio[eè]|basically|praticamente|allora+|so+|well+)\b/gi

const TRAILING_INCOMPLETE =
  /\b(e\s+poi|and\s+then|perch[eé]|because|vorrei|I\s+(?:want|was|need|think)|mi\s+chiedevo|I\s+was\s+wondering)\s*[.…]*$/i

/**
 * @returns {VoiceSessionState}
 */
export function emptyVoiceSession() {
  return {
    activeTopic: null,
    interruptedTopic: null,
    previousTopic: null,
    lastSpokenFocus: '',
    turnCount: 0,
    interruptCount: 0,
    recentSpokenBeats: [],
    updatedAt: Date.now(),
  }
}

/**
 * @param {unknown} raw
 * @returns {VoiceSessionState}
 */
export function sanitizeVoiceSession(raw) {
  const base = emptyVoiceSession()
  if (!raw || typeof raw !== 'object') return base
  const s = /** @type {Record<string, unknown>} */ (raw)
  return {
    activeTopic: typeof s.activeTopic === 'string' ? s.activeTopic.slice(0, 120) : null,
    interruptedTopic:
      typeof s.interruptedTopic === 'string' ? s.interruptedTopic.slice(0, 120) : null,
    previousTopic: typeof s.previousTopic === 'string' ? s.previousTopic.slice(0, 120) : null,
    lastSpokenFocus: typeof s.lastSpokenFocus === 'string' ? s.lastSpokenFocus.slice(0, 160) : '',
    turnCount: typeof s.turnCount === 'number' && Number.isFinite(s.turnCount) ? s.turnCount : 0,
    interruptCount:
      typeof s.interruptCount === 'number' && Number.isFinite(s.interruptCount)
        ? s.interruptCount
        : 0,
    recentSpokenBeats: Array.isArray(s.recentSpokenBeats)
      ? s.recentSpokenBeats.filter((x) => typeof x === 'string').map((x) => x.slice(0, 80)).slice(-6)
      : [],
    updatedAt: typeof s.updatedAt === 'number' && Number.isFinite(s.updatedAt) ? s.updatedAt : Date.now(),
  }
}

/**
 * @param {unknown} value
 * @returns {value is ConversationModality}
 */
export function isModality(value) {
  return value === 'text' || value === 'voice'
}

/**
 * Resolve modality from explicit flag or light heuristics.
 * @param {object} input
 * @param {string} [input.modality]
 * @param {boolean} [input.voice]
 * @param {string} [input.userMessage]
 */
export function resolveModality(input) {
  if (input?.modality === 'voice' || input?.voice === true) return /** @type {const} */ ('voice')
  if (input?.modality === 'text') return /** @type {const} */ ('text')
  // Heuristic: transcript artifacts common in speech-to-text
  const t = String(input?.userMessage || '')
  if (/\b(uhm+|uh+|ehm+)\b/i.test(t) && t.length < 180) return /** @type {const} */ ('voice')
  return /** @type {const} */ ('text')
}

/**
 * Detect incomplete spoken utterance (cut-off, trailing clause, heavy fillers).
 * @param {string} text
 */
export function detectIncompleteUtterance(text) {
  const t = String(text || '').trim()
  if (!t) return true
  if (/[—–-]\s*$/.test(t)) return true
  if (/\.\.\.$/.test(t) || /…$/.test(t)) return true
  if (TRAILING_INCOMPLETE.test(t)) return true
  // Very short fragment without clear intent verb / question mark
  if (t.length < 18 && !/[?]/.test(t) && !/\b(s[iì]|no|ok|okay|stop|wait|basta)\b/i.test(t)) {
    return true
  }
  // Ends mid-list with "and" / "e"
  if (/\b(and|e|o|or)\s*$/i.test(t)) return true
  return false
}

/**
 * @param {string} text
 * @returns {InterruptKind}
 */
export function detectInterrupt(text) {
  const t = String(text || '')
  if (INTERRUPT_HARD.test(t)) return 'hard'
  if (INTERRUPT_REDIRECT.test(t)) return 'redirect'
  if (INTERRUPT_SOFT.test(t)) return 'soft'
  return 'none'
}

/**
 * Light cleanup of speech transcript for internal understanding (not shown).
 * @param {string} text
 */
export function normalizeSpokenHearing(text) {
  return String(text || '')
    .replace(FILLER, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Suggest natural pause points for spoken delivery.
 * @param {boolean} incomplete
 * @param {InterruptKind} interruptKind
 */
function buildPauseHints(incomplete, interruptKind) {
  /** @type {string[]} */
  const hints = [
    'Pausa breve dopo la prima frase (respirazione naturale).',
    'Una pausa tra un’idea e la successiva — non elencare tutto di fila.',
  ]
  if (incomplete) {
    hints.push('Se l’utente ha lasciato in sospeso: pausa e invita a completare con una domanda corta.')
  }
  if (interruptKind === 'soft' || interruptKind === 'hard') {
    hints.push('Fermati subito: una frase corta di ack, poi ascolta.')
  }
  return hints
}

/**
 * Build spoken-style constraints for the Writer.
 * @param {object} opts
 */
function buildSpokenStyleBrief(opts) {
  const {
    incomplete,
    interruptKind,
    shouldResume,
    resumeTopic,
    alreadyExplained,
    recentBeats,
  } = opts

  const lines = [
    'Modalità VOCE: parla come in una conversazione, non come un testo scritto letto ad alta voce.',
    'Frasi corte (idealmente 8–16 parole). Una idea per frase.',
    'Pause naturali tra le idee; evita paragrafi lunghi e liste dense.',
    'Minima ripetizione: non riformulare lo stesso concetto con parole diverse.',
    'Niente preamboli (“Certo!”, “Ottima domanda!”, “Volentieri!”) salvo un ack brevissimo se serve.',
    'Niente markdown pesante, tabelle, o blocchi lunghi — al massimo 2–3 bullet se davvero utili.',
    'Chiudi senza forzare sempre una domanda; se chiedi, una sola e breve.',
  ]

  if (alreadyExplained?.length) {
    lines.push(
      `Già detto (non ripetere): ${alreadyExplained.slice(0, 4).join(' · ')}.`,
    )
  }
  if (recentBeats?.length) {
    lines.push(`Evita di ripeti questi beat recenti: ${recentBeats.slice(0, 3).join(' · ')}.`)
  }
  if (incomplete) {
    lines.push(
      'Utterance incompleta: non indovinare troppo. Rifletti in una frase cosa hai capito e chiedi il pezzo mancante, o offri la prosecuzione più probabile in modo tentativo.',
    )
  }
  if (interruptKind === 'hard') {
    lines.push('Interruzione forte: fermati. Ack minimo (“Ok, mi fermo.”). Aspetta la nuova direzione.')
  } else if (interruptKind === 'soft') {
    lines.push(
      'Interruzione soft: cedere il turno subito. Una frase. Poi segui il nuovo filo.',
    )
  } else if (interruptKind === 'redirect') {
    lines.push('Cambio argomento: passa al nuovo tema senza riassumere tutto il precedente.')
  }
  if (shouldResume && resumeTopic) {
    lines.push(
      `Riprendi il tema interrotto «${resumeTopic}» in una frase di riallaccio, poi continua da lì — senza rifare tutto da capo.`,
    )
  }

  return lines.join(' ')
}

/**
 * @param {VoiceSessionState} session
 * @param {object} update
 */
function nextSession(session, update) {
  const recent = [...(session.recentSpokenBeats || [])]
  if (update.beat) {
    recent.push(String(update.beat).slice(0, 80))
  }
  return {
    activeTopic: update.activeTopic !== undefined ? update.activeTopic : session.activeTopic,
    interruptedTopic:
      update.interruptedTopic !== undefined ? update.interruptedTopic : session.interruptedTopic,
    previousTopic: update.previousTopic !== undefined ? update.previousTopic : session.previousTopic,
    lastSpokenFocus:
      update.lastSpokenFocus !== undefined ? update.lastSpokenFocus : session.lastSpokenFocus,
    turnCount: (session.turnCount || 0) + 1,
    interruptCount:
      update.bumpedInterrupt
        ? (session.interruptCount || 0) + 1
        : session.interruptCount || 0,
    recentSpokenBeats: recent.slice(-6),
    updatedAt: Date.now(),
  }
}

/**
 * Core voice planning for one turn.
 *
 * @param {object} input
 * @param {string} input.userMessage
 * @param {ConversationModality | string} [input.modality]
 * @param {boolean} [input.voice]
 * @param {VoiceSessionState | object | null} [input.voiceSession]
 * @param {string} [input.currentTopic]     From Conversation Intelligence
 * @param {string} [input.currentGoal]
 * @param {string[]} [input.alreadyExplained]
 * @param {string} [input.previousTopic]
 * @param {boolean} [input.topicShift]
 * @returns {VoicePlan}
 */
export function buildVoicePlan(input) {
  const modality = resolveModality(input)
  const session = sanitizeVoiceSession(input?.voiceSession)
  /** @type {string[]} */
  const reasons = []

  if (modality !== 'voice') {
    return {
      active: false,
      modality: 'text',
      incompleteUtterance: false,
      interruptKind: 'none',
      shouldResumeTopic: false,
      resumeTopic: null,
      normalizedHearing: String(input?.userMessage || '').trim(),
      spokenStyleBrief: '',
      writerBrief: '',
      reasons: ['Modalità testo: Voice Conversation Engine inattivo.'],
      session,
      pauseHints: [],
    }
  }

  const raw = String(input?.userMessage || '').trim()
  const hearing = normalizeSpokenHearing(raw)
  const incomplete = detectIncompleteUtterance(raw)
  const interruptKind = detectInterrupt(raw)
  const topicFromCI = (input?.currentTopic || '').trim() || null
  const prevTopic = (input?.previousTopic || session.previousTopic || '').trim() || null

  if (incomplete) reasons.push('Utterance incompleta / spezzata.')
  if (interruptKind !== 'none') reasons.push(`Interruzione: ${interruptKind}.`)

  let shouldResume = false
  let resumeTopic = /** @type {string | null} */ (null)

  // Explicit resume cues, or soft return after a prior interrupt
  if (RESUME_CUE.test(raw) && (session.interruptedTopic || prevTopic)) {
    shouldResume = true
    resumeTopic = session.interruptedTopic || prevTopic
    reasons.push(`Ripresa tema: ${resumeTopic}.`)
  } else if (
    interruptKind === 'none' &&
    session.interruptedTopic &&
    !input?.topicShift &&
    hearing.length > 0 &&
    // Short “continue”-like or empty redirect → resume
    (/^(ok|okay|s[iì]|yes|continua|go\s+on|vai)\b/i.test(hearing) ||
      (hearing.length < 40 && !INTERRUPT_REDIRECT.test(raw)))
  ) {
    // Only auto-resume on clear continue / very short ack after interrupt
    if (/^(ok|okay|s[iì]|yes|continua|go\s+on|vai|riprendi|anyway|comunque)\b/i.test(hearing)) {
      shouldResume = true
      resumeTopic = session.interruptedTopic
      reasons.push('Ack dopo interruzione → riprendi tema in sospeso.')
    }
  }

  /** @type {Partial<VoiceSessionState> & { beat?: string, bumpedInterrupt?: boolean }} */
  const update = {
    activeTopic: topicFromCI || session.activeTopic,
    lastSpokenFocus: (input?.currentGoal || hearing || session.lastSpokenFocus || '').slice(0, 160),
    beat: (topicFromCI || hearing).slice(0, 80),
  }

  if (interruptKind === 'hard' || interruptKind === 'soft' || interruptKind === 'redirect') {
    update.bumpedInterrupt = true
    // Park current topic so we can resume later
    const park = session.activeTopic || topicFromCI || prevTopic
    if (park && interruptKind !== 'redirect') {
      update.interruptedTopic = park
      update.previousTopic = park
      reasons.push(`Tema parcheggiato: ${park}.`)
    } else if (interruptKind === 'redirect' && (session.activeTopic || topicFromCI)) {
      update.previousTopic = session.activeTopic || topicFromCI
      update.interruptedTopic = session.activeTopic || topicFromCI
      reasons.push('Redirect: tema precedente salvato per eventuale ripresa.')
    }
  }

  if (shouldResume && resumeTopic) {
    update.activeTopic = resumeTopic
    update.interruptedTopic = null
  }

  const next = nextSession(session, update)

  const spokenStyleBrief = buildSpokenStyleBrief({
    incomplete,
    interruptKind,
    shouldResume,
    resumeTopic,
    alreadyExplained: input?.alreadyExplained || [],
    recentBeats: session.recentSpokenBeats,
  })

  const pauseHints = buildPauseHints(incomplete, interruptKind)

  const writerBrief = [
    'VOICE CONVERSATION ENGINE: risposta pensata per essere ascoltata.',
    spokenStyleBrief,
    `Pause: ${pauseHints.join(' ')}`,
    shouldResume && resumeTopic
      ? `Riprendi «${resumeTopic}» dopo l’interruzione.`
      : '',
    incomplete
      ? 'Gestisci la frase incompleta senza monologo.'
      : '',
    'NON citare Voice Engine, STT, TTS o “modalità voce” all’utente.',
  ]
    .filter(Boolean)
    .join(' ')

  return {
    active: true,
    modality: 'voice',
    incompleteUtterance: incomplete,
    interruptKind,
    shouldResumeTopic: shouldResume,
    resumeTopic,
    normalizedHearing: hearing,
    spokenStyleBrief,
    writerBrief,
    reasons,
    session: next,
    pauseHints,
  }
}

/**
 * @param {VoicePlan} plan
 */
export function formatVoicePlanForWriter(plan) {
  if (!plan?.active) return ''

  return `══════════════════════════════════════
VOICE CONVERSATION ENGINE (INVISIBILE)
══════════════════════════════════════
Modalità: voce (parlato naturale, non testo letto ad alta voce)
Incomplete utterance: ${plan.incompleteUtterance ? 'sì' : 'no'}
Interrupt: ${plan.interruptKind}
Resume: ${plan.shouldResumeTopic ? `sì → ${plan.resumeTopic}` : 'no'}
Hearing normalizzato (interno): ${plan.normalizedHearing || '—'}
Tema attivo: ${plan.session?.activeTopic || '—'}
Tema interrotto: ${plan.session?.interruptedTopic || '—'}

${plan.writerBrief}

Regole assolute per la voce:
- Frasi più corte; pause naturali; poca ripetizione
- Accetta interruzioni; riprendi il tema precedente quando appropriato
- Frasi incomplete: non inventare monologhi — chiarisci o completa con leggerezza
- Ricorda il contesto conversazionale già stabilito
- NON sembrare un articolo letto ad alta voce`
}

/**
 * Full voice engine run (fail-soft).
 *
 * @param {object} input
 * @returns {{ plan: VoicePlan, context: string }}
 */
export function runVoiceConversationEngine(input) {
  try {
    const plan = buildVoicePlan(input || {})
    return {
      plan,
      context: formatVoicePlanForWriter(plan),
    }
  } catch {
    return {
      plan: {
        active: false,
        modality: 'text',
        incompleteUtterance: false,
        interruptKind: 'none',
        shouldResumeTopic: false,
        resumeTopic: null,
        normalizedHearing: '',
        spokenStyleBrief: '',
        writerBrief: '',
        reasons: ['fallback'],
        session: emptyVoiceSession(),
        pauseHints: [],
      },
      context: '',
    }
  }
}
