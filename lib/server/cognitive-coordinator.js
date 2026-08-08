/**
 * LAIfe Cognitive Coordinator
 *
 * Final decision maker before the Writer generates the response.
 * Every cognitive engine is an advisor; the Coordinator ranks, dedupes,
 * resolves conflicts, and limits influence so only the most useful
 * behaviors shape the answer.
 *
 * Never let multiple engines compete for the same part of the response.
 * Optimize for coherence, clarity, and conversational quality.
 *
 * Invisible to the user. Fail-soft.
 */

import { runInsightDiscoveryStage } from './insight-discovery.js'

/**
 * @typedef {'memory'|'curiosity'|'continuation'|'next_ask'|'teacher'|'personality'|'knowledge_level'|'welcome'|'life_intelligence'|'automation_builder'|'device_manager'|'topic_leadership'|'information_value'|'intellectual_initiative'|'surprise'|'intellectual_honesty'|'feedback_interpretation'|'warm_conversation'|'conversational_presence'|'planning'|'tool_selection'|'progressive_reasoning'|'adaptive'|'voice'|'momentum'|'action'|'multi_step'|'conversation_intelligence'|'reflection'|'core_plan'} AdvisorId
 */

/**
 * Exclusive response slots — at most one primary winner per slot
 * (style may merge a small capped set).
 *
 * @typedef {'opening'|'structure'|'coda'|'style'|'tools'|'goal'|'memory_policy'|'directive'} ResponseSlot
 */

/**
 * @typedef {object} AdvisorSuggestion
 * @property {string} id
 * @property {AdvisorId} advisor
 * @property {ResponseSlot} slot
 * @property {string} [text]
 * @property {string[]} [structure]
 * @property {string[]} [tools]
 * @property {string} [goal]
 * @property {boolean} [skipMemory]
 * @property {boolean} [webOff]
 * @property {number} [confidence] 0–1
 * @property {number} [baseValue] 0–10
 * @property {string[]} [reasons]
 * @property {boolean} [active]
 * @property {string} [fingerprint] for dedupe
 */

/**
 * @typedef {object} CoordinationDecision
 * @property {AdvisorSuggestion[]} collected
 * @property {AdvisorSuggestion[]} ranked
 * @property {AdvisorSuggestion[]} accepted
 * @property {AdvisorSuggestion[]} rejected
 * @property {Record<string, AdvisorSuggestion | null>} winnersBySlot
 * @property {string[]} styleBriefs
 * @property {string[]} directiveBriefs
 * @property {string[]} responseStructure
 * @property {string[]} toolOrder
 * @property {string[]} toolsSkipped
 * @property {string | null} realGoal
 * @property {boolean} skipMemory
 * @property {boolean} webOff
 * @property {string} writerDirective
 * @property {string} coordinatorBrief
 * @property {string[]} reasons
 * @property {{ found: boolean, kind?: string, seed?: string, score?: number } | null} [insightDiscovery]
 */

/** Max advisor briefs allowed into the Writer directive (besides base). */
const MAX_DIRECTIVE_BRIEFS = 4

/** Max style briefs (voice + personality/behavior). */
const MAX_STYLE_BRIEFS = 2

/** Max structure steps passed to Writer. */
const MAX_STRUCTURE_STEPS = 6

/** Max coda lines (always ≤1 after conflict resolution). */
const MAX_CODA = 1

/**
 * Base value by advisor when competing for influence.
 * Higher = more likely to win exclusive slots when confidence is equal.
 * @type {Record<AdvisorId, number>}
 */
const ADVISOR_BASE_VALUE = {
  reflection: 3,
  conversation_intelligence: 6,
  voice: 9,
  continuation: 9,
  personality: 7,
  knowledge_level: 7.5,
  intellectual_honesty: 8.35,
  feedback_interpretation: 9.15,
  warm_conversation: 8.05,
  conversational_presence: 8.15,
  welcome: 9.2,
  life_intelligence: 7.8,
  automation_builder: 9.3,
  device_manager: 8.2,
  topic_leadership: 9.45,
  information_value: 6.5,
  teacher: 8,
  progressive_reasoning: 7,
  adaptive: 5,
  planning: 7,
  multi_step: 9.5,
  action: 9,
  next_ask: 5.5,
  curiosity: 5,
  momentum: 5,
  intellectual_initiative: 5.35,
  surprise: 5.25,
  tool_selection: 6,
  memory: 6,
  core_plan: 4,
}

/**
 * Slot priority when assembling the final response (lower = earlier / stronger).
 * @type {Record<ResponseSlot, number>}
 */
const SLOT_PRIORITY = {
  goal: 1,
  opening: 2,
  structure: 3,
  tools: 4,
  memory_policy: 5,
  directive: 6,
  style: 7,
  coda: 8,
}

/**
 * Normalize confidence labels or numbers to 0–1.
 * @param {unknown} c
 */
function conf01(c) {
  if (typeof c === 'number' && Number.isFinite(c)) {
    return Math.max(0, Math.min(1, c > 1 ? c / 10 : c))
  }
  if (c === 'high') return 0.9
  if (c === 'medium') return 0.65
  if (c === 'low') return 0.35
  return 0.5
}

/**
 * @param {string} text
 */
function fingerprintText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .trim()
    .slice(0, 160)
}

/**
 * Create a suggestion object.
 * @param {Partial<AdvisorSuggestion> & { advisor: AdvisorId, slot: ResponseSlot }} raw
 * @returns {AdvisorSuggestion}
 */
export function makeSuggestion(raw) {
  const text = raw.text || ''
  const structure = Array.isArray(raw.structure) ? raw.structure.filter(Boolean) : undefined
  const fp =
    raw.fingerprint ||
    fingerprintText(
      [raw.advisor, raw.slot, text, (structure || []).join('|')].filter(Boolean).join('::'),
    )
  return {
    id: raw.id || `${raw.advisor}:${raw.slot}:${fp.slice(0, 24)}`,
    advisor: raw.advisor,
    slot: raw.slot,
    text: text || undefined,
    structure,
    tools: raw.tools,
    goal: raw.goal,
    skipMemory: raw.skipMemory,
    webOff: raw.webOff,
    confidence: conf01(raw.confidence),
    baseValue:
      typeof raw.baseValue === 'number'
        ? raw.baseValue
        : ADVISOR_BASE_VALUE[raw.advisor] ?? 4,
    reasons: raw.reasons || [],
    active: raw.active !== false,
    fingerprint: fp,
  }
}

/**
 * Value score used for ranking.
 * @param {AdvisorSuggestion} s
 */
export function scoreSuggestion(s) {
  const slotBoost = 10 - (SLOT_PRIORITY[s.slot] ?? 6)
  return (s.baseValue || 0) * (0.45 + 0.55 * (s.confidence || 0.5)) + slotBoost * 0.15
}

/**
 * Rank suggestions highest-value first.
 * @param {AdvisorSuggestion[]} suggestions
 */
export function rankSuggestions(suggestions) {
  return [...suggestions]
    .filter((s) => s && s.active !== false)
    .map((s) => ({ ...s, _score: scoreSuggestion(s) }))
    .sort((a, b) => {
      if (b._score !== a._score) return b._score - a._score
      return (SLOT_PRIORITY[a.slot] ?? 9) - (SLOT_PRIORITY[b.slot] ?? 9)
    })
}

/**
 * Remove near-duplicate suggestions (same slot + similar fingerprint / text).
 * @param {AdvisorSuggestion[]} ranked
 */
export function dedupeSuggestions(ranked) {
  /** @type {AdvisorSuggestion[]} */
  const out = []
  const seen = new Set()
  for (const s of ranked) {
    const key = `${s.slot}::${s.fingerprint}`
    const textKey = s.text ? `${s.slot}::${fingerprintText(s.text).slice(0, 80)}` : ''
    if (seen.has(key) || (textKey && seen.has(textKey))) continue
    // Soft near-dup: same advisor+slot keeps highest only (already ranked)
    const advisorSlot = `${s.advisor}::${s.slot}`
    if (seen.has(advisorSlot)) continue
    seen.add(key)
    if (textKey) seen.add(textKey)
    seen.add(advisorSlot)
    out.push(s)
  }
  return out
}

/**
 * Hard suppressions based on conversational state.
 * @param {object} state
 */
