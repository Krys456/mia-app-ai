/**
 * #320 — Compact Energy Math result chip.
 */

import type { EnergyMathUiState } from '../../types'
import './EnergyMathUi.css'

type Props = {
  energyMathUi: EnergyMathUiState
  onAction: (actionId: string) => void
}

export function EnergyMathUi({ energyMathUi, onAction }: Props) {
  if (energyMathUi.kind !== 'result') return null
  const actions = energyMathUi.actions || []

  return (
    <div className="energy-ui" data-energy-kind={energyMathUi.kind}>
      <div className="energy-ui__card" aria-label="Energy Math">
        <div className="energy-ui__title">{energyMathUi.title || 'Energia'}</div>
        <div className="energy-ui__expr">{energyMathUi.expression}</div>
        <div className="energy-ui__eq">= {energyMathUi.result}</div>
      </div>
      {actions.length ? (
        <div className="energy-ui__actions" role="group" aria-label="Azioni energy math">
          {actions.map((a) => (
            <button
              key={a.id}
              type="button"
              className="energy-ui__btn"
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
