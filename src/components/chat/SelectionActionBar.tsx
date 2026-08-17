import { memo } from 'react'
import type { MessageSelectionSnapshot } from './useMessageSelection'
import './SelectionActionBar.css'

interface SelectionActionBarProps {
  snapshot: MessageSelectionSnapshot
  onDefine: () => void
  onExplain: () => void
  onDismiss: () => void
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

function SelectionActionBarComponent({
  snapshot,
  onDefine,
  onExplain,
  onDismiss,
}: SelectionActionBarProps) {
  const { anchorRect } = snapshot
  const vw = typeof window !== 'undefined' ? window.innerWidth : 360
  const barWidth = Math.min(280, vw - 24)
  const left = clamp(anchorRect.left + anchorRect.width / 2 - barWidth / 2, 12, vw - barWidth - 12)
  // Prefer above selection; if too high, place below.
  const placeBelow = anchorRect.top < 72
  const top = placeBelow
    ? Math.min(anchorRect.bottom + 8, (typeof window !== 'undefined' ? window.innerHeight : 640) - 64)
    : Math.max(8, anchorRect.top - 52)

  return (
    <div
      className="selection-action-bar"
      role="toolbar"
      aria-label="Azioni sul testo selezionato"
      style={{ top, left, width: barWidth }}
    >
      <button type="button" className="selection-action-bar__btn" onClick={onDefine}>
        Definisci
      </button>
      <button type="button" className="selection-action-bar__btn" onClick={onExplain}>
        Spiega
      </button>
      <button
        type="button"
        className="selection-action-bar__btn selection-action-bar__btn--ghost"
        onClick={onDismiss}
        aria-label="Chiudi"
      >
        ✕
      </button>
    </div>
  )
}

export const SelectionActionBar = memo(SelectionActionBarComponent)
