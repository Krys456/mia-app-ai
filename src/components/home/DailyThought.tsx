/**
 * #335B — Daily philosophical thought (deterministic local rotation).
 */

import { useMemo } from 'react'
import { dailyThoughtForDate } from '../../lib/dailyThought'

export function DailyThought() {
  const thought = useMemo(() => dailyThoughtForDate(new Date()), [])

  return (
    <p className="home-thought type-daily-thought motion-ink-reveal" data-home="daily-thought">
      {thought}
    </p>
  )
}
