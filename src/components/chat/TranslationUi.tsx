/**
 * #322 — Compact Translation result chip + Copy.
 */

import type { TranslationUiState } from '../../types'
import './TranslationUi.css'

type Props = {
  translationUi: TranslationUiState
  onAction: (actionId: string) => void
}

export function TranslationUi({ translationUi, onAction }: Props) {
  if (translationUi.kind !== 'result') return null
  const actions = translationUi.actions || []

  return (
    <div className="translation-ui" data-translation-kind={translationUi.kind}>
      {translationUi.chip ? (
        <div className="translation-ui__chip" aria-label="Languages">
          {translationUi.chip}
        </div>
      ) : null}
      {actions.length ? (
        <div className="translation-ui__actions" role="group" aria-label="Translation actions">
          {actions.map((a) => (
            <button
              key={a.id}
              type="button"
              className="translation-ui__btn"
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
