import { memo, useLayoutEffect, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import type { MessageSelectionSnapshot } from './useMessageSelection'
import {
  computeActionBarPlacement,
  isCoarsePointerMobile,
} from './selectionToolbarLayout'
import './SelectionActionBar.css'

interface SelectionActionBarProps {
  snapshot: MessageSelectionSnapshot
  onDefine: () => void
  onExplain: () => void
  onDismiss: () => void
}

function readComposerInsetPx(): number {
  if (typeof document === 'undefined') return 92
  const dock = document.querySelector('.composer-dock') as HTMLElement | null
  if (dock) {
    return Math.ceil(dock.getBoundingClientRect().height) + 8
  }
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue('--composer-h')
    .trim()
  const parsed = Number.parseFloat(raw)
  const fallback = Number.isFinite(parsed) && parsed > 0 ? parsed : 5.75 * 16
  return Math.ceil(fallback + 8)
}

function readViewportBox() {
  const vv = typeof window !== 'undefined' ? window.visualViewport : null
  if (vv) {
    return {
      width: vv.width,
      height: vv.height,
      offsetTop: vv.offsetTop,
      offsetLeft: vv.offsetLeft,
    }
  }
  return {
    width: typeof window !== 'undefined' ? window.innerWidth : 360,
    height: typeof window !== 'undefined' ? window.innerHeight : 640,
    offsetTop: 0,
    offsetLeft: 0,
  }
}

function SelectionActionBarComponent({
  snapshot,
  onDefine,
  onExplain,
  onDismiss,
}: SelectionActionBarProps) {
  const [composerInsetPx, setComposerInsetPx] = useState(readComposerInsetPx)
  const [viewport, setViewport] = useState(readViewportBox)

  useLayoutEffect(() => {
    const sync = () => {
      setComposerInsetPx(readComposerInsetPx())
      setViewport(readViewportBox())
    }
    sync()
    const dock = document.querySelector('.composer-dock')
    const ro =
      typeof ResizeObserver !== 'undefined' && dock
        ? new ResizeObserver(() => sync())
        : null
    if (dock && ro) ro.observe(dock)
    window.addEventListener('resize', sync)
    window.visualViewport?.addEventListener('resize', sync)
    window.visualViewport?.addEventListener('scroll', sync)
    return () => {
      ro?.disconnect()
      window.removeEventListener('resize', sync)
      window.visualViewport?.removeEventListener('resize', sync)
      window.visualViewport?.removeEventListener('scroll', sync)
    }
  }, [snapshot.anchorRect.top, snapshot.anchorRect.bottom, snapshot.anchorRect.left])

  if (typeof document === 'undefined') return null

  const placement = computeActionBarPlacement({
    anchor: snapshot.anchorRect,
    viewport,
    composerInsetPx,
    isMobile: isCoarsePointerMobile(),
  })

  // Preserve the native Selection when tapping toolbar controls.
  // preventDefault on pointerdown stops focus/selection transfer without
  // rewriting the Range.
  const preserveSelection = (event: ReactPointerEvent) => {
    event.preventDefault()
  }

  const overlay = (
    <div
      className="selection-action-bar"
      role="toolbar"
      aria-label="Azioni sul testo selezionato"
      data-placement={placement.placement}
      style={{
        top: placement.top,
        left: placement.left,
        width: placement.width,
      }}
      onPointerDown={preserveSelection}
    >
      <button
        type="button"
        className="selection-action-bar__btn"
        onPointerDown={preserveSelection}
        onClick={onDefine}
      >
        Definisci
      </button>
      <button
        type="button"
        className="selection-action-bar__btn"
        onPointerDown={preserveSelection}
        onClick={onExplain}
      >
        Spiega
      </button>
      <button
        type="button"
        className="selection-action-bar__btn selection-action-bar__btn--ghost"
        onPointerDown={preserveSelection}
        onClick={onDismiss}
        aria-label="Chiudi"
      >
        ✕
      </button>
    </div>
  )

  // Portal to body so fixed positioning escapes .app-view transform trapping
  // (same architecture as SelectionInsightSheet).
  return createPortal(overlay, document.body)
}

export const SelectionActionBar = memo(SelectionActionBarComponent)
