/**
 * #316 — Compact Places action chips / result actions.
 */

import type { PlacesUiState } from '../../types'
import './PlacesUi.css'

type Props = {
  placesUi: PlacesUiState
  onAction: (actionId: string) => void
}

export function PlacesUi({ placesUi, onAction }: Props) {
  const actions = placesUi.actions || []
  if (!actions.length && !placesUi.places?.length) return null

  return (
    <div className="places-ui" data-places-kind={placesUi.kind}>
      {placesUi.kind === 'results' && placesUi.places?.length ? (
        <ul className="places-ui__list" aria-label="Luoghi">
          {placesUi.places.map((p, i) => (
            <li key={p.id || String(i)} className="places-ui__item">
              <span className="places-ui__name">
                {i + 1}. {p.name}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {actions.length ? (
        <div className="places-ui__actions" role="group" aria-label="Azioni luoghi">
          {actions.map((a) => (
            <button
              key={a.id}
              type="button"
              className="places-ui__btn"
              onClick={() => onAction(a.id)}
            >
              {a.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
