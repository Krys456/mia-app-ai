/**
 * #355B — Compact Places status chip + location-permission ask.
 * Mirrors src/components/chat/CalendarUi.tsx.
 */

import type { PlacesUiState } from '../../types'
import './PlacesUi.css'

type Props = {
  placesUi: PlacesUiState
  onAction?: (actionId: string) => void
}

export function PlacesUi({ placesUi, onAction }: Props) {
  const actions = placesUi.actions || []
  const chip = placesUi.chip

  if (!chip && !actions.length) return null

  return (
    <div className="places-ui" data-places-kind={placesUi.kind}>
      <div className="places-ui__row" aria-label="Luoghi">
        {chip ? <span className="places-ui__chip">{chip}</span> : null}
        {actions.map((a) => (
          <button
            key={a.id}
            type="button"
            className="places-ui__action"
            onClick={() => onAction?.(a.id)}
          >
            {a.label}
          </button>
        ))}
      </div>
    </div>
  )
}