function buildSuppressions(state) {
  /** @type {Set<string>} */
  const suppressAdvisors = new Set()
  /** @type {Set<ResponseSlot>} */
  const suppressSlots = new Set()

  const cont = state.continuation
  const voice = state.voice
  const shortStop = Boolean(cont?.isShortMessage && !cont?.shouldContinue)
  const shortContinue = Boolean(cont?.isShortMessage && cont?.shouldContinue)
  const voiceBusy = Boolean(
    voice?.active && (voice.interruptKind !== 'none' || voice.incompleteUtterance),
  )
  const multiActive = Boolean(state.multiStep?.active)
  const actionBusy = Boolean(state.action?.actionRequired)
  const automationBusy = Boolean(
    state.automation?.active &&
      state.automation.phase !== 'idle' &&
      state.automation.phase !== 'cancelled',
  )
  const topicLead = Boolean(state.topicLeadership?.shouldLead)
  const feedbackOwns = Boolean(state.feedbackInterpretation?.active)
  const warmOwns = Boolean(
    state.warmConversation?.active &&
      state.warmConversation?.ownsOpening &&
      !state.warmConversation?.softStyleOnly,
  )

  if (shortStop) {
    suppressAdvisors.add('curiosity')
    suppressAdvisors.add('momentum')
    suppressAdvisors.add('intellectual_initiative')
    suppressAdvisors.add('surprise')
    suppressAdvisors.add('next_ask')
    suppressAdvisors.add('life_intelligence')
    suppressSlots.add('coda')
  }
  if (feedbackOwns) {
    // Meta-feedback owns style adaptation this turn — no competing coda noise
    suppressAdvisors.add('curiosity')
    suppressAdvisors.add('momentum')
    suppressAdvisors.add('intellectual_initiative')
    suppressAdvisors.add('surprise')
    suppressAdvisors.add('next_ask')
    suppressAdvisors.add('life_intelligence')
    suppressAdvisors.add('welcome')
    suppressAdvisors.add('warm_conversation')
    suppressSlots.add('coda')
  }
  if (warmOwns) {
    // Pure warm greeting / casual start — no transactional coda noise
    suppressAdvisors.add('curiosity')
    suppressAdvisors.add('next_ask')
    suppressAdvisors.add('life_intelligence')
    suppressSlots.add('coda')
  }
  if (topicLead) {
    // Topic Leadership owns the turn — one theme, no competing coda / tips / welcome opening
    suppressAdvisors.add('curiosity')
    suppressAdvisors.add('momentum')
    suppressAdvisors.add('intellectual_initiative')
    suppressAdvisors.add('surprise')
    suppressAdvisors.add('next_ask')
    suppressAdvisors.add('life_intelligence')
    suppressAdvisors.add('welcome')
    suppressSlots.add('coda')
  }
  if (voiceBusy) {
    suppressAdvisors.add('curiosity')
    suppressAdvisors.add('momentum')
    suppressAdvisors.add('intellectual_initiative')
    suppressAdvisors.add('surprise')
    suppressAdvisors.add('life_intelligence')
    suppressSlots.add('coda')
  }
  if (multiActive) {
    // Multi-step owns structure; teacher/progressive structure yield
    suppressAdvisors.add('curiosity')
    suppressAdvisors.add('momentum')
    suppressAdvisors.add('intellectual_initiative')
    suppressAdvisors.add('surprise')
    suppressAdvisors.add('next_ask')
    suppressAdvisors.add('life_intelligence')
  }
  if (actionBusy && !multiActive) {
    suppressAdvisors.add('curiosity')
    suppressAdvisors.add('momentum')
    suppressAdvisors.add('intellectual_initiative')
    suppressAdvisors.add('surprise')
    suppressAdvisors.add('life_intelligence')
  }
  if (automationBusy) {
    // Automation builder owns the turn — explain draft, no competing tips
    suppressAdvisors.add('curiosity')
    suppressAdvisors.add('momentum')
    suppressAdvisors.add('intellectual_initiative')
    suppressAdvisors.add('surprise')
    suppressAdvisors.add('next_ask')
    suppressAdvisors.add('life_intelligence')
    suppressSlots.add('coda')
  }
  if (shortContinue) {
    // Continuation owns the beat — no competing coda engines
    suppressAdvisors.add('curiosity')
    suppressAdvisors.add('momentum')
    suppressAdvisors.add('intellectual_initiative')
    suppressAdvisors.add('surprise')
    suppressAdvisors.add('next_ask')
    suppressAdvisors.add('life_intelligence')
    suppressSlots.add('coda')
  }

  return {
    suppressAdvisors,
    suppressSlots,
    shortStop,
    shortContinue,
    topicLead,
    voiceBusy,
    multiActive,
    actionBusy,
    automationBusy,
  }
}

/**
 * Resolve conflicts: one winner per exclusive slot; coda engines never share.
 * @param {AdvisorSuggestion[]} deduped
 * @param {object} state
 */
export function resolveConflicts(deduped, state = {}) {
  const { suppressAdvisors, suppressSlots, multiActive, actionBusy, voiceBusy, shortStop } =
    buildSuppressions(state)

  /** @type {AdvisorSuggestion[]} */
  const accepted = []
  /** @type {AdvisorSuggestion[]} */
  const rejected = []
  /** @type {Record<string, AdvisorSuggestion | null>} */
  const winnersBySlot = {
    opening: null,
    structure: null,
    coda: null,
    style: null,
    tools: null,
    goal: null,
    memory_policy: null,
    directive: null,
  }

  /** @type {AdvisorSuggestion[]} */
  const styleAccepted = []
  /** @type {AdvisorSuggestion[]} */
  const directiveAccepted = []

  for (const s of deduped) {
    if (suppressAdvisors.has(s.advisor) && (s.slot === 'coda' || s.slot === 'structure')) {
      // Allow style/directive from suppressed advisors only if not coda/structure
      if (s.slot === 'coda' || (s.slot === 'structure' && (multiActive || actionBusy || voiceBusy || shortStop))) {
        rejected.push({ ...s, reasons: [...(s.reasons || []), 'suppressed_by_coordinator'] })
        continue
      }
    }
    if (suppressSlots.has(s.slot)) {
      rejected.push({ ...s, reasons: [...(s.reasons || []), 'slot_suppressed'] })
      continue
    }

    // Structure: exclusive — prefer multi_step > action > voice > continuation > teacher > personality > progressive > planning > adaptive > core
    if (s.slot === 'structure' || s.slot === 'opening') {
      const slot = s.slot
      if (!winnersBySlot[slot]) {
        winnersBySlot[slot] = s
        accepted.push(s)
      } else {
        rejected.push({ ...s, reasons: [...(s.reasons || []), `lost_${slot}_to_${winnersBySlot[slot]?.advisor}`] })
      }
      continue
    }

    // Coda: exclusive — curiosity / momentum / intellectual_initiative / surprise / next_ask bridge — only ONE
    if (s.slot === 'coda') {
      if (!winnersBySlot.coda && accepted.filter((a) => a.slot === 'coda').length < MAX_CODA) {
        winnersBySlot.coda = s
        accepted.push(s)
      } else {
        rejected.push({ ...s, reasons: [...(s.reasons || []), 'lost_coda_slot'] })
      }
      continue
    }

    // Style: merge up to MAX_STYLE_BRIEFS (voice preferred first via ranking)
    if (s.slot === 'style') {
      if (styleAccepted.length < MAX_STYLE_BRIEFS) {
        styleAccepted.push(s)
        accepted.push(s)
        if (!winnersBySlot.style) winnersBySlot.style = s
      } else {
        rejected.push({ ...s, reasons: [...(s.reasons || []), 'style_budget'] })
      }
      continue
    }

    // Directive briefs: capped
    if (s.slot === 'directive') {
      if (directiveAccepted.length < MAX_DIRECTIVE_BRIEFS) {
        directiveAccepted.push(s)
        accepted.push(s)
        if (!winnersBySlot.directive) winnersBySlot.directive = s
      } else {
        rejected.push({ ...s, reasons: [...(s.reasons || []), 'directive_budget'] })
      }
      continue
    }

    // tools / goal / memory_policy: exclusive winner (highest ranked)
    if (s.slot === 'tools' || s.slot === 'goal' || s.slot === 'memory_policy') {
      if (!winnersBySlot[s.slot]) {
        winnersBySlot[s.slot] = s
        accepted.push(s)
      } else if (s.slot === 'tools') {
        // Merge tool lists from secondary tool advisors into winner later via apply
        // Accept as supplemental if same policy direction
        accepted.push(s)
      } else {
        rejected.push({ ...s, reasons: [...(s.reasons || []), `lost_${s.slot}`] })
      }
      continue
    }

    accepted.push(s)
  }

  return { accepted, rejected, winnersBySlot, styleAccepted, directiveAccepted }
}

/**
 * Collect advisor suggestions from engine outputs.
 * Engines propose; they do not decide.
 *
 * @param {object} input
 * @returns {AdvisorSuggestion[]}
 */
