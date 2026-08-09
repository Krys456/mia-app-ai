import type { PersonalizationSettings } from '../../types'
import {
  COMFORT_TRAP_TOPICS,
  getTopicById,
  type TopicSeed,
} from './topicLibrary'
import { hasTalkedAboutSimilarRecently, scoreNovelty } from './novelty'
import {
  applyPivotSuppression,
  createEmptyMemory,
  matchTopicsInText,
  pickFreshTopic,
  recentOpeningStyles,
  recentTopicIds,
  rememberAssistantMessage,
  type TopicMemory,
} from './topicMemory'
import { detectRepetitionSignals } from './userSignals'

export interface DiversityEngineResult {
  content: string
  noveltyScore: number
  rewritten: boolean
  pivoted: boolean
  topicId: string
  topicLabel: string
  reasons: string[]
  memory: TopicMemory
}

export interface DiversityGenerateInput {
  userText: string
  settings: PersonalizationSettings
  memory?: TopicMemory
  /** Recent assistant message contents (last 10) — used if memory omitted */
  recentAssistantMessages?: string[]
  maxRewriteAttempts?: number
}

const OPENING_STYLES = [
  'curiosity',
  'fact',
  'question',
  'scene',
  'contrast',
  'invitation',
] as const

type OpeningKind = (typeof OPENING_STYLES)[number]

function pickOpening(memory: TopicMemory): OpeningKind {
  const used = new Set(
    recentOpeningStyles(memory).map((o) => o.split(':')[0] ?? o),
  )
  const pool = OPENING_STYLES.filter((s) => !used.has(s) && !used.has(`lead`))
  const list = pool.length ? pool : [...OPENING_STYLES]
  return list[Math.floor(Math.random() * list.length)]!
}

function renderOpening(
  kind: OpeningKind,
  topic: TopicSeed,
  useEmojis: boolean,
): string {
  const angle =
    topic.angles[Math.floor(Math.random() * topic.angles.length)] ?? topic.label
  const emoji = useEmojis
  switch (kind) {
    case 'curiosity':
      return emoji ? `${angle} ✨` : angle
    case 'fact':
      return angle
    case 'question':
      return `Quick shift — ${topic.label.toLowerCase()} for a moment?`
    case 'scene':
      return `Picture this (${topic.label.toLowerCase()}):`
    case 'contrast':
      return `Different lane entirely — ${topic.label}.`
    case 'invitation':
      return emoji
        ? `Want a fresh thread? Let's borrow *${topic.label}* for a minute. 🌊`
        : `Want a fresh thread? Let's borrow *${topic.label}* for a minute.`
  }
}

function pickUnusedMetaphor(topic: TopicSeed, memory: TopicMemory): string | null {
  const used = new Set(memory.recent.flatMap((e) => e.metaphors))
  const pool = topic.metaphors.filter((m) => !used.has(m.toLowerCase()) && ![...used].some((u) => u.includes(m.toLowerCase().slice(0, 12))))
  if (!pool.length) return null
  return pool[Math.floor(Math.random() * pool.length)] ?? null
}

function pickSpark(topic: TopicSeed, memory: TopicMemory): string {
  const recent = memory.recent.map((e) => e.content)
  const fresh = topic.sparks.filter(
    (s) => !recent.some((r) => r.includes(s.slice(0, 40))),
  )
  const pool = fresh.length ? fresh : topic.sparks
  return pool[Math.floor(Math.random() * pool.length)] ?? topic.sparks[0]!
}

function buildDiverseReply(opts: {
  topic: TopicSeed
  settings: PersonalizationSettings
  memory: TopicMemory
  pivoted: boolean
  userText: string
}): string {
  const { topic, settings, memory, pivoted, userText } = opts
  const name = settings.displayName.trim()
  const greeting = name ? `${name} — ` : ''
  const openingKind = pickOpening(memory)
  const opening = renderOpening(openingKind, topic, settings.useEmojis)
  const spark = pickSpark(topic, memory)
  const metaphor = pickUnusedMetaphor(topic, memory)

  const pivotLead = pivoted
    ? settings.useEmojis
      ? `Heard. Switching lanes — no encore on the old thread. 🔄`
      : `Heard. Switching lanes — no encore on the old thread.`
    : null

  const metaphorLine = metaphor
    ? `Think of it ${metaphor}.`
    : null

  const followUps = [
    `What does that spark for you?`,
    `Want to stay here, or zig somewhere else?`,
    `Curious what pulled your attention in that?`,
    `Should we chase this further?`,
  ]
  // Avoid repeating last follow-up shape
  const follow =
    followUps[Math.floor(Math.random() * followUps.length)] ?? followUps[0]!

  if (settings.replyLength === 'concise') {
    return [pivotLead, `${greeting}${opening}`, spark, follow]
      .filter(Boolean)
      .join('\n\n')
  }

  if (settings.replyLength === 'detailed') {
    return [
      pivotLead,
      `${greeting}${opening}`,
      spark,
      metaphorLine,
      `**Why it matters:** fresh angles keep the chat alive — and keep me from looping the same “small habits / routines” groove.`,
      follow,
    ]
      .filter(Boolean)
      .join('\n\n')
  }

  // balanced + acknowledge user text lightly without dragging comfort topics
  const ack =
    userText.length > 12 && !pivoted
      ? `Noted what you said — and I’m not going to grind the same groove.`
      : null

  return [pivotLead, ack, `${greeting}${opening}`, spark, metaphorLine, follow]
    .filter(Boolean)
    .join('\n\n')
}

