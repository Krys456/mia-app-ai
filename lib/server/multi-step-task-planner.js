/**
 * LAIfe Multi-Step Task Planner
 *
 * When a request requires multiple actions:
 * 1. Break it into an ordered plan
 * 2. Execute each step in order
 * 3. Recover gracefully if a step fails
 * 4. Keep the user informed without exposing internal reasoning
 *
 * Invisible to the user — produces Writer guidance only.
 * Complements Universal Task Planner (response structure) and
 * Universal Action Engine (single external actions).
 */

import { analyzeAction } from './action-engine/index.js'

/**
 * @typedef {'action'|'advisory'|'lookup'} StepKind
 */

/**
 * @typedef {'continue'|'skip_rest'|'retry_once'} RecoveryMode
 */

/**
 * @typedef {object} PlanStep
 * @property {string} id
 * @property {string} title          User-friendly label (for Writer, not dumped raw)
 * @property {StepKind} kind
 * @property {string} [actionMessage] Synthetic message for Action Engine
 * @property {string} [advisoryKey]   Template key for advisory content
 * @property {RecoveryMode} recovery
 * @property {boolean} [critical]     If true, failure may stop remaining steps
 */

/**
 * @typedef {object} StepResult
 * @property {string} id
 * @property {string} title
 * @property {StepKind} kind
 * @property {'ok'|'partial'|'failed'|'blocked'|'skipped'} status
 * @property {string} userNote       Short, human note for the Writer
 * @property {string} [detail]       Internal detail (not for user dump)
 * @property {object | null} [actionPlan]
 */

/**
 * @typedef {object} MultiStepPlan
 * @property {boolean} active
 * @property {string | null} scenarioId
 * @property {string} goal
 * @property {PlanStep[]} steps
 * @property {string} writerBrief
 * @property {string[]} reasons
 */

/**
 * Scenario templates for common multi-action requests.
 * @type {Array<{ id: string, match: RegExp, goal: string, steps: PlanStep[] }>}
 */
const SCENARIOS = [
  {
    id: 'prepare_trip',
    match:
      /\b((prepara|preparare|prepare|prep)\w*.{0,40}(viaggio|trip|vacanza|trasferta|travel)|trip\s*prep|prepare\s+my\s+trip|organizza.{0,20}(viaggio|trip))\b/i,
    goal: 'Preparare il viaggio in modo completo',
    steps: [
      {
        id: 'weather',
        title: 'Controllare il meteo',
        kind: 'action',
        actionMessage: 'che tempo fa per il viaggio',
        recovery: 'continue',
      },
      {
        id: 'calendar',
        title: 'Verificare il calendario',
        kind: 'action',
        actionMessage: 'consulta il calendario per il viaggio',
        recovery: 'continue',
      },
      {
        id: 'hotel',
        title: 'Cercare la prenotazione hotel',
        kind: 'advisory',
        advisoryKey: 'hotel_reservation',
        recovery: 'continue',
      },
      {
        id: 'packing',
        title: 'Suggerire lista bagaglio',
        kind: 'advisory',
        advisoryKey: 'packing_list',
        recovery: 'continue',
      },
      {
        id: 'travel_time',
        title: 'Calcolare tempo di viaggio',
        kind: 'action',
        actionMessage: 'quanto ci vuole in navigazione verso destinazione viaggio',
        recovery: 'continue',
      },
      {
        id: 'documents',
        title: 'Ricordare documenti importanti',
        kind: 'advisory',
        advisoryKey: 'travel_documents',
        recovery: 'continue',
      },
    ],
  },
  {
    id: 'morning_brief',
    match:
      /\b((prepara|prepare|fammi|dammi).{0,20}(mattina|morning|giornata)|briefing\s+mattutino|morning\s+brief|organizza\s+la\s+giornata)\b/i,
    goal: 'Preparare la giornata',
    steps: [
      {
        id: 'weather',
        title: 'Controllare il meteo',
        kind: 'action',
        actionMessage: 'che tempo fa oggi',
        recovery: 'continue',
      },
      {
        id: 'calendar',
        title: 'Verificare gli impegni',
        kind: 'action',
        actionMessage: 'consulta il calendario di oggi',
        recovery: 'continue',
      },
      {
        id: 'tasks',
        title: 'Richiamare i promemoria',
        kind: 'advisory',
        advisoryKey: 'day_reminders',
        recovery: 'continue',
      },
      {
        id: 'focus',
        title: 'Suggerire priorità',
        kind: 'advisory',
        advisoryKey: 'day_priorities',
        recovery: 'continue',
      },
    ],
  },
  {
    id: 'meeting_prep',
    match:
      /\b((prepara|prepare|prep).{0,30}(riunione|meeting|call)|(meeting|riunione)\s+prep)\b/i,
    goal: 'Preparare la riunione',
    steps: [
      {
        id: 'calendar',
        title: 'Verificare orario e partecipanti',
        kind: 'action',
        actionMessage: 'consulta il calendario per la riunione',
        recovery: 'continue',
      },
      {
        id: 'notes',
        title: 'Raccogliere punti da trattare',
        kind: 'advisory',
        advisoryKey: 'meeting_agenda',
        recovery: 'continue',
      },
      {
        id: 'docs',
        title: 'Ricordare materiali utili',
        kind: 'advisory',
        advisoryKey: 'meeting_materials',
        recovery: 'continue',
      },
    ],
  },
]