export function collectAdvisorSuggestions(input) {
  const {
    plan,
    baseStructure,
    reflection,
    conversation,
    voice,
    welcome,
    continuation,
    behavior,
    knowledge,
    expertTeacher,
    task,
    nextAsk,
    curiosity,
    momentum,
    intellectualInitiative,
    surprise,
    honesty,
    feedbackInterpretation,
    warmConversation,
    conversationalPresence,
    multiStep,
    actionEngine,
    life,
    automationBuilder,
    deviceManager,
    topicLeadership,
    follow,
  } = input

  /** @type {AdvisorSuggestion[]} */
  const out = []

  // --- Information Value Estimator (prefer few high-value pieces) ---
  if (plan?.infoValue?.writerBrief && Array.isArray(plan.infoValue.kept) && plan.infoValue.kept.length > 0) {
    const iv = plan.infoValue
    out.push(
      makeSuggestion({
        advisor: 'information_value',
        slot: 'directive',
        text: iv.writerBrief,
        confidence: 0.75,
        baseValue: ADVISOR_BASE_VALUE.information_value,
        reasons: [`info_value_kept_${iv.kept.length}`, ...(iv.reasons || []).slice(0, 2)],
      }),
    )
    // Soft structure nudge: only high-value pieces in the body
    out.push(
      makeSuggestion({
        advisor: 'information_value',
        slot: 'structure',
        structure: [
          `Includi solo pezzi ad alto valore: ${iv.kept.map((c) => c.kind).join(', ')}`,
          'Scarta padding / ripetizioni / chiusure generiche — preferisci poche idee forti',
          `Obiettivo reale da servire: ${plan.realGoal}`,
        ],
        text: iv.writerBrief,
        confidence: 0.7,
        baseValue: ADVISOR_BASE_VALUE.information_value,
        reasons: ['info_value_structure'],
      }),
    )
  }

  // --- Topic Leadership Engine (Never Give Control Back) ---
  if (topicLeadership?.plan?.shouldLead && topicLeadership.plan.chosen && topicLeadership.plan.writerBrief) {
    const tl = topicLeadership.plan
    const pick = tl.chosen
    out.push(
      makeSuggestion({
        advisor: 'topic_leadership',
        slot: 'opening',
        structure: [
          `Never Give Control Back: UNA direzione «${pick.title}» — commit e sviluppa`,
          `Perché (breve): ${pick.why}`,
          `Insight + sviluppo — niente domande di scelta, niente liste`,
          'Vietato: far riscegliere; “di cosa vuoi parlare?”; “preferisci…?”; opzioni A/B/C',
          `Obiettivo reale da servire: ${plan.realGoal}`,
        ],
        text: tl.writerBrief,
        confidence: tl.confidence === 'high' ? 0.93 : 0.82,
        baseValue: ADVISOR_BASE_VALUE.topic_leadership,
        reasons: [`topic_${pick.id}`, 'never_give_control_back', ...(tl.reasons || []).slice(0, 2)],
      }),
    )
    out.push(
      makeSuggestion({
        advisor: 'topic_leadership',
        slot: 'directive',
        text: tl.writerBrief,
        confidence: tl.confidence === 'high' ? 0.93 : 0.82,
        baseValue: ADVISOR_BASE_VALUE.topic_leadership,
        reasons: ['topic_leadership_brief', 'never_give_control_back'],
      }),
    )
  }

  // --- Universal Device Manager (capability-first device control) ---
  if (deviceManager?.plan?.active && deviceManager.plan.topMatch && deviceManager.plan.writerBrief) {
    const dm = deviceManager.plan
    const match = dm.topMatch
    out.push(
      makeSuggestion({
        advisor: 'device_manager',
        slot: 'directive',
        text: dm.writerBrief,
        confidence: match.score >= 0.75 ? 0.85 : 0.65,
        baseValue: ADVISOR_BASE_VALUE.device_manager + Math.min(1, (match.score - 0.58) * 2),
        reasons: [`device_${match.device.type}`, `cap_${match.capability}`],
      }),
    )
    if (dm.shouldAct) {
      out.push(
        makeSuggestion({
          advisor: 'device_manager',
          slot: 'structure',
          structure: [
            `Dispositivo: ${match.device.name} (tipo ${match.device.type})`,
            `Capability: ${match.capability} — ${match.actionSummary}`,
            dm.stats.connected > 0
              ? 'Esegui tramite adapter se connesso; verifica esito'
              : 'Adapter non connesso: spiega il limite, non fingere successo',
            `Obiettivo reale da servire: ${plan.realGoal}`,
          ],
          text: dm.writerBrief,
          confidence: match.score,
          baseValue: ADVISOR_BASE_VALUE.device_manager,
          reasons: ['device_structure'],
        }),
      )
    }
  }

  // --- Natural Language Automation Builder (owns structure when drafting/confirming) ---
  if (automationBuilder?.plan?.active && automationBuilder.plan.writerBrief) {
    const ab = automationBuilder.plan
    out.push(
      makeSuggestion({
        advisor: 'automation_builder',
        slot: 'structure',
        structure: [
          ...(ab.structureHints || []),
          `Obiettivo reale da servire: ${plan.realGoal}`,
        ],
        text: ab.writerBrief,
        confidence: ab.confidence || 0.85,
        baseValue: ADVISOR_BASE_VALUE.automation_builder,
        reasons: [`automation_${ab.phase}`],
      }),
    )
    out.push(
      makeSuggestion({
        advisor: 'automation_builder',
        slot: 'directive',
        text: ab.writerBrief,
        confidence: ab.confidence || 0.85,
        baseValue: ADVISOR_BASE_VALUE.automation_builder,
        reasons: ['automation_brief'],
      }),
    )
  }

  // --- Knowledge Level Estimator (terminology / depth / pacing) ---
  if (knowledge?.plan?.active && knowledge.plan.writerBrief) {
    out.push(
      makeSuggestion({
        advisor: 'knowledge_level',
        slot: 'directive',
        text: knowledge.plan.writerBrief,
        confidence: knowledge.plan.confidence || 0.7,
        baseValue: ADVISOR_BASE_VALUE.knowledge_level,
        reasons: [
          `level_${knowledge.plan.level}`,
          ...(knowledge.plan.reasons || []).slice(0, 3),
        ],
      }),
    )
    if (knowledge.plan.adjustments) {
      const adj = knowledge.plan.adjustments
      out.push(
        makeSuggestion({
          advisor: 'knowledge_level',
          slot: 'style',
          text: `Calibra sul livello ${knowledge.plan.level}: terminology=${adj.terminology}, examples=${adj.examples}, depth=${adj.depth}, pacing=${adj.pacing}. Evita oversimplifying e overwhelm.`,
          confidence: knowledge.plan.confidence || 0.7,
          baseValue: ADVISOR_BASE_VALUE.knowledge_level,
          reasons: ['knowledge_adjustments'],
        }),
      )
    }
  }

  // --- Intellectual Honesty (epistemic ceiling — style + directive) ---
  if (honesty?.plan?.active && honesty.plan.writerBrief) {
    const h = honesty.plan
    out.push(
      makeSuggestion({
        advisor: 'intellectual_honesty',
        slot: 'directive',
        text: h.writerBrief,
        confidence: h.confidence || 0.75,
        baseValue:
          ADVISOR_BASE_VALUE.intellectual_honesty +
          (h.toolEvidence === 'strong' ? 0.3 : h.toolEvidence === 'none' ? 0.15 : 0),
        reasons: [
          `ceiling_${h.ceiling}`,
          `stance_${h.dominantStance}`,
          ...(h.reasons || []).slice(0, 3),
        ],
      }),
    )
    out.push(
      makeSuggestion({
        advisor: 'intellectual_honesty',
        slot: 'style',
        text: `Onestà intellettuale: ceiling=${h.ceiling}. Allinea certezza all’evidenza; mai speculazione come fatto; dichiara l’incertezza in modo naturale.`,
        structure: [
          `Epistemic ceiling: ${h.ceiling} (non superare)`,
          `Stance dominante: ${h.dominantStance}`,
          'Classifica ogni claim: fatto / evidenza forte / inferenza / speculazione / opinione',
        ],
        confidence: h.confidence || 0.75,
        baseValue: ADVISOR_BASE_VALUE.intellectual_honesty,
        reasons: ['honesty_style_ladder'],
      }),
    )
  } else if (honesty?.plan?.writerBrief && !honesty.plan.active) {
    out.push(
      makeSuggestion({
        advisor: 'intellectual_honesty',
        slot: 'directive',
        text: honesty.plan.writerBrief,
        confidence: 0.4,
        baseValue: 3,
        reasons: ['honesty_social_skip'],
      }),
    )
  }

  // --- Feedback Interpretation (meta-feedback about the assistant) ---
  if (feedbackInterpretation?.plan?.active && feedbackInterpretation.plan.writerBrief) {
    const fb = feedbackInterpretation.plan
    out.push(
      makeSuggestion({
        advisor: 'feedback_interpretation',
        slot: 'directive',
        text: fb.writerBrief,
        confidence: fb.confidence || 0.8,
        baseValue:
          ADVISOR_BASE_VALUE.feedback_interpretation +
          (fb.confidence === 'high' ? 0.25 : 0),
        reasons: [
          `feedback_${fb.kind}`,
          ...(fb.signals || []).slice(0, 3),
        ],
      }),
    )
    out.push(
      makeSuggestion({
        advisor: 'feedback_interpretation',
        slot: 'style',
        text: `Feedback Interpretation: adatta subito (${fb.kind}). Non trattare come domanda fattuale; niente lezioni ovvie; niente “Vuoi che…?”; non menzionare il Conversation Preference Profile.`,
        structure: fb.structureLine
          ? [
              fb.structureLine,
              fb.continueTopic
                ? 'Continua sul filo corrente con lo stile/qualità richiesti'
                : 'Adatta lo stile senza aprire un nuovo tema',
            ]
          : undefined,
        confidence: fb.confidence || 0.8,
        baseValue: ADVISOR_BASE_VALUE.feedback_interpretation,
        reasons: ['feedback_style_adapt'],
      }),
    )
    if (fb.continueTopic && fb.structureLine) {
      out.push(
        makeSuggestion({
          advisor: 'feedback_interpretation',
          slot: 'structure',
          structure: [
            fb.structureLine,
            'Ack naturale solo se serve (breve/woven) — poi sostanza migliorata',
            'Vietato: spiegare concetti ovvi; chiedere conferma del feedback; menzionare il profilo',
            `Obiettivo reale da servire: ${plan.realGoal}`,
          ],
          text: fb.writerBrief,
          confidence: fb.confidence || 0.8,
          baseValue: ADVISOR_BASE_VALUE.feedback_interpretation,
          reasons: [`feedback_structure_${fb.kind}`],
        }),
      )
    }
  } else if (
    feedbackInterpretation?.plan?.profileActive &&
    feedbackInterpretation.plan.writerBrief
  ) {
    // Sticky Conversation Preference Profile — soft style only, no turn ownership.
    out.push(
      makeSuggestion({
        advisor: 'feedback_interpretation',
        slot: 'style',
        text: feedbackInterpretation.plan.writerBrief,
        confidence: 0.55,
        baseValue: 6.2,
        reasons: ['preference_profile_sticky'],
      }),
    )
  }

  // --- Warm Conversation (enjoy chat; anti-transactional) ---
  if (warmConversation?.plan?.active && warmConversation.plan.writerBrief) {
    const wc = warmConversation.plan
    const welcomeOwns = Boolean(welcome?.plan?.active)
    const continuationOwnsOpening = Boolean(
      continuation?.plan?.isShortMessage && continuation?.plan?.shouldContinue,
    )

    out.push(
      makeSuggestion({
        advisor: 'warm_conversation',
        slot: 'style',
        text: wc.writerBrief,
        confidence: wc.confidence === 'high' ? 0.9 : wc.confidence === 'medium' ? 0.78 : 0.62,
        baseValue:
          ADVISOR_BASE_VALUE.warm_conversation +
          (wc.confidence === 'high' ? 0.2 : 0) +
          (wc.trigger === 'greeting' || wc.trigger === 'casual_start' ? 0.15 : 0),
        reasons: [`warm_${wc.trigger}`, ...(wc.signals || []).slice(0, 3)],
      }),
    )

    out.push(
      makeSuggestion({
        advisor: 'warm_conversation',
        slot: 'directive',
        text: wc.writerBrief,
        confidence: wc.confidence === 'high' ? 0.88 : 0.75,
        baseValue: ADVISOR_BASE_VALUE.warm_conversation,
        reasons: ['warm_conversation_brief'],
      }),
    )

    if (wc.ownsOpening && !wc.softStyleOnly && !welcomeOwns && !continuationOwnsOpening) {
      out.push(
        makeSuggestion({
          advisor: 'warm_conversation',
          slot: 'opening',
          structure: [
            wc.structureLine || 'Warm Conversation: partner — calore + idea, non helpdesk',
            'Vietato (basso valore): “Dimmi pure.”, “Come posso aiutarti?”, “Qual è la tua priorità?”, “Cosa vuoi sapere?”, “Hai domande?”, “Fammi sapere.”, “Sono qui se ti serve.”',
            'Preferisci: osservazioni, idee, curiosità, storie, insight, fatti sorprendenti, collegamenti',
            `Obiettivo reale da servire: ${plan.realGoal}`,
          ],
          text: wc.writerBrief,
          confidence: wc.confidence === 'high' ? 0.88 : 0.75,
          baseValue: ADVISOR_BASE_VALUE.warm_conversation,
          reasons: [`warm_opening_${wc.trigger}`],
        }),
      )
    } else if (wc.structureLine && !welcomeOwns) {
      out.push(
        makeSuggestion({
          advisor: 'warm_conversation',
          slot: 'structure',
          structure: [
            wc.structureLine,
            'Transizioni naturali; tono di chi pensa volentieri insieme',
            `Obiettivo reale da servire: ${plan.realGoal}`,
          ],
          text: wc.writerBrief,
          confidence: 0.7,
          baseValue: ADVISOR_BASE_VALUE.warm_conversation - 0.4,
          reasons: [`warm_structure_${wc.trigger}`],
        }),
      )
    }
  }

  // --- Conversational Presence (feel present; engage meaning; no restart/interview default) ---
  if (conversationalPresence?.plan?.active && conversationalPresence.plan.writerBrief) {
    const cp = conversationalPresence.plan
    out.push(
      makeSuggestion({
        advisor: 'conversational_presence',
        slot: 'style',
        text: cp.writerBrief,
        confidence: cp.confidence === 'high' ? 0.88 : cp.confidence === 'medium' ? 0.76 : 0.6,
        baseValue:
          ADVISOR_BASE_VALUE.conversational_presence +
          (cp.confidence === 'high' ? 0.15 : 0) +
          (cp.restartRisk || cp.interviewRisk ? 0.1 : 0),
        reasons: [`presence_${cp.mode}`, ...(cp.signals || []).slice(0, 3)],
      }),
    )
    out.push(
      makeSuggestion({
        advisor: 'conversational_presence',
        slot: 'directive',
        text: cp.writerBrief,
        confidence: cp.confidence === 'high' ? 0.86 : 0.74,
        baseValue: ADVISOR_BASE_VALUE.conversational_presence,
        reasons: ['conversational_presence_brief'],
      }),
    )
    if (cp.restartRisk || cp.interviewRisk || cp.preferSharedThought) {
      const modeLine =
        cp.mode === 'listen'
          ? 'Presence listen: riconoscimento emotivo + presenza — niente intervista'
          : cp.mode === 'react'
            ? 'Presence react: reagisci, poi sviluppa lo stesso filo'
            : cp.mode === 'shared_thread'
              ? 'Presence shared_thread: continua il pensiero condiviso — non ripartire'
              : cp.mode === 'substance'
                ? 'Presence substance: servi la richiesta con presenza, senza frasi da sportello'
                : 'Presence engage: osservazione o idea viva — non helpdesk'
      out.push(
        makeSuggestion({
          advisor: 'conversational_presence',
          slot: 'structure',
          structure: [
            modeLine,
            cp.preferReaction
              ? 'Includi una reazione/osservazione genuina (non formula)'
              : 'Ragionamento condiviso o transizione ponderata',
            cp.interviewRisk
              ? 'Domande solo se utili al filo — mai perché sono facili'
              : 'Evita frasi generiche da assistente',
            `Obiettivo reale da servire: ${plan.realGoal}`,
          ],
          text: cp.writerBrief,
          confidence: 0.72,
          baseValue: ADVISOR_BASE_VALUE.conversational_presence - 0.25,
          reasons: [`presence_structure_${cp.mode}`],
        }),
      )
    }
  }

  // --- Welcome Experience Engine (opening ownership when active) ---
  if (
    welcome?.plan?.active &&
    welcome.plan.writerBrief &&
    !topicLeadership?.plan?.shouldLead
  ) {
    const strategy = welcome.plan.strategy || 'warm_only'
    /** @type {string[]} */
    let structure = []
    if (welcome.plan.mode === 'warm_handoff' || strategy === 'warm_handoff') {
      structure = [
        `Warm handoff breve (seed): ${welcome.plan.greetingSeed}`,
        'Poi servi subito la richiesta dell’utente',
        'Niente digressioni da progetto se distrae',
        `Obiettivo reale da servire: ${plan.realGoal}`,
      ]
    } else if (strategy === 'warm_only') {
      structure = [
        `Saluto caldo unico (seed): ${welcome.plan.greetingSeed}`,
        'Partner di conversazione: se il filo è vuoto, apri con osservazione/idea/curiosità/insight — non un’intervista',
        'Vietato (basso valore): “Dimmi pure.”, “Come posso aiutarti?”, “Qual è la tua priorità?”, “Cosa vuoi sapere?”, “Hai domande?”, “Fammi sapere.”, “Sono qui se ti serve.”',
        `Obiettivo reale da servire: ${plan.realGoal}`,
      ]
    } else {
      structure = [
        `Apertura (${strategy}) seed: ${welcome.plan.greetingSeed}`,
        welcome.plan.memory
          ? `Al massimo UN contesto: ${welcome.plan.memory.kind} «${welcome.plan.memory.label}»`
          : 'Niente lista memorie',
        welcome.plan.nextStep
          ? `Un solo next step proposto da te: ${welcome.plan.nextStep}`
          : 'Se manca un filo: porta UNA idea — non chiedere la priorità',
        'Partner di conversazione — varietà, niente script da interview',
        `Obiettivo reale da servire: ${plan.realGoal}`,
      ]
    }
    out.push(
      makeSuggestion({
        advisor: 'welcome',
        slot: 'opening',
        structure,
        text: welcome.plan.writerBrief,
        confidence: 0.92,
        baseValue: ADVISOR_BASE_VALUE.welcome,
        reasons: [`welcome_${strategy}`],
      }),
    )
    out.push(
      makeSuggestion({
        advisor: 'welcome',
        slot: 'directive',
        text: welcome.plan.writerBrief,
        confidence: 0.92,
        reasons: ['welcome_brief'],
      }),
    )
  }

  // --- Life Intelligence Engine (multi-source proactive tip — coda, high bar) ---
  if (life?.plan?.shouldSuggest && life.plan.chosen && life.plan.writerBrief) {
    const rec = life.plan.chosen
    out.push(
      makeSuggestion({
        advisor: 'life_intelligence',
        slot: 'coda',
        text: life.plan.writerBrief,
        structure: [
          `Dopo la risposta: UNA raccomandazione di vita concisa (${rec.kind}) — ${rec.title}`,
        ],
        confidence: life.plan.confidence || 0.7,
        baseValue:
          ADVISOR_BASE_VALUE.life_intelligence +
          Math.min(1.5, (rec.valueScore - 6.4) * 0.4) +
          (rec.urgency === 'high' ? 0.6 : 0),
        reasons: [`life_${rec.id}`, `sources_${rec.sources.join('+')}`],
      }),
    )
    out.push(
      makeSuggestion({
        advisor: 'life_intelligence',
        slot: 'directive',
        text: life.plan.writerBrief,
        confidence: life.plan.confidence || 0.7,
        baseValue: ADVISOR_BASE_VALUE.life_intelligence,
        reasons: ['life_brief'],
      }),
    )
  }

  // --- Core / progressive / adaptive / teacher (from base plan) ---
  if (plan?.progressive?.enabled && plan.progressive.structureHints?.length) {
    out.push(
      makeSuggestion({
        advisor: 'progressive_reasoning',
        slot: 'structure',
        structure: [
          ...plan.progressive.structureHints.filter((h) => !/^Ragionamento progressivo/i.test(h)),
          `Obiettivo reale da servire: ${plan.realGoal}`,
        ],
        text: plan.progressive.writerBrief || '',
        confidence: plan.progressive.confidence || 0.7,
        baseValue: ADVISOR_BASE_VALUE.progressive_reasoning,
        reasons: ['progressive_plan'],
      }),
    )
    if (plan.progressive.writerBrief) {
      out.push(
        makeSuggestion({
          advisor: 'progressive_reasoning',
          slot: 'directive',
          text: plan.progressive.writerBrief,
          confidence: 0.7,
          reasons: ['progressive_brief'],
        }),
      )
    }
  }

  if (plan?.adaptive?.structureHints?.length && !plan?.progressive?.enabled) {
    out.push(
      makeSuggestion({
        advisor: 'adaptive',
        slot: 'structure',
        structure: [
          ...plan.adaptive.structureHints,
          `Obiettivo reale da servire: ${plan.realGoal}`,
        ],
        text: plan.adaptive.writerBrief || '',
        confidence: 0.6,
        reasons: ['adaptive_structure'],
      }),
    )
  }

  if (expertTeacher?.plan?.enabled && expertTeacher.plan.structureHints?.length) {
    out.push(
      makeSuggestion({
        advisor: 'teacher',
        slot: 'structure',
        structure: [
          ...expertTeacher.plan.structureHints,
          'Prosa da ottimo insegnante: progressiva, umana — non enciclopedia',
          `Obiettivo reale da servire: ${plan.realGoal}`,
        ],
        text: expertTeacher.plan.writerBrief || '',
        confidence: expertTeacher.plan.confidence || 0.8,
        baseValue: ADVISOR_BASE_VALUE.teacher + 0.5,
        reasons: ['expert_teacher'],
      }),
    )
    if (expertTeacher.plan.writerBrief) {
      out.push(
        makeSuggestion({
          advisor: 'teacher',
          slot: 'directive',
          text: expertTeacher.plan.writerBrief,
          confidence: 0.8,
          reasons: ['teacher_brief'],
        }),
      )
    }
  }

  // Fallback core structure if nothing else owns it
  if (baseStructure?.length) {
    out.push(
      makeSuggestion({
        advisor: 'core_plan',
        slot: 'structure',
        structure: baseStructure,
        confidence: 0.4,
        baseValue: 3,
        reasons: ['base_outline'],
      }),
    )
  }

  // --- Personality / Dynamic Behavior ---
  if (behavior?.plan?.active) {
    if (behavior.plan.shortReply && !behavior.plan.shouldContinue) {
      out.push(
        makeSuggestion({
          advisor: 'personality',
          slot: 'opening',
          structure: [
            'Risposta brevissima e naturale',
            'Non forzare la conversazione',
            `Obiettivo reale da servire: ${plan.realGoal}`,
          ],
          text: behavior.plan.writerBrief || '',
          confidence: behavior.plan.confidence || 0.85,
          baseValue: 9,
          reasons: ['behavior_short_stop'],
        }),
      )
    } else if (behavior.plan.responseHints?.length) {
      out.push(
        makeSuggestion({
          advisor: 'personality',
          slot: 'structure',
          structure: [
            ...behavior.plan.responseHints.slice(0, 4),
            `Behavior: ${behavior.plan.behavior}`,
            `Obiettivo reale da servire: ${plan.realGoal}`,
          ],
          text: behavior.plan.writerBrief || '',
          confidence: behavior.plan.confidence || 0.75,
          reasons: [`behavior_${behavior.plan.behavior}`],
        }),
      )
    }
    if (behavior.plan.writerBrief) {
      out.push(
        makeSuggestion({
          advisor: 'personality',
          slot: 'directive',
          text: behavior.plan.writerBrief,
          confidence: behavior.plan.confidence || 0.75,
          reasons: ['behavior_brief'],
        }),
      )
    }
    if (behavior.plan.styleBrief) {
      out.push(
        makeSuggestion({
          advisor: 'personality',
          slot: 'style',
          text: behavior.plan.styleBrief,
          confidence: 0.7,
          reasons: ['behavior_style'],
        }),
      )
    }
    if (behavior.plan.memoryHelpful === false) {
      out.push(
        makeSuggestion({
          advisor: 'memory',
          slot: 'memory_policy',
          skipMemory: true,
          text: 'Skip memory retrieval — would not improve this turn.',
          confidence: 0.8,
          reasons: ['memory_not_helpful'],
        }),
      )
    }
  }

  // --- Voice ---
  if (voice?.plan?.active) {
    if (voice.plan.interruptKind === 'hard' || voice.plan.interruptKind === 'soft') {
      out.push(
        makeSuggestion({
          advisor: 'voice',
          slot: 'opening',
          structure: [
            'Ack brevissimo (una frase corta)',
            voice.plan.shouldResumeTopic
              ? `Riprendi «${voice.plan.resumeTopic}» senza rifare tutto`
              : 'Ascolta / segui la nuova direzione dell’utente',
            'Niente monologo — modalità voce',
          ],
          text: voice.plan.writerBrief || '',
          confidence: 0.95,
          baseValue: 10,
          reasons: [`voice_interrupt_${voice.plan.interruptKind}`],
        }),
      )
    } else if (voice.plan.incompleteUtterance) {
      out.push(
        makeSuggestion({
          advisor: 'voice',
          slot: 'opening',
          structure: [
            'Una frase su cosa hai capito finora',
            'Invito breve a completare OPPURE prosecuzione tentativa leggera',
            'Frasi corte, pause naturali',
          ],
          text: voice.plan.writerBrief || '',
          confidence: 0.9,
          baseValue: 9.5,
          reasons: ['voice_incomplete'],
        }),
      )
    } else if (voice.plan.writerBrief) {
      out.push(
        makeSuggestion({
          advisor: 'voice',
          slot: 'directive',
          text: voice.plan.writerBrief,
          confidence: 0.75,
          reasons: ['voice_brief'],
        }),
      )
    }
    if (voice.plan.spokenStyleBrief) {
      out.push(
        makeSuggestion({
          advisor: 'voice',
          slot: 'style',
          text: voice.plan.spokenStyleBrief,
          confidence: 0.95,
          baseValue: 9.5,
          reasons: ['voice_spoken_style'],
        }),
      )
    }
  }

  // --- Continuation ---
  if (continuation?.plan?.isShortMessage) {
    if (continuation.plan.shouldContinue) {
      const nextLayer = expertTeacher?.plan?.enabled
        ? expertTeacher.plan.layersThisTurn?.[0]
        : null
      out.push(
        makeSuggestion({
          advisor: 'continuation',
          slot: 'opening',
          structure:
            continuation.plan.intent === 'compliment_go_deeper'
              ? [
                  'BUILD IDEAS, DON\'T RESET — stessa idea, uno strato più a fondo',
                  'Ack caldo in mezza frase max (o nessuno) — NON solo “grazie”; NON ripartire da zero',
                  `Sviluppa il filo (${continuation.plan.continuationStyle || 'advanced'}) — NON fare subito un’altra domanda`,
                  'Entusiasmo = permesso di approfondire lo stesso treno di pensiero',
                  `Obiettivo reale da servire: ${conversation?.memory?.currentGoal || plan.realGoal}`,
                ]
              : [
                  'Ack naturale in mezza frase (opzionale) — senza “Perfetto!” ripetitivo',
                  nextLayer
                    ? `Prossimo layer didattico: ${nextLayer.label} — ${nextLayer.writerHint}`
                    : `Una sola aggiunta di valore (${continuation.plan.continuationStyle || continuation.plan.additionKind || 'utile'}) sul filo corrente`,
                  'Chiudi senza forzare; non trasformarlo in un corso infinito',
                  `Obiettivo reale da servire: ${conversation?.memory?.currentGoal || plan.realGoal}`,
                ],
          text: continuation.plan.writerBrief || '',
          confidence: continuation.plan.confidence || 0.85,
          baseValue: continuation.plan.intent === 'compliment_go_deeper' ? 9.4 : 9.2,
          reasons:
            continuation.plan.intent === 'compliment_go_deeper'
              ? ['continuation_compliment_deeper', 'build_ideas_dont_reset']
              : ['continuation_continue'],
        }),
      )
      if (conversation?.memory?.currentGoal) {
        out.push(
          makeSuggestion({
            advisor: 'continuation',
            slot: 'goal',
            goal: `Continuare l’apprendimento su: ${conversation.memory.currentTopic}`,
            confidence: 0.8,
            reasons: ['continuation_goal'],
          }),
        )
      }
    } else {
      out.push(
        makeSuggestion({
          advisor: 'continuation',
          slot: 'opening',
          structure: [
            'Risposta breve e umana all’ack / chiusura',
            'Niente mini-lezione, niente reset, niente domanda forzata',
            `Obiettivo reale da servire: ${conversation?.memory?.currentGoal || plan.realGoal}`,
          ],
          text: continuation.plan.writerBrief || '',
          confidence: continuation.plan.confidence || 0.9,
          baseValue: 9.5,
          reasons: ['continuation_stop'],
        }),
      )
    }
    if (continuation.plan.writerBrief) {
      out.push(
        makeSuggestion({
          advisor: 'continuation',
          slot: 'directive',
          text: continuation.plan.writerBrief,
          confidence: continuation.plan.confidence || 0.85,
          reasons: ['continuation_brief'],
        }),
      )
    }
    out.push(
      makeSuggestion({
        advisor: 'tool_selection',
        slot: 'tools',
        tools: (plan.toolOrder || []).filter((t) => t === 'memory'),
        webOff: true,
        confidence: 0.9,
        reasons: ['short_message_tools'],
      }),
    )
  }

  // --- Conversation intelligence / follow-ups ---
  if (
    follow === 'continue' ||
    follow === 'ack' ||
    follow === 'example' ||
    follow === 'clarify'
  ) {
    if (!continuation?.plan?.isShortMessage) {
      out.push(
        makeSuggestion({
          advisor: 'conversation_intelligence',
          slot: 'structure',
          structure: [
            follow === 'example'
              ? 'Apri con un esempio concreto sul filo corrente'
              : follow === 'clarify'
                ? 'Apri chiarendo il punto già toccato, senza rifare tutta la lezione'
                : 'Riprendi dal punto lasciato, senza reset — non trattare il messaggio come isolato',
            'Aggiungi solo ciò che manca rispetto a quanto già detto',
            'Chiudi in modo naturale e continuo',
            `Obiettivo reale da servire: ${conversation?.memory?.currentGoal || plan.realGoal}`,
          ],
          confidence: 0.8,
          baseValue: 8,
          reasons: [`follow_${follow}`],
        }),
      )
    }
    if (conversation?.memory?.continuityDirective) {
      out.push(
        makeSuggestion({
          advisor: 'conversation_intelligence',
          slot: 'directive',
          text: conversation.memory.continuityDirective,
          confidence: 0.8,
          reasons: ['continuity_directive'],
        }),
      )
    }
    if (conversation?.memory?.currentGoal) {
      out.push(
        makeSuggestion({
          advisor: 'conversation_intelligence',
          slot: 'goal',
          goal: conversation.memory.currentGoal,
          confidence: 0.75,
          reasons: ['follow_goal'],
        }),
      )
    }
    out.push(
      makeSuggestion({
        advisor: 'tool_selection',
        slot: 'tools',
        tools: (plan.toolOrder || []).filter((t) => t === 'memory'),
        webOff: true,
        confidence: 0.85,
        reasons: ['followup_memory_only'],
      }),
    )
  } else if (conversation?.memory?.topicShift && conversation.memory.continuityDirective) {
    out.push(
      makeSuggestion({
        advisor: 'conversation_intelligence',
        slot: 'directive',
        text: conversation.memory.continuityDirective,
        confidence: 0.7,
        reasons: ['topic_shift'],
      }),
    )
    if (conversation.memory.currentGoal) {
      out.push(
        makeSuggestion({
          advisor: 'conversation_intelligence',
          slot: 'goal',
          goal: conversation.memory.currentGoal,
          confidence: 0.7,
          reasons: ['topic_shift_goal'],
        }),
      )
    }
  }

  // --- Planning (task planner) ---
  if (task?.plan?.complexity === 'high' && follow === 'other') {
    out.push(
      makeSuggestion({
        advisor: 'planning',
        slot: 'structure',
        structure: [
          `Problema centrale: ${plan.progressive?.coreProblem || plan.realGoal}`,
          ...(task.plan.workstreams || []).slice(0, 5).map((w, i) => `Parte ${i + 1}: ${w}`),
          'Ricombina in una risposta unica',
          'Verifica coerenza interna',
          'Scrivi solo la risposta finale',
          `Obiettivo reale da servire: ${plan.realGoal}`,
        ],
        text: task.plan.writerBrief || '',
        confidence: 0.8,
        baseValue: 8,
        reasons: ['task_high_complexity'],
      }),
    )
  } else if (
    task?.plan?.complexity === 'medium' &&
    follow === 'other' &&
    plan.adaptive?.effort !== 'minimal' &&
    task.plan.writerBrief
  ) {
    out.push(
      makeSuggestion({
        advisor: 'planning',
        slot: 'directive',
        text: task.plan.writerBrief,
        confidence: 0.65,
        reasons: ['task_medium'],
      }),
    )
  }

  if (
    follow !== 'continue' &&
    follow !== 'ack' &&
    follow !== 'example' &&
    follow !== 'clarify' &&
    Array.isArray(task?.plan?.tools) &&
    task.plan.tools.length
  ) {
    const merged = [...new Set([...(plan.toolOrder || []), ...task.plan.tools])]
    out.push(
      makeSuggestion({
        advisor: 'planning',
        slot: 'tools',
        tools: plan.webDecision?.needed ? merged : merged.filter((t) => t !== 'web'),
        confidence: 0.7,
        reasons: ['task_tools'],
      }),
    )
  }

  // --- Next-ask (shapes body — not a competing coda when curiosity/momentum win) ---
  if (nextAsk?.plan?.active && nextAsk.plan.prediction && !continuation?.plan?.isShortMessage) {
    out.push(
      makeSuggestion({
        advisor: 'next_ask',
        slot: 'directive',
        text: nextAsk.plan.shapeBrief || nextAsk.plan.writerBrief || '',
        confidence: nextAsk.plan.confidence || 0.6,
        baseValue: ADVISOR_BASE_VALUE.next_ask,
        reasons: [`next_ask_${nextAsk.plan.prediction.kind}`],
      }),
    )
    // Soft structure hint (lower value than exclusive structure owners)
    out.push(
      makeSuggestion({
        advisor: 'next_ask',
        slot: 'coda',
        text: `Mentre rispondi: prepara un ponte naturale verso la curiosità probabile (${nextAsk.plan.prediction.kind}) — senza menzionarla`,
        structure: [
          `Mentre rispondi: prepara un ponte naturale verso la curiosità probabile (${nextAsk.plan.prediction.kind}) — senza menzionarla`,
        ],
        confidence: conf01(nextAsk.plan.confidence) * 0.85,
        baseValue: 4.5,
        reasons: ['next_ask_bridge'],
      }),
    )
  }

  // --- Intellectual Initiative (high-bar coda: one valuable insight or silence) ---
  if (
    intellectualInitiative?.plan?.shouldAdd &&
    intellectualInitiative.plan.chosen &&
    !continuation?.plan?.isShortMessage
  ) {
    const insight = intellectualInitiative.plan.chosen
    out.push(
      makeSuggestion({
        advisor: 'intellectual_initiative',
        slot: 'coda',
        text: intellectualInitiative.plan.writerBrief || '',
        structure: [
          `Prima di chiudere: UNA sola aggiunta ad alto valore (${insight.kind}) — tono “Ecco una cosa interessante…”, 1–3 frasi, mai filler`,
        ],
        confidence: intellectualInitiative.plan.confidence || 0.7,
        baseValue:
          ADVISOR_BASE_VALUE.intellectual_initiative +
          Math.min(1.2, Math.max(0, (insight.score - 3.45) * 1.1)),
        reasons: [`initiative_${insight.kind}`],
      }),
    )
  } else if (
    intellectualInitiative?.plan?.writerBrief &&
    !intellectualInitiative.plan.shouldAdd &&
    !continuation?.plan?.isShortMessage
  ) {
    out.push(
      makeSuggestion({
        advisor: 'intellectual_initiative',
        slot: 'directive',
        text: intellectualInitiative.plan.writerBrief,
        confidence: 0.35,
        baseValue: 2.8,
        reasons: ['initiative_silence_guard'],
      }),
    )
  }

  // --- Surprise Without Confusion (coda: one clear unexpected learning beat) ---
  if (
    surprise?.plan?.shouldSurprise &&
    surprise.plan.chosen &&
    !continuation?.plan?.isShortMessage
  ) {
    const idea = surprise.plan.chosen
    out.push(
      makeSuggestion({
        advisor: 'surprise',
        slot: 'coda',
        text: surprise.plan.writerBrief || '',
        structure: [
          `Dopo il punto chiave: UNA sorpresa chiara (${idea.kind}) che aumenta curiosità e comprensione — facile da seguire, zero hype/trivia`,
        ],
        confidence: surprise.plan.confidence || 0.7,
        baseValue:
          ADVISOR_BASE_VALUE.surprise + Math.min(1.0, Math.max(0, (idea.score - 3.5) * 1.0)),
        reasons: [`surprise_${idea.kind}`],
      }),
    )
  } else if (
    surprise?.plan?.writerBrief &&
    !surprise.plan.shouldSurprise &&
    !continuation?.plan?.isShortMessage
  ) {
    out.push(
      makeSuggestion({
        advisor: 'surprise',
        slot: 'directive',
        text: surprise.plan.writerBrief,
        confidence: 0.35,
        baseValue: 2.6,
        reasons: ['surprise_silence_guard'],
      }),
    )
  }

  // --- Curiosity (coda) ---
  if (curiosity?.plan?.shouldExtend && curiosity.plan.chosen && !continuation?.plan?.isShortMessage) {
    out.push(
      makeSuggestion({
        advisor: 'curiosity',
        slot: 'coda',
        text: curiosity.plan.writerBrief || '',
        structure: [
          `Dopo la risposta: estendi naturalmente con UNA idea curiosità (${curiosity.plan.chosen.kind}) — mai “Anything else?”`,
        ],
        confidence: curiosity.plan.confidence || 0.7,
        baseValue: ADVISOR_BASE_VALUE.curiosity + (curiosity.plan.chosen.score || 0) * 0.3,
        reasons: [`curiosity_${curiosity.plan.chosen.kind}`],
      }),
    )
  } else if (
    curiosity?.plan?.writerBrief &&
    !continuation?.plan?.isShortMessage &&
    !voice?.plan?.active
  ) {
    out.push(
      makeSuggestion({
        advisor: 'curiosity',
        slot: 'directive',
        text: curiosity.plan.writerBrief,
        confidence: 0.4,
        baseValue: 3,
        reasons: ['curiosity_soft_closer_guard'],
      }),
    )
  }

  // --- Momentum (coda competitor) ---
  if (
    !continuation?.plan?.isShortMessage &&
    momentum?.plan?.writerBrief &&
    !(voice?.plan?.active && (voice.plan.interruptKind !== 'none' || voice.plan.incompleteUtterance))
  ) {
    if (momentum.plan.shouldContinue) {
      out.push(
        makeSuggestion({
          advisor: 'momentum',
          slot: 'coda',
          text: momentum.plan.writerBrief,
          structure: [
            voice?.plan?.active
              ? `Prima di chiudere: al massimo UNA coda parlata brevissima (${momentum.plan.continuationKind})`
              : `Prima di chiudere: UNA continuazione concisa di qualità (${momentum.plan.continuationKind}) — non allungare a vuoto`,
          ],
          confidence: momentum.plan.confidence || 0.65,
          baseValue: ADVISOR_BASE_VALUE.momentum + (momentum.plan.shouldContinue ? 0.8 : 0),
          reasons: [`momentum_${momentum.plan.continuationKind}`],
        }),
      )
    } else {
      out.push(
        makeSuggestion({
          advisor: 'momentum',
          slot: 'directive',
          text: momentum.plan.writerBrief,
          confidence: momentum.plan.confidence || 0.6,
          baseValue: 4,
          reasons: ['momentum_natural_end'],
        }),
      )
    }
  }

  // --- Multi-step / Action ---
  if (multiStep?.plan?.active && multiStep.plan.writerBrief) {
    out.push(
      makeSuggestion({
        advisor: 'multi_step',
        slot: 'structure',
        structure: [
          'Apri con cosa stai preparando / l’obiettivo in una frase',
          'Riassumi i passi utili in ordine naturale (senza jargon da planner)',
          'Se qualcosa non è riuscito o manca un connettore: dillo in una frase e continua',
          multiStep.results?.some((r) => r.status === 'blocked')
            ? 'Chiedi UNA conferma chiara solo per i passi in attesa'
            : 'Chiudi con il prossimo passo concreto per l’utente',
          `Obiettivo reale da servire: ${plan.realGoal}`,
        ],
        text: multiStep.plan.writerBrief,
        confidence: 0.95,
        baseValue: 9.8,
        reasons: ['multi_step_active'],
      }),
    )
    out.push(
      makeSuggestion({
        advisor: 'multi_step',
        slot: 'directive',
        text: multiStep.plan.writerBrief,
        confidence: 0.95,
        reasons: ['multi_step_brief'],
      }),
    )
  } else if (actionEngine?.plan?.actionRequired && actionEngine.plan.writerBrief) {
    /** @type {string[]} */
    let structure = []
    if (actionEngine.plan.phase === 'awaiting_confirmation') {
      structure = [
        'Riassumi l’azione proposta in una frase chiara',
        'Chiedi conferma breve (sì/no) — non eseguire ancora',
        `Obiettivo reale da servire: ${plan.realGoal}`,
      ]
    } else {
      structure = [
        'Spiega l’esito dell’azione in modo naturale (senza jargon)',
        actionEngine.plan.phase === 'unavailable'
          ? 'Offri un’alternativa utile finché l’integrazione non è collegata'
          : 'Conferma cosa è successo / cosa non è stato fatto',
        `Obiettivo reale da servire: ${plan.realGoal}`,
      ]
    }
    out.push(
      makeSuggestion({
        advisor: 'action',
        slot: 'structure',
        structure,
        text: actionEngine.plan.writerBrief,
        confidence: 0.92,
        baseValue: 9.4,
        reasons: [`action_${actionEngine.plan.phase}`],
      }),
    )
    out.push(
      makeSuggestion({
        advisor: 'action',
        slot: 'directive',
        text: actionEngine.plan.writerBrief,
        confidence: 0.92,
        reasons: ['action_brief'],
      }),
    )
  }

  // --- Reflection (soft directive) ---
  if (reflection?.signals?.directive) {
    out.push(
      makeSuggestion({
        advisor: 'reflection',
        slot: 'directive',
        text: reflection.signals.directive,
        confidence: 0.45,
        baseValue: 3,
        reasons: ['reflection_learn'],
      }),
    )
  }

  // --- Default tool selection from plan ---
  if (Array.isArray(plan?.toolOrder)) {
    out.push(
      makeSuggestion({
        advisor: 'tool_selection',
        slot: 'tools',
        tools: [...plan.toolOrder],
        confidence: 0.5,
        baseValue: 4,
        reasons: ['core_tools'],
      }),
    )
  }

  return out.filter((s) => s.active !== false)
}

