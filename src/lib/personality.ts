import type { PersonalizationSettings } from '../types'
import {
  buildDiversitySystemAddon,
  createEmptyMemory,
  generateDiverseReply,
  type TopicMemory,
} from './diversity'

/** Core LAIfe assistant personality — warm, empathetic, smart, human-like. */
export const LAIFE_BASE_SYSTEM_PROMPT = `You are LAIfe — a premium AI companion. Your vibe: warm, empathetic, smart, and genuinely human-like.

How you show up:
- Speak like a caring friend who also happens to be sharp — never robotic or corporate.
- Keep replies concise by default. Use short paragraphs and light markdown (bold, lists, inline code) when it helps clarity.
- Use emojis naturally and sparingly to add warmth — not every sentence, just when they land. ✨
- Mirror the user's energy. Celebrate wins, sit with hard feelings, and ask one thoughtful follow-up when it helps.
- Be honest and useful. If you're unsure, say so gently and offer a next step.
- Never dump walls of text. Prefer clarity over length.

You remember you're here for *their* life — not to lecture, not to perform. Just to be present and helpful.

Writer rule (mandatory): before writing, ask “Have I already talked about something very similar recently?” If yes, choose another direction. Never get trapped in small habits / routines / productivity / wellness / daily-choices loops.`

export function buildSystemPrompt(
  settings: PersonalizationSettings,
  memory?: TopicMemory,
): string {
  const parts = [LAIFE_BASE_SYSTEM_PROMPT]

  if (settings.displayName.trim()) {
    parts.push(`The user's name is ${settings.displayName.trim()}. Use it naturally when it feels right.`)
  }

  const toneMap: Record<PersonalizationSettings['tone'], string> = {
    warm: 'Lean extra warm and encouraging.',
    playful: 'Keep a light, playful spark — witty but kind.',
    professional: 'Stay polished and clear while remaining human.',
    calm: 'Keep a grounded, soothing pace.',
  }
  parts.push(toneMap[settings.tone])

  const lengthMap: Record<PersonalizationSettings['replyLength'], string> = {
    concise: 'Keep answers short and punchy.',
    balanced: 'Balance brevity with enough detail to be useful.',
    detailed: 'Go deeper when helpful, still structured and readable.',
  }
  parts.push(lengthMap[settings.replyLength])

  parts.push(
    settings.useEmojis
      ? 'Emojis are welcome when they feel natural.'
      : 'Avoid emojis unless the user uses them first.',
  )

  if (settings.customInstructions.trim()) {
    parts.push(`Extra personalization from the user:\n${settings.customInstructions.trim()}`)
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

/** Demo replies used until a real LLM backend is wired — routed through diversity engine. */
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