/**
 * Advisory content templates — concrete help, not chain-of-thought.
 * @type {Record<string, (userMessage: string) => string>}
 */
const ADVISORY = {
  hotel_reservation: () =>
    'Cerca la conferma hotel (email, app booking, o cartella viaggio): nome struttura, indirizzo, check-in/out, codice prenotazione.',
  packing_list: () =>
    'Lista bagaglio essenziale: documenti, caricatori, abiti per il meteo previsto, kit toilette, medicine, adattatore, power bank.',
  travel_documents: () =>
    'Documenti da avere a portata: documento d’identità/passaporto, biglietti, assicurazione, prenotazioni, contatti emergenza, carte di pagamento.',
  day_reminders: () =>
    'Rivedi i promemoria aperti e scegli 1–3 cose da chiudere oggi; sposta il resto senza senso di colpa.',
  day_priorities: () =>
    'Priorità tipiche: un impegno fisso (calendario), un pezzo di lavoro ad alto impatto, e una cosa personale breve.',
  meeting_agenda: () =>
    'Agenda essenziale: obiettivo della call, 2–3 punti decisionali, eventuali blocker, next step proposto.',
  meeting_materials: () =>
    'Materiali utili: ultimo doc condiviso, metriche chiave, decisioni aperse, link alla call.',
}

/**
 * @param {string} text
 */