/**
 * Assemble writer directive + structure from accepted suggestions.
 * @param {object} input
 * @returns {CoordinationDecision}
 */
export function runCognitiveCoordinator(input) {
  const plan = input.plan
  const collected = Array.isArray(input.suggestions)
    ? input.suggestions
    : collectAdvisorSuggestions(input)

  const ranked = rankSuggestions(collected)
  const deduped = dedupeSuggestions(ranked)
  const { accepted, rejected, winnersBySlot, styleAccepted, directiveAccepted } =
    resolveConflicts(deduped, {
      continuation: input.continuation?.plan || input.continuation || null,
      voice: input.voice?.plan || input.voice || null,
      multiStep: input.multiStep?.plan || input.multiStep || null,
      action: input.actionEngine?.plan || input.action || null,
      automation: input.automationBuilder?.plan || input.automation || null,
      topicLeadership: input.topicLeadership?.plan || input.topicLeadership || null,
      feedbackInterpretation:
        input.feedbackInterpretation?.plan || input.feedbackInterpretation || null,
      warmConversation: input.warmConversation?.plan || input.warmConversation || null,
    })

  // Structure: opening wins over structure when both present (short/voice turns)
  const opening = winnersBySlot.opening
  const structureWinner = opening || winnersBySlot.structure
  /** @type {string[]} */
  let responseStructure = structureWinner?.structure
    ? [...structureWinner.structure]
    : [...(input.baseStructure || plan?.responseStructure || [])]

  // Attach at most one coda line
  const coda = winnersBySlot.coda
  if (coda?.structure?.length) {
    for (const line of coda.structure.slice(0, MAX_CODA)) {
      if (!responseStructure.includes(line)) responseStructure.push(line)
    }
  } else if (coda?.text && !responseStructure.some((l) => /curiosità|prima di chiudere|ponte naturale/i.test(l))) {
    responseStructure.push(coda.text)
  }

  responseStructure = responseStructure.filter(Boolean).slice(0, MAX_STRUCTURE_STEPS)

  // Tools
  const toolSuggestions = accepted.filter((s) => s.slot === 'tools' && Array.isArray(s.tools))
  let toolOrder = plan?.toolOrder ? [...plan.toolOrder] : []
  let webOff = false
  if (toolSuggestions.length) {
    // Highest-ranked tool suggestion wins as base; merge uniques from others with same webOff
    const primary = toolSuggestions[0]
    toolOrder = [...(primary.tools || [])]
    webOff = Boolean(primary.webOff)
    for (const ts of toolSuggestions.slice(1)) {
      if (ts.webOff) webOff = true
      for (const t of ts.tools || []) {
        if (!toolOrder.includes(t)) toolOrder.push(t)
      }
    }
  }
  if (webOff) toolOrder = toolOrder.filter((t) => t !== 'web')

  const skipMemory = Boolean(winnersBySlot.memory_policy?.skipMemory)
  if (skipMemory) toolOrder = toolOrder.filter((t) => t !== 'memory')

  const ALL = ['memory', 'web', 'vision', 'document', 'calculator', 'weather', 'calendar', 'reminder']
  const toolsSkipped = ALL.filter((t) => !toolOrder.includes(t))

  const realGoal = winnersBySlot.goal?.goal || plan?.realGoal || null

  // --- Insight Discovery stage (inside Coordinator, before final Writer handoff) ---
  // ONE unexpected but highly relevant connection — or silence. Never invent / force.
  const insightDiscovery = runInsightDiscoveryStage({
    plan,
    userMessage: input.userMessage || plan?.userMessage || '',
    session: input.session || input.conversation?.memory || null,
    continuation: input.continuation?.plan || input.continuation || null,
    voice: input.voice?.plan || input.voice || null,
    multiStep: input.multiStep?.plan || input.multiStep || null,
    action: input.actionEngine?.plan || input.action || null,
    automation: input.automationBuilder?.plan || input.automation || null,
    topicLeadership: input.topicLeadership?.plan || input.topicLeadership || null,
    codaAdvisor: coda?.advisor || null,
    realGoal,
  })

  if (insightDiscovery.found && insightDiscovery.structureLine) {
    if (!responseStructure.some((l) => /insight discovery|connessione inattesa/i.test(l))) {
      responseStructure.push(insightDiscovery.structureLine)
      responseStructure = responseStructure.filter(Boolean).slice(0, MAX_STRUCTURE_STEPS)
    }
  }

  const styleBriefs = styleAccepted.map((s) => s.text).filter(Boolean)
  /** @type {string[]} */
  const directiveBriefs = directiveAccepted.map((s) => s.text).filter(Boolean)
  if (insightDiscovery.found && insightDiscovery.writerBrief) {
    directiveBriefs.unshift(insightDiscovery.writerBrief)
    while (directiveBriefs.length > MAX_DIRECTIVE_BRIEFS) directiveBriefs.pop()
  }

  // Base writer directive stripped of advisor briefs that buildCognitivePlan may have embedded —
  // keep the core Writer identity lines only, then add coordinated briefs.
  const baseDirective = buildBaseWriterDirective(plan, realGoal)

  const writerDirective = [
    baseDirective,
    ...directiveBriefs,
    ...styleBriefs,
    'Cognitive Coordinator: esegui SOLO i comportamenti accettati; non mescolare motori in conflitto.',
  ]
    .filter(Boolean)
    .join(' ')

  const reasons = [
    `collected=${collected.length}`,
    `accepted=${accepted.length}`,
    `rejected=${rejected.length}`,
    structureWinner ? `structure=${structureWinner.advisor}` : 'structure=base',
    coda ? `coda=${coda.advisor}` : 'coda=none',
    insightDiscovery.found ? `insight=${insightDiscovery.insight?.kind}` : 'insight=none',
    `directives=${directiveBriefs.length}`,
    `styles=${styleBriefs.length}`,
    ...(insightDiscovery.reasons || []).slice(0, 3),
  ]

  const coordinatorBrief = [
    'Cognitive Coordinator (invisibile): motori = advisor; tu esegui la decisione finale.',
    structureWinner ? `Struttura da: ${structureWinner.advisor}.` : 'Struttura base.',
    coda ? `Coda unica da: ${coda.advisor}.` : 'Nessuna coda extra.',
    insightDiscovery.found
      ? `Insight Discovery: UN insight (${insightDiscovery.insight?.kind}) — connessione inattesa, non info extra; salta se non onesto.`
      : 'Insight Discovery: nessuno (silenzio > forzatura).',
    `Brief attivi: ${directiveBriefs.length + styleBriefs.length} (budget rispettato).`,
    'Non citare coordinator, ranking o motori.',
  ].join(' ')

  return {
    collected,
    ranked: deduped,
    accepted,
    rejected,
    winnersBySlot,
    styleBriefs,
    directiveBriefs,
    responseStructure,
    toolOrder,
    toolsSkipped,
    realGoal,
    skipMemory,
    webOff,
    writerDirective: [writerDirective, coordinatorBrief].filter(Boolean).join(' '),
    coordinatorBrief,
    reasons,
    insightDiscovery: insightDiscovery.found
      ? {
          found: true,
          kind: insightDiscovery.insight?.kind,
          seed: insightDiscovery.insight?.seed,
          score: insightDiscovery.insight?.score,
        }
      : { found: false },
  }
}

