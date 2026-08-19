/**
 * #314 — Compact active-timer chip (composer-adjacent).
 */

import { useEffect, useState } from 'react'
import {
  formatCountdown,
  remainingMs,
  timerCompletedMessage,
  type ActiveTimerContext,
} from '../../lib/timer'

type Props = {
  timer: ActiveTimerContext
  language?: 'it' | 'en'
  onStop: () => void
  onAddMinute: () => void
  onDismissCompleted: () => void
}

export function ActiveTimerChip({
  timer,
  language = 'it',
  onStop,
  onAddMinute,
  onDismissCompleted,
}: Props) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (timer.status !== 'running') return
    const id = window.setInterval(() => setNow(Date.now()), 250)
    return () => window.clearInterval(id)
  }, [timer.status, timer.id])

  if (timer.status === 'cancelled') return null

  if (timer.status === 'completed') {
    return (
      <div
        className="composer-timer-chip composer-timer-chip--done"
        role="status"
        aria-live="assertive"
      >
        <span className="composer-timer-chip__icon" aria-hidden="true">
          ⏱️
        </span>
        <span className="composer-timer-chip__meta">
          <span className="composer-timer-chip__name">{timerCompletedMessage(language)}</span>
        </span>
        <button
          type="button"
          className="composer-timer-chip__btn"
          onClick={onDismissCompleted}
        >
          {language === 'en' ? 'OK' : 'OK'}
        </button>
      </div>
    )
  }

  const left = remainingMs(timer, now)
  return (
    <div className="composer-timer-chip" aria-label={`Timer ${formatCountdown(left)}`}>
      <span className="composer-timer-chip__icon" aria-hidden="true">
        ⏱️
      </span>
      <span className="composer-timer-chip__meta">
        <span className="composer-timer-chip__name">{timer.label || 'Timer'}</span>
        <span className="composer-timer-chip__time" aria-live="polite">
          {formatCountdown(left)}
        </span>
      </span>
      <div className="composer-timer-chip__actions">
        <button
          type="button"
          className="composer-timer-chip__btn"
          onClick={onAddMinute}
          title={language === 'en' ? 'Add 1 minute' : 'Aggiungi 1 minuto'}
        >
          +1
        </button>
        <button
          type="button"
          className="composer-timer-chip__btn composer-timer-chip__btn--stop"
          onClick={onStop}
          aria-label={language === 'en' ? 'Stop timer' : 'Ferma timer'}
        >
          {language === 'en' ? 'Stop' : 'Ferma'}
        </button>
      </div>
    </div>
  )
}
