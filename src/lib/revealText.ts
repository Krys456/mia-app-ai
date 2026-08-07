/**
 * Progressive text reveal for chat replies.
 * Display-only: does not change model output, only how it appears on screen.
 */

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * Reveal reply text gradually so the conversation feels written, not pasted.
 * Word-batched via rAF with a natural cadence; never dumps long replies in one frame.
 */
export function revealReplyText(
  fullText: string,
  onProgress: (partial: string) => void,
  isCancelled: () => boolean,
): Promise<void> {
  const text = fullText.trim()
  if (!text) {
    onProgress('')
    return Promise.resolve()
  }

  if (prefersReducedMotion()) {
    onProgress(text)
    return Promise.resolve()
  }

  // Keep whitespace tokens so markdown spacing stays intact.
  const tokens = text.split(/(\s+)/).filter((t) => t.length > 0)
  let index = 0
  let acc = ''

  // Natural reading pace: ~28–42 tokens/sec depending on length.
  // Short replies still animate (never appear all at once).
  const chars = text.length
  const durationMs = Math.min(4200, Math.max(480, chars * 9 + tokens.length * 12))
  const frameMs = 1000 / 60
  const framesTarget = Math.max(12, Math.round(durationMs / frameMs))
  const perFrame = Math.max(1, Math.ceil(tokens.length / framesTarget))

  return new Promise((resolve) => {
    let lastTs = 0
    // Slight micro-pause after punctuation for a human writing feel.
    let pauseFrames = 0

    const step = (ts: number) => {
      if (isCancelled()) {
        resolve()
        return
      }

      if (pauseFrames > 0) {
        pauseFrames -= 1
        requestAnimationFrame(step)
        return
      }

      // Cap frame work if the tab was backgrounded.
      if (lastTs && ts - lastTs > 80) {
        // Catch up a little without dumping everything.
      }
      lastTs = ts

      let n = 0
      while (n < perFrame && index < tokens.length) {
        const token = tokens[index]
        acc += token
        index += 1
        n += 1

        const trimmed = token.trimEnd()
        const last = trimmed[trimmed.length - 1]
        if (last === '.' || last === '!' || last === '?' || last === ':' || last === '\n') {
          pauseFrames = 1
          break
        }
      }

      onProgress(acc)

      if (index < tokens.length) {
        requestAnimationFrame(step)
      } else {
        resolve()
      }
    }

    requestAnimationFrame(step)
  })
}
