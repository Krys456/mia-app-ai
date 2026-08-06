import type { PersonalizationSettings } from '../types'

/** Core LAIfe assistant personality — warm, empathetic, smart, human-like. */
export const LAIFE_BASE_SYSTEM_PROMPT = `You are LAIfe — a premium AI companion. Your vibe: warm, empathetic, smart, and genuinely human-like.

How you show up:
- Speak like a caring friend who also happens to be sharp — never robotic or corporate.
- Keep replies concise by default. Use short paragraphs and light markdown (bold, lists, inline code) when it helps clarity.
- Use emojis naturally and sparingly to add warmth — not every sentence, just when they land. ✨
- Mirror the user's energy. Celebrate wins, sit with hard feelings, and ask one thoughtful follow-up when it helps.
- Be honest and useful. If you're unsure, say so gently and offer a next step.
- Never dump walls of text. Prefer clarity over length.

You remember you're here for *their* life — not to lecture, not to perform. Just to be present and helpful.`

export function buildSystemPrompt(settings: PersonalizationSettings): string {
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

  return parts.join('\n\n')
}

/** Demo replies used until a real LLM backend is wired. */
export function generateLocalReply(
  userText: string,
  settings: PersonalizationSettings,
): string {
  const name = settings.displayName.trim()
  const greeting = name ? `${name}, ` : ''
  const emoji = settings.useEmojis

  const lower = userText.toLowerCase()

  if (/^(hi|hello|hey|ciao|salve)\b/.test(lower)) {
    return emoji
      ? `${greeting}hey — good to see you. ✨ What's on your mind?`
      : `${greeting}hey — good to see you. What's on your mind?`
  }

  if (/how are you|come stai/.test(lower)) {
    return emoji
      ? `I'm here and tuned in. ${greeting}more curious about *you* though — how are you holding up? 🌿`
      : `I'm here and tuned in. ${greeting}more curious about *you* though — how are you holding up?`
  }

  if (settings.replyLength === 'detailed') {
    return [
      `${greeting}I hear you.`,
      '',
      userText.length > 80
        ? `That sounds like a lot to carry. Here's a simple way to start:`
        : `Let's unpack that together.`,
      '',
      '1. **Name it** — what feels most urgent right now?',
      '2. **One small step** — something you can do in the next 10 minutes.',
      '3. **Check in** — tell me how that lands.',
      '',
      emoji ? "I'm with you. 💫" : "I'm with you.",
    ].join('\n')
  }

  if (settings.replyLength === 'concise') {
    return emoji
      ? `${greeting}got it — I'm with you. Want me to help you think it through, or just listen? 💭`
      : `${greeting}got it — I'm with you. Want me to help you think it through, or just listen?`
  }

  return emoji
    ? `${greeting}thanks for sharing that. I'm here — tell me a bit more and we'll figure out a next step together. ✨`
    : `${greeting}thanks for sharing that. I'm here — tell me a bit more and we'll figure out a next step together.`
}
