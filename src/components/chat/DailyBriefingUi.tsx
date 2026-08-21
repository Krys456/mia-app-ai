/**
 * #321/#334B — Compact Daily Briefing chips (Kami-quiet).
 */

import type { DailyBriefingUiState } from '../../types'
import './DailyBriefingUi.css'

type Props = {
  dailyBriefingUi: DailyBriefingUiState
}

export function DailyBriefingUi({ dailyBriefingUi }: Props) {
  if (dailyBriefingUi.kind !== 'summary') return null
  const chips = dailyBriefingUi.chips || []
  if (!chips.length) return null

  return (
    <div className="briefing-ui" data-briefing-kind={dailyBriefingUi.kind}>
      <div className="briefing-ui__chips" aria-label="Briefing">
        {chips.map((c) => (
          <span
            key={c.id}
            className={`briefing-ui__chip${c.muted ? ' briefing-ui__chip--muted' : ''}`}
          >
            {c.label}
          </span>
        ))}
      </div>
    </div>
  )
}
