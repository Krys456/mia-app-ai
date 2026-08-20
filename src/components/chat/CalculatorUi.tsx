/**
 * #318 — Compact calculation result chip.
 */

import type { CalculatorUiState } from '../../types'
import './CalculatorUi.css'

type Props = {
  calculatorUi: CalculatorUiState
  onAction: (actionId: string) => void
}

export function CalculatorUi({ calculatorUi, onAction }: Props) {
  if (calculatorUi.kind !== 'result') return null
  const actions = calculatorUi.actions || []

  return (
    <div className="calc-ui" data-calc-kind={calculatorUi.kind}>
      <div className="calc-ui__card" aria-label="Calcolo">
        <div className="calc-ui__expr">{calculatorUi.expression}</div>
        <div className="calc-ui__eq">= {calculatorUi.result}</div>
      </div>
      {actions.length ? (
        <div className="calc-ui__actions" role="group" aria-label="Azioni calcolo">
          {actions.map((a) => (
            <button
              key={a.id}
              type="button"
              className="calc-ui__btn"
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