function greetingReply(settings: PersonalizationSettings, memory: TopicMemory): string {
  const topic = pickFreshTopic(memory, { forceAvoidComfort: true })
  const name = settings.displayName.trim()
  const hi = name ? `${name}, hey` : 'Hey'
  const spark = pickSpark(topic, memory)
  return settings.useEmojis
    ? `${hi} — good to see you. ✨\n\n${spark}\n\nWhat’s pulling at you today — or want another random lane?`
    : `${hi} — good to see you.\n\n${spark}\n\nWhat’s pulling at you today — or want another random lane?`
}

/**
 * Core diversity engine: topic memory + novelty gate + pivot-on-signal.
 */
export function generateDiverseReply(
  input: DiversityGenerateInput,
): DiversityEngineResult {
  const maxAttempts = input.maxRewriteAttempts ?? 5
  let memory =
    input.memory ??
    (() => {
      let m = createEmptyMemory()
      for (const msg of input.recentAssistantMessages ?? []) {
        m = rememberAssistantMessage(m, msg)
      }
      return m
    })()

  const signal = detectRepetitionSignals(input.userText)
  const pivoted = signal.matched
  const lower = input.userText.toLowerCase()

  if (pivoted) {
    const currentTopics = [
      ...recentTopicIds(memory),
      ...matchTopicsInText(
        memory.recent.map((e) => e.content).join('\n'),
      ),
      ...COMFORT_TRAP_TOPICS,
    ]
    memory = applyPivotSuppression(memory, currentTopics)
  }

  // Fast path greetings still go through diversity spark
  if (/^(hi|hello|hey|ciao|salve)\b/.test(lower) && !pivoted) {
    let content = greetingReply(input.settings, memory)
    let report = scoreNovelty(content, memory)
    let attempts = 0
    while (report.shouldRewrite && attempts < maxAttempts) {
      content = greetingReply(input.settings, memory)
      report = scoreNovelty(content, memory)
      attempts++
    }
    memory = rememberAssistantMessage(memory, content)
    return {
      content,
      noveltyScore: report.score,
      rewritten: attempts > 0,
      pivoted: false,
      topicId: report.fingerprint.topicIds[0] ?? 'greeting',
      topicLabel: 'Greeting',
      reasons: report.reasons,
      memory,
    }
  }

  let rewritten = false
  let best: { content: string; score: number; topic: TopicSeed; reasons: string[] } | null =
    null

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const topic = pickFreshTopic(memory, {
      forceAvoidComfort: pivoted || signal.strength > 0.5,
    })

    // Writer rule
    const draft = buildDiverseReply({
      topic,
      settings: input.settings,
      memory,
      pivoted,
      userText: input.userText,
    })

    if (hasTalkedAboutSimilarRecently(draft, memory) && attempt < maxAttempts - 1) {
      rewritten = true
      continue
    }

    const report = scoreNovelty(draft, memory)
    if (!best || report.score > best.score) {
      best = {
        content: draft,
        score: report.score,
        topic,
        reasons: report.reasons,
      }
    }

    if (!report.shouldRewrite) {
      memory = rememberAssistantMessage(memory, draft)
      return {
        content: draft,
        noveltyScore: report.score,
        rewritten: rewritten || attempt > 0,
        pivoted,
        topicId: topic.id,
        topicLabel: topic.label,
        reasons: report.reasons,
        memory,
      }
    }

    rewritten = true
  }

  const fallbackTopic =
    best?.topic ??
    pickFreshTopic(memory, { forceAvoidComfort: true }) ??
    getTopicById('curiosities-odd')!

  const content =
    best?.content ??
    buildDiverseReply({
      topic: fallbackTopic,
      settings: input.settings,
      memory,
      pivoted: true,
      userText: input.userText,
    })

  const finalReport = scoreNovelty(content, memory)
  memory = rememberAssistantMessage(memory, content)

  return {
    content,
    noveltyScore: best?.score ?? finalReport.score,
    rewritten: true,
    pivoted,
    topicId: fallbackTopic.id,
    topicLabel: fallbackTopic.label,
    reasons: best?.reasons ?? finalReport.reasons,
    memory,
  }
}

/** Prompt fragment for a real LLM backend. */
export function buildDiversitySystemAddon(memory: TopicMemory): string {
  const recent = recentTopicIds(memory)
  const suppressed = memory.suppressedTopicIds
  const openings = recentOpeningStyles(memory)

  return `Topic Diversity & Anti-Repetition Engine (mandatory):

Before writing, ask: "Have I already talked about something very similar recently?"
If YES — choose another direction. Never get trapped in small habits, routines, productivity, wellness, or daily-choices loops.

Topic memory (recent): ${recent.join(', ') || 'none'}
Suppressed topics: ${suppressed.join(', ') || 'none'}
Recent opening styles to avoid repeating: ${openings.join(' | ') || 'none'}
Repeated concepts to avoid: ${memory.repeatedConcepts.join(', ') || 'none'}

If the user signals boredom/repetition ("Di nuovo?", "Ancora?", "Ti ripeti.", "Cambia argomento.", etc.):
- Do NOT defend the previous topic.
- Do NOT explain it again.
- Pivot immediately to a fresh lane from: Science, History, Technology, Psychology, Nature, Space, Music, Cinema, Books, Business, Creativity, Language, Sports, Food, Travel, Architecture, Economics, Philosophy, Curiosities, Future, Culture, Relationships, Humor, AI, Human behavior, Random facts.

Every reply must feel novel vs the last 10 assistant messages (topics, metaphors, openings, sentence shapes).`
}