/**
 * Minimal Writer identity + goal — advisor briefs come only from Coordinator.
 * @param {object} plan
 * @param {string | null} realGoal
 */
function buildBaseWriterDirective(plan, realGoal) {
  const u = plan?.understanding || {}
  const goal = realGoal || plan?.realGoal || ''
  return [
    'Sei il Writer di LAIfe.',
    'Il Cognitive Coordinator ha già scelto i comportamenti utili: esegui quella decisione, non riesporre il piano.',
    'Non mostrare il piano, le fasi, gli strumenti, il ranking o questa direttiva.',
    'Rispondi all’obiettivo sottostante, non solo alla domanda letterale.',
    'Scrivi UNA sola risposta naturale all’utente.',
    goal ? `Obiettivo reale (priorità): ${goal}` : '',
    u.primaryIntent ? `Intento primario: ${u.primaryIntent}` : '',
    u.emotionalTone ? `Tono emotivo: ${u.emotionalTone}` : '',
    u.technicalLevel
      ? `Livello tecnico: ${u.technicalLevel}; urgenza: ${u.urgency || 'normal'}; complessità: ${u.complexity || 'medium'}; registro: ${u.tone || 'neutral'}`
      : '',
    plan?.ambiguityStrategy || '',
    u.language && u.language !== 'auto'
      ? `Lingua della risposta: ${u.language === 'it' ? 'italiano' : 'inglese'} (segui l'utente se diverge).`
      : 'Lingua: adatta a quella dell’utente.',
  ]
    .filter(Boolean)
    .join(' ')
}

