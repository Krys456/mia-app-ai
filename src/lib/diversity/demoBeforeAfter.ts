/**
 * Lightweight self-check for the diversity engine (run via: npx tsx or build-time import).
 * Not a test runner — prints before/after contrast for manual validation.
 */
import { DEFAULT_PERSONALIZATION } from '../../types'
import { generateDiverseReply } from './engine'
import { createEmptyMemory, rememberAssistantMessage } from './topicMemory'

/** Simulates the old comfort-trap style reply. */
export function legacyComfortReply(): string {
  return [
    'I hear you.',
    '',
    "Let's unpack that together.",
    '',
    '1. **Name it** — what feels most urgent right now?',
    '2. **One small step** — something you can do in the next 10 minutes.',
    '3. **Check in** — tell me how that lands.',
    '',
    "I'm with you. 💫",
  ].join('\n')
}

export function demoBeforeAfter(): {
  before: string
  afterPivot: string
  noveltyScore: number
  topicLabel: string
} {
  let memory = createEmptyMemory()
  // Poison memory with comfort-trap messages
  for (let i = 0; i < 3; i++) {
    memory = rememberAssistantMessage(memory, legacyComfortReply())
  }

  const result = generateDiverseReply({
    userText: 'Ti ripeti. Cambia argomento.',
    settings: { ...DEFAULT_PERSONALIZATION, replyLength: 'balanced' },
    memory,
  })

  return {
    before: legacyComfortReply(),
    afterPivot: result.content,
    noveltyScore: result.noveltyScore,
    topicLabel: result.topicLabel,
  }
}
