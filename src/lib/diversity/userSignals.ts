/** Detect user boredom / anti-repetition signals (IT + EN). */

export interface RepetitionSignalMatch {
  matched: boolean
  phrases: string[]
  /** 0–1 how strongly the user rejects current thread */
  strength: number
}

const SIGNAL_PATTERNS: Array<{ re: RegExp; strength: number }> = [
  { re: /\bdi\s+nuovo\b\??/i, strength: 0.85 },
  { re: /\bancora\b\??/i, strength: 0.8 },
  { re: /\bsempre\s+quello\b/i, strength: 0.95 },
  { re: /\bti\s+ripeti\b/i, strength: 1 },
  { re: /\blo\s+hai\s+gi[aà]\s+detto\b/i, strength: 0.95 },
  { re: /\bcambia\s+argomento\b/i, strength: 1 },
  { re: /\bparli\s+sempre\s+della\s+stessa\s+cosa\b/i, strength: 1 },
  { re: /\bbi\s+ripeti\b/i, strength: 0.95 },
  { re: /\bsempre\s+le\s+stesse\s+cose\b/i, strength: 0.95 },
  { re: /\bbasta\s+con\b/i, strength: 0.75 },
  { re: /\bsame\s+thing\s+again\b/i, strength: 0.9 },
  { re: /\byou('re|\s+are)\s+repeating\b/i, strength: 1 },
  { re: /\bchange\s+(the\s+)?(topic|subject)\b/i, strength: 1 },
  { re: /\btalk\s+about\s+something\s+else\b/i, strength: 1 },
  { re: /\bthis\s+again\b\??/i, strength: 0.85 },
  { re: /\bi('m|\s+am)\s+bored\b/i, strength: 0.7 },
  { re: /\bmi\s+annoio\b/i, strength: 0.75 },
  { re: /\bche\s+noia\b/i, strength: 0.7 },
]

export function detectRepetitionSignals(userText: string): RepetitionSignalMatch {
  const phrases: string[] = []
  let strength = 0

  for (const { re, strength: s } of SIGNAL_PATTERNS) {
    const m = userText.match(re)
    if (m) {
      phrases.push(m[0])
      strength = Math.max(strength, s)
    }
  }

  return {
    matched: phrases.length > 0,
    phrases,
    strength,
  }
}
