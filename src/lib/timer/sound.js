/**
 * #314 — Short timer-complete chime via Web Audio (no external assets).
 */

export async function playTimerCompletionSound(audioCtxFactory = null) {
  const attempted = true
  try {
    const AC =
      typeof window !== 'undefined'
        ? window.AudioContext || window.webkitAudioContext
        : null
    if (!AC && !audioCtxFactory) {
      return { attempted, played: false, failureCode: 'no_audio_context' }
    }
    const ctx = audioCtxFactory ? audioCtxFactory() : new AC()
    if (ctx.state === 'suspended') {
      try {
        await ctx.resume()
      } catch {
        return { attempted, played: false, failureCode: 'audio_suspended' }
      }
    }

    const now = ctx.currentTime
    const tones = [
      { freq: 880, start: 0, dur: 0.12 },
      { freq: 1174.7, start: 0.14, dur: 0.18 },
    ]
    for (const tone of tones) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = tone.freq
      gain.gain.setValueAtTime(0.0001, now + tone.start)
      gain.gain.exponentialRampToValueAtTime(0.18, now + tone.start + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + tone.start + tone.dur)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(now + tone.start)
      osc.stop(now + tone.start + tone.dur + 0.02)
    }

    if (typeof window !== 'undefined') {
      window.setTimeout(() => {
        try {
          void ctx.close()
        } catch {
          /* ignore */
        }
      }, 600)
    }

    return { attempted, played: true, failureCode: null }
  } catch {
    return { attempted, played: false, failureCode: 'sound_error' }
  }
}

/** Optional browser notification if permission already granted (never prompts). */
export function tryTimerCompletionNotification(lang) {
  try {
    if (typeof Notification === 'undefined') {
      return { attempted: false, shown: false, failureCode: 'no_notification_api' }
    }
    if (Notification.permission !== 'granted') {
      return { attempted: false, shown: false, failureCode: 'permission_not_granted' }
    }
    const title = lang === 'en' ? "⏱️ Time's up" : '⏱️ Tempo scaduto'
    // eslint-disable-next-line no-new
    new Notification(title, {
      body:
        lang === 'en' ? 'Your ShinkAIdo timer finished.' : 'Il timer di ShinkAIdo è terminato.',
      tag: 'shinkaido-timer-complete',
      silent: false,
    })
    return { attempted: true, shown: true, failureCode: null }
  } catch {
    return { attempted: true, shown: false, failureCode: 'notification_error' }
  }
}