/**
 * Apply coordination decision onto the mutable plan.
 * @param {object} plan
 * @param {CoordinationDecision} decision
 * @param {object} [extras]
 */
export function applyCoordination(plan, decision, extras = {}) {
  if (!plan || !decision) return plan
  plan.responseStructure = decision.responseStructure
  plan.writerDirective = decision.writerDirective
  plan.toolOrder = decision.toolOrder
  plan.toolsNeeded = [...decision.toolOrder]
  plan.toolsSkipped = decision.toolsSkipped
  if (decision.realGoal) plan.realGoal = decision.realGoal
  if (decision.webOff && plan.webDecision) {
    plan.webDecision = { needed: false, reason: 'coordinator: follow-up / short — niente web' }
  }
  if (extras.pendingAction) plan.pendingAction = extras.pendingAction
  plan.coordination = {
    accepted: decision.accepted.map((s) => ({
      advisor: s.advisor,
      slot: s.slot,
      id: s.id,
    })),
    rejected: decision.rejected.map((s) => ({
      advisor: s.advisor,
      slot: s.slot,
      reason: (s.reasons || []).slice(-1)[0] || 'rejected',
    })),
    winners: Object.fromEntries(
      Object.entries(decision.winnersBySlot)
        .filter(([, v]) => v)
        .map(([k, v]) => [k, v.advisor]),
    ),
    reasons: decision.reasons,
    insightDiscovery: decision.insightDiscovery || { found: false },
  }
  return plan
}

/**
 * Format coordinator block for Writer context (invisible).
 * @param {CoordinationDecision} decision
 */
export function formatCoordinatorForWriter(decision) {
  if (!decision) return ''
  const accepted =
    decision.accepted
      ?.slice(0, 12)
      .map((s) => `- ${s.advisor}/${s.slot}`)
      .join('\n') || '- (none)'
  const rejected =
    decision.rejected
      ?.slice(0, 8)
      .map((s) => `- ${s.advisor}/${s.slot}: ${(s.reasons || []).slice(-1)[0] || '—'}`)
      .join('\n') || '- (none)'

  return `══════════════════════════════════════
COGNITIVE COORDINATOR (INVISIBILE)
══════════════════════════════════════
I motori cognitivi sono advisor. Questa è la decisione finale.
Accettati:
${accepted}
Scartati / in conflitto:
${rejected}
Insight Discovery: ${
    decision.insightDiscovery?.found
      ? `UN insight (${decision.insightDiscovery.kind}) — connessione inattesa, non informazione extra; salta se non onesto.`
      : 'nessuno (silenzio > forzatura; mai inventare).'
  }
${decision.coordinatorBrief}
NON citare il coordinator. Scrivi solo la risposta all’utente.`.trim()
}
