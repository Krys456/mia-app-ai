/**
 * #357B — Compact Reminder proposal actions (Conferma / Annulla).
 */

import type { ReminderUiState } from '../../types'
import './ReminderUi.css'

type Props = {
  reminderUi: ReminderUiState
  onAction?: (actionId: string) => void
}

export function ReminderUi({ reminderUi, onAction }: Props) {
  const actions = reminderUi.actions || []
  const chip = reminderUi.chip
  if (!chip && !actions.length) return null

  return (
    <div className="reminder-ui" data-reminder-kind={reminderUi.kind}>
      <div className="reminder-ui__row" aria-label="Promemoria">
        {chip ? <span className="reminder-ui__chip">{chip}</span> : null}
        {actions.map((a) => (
          <button
            key={a.id}
            type="button"
            className={`reminder-ui__action${a.id === 'confirm' ? ' reminder-ui__action--primary' : ''}`}
            onClick={() => onAction?.(a.id)}
          >
            {a.label}
          </button>
        ))}
      </div>
    </div>
  )
}
