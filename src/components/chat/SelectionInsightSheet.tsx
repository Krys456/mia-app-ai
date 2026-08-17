import { memo, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import type { SelectionInsightState } from './useMessageSelection'
import './SelectionInsightSheet.css'

interface SelectionInsightSheetProps {
  insight: SelectionInsightState
  onDismiss: () => void
  onRetry?: () => void
}

/**
 * Measure the live composer dock so the sheet clears it on mobile.
 * Falls back to --composer-h when the dock is missing.
 */
function useComposerDockInsetPx(): number {
  const [inset, setInset] = useState(0)

  useLayoutEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return

    const read = () => {
      const dock = document.querySelector('.composer-dock') as HTMLElement | null
      if (dock) {
        const h = Math.ceil(dock.getBoundingClientRect().height)
        // Gap above the dock so the sheet never kisses the composer edge.
        setInset(Math.max(h + 8, 0))
        return
      }
      const raw = getComputedStyle(document.documentElement)
        .getPropertyValue('--composer-h')
        .trim()
      const parsed = Number.parseFloat(raw)
      const fallback = Number.isFinite(parsed) && parsed > 0 ? parsed : 5.75 * 16
      setInset(Math.ceil(fallback + 8))
    }

    read()
    const dock = document.querySelector('.composer-dock')
    const ro =
      typeof ResizeObserver !== 'undefined' && dock
        ? new ResizeObserver(() => read())
        : null
    if (dock && ro) ro.observe(dock)
    window.addEventListener('resize', read)
    window.visualViewport?.addEventListener('resize', read)
    return () => {
      ro?.disconnect()
      window.removeEventListener('resize', read)
      window.visualViewport?.removeEventListener('resize', read)
    }
  }, [])

  return inset
}

function SelectionInsightSheetComponent({
  insight,
  onDismiss,
  onRetry,
}: SelectionInsightSheetProps) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const composerInsetPx = useComposerDockInsetPx()
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

  if (typeof document === 'undefined') return null

  const overlay = (
    <div
      className="selection-insight"
      role="dialog"
      aria-modal="true"
      aria-label={label}
      style={
        {
          ['--selection-composer-inset' as string]: `${composerInsetPx}px`,
        } as CSSProperties
      }
    >
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

  // Portal to body so fixed positioning escapes .app-view transform containing block
  // and paints above the sticky composer dock.
  return createPortal(overlay, document.body)
}

export const SelectionInsightSheet = memo(SelectionInsightSheetComponent)
