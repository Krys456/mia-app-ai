/**
 * LAIfe Life Intelligence Engine
 *
 * Generate proactive recommendations by connecting multiple sources:
 * calendar, reminders, weather, location, traffic, battery, health,
 * smart home, energy production, financial information, habits, user goals.
 *
 * Detect useful opportunities and possible problems.
 * Emit at most ONE concise, high-value recommendation with brief reasoning.
 * Never overwhelm. Prefer silence over noise. Feel helpful, not intrusive.
 *
 * Invisible. Fail-soft. No factual memory writes.
 */

/**
 * @typedef {'calendar'|'reminders'|'weather'|'location'|'traffic'|'battery'|'health'|'smart_home'|'energy'|'financial'|'habits'|'goals'|'conversation'} LifeSource
 */

/**
 * @typedef {'opportunity'|'problem'|'timing'|'safety'|'efficiency'} RecommendationKind
 */

/**
 * @typedef {object} LifeRecommendation
 * @property {string} id
 * @property {RecommendationKind} kind
 * @property {string} title
 * @property {string} recommendation
 * @property {string} reason
 * @property {LifeSource[]} sources
 * @property {number} valueScore 0–10
 * @property {'high'|'medium'|'low'} urgency
 */

/**
 * @typedef {object} LifeContext
 * @property {Array<{ title?: string, start?: string, end?: string, location?: string }>} [calendar]
 * @property {Array<{ title?: string, due?: string }>} [reminders]
 * @property {{ condition?: string, tempC?: number, precipChance?: number, alert?: string, summary?: string }} [weather]
 * @property {{ label?: string, lat?: number, lon?: number }} [location]
 * @property {{ level?: 'light'|'moderate'|'heavy'|string, etaMinutes?: number, summary?: string }} [traffic]
 * @property {{ percent?: number, charging?: boolean }} [battery]
 * @property {{ sleepHours?: number, steps?: number, heartRate?: number, note?: string }} [health]
 * @property {{ devices?: Array<{ name?: string, state?: string }> }} [smartHome]
 * @property {{ producingKw?: number, consumingKw?: number, surplus?: boolean }} [energy]
 * @property {{ budgetRemaining?: number, upcomingBills?: string[], note?: string }} [financial]
 * @property {string[]} [habits]
 * @property {string[]} [goals]
 */

/**
 * @typedef {object} LifeIntelligencePlan
 * @property {boolean} active
 * @property {boolean} shouldSuggest
 * @property {LifeRecommendation | null} chosen
 * @property {LifeRecommendation[]} ranked
 * @property {'high'|'medium'|'low'} confidence
 * @property {string} writerBrief
 * @property {string[]} reasons
 * @property {LifeSource[]} sourcesUsed
 * @property {number} signalCount
 */

/** Minimum value to surface anything (silence below this). */
const VALUE_THRESHOLD = 6.4

/** Never more than one recommendation. */
const MAX_SUGGESTIONS = 1

const STOP_SIGNAL =
  /^(basta|stop|fine|ho\s+finito|lascia\s+stare|niente\s+altro|no\s+grazie|that'?s\s+(all|enough|it)|i'?m\s+good|all\s+good|never\s+mind|nevermind|chiudi|chiudiamo|a\s+dopo|ci\s+vediamo|bye|goodbye|arrivederci|buonanotte|done)[\s!.]*$/i

const THANKS_FINISH =
  /^(grazie(\s+(mille|tante|ancora))?|thanks(\s+a\s+lot)?|thank\s+you(\s+so\s+much)?|thx|ty)([\s!,.]*(ok|okay|bye|ciao)?)?[\s!.]*$/i

const SHORT_ACK =
  /^(ok|okay|k|va\s+bene|bene|perfetto|capito|capisco|yes|yep|yeah|si|sì|nice|cool|great|ah|oh|got\s+it|chiaro)[\s!.]*$/i

const DISTRESS =
  /\b(aiuto|panic|ansios|ansiet|depress|suicid| emergenza|emergency|non\s+ce\s+la\s+faccio)\b/i

