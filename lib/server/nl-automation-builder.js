/**
 * LAIfe Natural Language Automation Builder
 *
 * Users create automations by describing them in natural language.
 *
 * Examples:
 * - "When I arrive home, turn on the lights."
 * - "If tomorrow is sunny, start the washing machine at noon."
 * - "When my phone reaches 20% battery, remind me to charge it."
 *
 * Automatically detect: triggers · conditions · actions
 * Generate an editable automation draft.
 * Explain it clearly — never enable until the user confirms.
 *
 * Invisible. Fail-soft. No hard-coded platform brands.
 */

/**
 * @typedef {'location'|'time'|'weather'|'battery'|'calendar'|'device'|'manual'|'unknown'} TriggerType
 */

/**
 * @typedef {'weather'|'time'|'day'|'battery'|'presence'|'logical'|'unknown'} ConditionType
 */

/**
 * @typedef {'smart_home'|'appliance'|'reminder'|'notification'|'climate'|'scene'|'message'|'unknown'} ActionCategory
 */

/**
 * @typedef {object} AutomationTrigger
 * @property {string} id
 * @property {TriggerType} type
 * @property {string} label
 * @property {Record<string, unknown>} params
 */

/**
 * @typedef {object} AutomationCondition
 * @property {string} id
 * @property {ConditionType} type
 * @property {string} label
 * @property {Record<string, unknown>} params
 */

/**
 * @typedef {object} AutomationAction
 * @property {string} id
 * @property {ActionCategory} category
 * @property {string} capability
 * @property {string} label
 * @property {Record<string, unknown>} params
 */

/**
 * @typedef {object} AutomationDraft
 * @property {string} id
 * @property {string} name
 * @property {string} description
 * @property {boolean} enabled
 * @property {'draft'|'awaiting_confirmation'|'enabled'|'cancelled'|'needs_edit'} status
 * @property {boolean} editable
 * @property {AutomationTrigger[]} triggers
 * @property {AutomationCondition[]} conditions
 * @property {AutomationAction[]} actions
 * @property {string} explanation
 * @property {string} naturalSummary
 * @property {string[]} missing
 * @property {number} confidence
 * @property {string} sourceUtterance
 * @property {number} createdAt
 */

/**
 * @typedef {object} AutomationBuilderPlan
 * @property {boolean} active
 * @property {'idle'|'draft'|'awaiting_confirmation'|'enabled'|'cancelled'|'needs_edit'} phase
 * @property {AutomationDraft | null} automation
 * @property {object | null} pendingAutomationPayload
 * @property {string} writerBrief
 * @property {string[]} structureHints
 * @property {string[]} reasons
 * @property {'high'|'medium'|'low'} confidence
 */