function normalize(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Heuristic: multiple coordinated actions implied by conjunctions + action verbs.
 * @param {string} userMessage
 * @returns {PlanStep[] | null}
 */
function inferGenericMultiSteps(userMessage) {
  const text = normalize(userMessage)
  if (text.length < 24) return null

  const hasMultiCue =
    /\b(e\s+poi|and\s+then|poi\s+|inoltre|also|e\s+anche|;)\b/i.test(text) ||
    (text.match(/\be\b/gi) || []).length >= 2

  if (!hasMultiCue) return null

  /** @type {Array<{ id: string, title: string, kind: StepKind, actionMessage?: string, advisoryKey?: string, test: RegExp }>} */
  const cues = [
    {
      id: 'weather',
      title: 'Controllare il meteo',
      kind: 'action',
      actionMessage: 'che tempo fa',
      test: /\b(meteo|weather|tempo)\b/i,
    },
    {
      id: 'calendar',
      title: 'Verificare il calendario',
      kind: 'action',
      actionMessage: 'consulta il calendario',
      test: /\b(calendario|calendar|impegni|agenda)\b/i,
    },
    {
      id: 'message',
      title: 'Preparare un messaggio',
      kind: 'action',
      actionMessage: 'prepara un messaggio',
      test: /\b(messaggio|message|email|mail)\b/i,
    },
    {
      id: 'reminder',
      title: 'Creare un promemoria',
      kind: 'action',
      actionMessage: 'ricordami di fare questa cosa',
      test: /\b(promemoria|remind|ricordami)\b/i,
    },
    {
      id: 'maps',
      title: 'Calcolare il percorso',
      kind: 'action',
      actionMessage: 'quanto ci vuole in navigazione',
      test: /\b(percorso|navigate|indicazioni|tempo\s+di\s+viaggio|travel\s+time)\b/i,
    },
    {
      id: 'files',
      title: 'Cercare nei file',
      kind: 'action',
      actionMessage: 'cerca nei file',
      test: /\b(file|documenti|cartella|folder)\b/i,
    },
  ]

  const hits = cues.filter((c) => c.test.test(text))
  if (hits.length < 2) return null

  return hits.map((h) => ({
    id: h.id,
    title: h.title,
    kind: h.kind,
    actionMessage: h.actionMessage,
    advisoryKey: h.advisoryKey,
    recovery: /** @type {RecoveryMode} */ ('continue'),
  }))
}

/**
 * Detect and build a multi-step plan (no execution yet).
 * @param {string} userMessage
 * @returns {MultiStepPlan}
 */
export function buildMultiStepPlan(userMessage) {
  const text = normalize(userMessage)
  /** @type {string[]} */
  const reasons = []

  if (!text) {
    return idlePlan('Messaggio vuoto.')
  }

  for (const scenario of SCENARIOS) {
    if (scenario.match.test(text)) {
      reasons.push(`Scenario riconosciuto: ${scenario.id}.`)
      return {
        active: true,
        scenarioId: scenario.id,
        goal: scenario.goal,
        steps: scenario.steps.map((s) => ({ ...s })),
        writerBrief: '',
        reasons,
      }
    }
  }

  const generic = inferGenericMultiSteps(text)
  if (generic) {
    reasons.push('Richiesta multi-azione inferita da congiunzioni / più intent.')
    return {
      active: true,
      scenarioId: 'generic_multi',
      goal: `Completare: ${text.slice(0, 100)}`,
      steps: generic,
      writerBrief: '',
      reasons,
    }
  }

  return idlePlan('Nessun piano multi-step necessario.')
}

/**
 * @param {string} reason
 * @returns {MultiStepPlan}
 */
function idlePlan(reason) {
  return {
    active: false,
    scenarioId: null,
    goal: '',
    steps: [],
    writerBrief: '',
    reasons: [reason],
  }
}

/**
 * Execute one advisory step.
 * @param {PlanStep} step
 * @param {string} userMessage
 * @returns {StepResult}
 */
function executeAdvisoryStep(step, userMessage) {
  const fn = step.advisoryKey ? ADVISORY[step.advisoryKey] : null
  if (!fn) {
    return {
      id: step.id,
      title: step.title,
      kind: 'advisory',
      status: 'failed',
      userNote: `Non sono riuscito a preparare «${step.title}».`,
      detail: 'missing_advisory_template',
      actionPlan: null,
    }
  }
  return {
    id: step.id,
    title: step.title,
    kind: 'advisory',
    status: 'ok',
    userNote: fn(userMessage),
    detail: step.advisoryKey,
    actionPlan: null,
  }
}

/**
 * Map Action Engine plan → step result.
 * @param {PlanStep} step
 * @param {Awaited<ReturnType<typeof analyzeAction>>} actionPlan
 * @returns {StepResult}
 */
function mapActionResult(step, actionPlan) {
  if (!actionPlan?.actionRequired) {
    return {
      id: step.id,
      title: step.title,
      kind: 'action',
      status: 'partial',
      userNote: `Per «${step.title}» non ho trovato un’integrazione diretta — continuo con il resto.`,
      detail: 'no_action_match',
      actionPlan,
    }
  }

  if (actionPlan.phase === 'awaiting_confirmation') {
    return {
      id: step.id,
      title: step.title,
      kind: 'action',
      status: 'blocked',
      userNote: `Per «${step.title}» serve la tua conferma prima di procedere.`,
      detail: 'needs_confirmation',
      actionPlan,
    }
  }

  if (actionPlan.phase === 'executed') {
    return {
      id: step.id,
      title: step.title,
      kind: 'action',
      status: 'ok',
      userNote:
        actionPlan.explainBrief ||
        `Ho completato «${step.title}».`,
      detail: 'executed',
      actionPlan,
    }
  }

  if (actionPlan.phase === 'unavailable') {
    return {
      id: step.id,
      title: step.title,
      kind: 'action',
      status: 'partial',
      userNote: `Non posso ancora eseguire «${step.title}» (integrazione non collegata) — continuo con il resto.`,
      detail: 'unavailable',
      actionPlan,
    }
  }

  if (actionPlan.phase === 'denied' || actionPlan.phase === 'error') {
    return {
      id: step.id,
      title: step.title,
      kind: 'action',
      status: 'failed',
      userNote: `«${step.title}» non è andato a buon fine — recupero e proseguo.`,
      detail: actionPlan.phase,
      actionPlan,
    }
  }

  return {
    id: step.id,
    title: step.title,
    kind: 'action',
    status: 'partial',
    userNote: `Ho gestito «${step.title}» in modo parziale.`,
    detail: actionPlan.phase || 'unknown',
    actionPlan,
  }
}

/**
 * Execute all steps in order with graceful recovery.
 *
 * @param {MultiStepPlan} plan
 * @param {object} [ctx]
 * @param {string} [ctx.userMessage]
 * @param {string[]} [ctx.grantedPermissions]
 * @param {boolean} [ctx.assumeAllPermissions]
 * @param {object | null} [ctx.pendingAction]
 * @returns {Promise<{ results: StepResult[], stoppedEarly: boolean, pendingAction: object | null }>}
 */
export async function executeMultiStepPlan(plan, ctx = {}) {
  /** @type {StepResult[]} */
  const results = []
  let stoppedEarly = false
  /** @type {object | null} */
  let pendingAction = null
  let abortAll = false

  if (!plan?.active || !plan.steps?.length) {
    return { results, stoppedEarly, pendingAction }
  }

  for (let i = 0; i < plan.steps.length; i++) {
    const step = plan.steps[i]

    if (abortAll) {
      results.push({
        id: step.id,
        title: step.title,
        kind: step.kind,
        status: 'skipped',
        userNote: `Saltato «${step.title}» dopo un problema precedente.`,
        detail: 'skipped_after_failure',
        actionPlan: null,
      })
      continue
    }

    /** @type {StepResult} */
    let result

    try {
      if (step.kind === 'advisory' || step.kind === 'lookup') {
        result = executeAdvisoryStep(step, ctx.userMessage || '')
      } else {
        const actionPlan = await analyzeAction({
          userMessage: step.actionMessage || step.title,
          grantedPermissions: ctx.grantedPermissions || [],
          assumeAllPermissions: ctx.assumeAllPermissions === true,
          batchAuthorizeLow: true,
          pendingAction: i === 0 ? ctx.pendingAction || null : null,
        })
        result = mapActionResult(step, actionPlan)

        if (actionPlan?.pendingActionPayload && result.status === 'blocked') {
          pendingAction = {
            ...actionPlan.pendingActionPayload,
            multiStep: {
              scenarioId: plan.scenarioId,
              stepId: step.id,
              remainingStepIds: plan.steps.slice(i + 1).map((s) => s.id),
            },
          }
        }

        if (result.status === 'failed' && step.recovery === 'retry_once') {
          const retryPlan = await analyzeAction({
            userMessage: step.actionMessage || step.title,
            grantedPermissions: ctx.grantedPermissions || [],
            assumeAllPermissions: ctx.assumeAllPermissions === true,
            batchAuthorizeLow: true,
          })
          result = mapActionResult(step, retryPlan)
          result.detail = `retry:${result.detail || ''}`
        }
      }
    } catch (err) {
      result = {
        id: step.id,
        title: step.title,
        kind: step.kind,
        status: 'failed',
        userNote: `Qualcosa è andato storto su «${step.title}» — continuo con il resto.`,
        detail: err instanceof Error ? err.message : 'exception',
        actionPlan: null,
      }
    }

    results.push(result)

    // Confirmation needed is not a hard failure: keep executing later steps
    // (Writer will ask for confirmation). Only critical / skip_rest aborts.
    if (
      result.status === 'failed' &&
      (step.critical || step.recovery === 'skip_rest')
    ) {
      abortAll = true
      stoppedEarly = true
    }
  }

  return { results, stoppedEarly, pendingAction }
}

/**
 * Build Writer-facing brief from execution results.
 * @param {MultiStepPlan} plan
 * @param {StepResult[]} results
 * @param {boolean} stoppedEarly
 */
export function formatMultiStepForWriter(plan, results, stoppedEarly) {
  if (!plan?.active) return ''

  const ok = results.filter((r) => r.status === 'ok' || r.status === 'partial')
  const failed = results.filter((r) => r.status === 'failed')
  const blocked = results.filter((r) => r.status === 'blocked')
  const skipped = results.filter((r) => r.status === 'skipped')

  const progressLines = results.map((r, i) => {
    const mark =
      r.status === 'ok'
        ? 'fatto'
        : r.status === 'partial'
          ? 'parziale'
          : r.status === 'blocked'
            ? 'in attesa'
            : r.status === 'failed'
              ? 'non riuscito'
              : 'saltato'
    return `${i + 1}. [${mark}] ${r.title} — ${r.userNote}`
  })

  return `══════════════════════════════════════
MULTI-STEP TASK PLANNER (INVISIBILE)
══════════════════════════════════════
Obiettivo: ${plan.goal}
Scenario: ${plan.scenarioId || '—'}
Passi: ${plan.steps.length} · Completati utili: ${ok.length} · Falliti: ${failed.length} · Bloccati: ${blocked.length} · Saltati: ${skipped.length}
${stoppedEarly ? 'Esecuzione interrotta in modo controllato (recovery).' : 'Piano eseguito in sequenza.'}

Esito per passo (usa per informare l’utente in modo naturale — NON stampare come log interno):
${progressLines.join('\n')}

Istruzioni Writer:
- Tieni l’utente informato sul progresso in linguaggio naturale (cosa hai fatto / cosa manca).
- NON esporre ragionamento interno, id passo, scenarioId, recovery, o “multi-step planner”.
- NON fingere successi se un passo è fallito o l’integrazione non è collegata.
- Se qualcosa è bloccato in conferma: chiedi UNA conferma chiara per quell’azione.
- Se un passo è fallito: spiega il limite in una frase e continua con il valore degli altri passi.
- Unisci tutto in una sola risposta utile, ordinata, senza checklist da motore.
- Chiudi con il prossimo passo concreto per l’utente se serve.`
}

/**
 * Full multi-step run for one turn.
 *
 * @param {object} input
 * @param {string} input.userMessage
 * @param {string[]} [input.grantedPermissions]
 * @param {boolean} [input.assumeAllPermissions]
 * @param {object | null} [input.pendingAction]
 * @returns {Promise<{
 *   plan: MultiStepPlan,
 *   results: StepResult[],
 *   stoppedEarly: boolean,
 *   pendingAction: object | null,
 *   context: string,
 * }>}
 */
export async function runMultiStepTaskPlanner(input) {
  try {
    const plan = buildMultiStepPlan(input?.userMessage || '')
    if (!plan.active) {
      return {
        plan,
        results: [],
        stoppedEarly: false,
        pendingAction: null,
        context: '',
      }
    }

    const { results, stoppedEarly, pendingAction } = await executeMultiStepPlan(plan, {
      userMessage: input.userMessage,
      grantedPermissions: input.grantedPermissions,
      assumeAllPermissions: input.assumeAllPermissions,
      pendingAction: input.pendingAction || null,
    })

    const okCount = results.filter((r) => r.status === 'ok' || r.status === 'partial').length
    const failedCount = results.filter((r) => r.status === 'failed').length
    const blockedCount = results.filter((r) => r.status === 'blocked').length

    plan.writerBrief = [
      'MULTI-STEP TASK PLANNER: richiesta multi-azione scomposta ed eseguita in ordine.',
      `Obiettivo: ${plan.goal}.`,
      `Esito: ${okCount} utili, ${failedCount} non riusciti, ${blockedCount} in attesa di conferma.`,
      'Informa l’utente sul progresso in modo naturale; niente jargon interno.',
      failedCount > 0
        ? 'Recupero: non bloccare tutta la risposta su un singolo fallimento.'
        : '',
      blockedCount > 0 ? 'Chiedi conferma solo per i passi bloccati.' : '',
    ]
      .filter(Boolean)
      .join(' ')

    return {
      plan,
      results,
      stoppedEarly,
      pendingAction,
      context: formatMultiStepForWriter(plan, results, stoppedEarly),
    }
  } catch {
    return {
      plan: idlePlan('fallback'),
      results: [],
      stoppedEarly: false,
      pendingAction: null,
      context: '',
    }
  }
}