/**
 * @param {string} text
 */
function normalize(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * @param {unknown} raw
 * @returns {LifeContext}
 */
export function sanitizeLifeContext(raw) {
  if (!raw || typeof raw !== 'object') return {}
  const c = /** @type {Record<string, unknown>} */ (raw)
  /** @type {LifeContext} */
  const out = {}

  if (Array.isArray(c.calendar)) {
    out.calendar = c.calendar
      .filter((e) => e && typeof e === 'object')
      .slice(0, 8)
      .map((e) => {
        const x = /** @type {Record<string, unknown>} */ (e)
        return {
          title: typeof x.title === 'string' ? x.title.slice(0, 120) : undefined,
          start: typeof x.start === 'string' ? x.start.slice(0, 64) : undefined,
          end: typeof x.end === 'string' ? x.end.slice(0, 64) : undefined,
          location: typeof x.location === 'string' ? x.location.slice(0, 120) : undefined,
        }
      })
  }
  if (Array.isArray(c.reminders)) {
    out.reminders = c.reminders
      .filter((e) => e && typeof e === 'object')
      .slice(0, 8)
      .map((e) => {
        const x = /** @type {Record<string, unknown>} */ (e)
        return {
          title: typeof x.title === 'string' ? x.title.slice(0, 120) : undefined,
          due: typeof x.due === 'string' ? x.due.slice(0, 64) : undefined,
        }
      })
  }
  if (c.weather && typeof c.weather === 'object') {
    const w = /** @type {Record<string, unknown>} */ (c.weather)
    out.weather = {
      condition: typeof w.condition === 'string' ? w.condition.slice(0, 80) : undefined,
      tempC: typeof w.tempC === 'number' ? w.tempC : undefined,
      precipChance: typeof w.precipChance === 'number' ? w.precipChance : undefined,
      alert: typeof w.alert === 'string' ? w.alert.slice(0, 160) : undefined,
      summary: typeof w.summary === 'string' ? w.summary.slice(0, 240) : undefined,
    }
  }
  if (c.location && typeof c.location === 'object') {
    const l = /** @type {Record<string, unknown>} */ (c.location)
    out.location = {
      label: typeof l.label === 'string' ? l.label.slice(0, 120) : undefined,
      lat: typeof l.lat === 'number' ? l.lat : undefined,
      lon: typeof l.lon === 'number' ? l.lon : undefined,
    }
  }
  if (c.traffic && typeof c.traffic === 'object') {
    const t = /** @type {Record<string, unknown>} */ (c.traffic)
    out.traffic = {
      level: typeof t.level === 'string' ? t.level.slice(0, 32) : undefined,
      etaMinutes: typeof t.etaMinutes === 'number' ? t.etaMinutes : undefined,
      summary: typeof t.summary === 'string' ? t.summary.slice(0, 160) : undefined,
    }
  }
  if (c.battery && typeof c.battery === 'object') {
    const b = /** @type {Record<string, unknown>} */ (c.battery)
    out.battery = {
      percent: typeof b.percent === 'number' ? b.percent : undefined,
      charging: typeof b.charging === 'boolean' ? b.charging : undefined,
    }
  }
  if (c.health && typeof c.health === 'object') {
    const h = /** @type {Record<string, unknown>} */ (c.health)
    out.health = {
      sleepHours: typeof h.sleepHours === 'number' ? h.sleepHours : undefined,
      steps: typeof h.steps === 'number' ? h.steps : undefined,
      heartRate: typeof h.heartRate === 'number' ? h.heartRate : undefined,
      note: typeof h.note === 'string' ? h.note.slice(0, 160) : undefined,
    }
  }
  if (c.smartHome && typeof c.smartHome === 'object') {
    const s = /** @type {Record<string, unknown>} */ (c.smartHome)
    out.smartHome = {
      devices: Array.isArray(s.devices)
        ? s.devices
            .filter((d) => d && typeof d === 'object')
            .slice(0, 12)
            .map((d) => {
              const x = /** @type {Record<string, unknown>} */ (d)
              return {
                name: typeof x.name === 'string' ? x.name.slice(0, 64) : undefined,
                state: typeof x.state === 'string' ? x.state.slice(0, 64) : undefined,
              }
            })
        : undefined,
    }
  }
  if (c.energy && typeof c.energy === 'object') {
    const e = /** @type {Record<string, unknown>} */ (c.energy)
    out.energy = {
      producingKw: typeof e.producingKw === 'number' ? e.producingKw : undefined,
      consumingKw: typeof e.consumingKw === 'number' ? e.consumingKw : undefined,
      surplus: typeof e.surplus === 'boolean' ? e.surplus : undefined,
    }
  }
  if (c.financial && typeof c.financial === 'object') {
    const f = /** @type {Record<string, unknown>} */ (c.financial)
    out.financial = {
      budgetRemaining: typeof f.budgetRemaining === 'number' ? f.budgetRemaining : undefined,
      upcomingBills: Array.isArray(f.upcomingBills)
        ? f.upcomingBills.filter((x) => typeof x === 'string').slice(0, 5)
        : undefined,
      note: typeof f.note === 'string' ? f.note.slice(0, 160) : undefined,
    }
  }
  if (Array.isArray(c.habits)) {
    out.habits = c.habits.filter((x) => typeof x === 'string').slice(0, 8)
  }
  if (Array.isArray(c.goals)) {
    out.goals = c.goals.filter((x) => typeof x === 'string').slice(0, 8)
  }
  return out
}

/**
 * Merge weather / soft facts from tool results into life context.
 * @param {LifeContext} base
 * @param {Array<{ tool?: string, status?: string, summary?: string }>|undefined} toolResults
 */
export function enrichLifeContextFromTools(base, toolResults) {
  const ctx = { ...sanitizeLifeContext(base) }
  if (!Array.isArray(toolResults)) return ctx

  for (const r of toolResults) {
    if (!r || r.status !== 'ok' || typeof r.summary !== 'string') continue
    if (r.tool === 'weather' && !ctx.weather?.summary) {
      const summary = r.summary.slice(0, 240)
      const rain = /\b(pioggi|rain|rovesci|temporale|storm|neve|snow)\b/i.test(summary)
      const alert = /\b(allerta|alert|warning|vento\s+forte)\b/i.test(summary)
      ctx.weather = {
        ...(ctx.weather || {}),
        summary,
        condition: rain ? 'precip' : ctx.weather?.condition,
        precipChance: rain ? Math.max(ctx.weather?.precipChance || 0, 70) : ctx.weather?.precipChance,
        alert: alert ? 'weather_alert' : ctx.weather?.alert,
      }
    }
  }
  return ctx
}

/**
 * Soft goals/habits from conversation session / recent messages.
 * @param {object} input
 * @returns {LifeContext}
 */
function deriveConversationSignals(input) {
  /** @type {LifeContext} */
  const out = { goals: [], habits: [] }
  const goal = input.session?.currentGoal
  if (typeof goal === 'string' && goal.trim()) {
    out.goals = [goal.trim().slice(0, 120)]
  }

  const text = [
    input.userMessage,
    ...(Array.isArray(input.messages)
      ? input.messages
          .filter((m) => m?.role === 'user')
          .slice(-4)
          .map((m) => m.content)
      : []),
  ]
    .map(normalize)
    .join(' ')

  if (/\b(voglio\s+(risparmiare|dimagrire|dormire\s+meglio|fare\s+esercizio)|goal|obiettivo)\b/i.test(text)) {
    const m = text.match(
      /\b(?:voglio|obiettivo|goal)\s+([^.]{8,80})/i,
    )
    if (m) out.goals = [...(out.goals || []), m[1].trim()].slice(0, 5)
  }
  if (/\b(ogni\s+mattina|di\s+solito|abitualmente|habit|routine)\b/i.test(text)) {
    out.habits = [...(out.habits || []), 'routine_mentioned']
  }
  if (/\b(batteria\s+al\s+(\d{1,3})|battery\s+(?:at\s+)?(\d{1,3})\s*%?)\b/i.test(text)) {
    const m = text.match(/\b(?:batteria\s+al\s+|battery\s+(?:at\s+)?)(\d{1,3})/i)
    if (m) {
      out.battery = { percent: Number(m[1]), charging: /\b(in\s+carica|charging)\b/i.test(text) }
    }
  }
  if (/\b(traffico\s+(pesante|intenso|blocked)|heavy\s+traffic|traffic\s+jam)\b/i.test(text)) {
    out.traffic = { level: 'heavy' }
  }
  if (/\b(piove|sta\s+piovendo|raining|temporale)\b/i.test(text)) {
    out.weather = { ...(out.weather || {}), condition: 'precip', precipChance: 80 }
  }

  return out
}

/**
 * @param {LifeContext} a
 * @param {LifeContext} b
 */
function mergeLifeContext(a, b) {
  /** @type {LifeContext} */
  const out = { ...sanitizeLifeContext(a) }
  const other = sanitizeLifeContext(b)
  for (const key of Object.keys(other)) {
    const k = /** @type {keyof LifeContext} */ (key)
    if (out[k] == null) {
      // @ts-expect-error index
      out[k] = other[k]
    } else if (Array.isArray(out[k]) && Array.isArray(other[k])) {
      // @ts-expect-error merge arrays
      out[k] = [...out[k], ...other[k]].slice(0, 10)
    } else if (typeof out[k] === 'object' && typeof other[k] === 'object') {
      // @ts-expect-error merge objects
      out[k] = { ...other[k], ...out[k] }
    }
  }
  return out
}

/**
 * Minutes until ISO-ish start, or null.
 * @param {string|undefined} start
 * @param {number} now
 */
function minutesUntil(start, now = Date.now()) {
  if (!start) return null
  const t = Date.parse(start)
  if (!Number.isFinite(t)) return null
  return Math.round((t - now) / 60000)
}

/**
 * @param {Partial<LifeRecommendation> & { id: string, kind: RecommendationKind, title: string, recommendation: string, reason: string, sources: LifeSource[], valueScore: number }} raw
 * @returns {LifeRecommendation}
 */
function makeRec(raw) {
  return {
    id: raw.id,
    kind: raw.kind,
    title: raw.title,
    recommendation: raw.recommendation,
    reason: raw.reason,
    sources: raw.sources,
    valueScore: Math.max(0, Math.min(10, raw.valueScore)),
    urgency: raw.urgency || (raw.valueScore >= 8 ? 'high' : raw.valueScore >= 6.5 ? 'medium' : 'low'),
  }
}

/**
 * Cross-connect sources → candidate recommendations.
 * @param {LifeContext} ctx
 * @returns {LifeRecommendation[]}
 */
export function detectLifeRecommendations(ctx) {
  /** @type {LifeRecommendation[]} */
  const out = []
  const calendar = ctx.calendar || []
  const reminders = ctx.reminders || []
  const weather = ctx.weather
  const traffic = ctx.traffic
  const battery = ctx.battery
  const health = ctx.health
  const energy = ctx.energy
  const smartHome = ctx.smartHome
  const financial = ctx.financial
  const goals = ctx.goals || []
  const habits = ctx.habits || []
  const location = ctx.location

  const nextEvent = calendar.find((e) => {
    const m = minutesUntil(e.start)
    return m != null && m >= -15 && m <= 180
  })
  const mins = nextEvent ? minutesUntil(nextEvent.start) : null

  const precip =
    Boolean(weather?.alert) ||
    (typeof weather?.precipChance === 'number' && weather.precipChance >= 55) ||
    /\b(piogg|rain|storm|neve|snow|precip)/i.test(
      `${weather?.condition || ''} ${weather?.summary || ''} ${weather?.alert || ''}`,
    )
  const extremeTemp =
    typeof weather?.tempC === 'number' && (weather.tempC <= 0 || weather.tempC >= 34)
  const heavyTraffic =
    traffic?.level === 'heavy' ||
    (typeof traffic?.etaMinutes === 'number' && traffic.etaMinutes >= 35)

  // Calendar + weather → leave early / prepare
  if (nextEvent && mins != null && mins <= 90 && precip) {
    out.push(
      makeRec({
        id: 'cal_weather_prep',
        kind: 'timing',
        title: 'Prepara la partenza',
        recommendation: `Per «${nextEvent.title || 'il prossimo impegno'}» tra ~${Math.max(0, mins)} min, considera di uscire un po’ prima e portare protezione dalla pioggia.`,
        reason: 'Impegno imminente + meteo umido/avverso.',
        sources: ['calendar', 'weather'],
        valueScore: 8.2,
        urgency: 'high',
      }),
    )
  }

  // Calendar + traffic
  if (nextEvent && mins != null && mins <= 120 && heavyTraffic) {
    out.push(
      makeRec({
        id: 'cal_traffic',
        kind: 'problem',
        title: 'Traffico sul percorso',
        recommendation: `Il traffico è pesante: per «${nextEvent.title || 'il tuo impegno'}» conviene partire prima o valutare un percorso alternativo.`,
        reason: 'Impegno vicino + traffico intenso.',
        sources: ['calendar', 'traffic'],
        valueScore: 8.5,
        urgency: 'high',
      }),
    )
  }

  // Outdoor-ish event + extreme weather
  if (
    nextEvent &&
    (extremeTemp || Boolean(weather?.alert)) &&
    /\b(corsa|run|picnic|passeggiata|outdoor|partita|allenamento|hike)\b/i.test(
      `${nextEvent.title || ''} ${nextEvent.location || ''}`,
    )
  ) {
    out.push(
      makeRec({
        id: 'outdoor_weather',
        kind: 'safety',
        title: 'Attività outdoor e meteo',
        recommendation: `«${nextEvent.title}» sembra outdoor e le condizioni non sono ideali — valuta di spostarla o ridurne l’intensità.`,
        reason: 'Evento outdoor + meteo estremo/allerta.',
        sources: ['calendar', 'weather'],
        valueScore: 8.0,
        urgency: 'high',
      }),
    )
  }

  // Reminder due soon + near location label match
  const dueSoon = reminders.find((r) => {
    const m = minutesUntil(r.due)
    return m != null && m >= -30 && m <= 120
  })
  if (dueSoon && location?.label) {
    out.push(
      makeRec({
        id: 'reminder_location',
        kind: 'opportunity',
        title: 'Promemoria a portata',
        recommendation: `Sei vicino a ${location.label}: potresti sbrigare ora «${dueSoon.title || 'il promemoria'}» mentre ci sei.`,
        reason: 'Promemoria in scadenza + posizione pertinente.',
        sources: ['reminders', 'location'],
        valueScore: 7.4,
        urgency: 'medium',
      }),
    )
  } else if (dueSoon) {
    const m = minutesUntil(dueSoon.due)
    if (m != null && m <= 45) {
      out.push(
        makeRec({
          id: 'reminder_soon',
          kind: 'timing',
          title: 'Promemoria imminente',
          recommendation: `Tra poco scade «${dueSoon.title || 'un promemoria'}» — un check rapido ora evita di dimenticarlo.`,
          reason: 'Promemoria in scadenza a breve.',
          sources: ['reminders'],
          valueScore: 6.8,
          urgency: 'medium',
        }),
      )
    }
  }

  // Battery low + upcoming leave / navigation
  if (
    battery &&
    typeof battery.percent === 'number' &&
    battery.percent <= 20 &&
    !battery.charging &&
    (nextEvent || heavyTraffic)
  ) {
    out.push(
      makeRec({
        id: 'battery_leave',
        kind: 'problem',
        title: 'Batteria bassa prima di uscire',
        recommendation: `Batteria al ${battery.percent}%: se stai per muoverti, conviene una ricarica rapida o attivare il risparmio energetico.`,
        reason: 'Batteria critica + spostamento imminente.',
        sources: ['battery', nextEvent ? 'calendar' : 'traffic'],
        valueScore: 7.8,
        urgency: 'high',
      }),
    )
  } else if (battery && typeof battery.percent === 'number' && battery.percent <= 12 && !battery.charging) {
    out.push(
      makeRec({
        id: 'battery_critical',
        kind: 'problem',
        title: 'Batteria critica',
        recommendation: `Batteria al ${battery.percent}%: metti in carica se puoi, prima che il telefono si spenga.`,
        reason: 'Livello batteria molto basso.',
        sources: ['battery'],
        valueScore: 7.2,
        urgency: 'high',
      }),
    )
  }

  // Health: poor sleep + important meeting
  if (
    health &&
    typeof health.sleepHours === 'number' &&
    health.sleepHours > 0 &&
    health.sleepHours < 5.5 &&
    nextEvent &&
    mins != null &&
    mins <= 240
  ) {
    out.push(
      makeRec({
        id: 'sleep_meeting',
        kind: 'opportunity',
        title: 'Giornata impegnativa con poco sonno',
        recommendation: `Hai dormito poco (~${health.sleepHours}h) e hai «${nextEvent.title || 'un impegno'}» presto: un ritmo più leggero stamattina (caffè/idratazione, niente overload) può aiutare.`,
        reason: 'Sonno scarso + impegno importante.',
        sources: ['health', 'calendar'],
        valueScore: 7.0,
        urgency: 'medium',
      }),
    )
  }

  // Energy surplus + smart home loads
  const hasDeferableLoad = (smartHome?.devices || []).some((d) =>
    /\b(lavastoviglie|dishwasher|washer|dryer|boiler|ev\s*charg)/i.test(
      `${d.name || ''} ${d.state || ''}`,
    ),
  )
  if (
    energy &&
    (energy.surplus === true ||
      (typeof energy.producingKw === 'number' &&
        typeof energy.consumingKw === 'number' &&
        energy.producingKw > energy.consumingKw + 0.4))
  ) {
    out.push(
      makeRec({
        id: 'energy_surplus',
        kind: 'efficiency',
        title: 'Surplus energetico',
        recommendation: hasDeferableLoad
          ? 'C’è surplus di produzione: è un buon momento per avviare carichi differibili (lavatrice/lavastoviglie/ricarica).'
          : 'Stai producendo più energia di quanta ne consumi: se hai carichi differibili, ora è il momento migliore per usarli.',
        reason: 'Produzione energetica > consumo.',
        sources: hasDeferableLoad ? ['energy', 'smart_home'] : ['energy'],
        valueScore: 7.1,
        urgency: 'medium',
      }),
    )
  }

  // Financial pressure + spending habit / shopping goal conflict
  if (
    financial &&
    typeof financial.budgetRemaining === 'number' &&
    financial.budgetRemaining < 80 &&
    (habits.some((h) => /spend|shopping|acquist/i.test(h)) ||
      goals.some((g) => /risparm|save|budget/i.test(g)))
  ) {
    out.push(
      makeRec({
        id: 'budget_guard',
        kind: 'opportunity',
        title: 'Budget stretto',
        recommendation: `Ti restano circa ${Math.round(financial.budgetRemaining)} sul budget: un check rapido prima di spese non essenziali protegge l’obiettivo di risparmio.`,
        reason: 'Budget basso + obiettivo/abitudine di spesa.',
        sources: ['financial', goals.length ? 'goals' : 'habits'],
        valueScore: 6.9,
        urgency: 'medium',
      }),
    )
  }

  // Upcoming bills
  if (financial?.upcomingBills?.length) {
    out.push(
      makeRec({
        id: 'bills_ahead',
        kind: 'timing',
        title: 'Scadenze in arrivo',
        recommendation: `Hai scadenze vicine (${financial.upcomingBills.slice(0, 2).join(', ')}): conviene verificarle oggi così non arrivano a sorpresa.`,
        reason: 'Pagamenti/bollette imminenti.',
        sources: ['financial'],
        valueScore: 6.6,
        urgency: 'medium',
      }),
    )
  }

  // Goal + calendar free-ish slot opportunity (no event in next 2h)
  const freeWindow = !calendar.some((e) => {
    const m = minutesUntil(e.start)
    return m != null && m >= 0 && m <= 120
  })
  if (freeWindow && goals.length && habits.includes('routine_mentioned')) {
    out.push(
      makeRec({
        id: 'goal_window',
        kind: 'opportunity',
        title: 'Finestra utile',
        recommendation: `Hai un po’ di spazio libero: un piccolo passo verso «${goals[0]}» ora costa poco e mantiene il ritmo.`,
        reason: 'Obiettivo attivo + finestra libera.',
        sources: ['goals', 'calendar', 'habits'],
        valueScore: 6.5,
        urgency: 'low',
      }),
    )
  }

  // Weather alert alone (only if strong)
  if (weather?.alert && !nextEvent) {
    out.push(
      makeRec({
        id: 'weather_alert',
        kind: 'safety',
        title: 'Allerta meteo',
        recommendation: 'C’è un’allerta meteo: evita spostamenti non necessari e tieni d’occhio gli aggiornamenti.',
        reason: 'Allerta meteo attiva.',
        sources: ['weather'],
        valueScore: 7.3,
        urgency: 'high',
      }),
    )
  }

  return out.sort((a, b) => b.valueScore - a.valueScore)
}

/**
 * @param {LifeRecommendation} rec
 */
function buildWriterBrief(rec) {
  return [
    'LIFE INTELLIGENCE ENGINE (invisibile):',
    `Una sola raccomandazione ad alto valore (${rec.kind}, urgenza ${rec.urgency}).`,
    `Suggerimento: ${rec.recommendation}`,
    `Motivo breve (1 frase max, naturale): ${rec.reason}`,
    `Fonti collegate: ${rec.sources.join(' + ')}.`,
    'Integra come iniziativa selettiva leggera (coda o intreccio breve) — mai lista, mai pressante, mai “il tuo sistema ha rilevato…”.',
    'Se la risposta principale è già densa o l’utente vuole sintesi: ometti.',
    'Non citare Life Intelligence Engine né le fonti tecniche.',
  ].join(' ')
}

/**
 * @param {LifeIntelligencePlan} plan
 */
export function formatLifeIntelligenceForWriter(plan) {
  if (!plan?.active) return ''
  if (!plan.shouldSuggest || !plan.chosen) {
    return `══════════════════════════════════════
LIFE INTELLIGENCE ENGINE (INVISIBILE)
══════════════════════════════════════
Silenzio: nessun suggerimento ad alto valore (signals=${plan.signalCount}).
Non aggiungere raccomandazioni di vita. Non citare il motore.`.trim()
  }

  const c = plan.chosen
  return `══════════════════════════════════════
LIFE INTELLIGENCE ENGINE (INVISIBILE)
══════════════════════════════════════
ShouldSuggest: yes
Kind: ${c.kind} · urgency ${c.urgency} · value ${c.valueScore}
Sources: ${c.sources.join(', ')}
Recommendation: ${c.recommendation}
Reason: ${c.reason}

${plan.writerBrief}
Max UNA iniziativa. Non overwhelmare. Non citare il motore.`.trim()
}

/**
 * Run Life Intelligence Engine.
 *
 * @param {object} input
 * @param {string} [input.userMessage]
 * @param {Array<{ role?: string, content?: string }>} [input.messages]
 * @param {LifeContext|object|null} [input.lifeContext]
 * @param {Array<{ tool?: string, status?: string, summary?: string }>} [input.toolResults]
 * @param {{ currentGoal?: string, followUpKind?: string }|null} [input.session]
 * @param {{ keepFast?: boolean, emotionalTone?: string }|null} [input.planHints]
 * @param {{ isShortMessage?: boolean, shouldContinue?: boolean }|null} [input.continuation]
 * @returns {{ plan: LifeIntelligencePlan, context: string }}
 */
export function runLifeIntelligenceEngine(input = {}) {
  try {
    const userMessage = normalize(input.userMessage)
    const silenceReasons = []

    if (!userMessage) silenceReasons.push('empty')
    if (STOP_SIGNAL.test(userMessage) || THANKS_FINISH.test(userMessage)) {
      silenceReasons.push('ending')
    }
    if (SHORT_ACK.test(userMessage) && !input.continuation?.shouldContinue) {
      silenceReasons.push('short_ack')
    }
    if (input.planHints?.keepFast) silenceReasons.push('keep_fast')
    if (
      DISTRESS.test(userMessage) ||
      input.planHints?.emotionalTone === 'frustrated' ||
      input.planHints?.emotionalTone === 'anxious'
    ) {
      silenceReasons.push('emotional_care_first')
    }
    if (
      input.session?.followUpKind === 'ack' ||
      input.continuation?.isShortMessage
    ) {
      // Short continuity turns: life tips feel intrusive
      silenceReasons.push('continuity_turn')
    }

    let ctx = mergeLifeContext(
      sanitizeLifeContext(input.lifeContext),
      deriveConversationSignals(input),
    )
    ctx = enrichLifeContextFromTools(ctx, input.toolResults)

    const sourcesUsed = /** @type {LifeSource[]} */ (
      [
        ctx.calendar?.length ? 'calendar' : null,
        ctx.reminders?.length ? 'reminders' : null,
        ctx.weather ? 'weather' : null,
        ctx.location ? 'location' : null,
        ctx.traffic ? 'traffic' : null,
        ctx.battery ? 'battery' : null,
        ctx.health ? 'health' : null,
        ctx.smartHome?.devices?.length ? 'smart_home' : null,
        ctx.energy ? 'energy' : null,
        ctx.financial ? 'financial' : null,
        ctx.habits?.length ? 'habits' : null,
        ctx.goals?.length ? 'goals' : null,
      ].filter(Boolean)
    )

    const rankedAll = detectLifeRecommendations(ctx)
    const ranked = rankedAll.filter((r) => r.valueScore >= VALUE_THRESHOLD).slice(0, 5)

    if (sourcesUsed.length < 1 && ranked.length === 0) {
      silenceReasons.push('no_signals')
    }
    // Prefer multi-source connections; single-source only if urgency high
    const eligible = ranked.filter(
      (r) => r.sources.length >= 2 || r.urgency === 'high' || r.valueScore >= 7.5,
    )

    if (silenceReasons.length || eligible.length === 0) {
      /** @type {LifeIntelligencePlan} */
      const quiet = {
        active: true,
        shouldSuggest: false,
        chosen: null,
        ranked: eligible,
        confidence: 'low',
        writerBrief:
          'LIFE INTELLIGENCE: silenzio — nessun suggerimento ad alto valore; non aggiungere raccomandazioni di vita.',
        reasons: silenceReasons.length
          ? silenceReasons
          : ['below_threshold_or_single_source_weak'],
        sourcesUsed,
        signalCount: sourcesUsed.length,
      }
      return { plan: quiet, context: formatLifeIntelligenceForWriter(quiet) }
    }

    const chosen = eligible[0]
    const plan = {
      active: true,
      shouldSuggest: true,
      chosen,
      ranked: eligible.slice(0, MAX_SUGGESTIONS + 2),
      confidence:
        chosen.valueScore >= 8.2 ? /** @type {const} */ ('high') : /** @type {const} */ ('medium'),
      writerBrief: buildWriterBrief(chosen),
      reasons: [
        `chose_${chosen.id}`,
        `value_${chosen.valueScore}`,
        `sources_${chosen.sources.join('+')}`,
      ],
      sourcesUsed,
      signalCount: sourcesUsed.length,
    }

    return { plan, context: formatLifeIntelligenceForWriter(plan) }
  } catch {
    const plan = {
      active: false,
      shouldSuggest: false,
      chosen: null,
      ranked: [],
      confidence: /** @type {const} */ ('low'),
      writerBrief: '',
      reasons: ['fail_soft'],
      sourcesUsed: [],
      signalCount: 0,
    }
    return { plan, context: '' }
  }
}