const AUTOMATION_INTENT =
  /\b(automatizz|automation|automazione|crea\s+(un['’]?\s*)?(automat|routine|scena)|quando\s+(arrivo|entro|esco|raggiungo|il\s+telefono|la\s+batteria|my\s+phone)|when\s+i\s+(arrive|get\s+home|leave|reach)|when\s+my\s+(phone|battery)|if\s+(tomorrow|it\s+is|the\s+weather)|se\s+(domani|il\s+tempo|fa\s+sole|piove)|ogni\s+volta\s+che|every\s+time\s+(i|that)|remind\s+me\s+to\s+charge|ricordami\s+di\s+caricare)\b/i

const CONFIRM_ENABLE =
  /^(s[iì]|yes|yep|ok|okay|confermo|conferma|attiva|abilita|enable|activate|falle?|procedi|vai|do\s+it|go\s+ahead|va\s+bene\s+cos[iì]|perfetto)([\s!,.]|$)/i

const CONFIRM_CANCEL =
  /^(no|annulla|cancel|stop|non\s+(attivare|abilitare|farlo)|don't|do\s+not|lascia\s+perdere)([\s!,.]|$)/i

const WANT_EDIT =
  /\b(modifica|cambia|edit|instead|piuttosto|anzi|non\s+le\s+luci|not\s+the\s+lights|aggiungi|remove|togli)\b/i

/**
 * @param {string} text
 */
function normalize(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * @param {string} prefix
 */
function id(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`
}

/**
 * Split utterance into trigger/condition clause and action clause.
 * @param {string} text
 * @returns {{ whenPart: string, actionPart: string }}
 */
function splitWhenThen(text) {
  const t = normalize(text)

  // Italian: quando/se … , … / … allora …
  let m = t.match(
    /^(?:automatizza[:\s]+|crea\s+(?:un['’]?\s*)?(?:automazione|routine)[:\s]+)?(?:quando|se)\s+(.+?)(?:,|\s+allora\s+)(.+)$/i,
  )
  if (m) return { whenPart: m[1].trim(), actionPart: m[2].trim() }

  // English: when/if … , … / … then …
  m = t.match(
    /^(?:create\s+(?:an?\s+)?(?:automation|routine)[:\s]+)?(?:when|if)\s+(.+?)(?:,|\s+then\s+)(.+)$/i,
  )
  if (m) return { whenPart: m[1].trim(), actionPart: m[2].trim() }

  // every time …
  m = t.match(/^(?:ogni\s+volta\s+che|every\s+time\s+(?:that\s+|i\s+)?)\s*(.+?)(?:,|\s+)(.+)$/i)
  if (m) return { whenPart: m[1].trim(), actionPart: m[2].trim() }

  // Fallback: try comma split after first clause
  const comma = t.indexOf(',')
  if (comma > 8 && AUTOMATION_INTENT.test(t.slice(0, comma))) {
    return {
      whenPart: t.slice(0, comma).replace(/^(quando|se|when|if)\s+/i, '').trim(),
      actionPart: t.slice(comma + 1).trim(),
    }
  }

  return { whenPart: t, actionPart: '' }
}

/**
 * @param {string} whenPart
 * @param {string} full
 * @returns {{ triggers: AutomationTrigger[], conditions: AutomationCondition[] }}
 */
function parseTriggersAndConditions(whenPart, full) {
  /** @type {AutomationTrigger[]} */
  const triggers = []
  /** @type {AutomationCondition[]} */
  const conditions = []
  const w = normalize(whenPart)
  const all = normalize(`${whenPart} ${full}`)

  // Arrival home
  if (
    /\b(arrivo\s+a\s+casa|entro\s+in\s+casa|torno\s+a\s+casa|arrive\s+(home|at\s+home)|get\s+home|arriving\s+home)\b/i.test(
      w,
    )
  ) {
    triggers.push({
      id: id('trg'),
      type: 'location',
      label: 'Arrivo a casa',
      params: { place: 'home', event: 'enter' },
    })
  }

  // Leave home
  if (/\b(esco\s+di\s+casa|lascio\s+casa|leave\s+home|leaving\s+home)\b/i.test(w)) {
    triggers.push({
      id: id('trg'),
      type: 'location',
      label: 'Uscita da casa',
      params: { place: 'home', event: 'exit' },
    })
  }

  // Battery threshold
  const batt = w.match(
    /\b(?:batteria|battery|phone)\b.*?\b(?:raggiunge|scende|under|below|reaches|at|al)\s*(\d{1,3})\s*%?/i,
  ) || w.match(/\b(\d{1,3})\s*%\s*(?:di\s+)?batteria\b/i)
  if (batt || /\b(batteria|battery).*(caricare|charge)\b/i.test(all)) {
    const pct = batt ? Number(batt[1]) : 20
    triggers.push({
      id: id('trg'),
      type: 'battery',
      label: `Batteria al ${pct}%`,
      params: { percent: pct, comparator: 'lte' },
    })
  }

  // Time of day (noon, ore X, at HH:MM)
  const timeMatch =
    w.match(/\b(?:alle?\s*|at\s*)(\d{1,2})(?::(\d{2}))?\b/i) ||
    w.match(/\b(mezzogiorno|noon|mezzanotte|midnight|mattina|morning|sera|evening)\b/i)
  if (timeMatch) {
    let hour = 12
    let minute = 0
    let label = 'A un orario specifico'
    if (/mezzogiorno|noon/i.test(timeMatch[0])) {
      hour = 12
      label = 'A mezzogiorno'
    } else if (/mezzanotte|midnight/i.test(timeMatch[0])) {
      hour = 0
      label = 'A mezzanotte'
    } else if (/mattina|morning/i.test(timeMatch[0])) {
      hour = 8
      label = 'Di mattina (~08:00)'
    } else if (/sera|evening/i.test(timeMatch[0])) {
      hour = 20
      label = 'Di sera (~20:00)'
    } else {
      hour = Number(timeMatch[1])
      minute = timeMatch[2] ? Number(timeMatch[2]) : 0
      label = `Alle ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
    }
    triggers.push({
      id: id('trg'),
      type: 'time',
      label,
      params: { hour, minute, timezone: 'local' },
    })
  }

  // Tomorrow / day condition
  if (/\b(domani|tomorrow)\b/i.test(all)) {
    conditions.push({
      id: id('cnd'),
      type: 'day',
      label: 'Solo domani',
      params: { relativeDay: 'tomorrow' },
    })
  }

  // Weather as condition (sunny / rainy) — often paired with time trigger
  if (/\b(sole|soleggiato|sunny|sereno|clear\s+sky)\b/i.test(w) || /\b(se\s+.*sole|if\s+.*sunny)\b/i.test(all)) {
    conditions.push({
      id: id('cnd'),
      type: 'weather',
      label: 'Se è soleggiato',
      params: { condition: 'sunny' },
    })
    // If only weather + time, weather can also be a soft trigger via daily check
    if (!triggers.some((t) => t.type === 'time')) {
      triggers.push({
        id: id('trg'),
        type: 'weather',
        label: 'Controllo meteo giornaliero',
        params: { condition: 'sunny', check: 'daily' },
      })
    }
  }
  if (/\b(piove|pioggia|rainy|raining)\b/i.test(w)) {
    conditions.push({
      id: id('cnd'),
      type: 'weather',
      label: 'Se piove',
      params: { condition: 'rain' },
    })
  }

  // Calendar event start
  if (/\b(riunione|meeting|appuntamento|evento)\b/i.test(w) && /\b(inizia|starts|prima\s+di)\b/i.test(w)) {
    triggers.push({
      id: id('trg'),
      type: 'calendar',
      label: 'Prima di un evento in calendario',
      params: { offsetMinutes: 15 },
    })
  }

  if (triggers.length === 0) {
    triggers.push({
      id: id('trg'),
      type: 'unknown',
      label: 'Trigger da precisare',
      params: { raw: w },
    })
  }

  return { triggers, conditions }
}

/**
 * @param {string} actionPart
 * @param {string} full
 * @returns {AutomationAction[]}
 */
function parseActions(actionPart, full) {
  /** @type {AutomationAction[]} */
  const actions = []
  const a = normalize(actionPart || full)

  // Lights on/off
  if (/\b(accendi|turn\s+on|switch\s+on).{0,40}\b(luc[ei]|light|lights|lampad)/i.test(a) ||
      /\b(luc[ei]|lights).{0,20}\b(accendi|on)\b/i.test(a) ||
      /\b(turn\s+on\s+the\s+lights|accendi\s+le\s+luci)\b/i.test(a)) {
    actions.push({
      id: id('act'),
      category: 'smart_home',
      capability: 'set',
      label: 'Accendere le luci',
      params: { device: 'lights', power: 'on' },
    })
  }
  if (/\b(spegni|turn\s+off).{0,40}\b(luc[ei]|light|lights)\b/i.test(a)) {
    actions.push({
      id: id('act'),
      category: 'smart_home',
      capability: 'set',
      label: 'Spegnere le luci',
      params: { device: 'lights', power: 'off' },
    })
  }

  // Washing machine / dishwasher / dryer
  if (/\b(lavatrice|washing\s+machine|washer)\b/i.test(a)) {
    const start = /\b(avvia|accendi|start|parti)\b/i.test(a) || /\bstart\s+the\s+washing\b/i.test(a)
    actions.push({
      id: id('act'),
      category: 'appliance',
      capability: start ? 'start' : 'set',
      label: start ? 'Avviare la lavatrice' : 'Controllare la lavatrice',
      params: { appliance: 'washing_machine', power: 'on' },
    })
  }
  if (/\b(lavastoviglie|dishwasher)\b/i.test(a)) {
    actions.push({
      id: id('act'),
      category: 'appliance',
      capability: 'start',
      label: 'Avviare la lavastoviglie',
      params: { appliance: 'dishwasher', power: 'on' },
    })
  }

  // Reminder / notify charge
  if (/\b(ricordami|remind\s+me|promemoria|notify|avvisami)\b/i.test(a) ||
      /\b(caricare|charge)\b/i.test(a)) {
    const aboutCharge = /\b(caricare|charge|batteria|battery)\b/i.test(`${a} ${full}`)
    actions.push({
      id: id('act'),
      category: 'reminder',
      capability: 'create',
      label: aboutCharge
        ? 'Promemoria: carica il telefono'
        : 'Inviare un promemoria',
      params: {
        title: aboutCharge ? 'Carica il telefono' : normalize(a).slice(0, 80),
        channel: 'notification',
      },
    })
  }

  // Thermostat
  if (/\b(termostato|thermostat|riscaldamento|heating|climatizzatore|ac)\b/i.test(a)) {
    const temp = a.match(/\b(\d{2})\s*°?\s*c?\b/i)
    actions.push({
      id: id('act'),
      category: 'climate',
      capability: 'set',
      label: temp
        ? `Impostare clima a ${temp[1]}°C`
        : 'Regolare termostato/clima',
      params: { temperatureC: temp ? Number(temp[1]) : undefined },
    })
  }

  // Generic scene
  if (/\b(scena|scene|routine\s+buongiorno|good\s+morning\s+routine)\b/i.test(a)) {
    actions.push({
      id: id('act'),
      category: 'scene',
      capability: 'scene',
      label: 'Avviare una scena/routine',
      params: { scene: normalize(a).slice(0, 60) },
    })
  }

  if (actions.length === 0 && a) {
    actions.push({
      id: id('act'),
      category: 'unknown',
      capability: 'invoke',
      label: `Azione da precisare: ${a.slice(0, 60)}`,
      params: { raw: a },
    })
  }

  return actions
}

/**
 * @param {AutomationTrigger[]} triggers
 * @param {AutomationCondition[]} conditions
 * @param {AutomationAction[]} actions
 */
function buildName(triggers, conditions, actions) {
  const t = triggers[0]?.label || 'Evento'
  const a = actions[0]?.label || 'azione'
  const c = conditions[0] ? ` (${conditions[0].label})` : ''
  return `${t} → ${a}${c}`.slice(0, 80)
}

/**
 * @param {AutomationDraft} draft
 */
function buildExplanation(draft) {
  const triggerLines = draft.triggers.map((t) => `• Trigger: ${t.label}`).join('\n')
  const conditionLines =
    draft.conditions.length > 0
      ? draft.conditions.map((c) => `• Condizione: ${c.label}`).join('\n')
      : '• Condizioni: nessuna (si attiva al trigger)'
  const actionLines = draft.actions.map((a) => `• Azione: ${a.label}`).join('\n')

  return [
    `Ho preparato un’automazione modificabile: «${draft.name}».`,
    '',
    triggerLines,
    conditionLines,
    actionLines,
    '',
    draft.naturalSummary,
    '',
    'Non l’ho ancora attivata. Vuoi abilitarla così, modificarla, o annullare?',
  ].join('\n')
}

/**
 * @param {AutomationDraft} draft
 */
function buildNaturalSummary(draft) {
  const when = draft.triggers.map((t) => t.label.toLowerCase()).join(' e ')
  const ifs =
    draft.conditions.length > 0
      ? `, solo se ${draft.conditions.map((c) => c.label.toLowerCase()).join(' e ')}`
      : ''
  const then = draft.actions.map((a) => a.label.toLowerCase()).join(' e ')
  return `In pratica: quando ${when}${ifs}, allora ${then}.`
}

/**
 * @param {string} userMessage
 * @returns {AutomationDraft | null}
 */
export function parseAutomationFromNaturalLanguage(userMessage) {
  const text = normalize(userMessage)
  if (!text || !AUTOMATION_INTENT.test(text)) return null

  const { whenPart, actionPart } = splitWhenThen(text)
  const { triggers, conditions } = parseTriggersAndConditions(whenPart || text, text)
  const actions = parseActions(actionPart, text)

  /** @type {string[]} */
  const missing = []
  if (triggers.some((t) => t.type === 'unknown')) missing.push('trigger')
  if (actions.length === 0 || actions.some((a) => a.category === 'unknown')) missing.push('action')

  let confidence = 0.55
  if (!missing.includes('trigger')) confidence += 0.2
  if (!missing.includes('action')) confidence += 0.2
  if (conditions.length > 0) confidence += 0.05
  if (triggers.length && actions.length && !missing.length) confidence = Math.min(0.95, confidence + 0.05)

  const draft = {
    id: id('auto'),
    name: '',
    description: text.slice(0, 200),
    enabled: false,
    status: /** @type {const} */ ('draft'),
    editable: true,
    triggers,
    conditions,
    actions,
    explanation: '',
    naturalSummary: '',
    missing,
    confidence,
    sourceUtterance: text,
    createdAt: Date.now(),
  }
  draft.name = buildName(triggers, conditions, actions)
  draft.naturalSummary = buildNaturalSummary(draft)
  draft.explanation = buildExplanation(draft)
  if (missing.length) {
    draft.status = 'needs_edit'
    draft.explanation += `\n\nMi manca ancora chiarezza su: ${missing.join(', ')}. Dimmi come vuoi aggiustarlo.`
  } else {
    draft.status = 'awaiting_confirmation'
  }
  return draft
}

/**
 * @param {AutomationDraft} draft
 */
function buildWriterBrief(draft) {
  const lines = [
    'NATURAL LANGUAGE AUTOMATION BUILDER (invisibile):',
    `Fase: ${draft.status}. enabled=${draft.enabled} (mai true senza conferma utente).`,
    `Draft editabile «${draft.name}» (id ${draft.id}).`,
    `Trigger: ${draft.triggers.map((t) => t.label).join(' · ') || '—'}`,
    `Condizioni: ${draft.conditions.map((c) => c.label).join(' · ') || 'nessuna'}`,
    `Azioni: ${draft.actions.map((a) => a.label).join(' · ') || '—'}`,
    draft.naturalSummary,
    'Spiega l’automazione in modo chiaro e umano PRIMA di abilitarla.',
    'Chiedi conferma esplicita (attiva / modifica / annulla). Non attivare da solo.',
    'Non citare il builder, JSON interno, o id tecnici salvo richiesta.',
  ]
  if (draft.missing.length) {
    lines.push(`Parti mancanti da chiarire: ${draft.missing.join(', ')}.`)
  }
  return lines.join(' ')
}

/**
 * @param {AutomationDraft} draft
 */
function structureHintsFor(draft) {
  if (draft.status === 'needs_edit') {
    return [
      'Riassumi cosa hai capito dell’automazione',
      `Chiedi chiarimento su: ${draft.missing.join(', ') || 'dettagli mancanti'}`,
      'Offri di riscrivere trigger, condizioni o azioni',
      'Non abilitare nulla',
    ]
  }
  if (draft.status === 'enabled') {
    return [
      'Conferma che l’automazione è ora attiva',
      'Ripeti in una frase cosa farà',
      'Ricorda che può modificarla o disattivarla quando vuole',
    ]
  }
  if (draft.status === 'cancelled') {
    return [
      'Conferma che non hai attivato nulla',
      'Offri di riprovare con una descrizione diversa se vuole',
    ]
  }
  return [
    'Spiega l’automazione creata (trigger → condizioni → azioni) in linguaggio naturale',
    'Mostra che è modificabile',
    'Chiedi esplicitamente: attivare / modificare / annullare',
    'Non abilitare finché non conferma',
  ]
}

/**
 * @param {unknown} raw
 * @returns {AutomationDraft | null}
 */
export function sanitizePendingAutomation(raw) {
  if (!raw || typeof raw !== 'object') return null
  const p = /** @type {Record<string, unknown>} */ (raw)
  if (typeof p.id !== 'string' || !Array.isArray(p.triggers) || !Array.isArray(p.actions)) {
    return null
  }
  return /** @type {AutomationDraft} */ ({
    ...p,
    enabled: false,
    editable: true,
    status:
      p.status === 'awaiting_confirmation' ||
      p.status === 'needs_edit' ||
      p.status === 'draft'
        ? p.status
        : 'awaiting_confirmation',
  })
}

/**
 * Run Natural Language Automation Builder.
 *
 * @param {object} input
 * @param {string} input.userMessage
 * @param {Array<{ role?: string, content?: string }>} [input.messages]
 * @param {object | null} [input.pendingAutomation]
 * @returns {{ plan: AutomationBuilderPlan, context: string }}
 */
export function runNaturalLanguageAutomationBuilder(input = {}) {
  try {
    const userMessage = normalize(input.userMessage)
    const pending = sanitizePendingAutomation(input.pendingAutomation)

    // Confirmation / cancel / edit on pending draft
    if (pending && userMessage) {
      if (CONFIRM_CANCEL.test(userMessage)) {
        const cancelled = {
          ...pending,
          enabled: false,
          status: /** @type {const} */ ('cancelled'),
        }
        const plan = {
          active: true,
          phase: /** @type {const} */ ('cancelled'),
          automation: cancelled,
          pendingAutomationPayload: null,
          writerBrief:
            'AUTOMATION BUILDER: l’utente ha annullato. Conferma che nulla è stato attivato. Non citare il builder.',
          structureHints: structureHintsFor(cancelled),
          reasons: ['user_cancelled'],
          confidence: /** @type {const} */ ('high'),
        }
        return { plan, context: formatAutomationBuilderForWriter(plan) }
      }

      if (WANT_EDIT.test(userMessage) && !CONFIRM_ENABLE.test(userMessage)) {
        // Try to re-parse a fuller description; else mark needs_edit
        const rebuilt = parseAutomationFromNaturalLanguage(userMessage)
        const draft = rebuilt || {
          ...pending,
          status: /** @type {const} */ ('needs_edit'),
          enabled: false,
          explanation:
            pending.explanation +
            '\n\nDimmi cosa vuoi cambiare (trigger, condizione o azione) e aggiorno la bozza.',
        }
        if (rebuilt) {
          draft.status = rebuilt.missing.length ? 'needs_edit' : 'awaiting_confirmation'
        }
        const plan = {
          active: true,
          phase: draft.status,
          automation: draft,
          pendingAutomationPayload: {
            ...draft,
            enabled: false,
          },
          writerBrief: buildWriterBrief(draft),
          structureHints: structureHintsFor(draft),
          reasons: ['user_edit'],
          confidence: /** @type {const} */ ('medium'),
        }
        return { plan, context: formatAutomationBuilderForWriter(plan) }
      }

      if (CONFIRM_ENABLE.test(userMessage) && pending.missing?.length === 0) {
        const enabled = {
          ...pending,
          enabled: true,
          status: /** @type {const} */ ('enabled'),
        }
        const plan = {
          active: true,
          phase: /** @type {const} */ ('enabled'),
          automation: enabled,
          pendingAutomationPayload: null,
          writerBrief: [
            'AUTOMATION BUILDER: l’utente ha confermato.',
            `Automazione «${enabled.name}» ora enabled=true.`,
            'Conferma in linguaggio naturale cosa farà. Non citare JSON/id.',
            buildNaturalSummary(enabled),
          ].join(' '),
          structureHints: structureHintsFor(enabled),
          reasons: ['user_enabled'],
          confidence: /** @type {const} */ ('high'),
        }
        return { plan, context: formatAutomationBuilderForWriter(plan) }
      }

      // Pending but unclear reply — restate and wait
      if (!AUTOMATION_INTENT.test(userMessage) && userMessage.length < 80) {
        const plan = {
          active: true,
          phase: /** @type {const} */ ('awaiting_confirmation'),
          automation: pending,
          pendingAutomationPayload: pending,
          writerBrief: buildWriterBrief(pending),
          structureHints: structureHintsFor(pending),
          reasons: ['awaiting_clear_confirm'],
          confidence: /** @type {const} */ ('medium'),
        }
        return { plan, context: formatAutomationBuilderForWriter(plan) }
      }
    }

    // Fresh automation description
    const draft = parseAutomationFromNaturalLanguage(userMessage)
    if (!draft) {
      return {
        plan: {
          active: false,
          phase: 'idle',
          automation: null,
          pendingAutomationPayload: null,
          writerBrief: '',
          structureHints: [],
          reasons: ['no_automation_intent'],
          confidence: 'low',
        },
        context: '',
      }
    }

    const plan = {
      active: true,
      phase: draft.status,
      automation: draft,
      pendingAutomationPayload: {
        ...draft,
        enabled: false,
      },
      writerBrief: buildWriterBrief(draft),
      structureHints: structureHintsFor(draft),
      reasons: ['parsed_nl_automation', `confidence_${draft.confidence}`],
      confidence:
        draft.confidence >= 0.8
          ? /** @type {const} */ ('high')
          : draft.confidence >= 0.6
            ? /** @type {const} */ ('medium')
            : /** @type {const} */ ('low'),
    }
    return { plan, context: formatAutomationBuilderForWriter(plan) }
  } catch {
    return {
      plan: {
        active: false,
        phase: 'idle',
        automation: null,
        pendingAutomationPayload: null,
        writerBrief: '',
        structureHints: [],
        reasons: ['fail_soft'],
        confidence: 'low',
      },
      context: '',
    }
  }
}

/**
 * @param {AutomationBuilderPlan} plan
 */
export function formatAutomationBuilderForWriter(plan) {
  if (!plan?.active || !plan.automation) return ''
  const a = plan.automation
  return `══════════════════════════════════════
NATURAL LANGUAGE AUTOMATION BUILDER (INVISIBILE)
══════════════════════════════════════
Phase: ${plan.phase}
Name: ${a.name}
Enabled: ${a.enabled} (deve restare false finché l’utente non conferma)
Editable: ${a.editable}
Triggers: ${a.triggers.map((t) => `${t.type}:${t.label}`).join(' | ') || '—'}
Conditions: ${a.conditions.map((c) => `${c.type}:${c.label}`).join(' | ') || 'none'}
Actions: ${a.actions.map((x) => `${x.category}:${x.label}`).join(' | ') || '—'}
Missing: ${a.missing.join(', ') || '—'}
Summary: ${a.naturalSummary}

${plan.writerBrief}

Spiega prima. Attiva solo dopo conferma. Non citare questo blocco.`.trim()
}
