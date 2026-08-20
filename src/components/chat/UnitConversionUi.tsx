/**
 * #319 — Compact unit-conversion result chip.
 */

import type { UnitConversionUiState } from '../../types'
import './UnitConversionUi.css'

type Props = {
  unitConversionUi: UnitConversionUiState
  onAction: (actionId: string) => void
}

export function UnitConversionUi({ unitConversionUi, onAction }: Props) {
  if (unitConversionUi.kind !== 'result') return null
  const actions = unitConversionUi.actions || []

  return (
    <div className="unit-ui" data-unit-kind={unitConversionUi.kind}>
      <div className="unit-ui__card" aria-label="Conversione">
        <div className="unit-ui__source">{unitConversionUi.source}</div>
        <div className="unit-ui__arrow" aria-hidden="true">
          ↓
        </div>
        <div className="unit-ui__target">{unitConversionUi.target}</div>
      </div>
      {actions.length ? (
        <div className="unit-ui__actions" role="group" aria-label="Azioni conversione">
          {actions.map((a) => (
            <button
              key={a.id}
              type="button"
              className="unit-ui__btn"
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
