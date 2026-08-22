/**
 * #336B — Compact Calendar status chip (Kami-quiet) + Settings handoff.
 */

import type { CalendarUiState } from '../../types'
import './CalendarUi.css'

type Props = {
  calendarUi: CalendarUiState
  onAction?: (actionId: string) => void
}

export function CalendarUi({ calendarUi, onAction }: Props) {
  if (calendarUi.kind !== 'status') return null
  const actions = calendarUi.actions || []
  const chip = calendarUi.chip

  if (!chip && !actions.length) return null

  return (
    <div className="calendar-ui" data-calendar-kind={calendarUi.kind}>
      <div className="calendar-ui__row" aria-label="Calendario">
        {chip ? <span className="calendar-ui__chip">{chip}</span> : null}
        {actions.map((a) => (
          <button
            key={a.id}
            type="button"
            className="calendar-ui__action"
            onClick={() => onAction?.(a.id)}
          >
            {a.label}
          </button>
        ))}
      </div>
    </div>
  )
}
