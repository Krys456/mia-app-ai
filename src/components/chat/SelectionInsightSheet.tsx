import { memo, useEffect, useRef } from 'react'
import type { SelectionInsightState } from './useMessageSelection'
import './SelectionInsightSheet.css'

interface SelectionInsightSheetProps {
  insight: SelectionInsightState
  onDismiss: () => void
  onRetry?: () => void
}

function SelectionInsightSheetComponent({
  insight,
  onDismiss,
  onRetry,
}: SelectionInsightSheetProps) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const label =
    insight.operation === 'define'
      ? 'Definizione'
      : insight.operation === 'explain'
        ? 'Spiegazione'
        : 'Insight'

  useEffect(() => {
    // Focus close after load settles — do not steal focus during native selection.
    if (!insight.loading) {
      closeRef.current?.focus()
    }
  }, [insight.loading, insight.result, insight.error])

  return (
    <div className="selection-insight" role="dialog" aria-modal="true" aria-label={label}>
      <button
        type="button"
        className="selection-insight__backdrop"
        aria-label="Chiudi"
        onClick={onDismiss}
      />
      <div className="selection-insight__sheet">
        <header className="selection-insight__header">
          <div className="selection-insight__meta">
            <span className="selection-insight__op">{label}</span>
            <p className="selection-insight__selected">“{insight.selectedText}”</p>
          </div>
          <button
            ref={closeRef}
            type="button"
            className="selection-insight__close"
            onClick={onDismiss}
            aria-label="Chiudi"
          >
            Chiudi
          </button>
        </header>

        <div className="selection-insight__body">
          {insight.loading ? (
            <p className="selection-insight__loading" aria-live="polite">
              Un momento…
            </p>
          ) : insight.error ? (
            <div className="selection-insight__error" role="alert">
              <p>{insight.error}</p>
              {onRetry ? (
                <button type="button" className="selection-insight__retry" onClick={onRetry}>
                  Riprova
                </button>
              ) : null}
            </div>
          ) : (
            <p className="selection-insight__result">{insight.result}</p>
          )}
        </div>
      </div>
    </div>
  )
}

export const SelectionInsightSheet = memo(SelectionInsightSheetComponent)
