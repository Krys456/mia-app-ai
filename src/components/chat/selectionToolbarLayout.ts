/**
 * #290 — pure layout helpers for the selection action bar.
 * Kept DOM-free so settle/position contracts can be unit-tested in Node.
 */

export const MOBILE_SELECTION_SETTLE_MS = 220
export const DESKTOP_SELECTION_SETTLE_MS = 0
/** Extra clearance around selection rect so native handles/menu are not covered. */
export const MOBILE_HANDLE_SAFETY_PX = 52
export const DESKTOP_HANDLE_SAFETY_PX = 12
export const ACTION_BAR_ESTIMATED_HEIGHT_PX = 48
export const ACTION_BAR_VIEWPORT_GAP_PX = 12

export interface AnchorRectLike {
  top: number
  left: number
  right: number
  bottom: number
  width: number
  height: number
}

export interface ViewportBox {
  width: number
  height: number
  offsetTop?: number
  offsetLeft?: number
}

export interface ActionBarPlacementInput {
  anchor: AnchorRectLike
  viewport: ViewportBox
  /** Reserved bottom band (composer + safe area), in CSS px. */
  composerInsetPx: number
  isMobile: boolean
  barWidthPx?: number
  barHeightPx?: number
}

export interface ActionBarPlacement {
  top: number
  left: number
  width: number
  placement: 'below' | 'above'
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

export function isCoarsePointerMobile(
  mediaMatches: (query: string) => boolean = (q) =>
    typeof window !== 'undefined' ? window.matchMedia(q).matches : false,
): boolean {
  // Touch-primary devices get settle + handle safety. Fine pointer keeps desktop UX.
  return mediaMatches('(hover: none) and (pointer: coarse)')
}

/**
 * Prefer below the selection with a handle-safety gap.
 * Fall back above when the below slot collides with the composer/viewport floor.
 * Never overlaps the selection rect itself.
 */
export function computeActionBarPlacement(
  input: ActionBarPlacementInput,
): ActionBarPlacement {
  const {
    anchor,
    viewport,
    composerInsetPx,
    isMobile,
    barHeightPx = ACTION_BAR_ESTIMATED_HEIGHT_PX,
  } = input
  const safety = isMobile ? MOBILE_HANDLE_SAFETY_PX : DESKTOP_HANDLE_SAFETY_PX
  const gap = ACTION_BAR_VIEWPORT_GAP_PX
  const vvTop = viewport.offsetTop ?? 0
  const vvLeft = viewport.offsetLeft ?? 0
  const vw = viewport.width
  const vh = viewport.height
  const barWidth = Math.min(
    input.barWidthPx ?? 280,
    Math.max(160, vw - gap * 2),
  )

  const floorY = vvTop + vh - Math.max(composerInsetPx, 0) - gap
  const ceilingY = vvTop + gap

  const belowTop = anchor.bottom + safety
  const aboveTop = anchor.top - safety - barHeightPx

  const belowFits = belowTop + barHeightPx <= floorY
  const aboveFits = aboveTop >= ceilingY

  let placement: 'below' | 'above' = 'below'
  let top = belowTop

  if (belowFits) {
    placement = 'below'
    top = belowTop
  } else if (aboveFits) {
    placement = 'above'
    top = aboveTop
  } else {
    // Both tight — pick the side with more free space, then clamp.
    const spaceBelow = floorY - anchor.bottom
    const spaceAbove = anchor.top - ceilingY
    if (spaceBelow >= spaceAbove) {
      placement = 'below'
      top = Math.min(belowTop, floorY - barHeightPx)
    } else {
      placement = 'above'
      top = Math.max(aboveTop, ceilingY)
    }
  }

  top = clamp(top, ceilingY, Math.max(ceilingY, floorY - barHeightPx))

  const centerX = anchor.left + anchor.width / 2
  const left = clamp(centerX - barWidth / 2, vvLeft + gap, vvLeft + vw - barWidth - gap)

  return { top, left, width: barWidth, placement }
}

/** True when both endpoints resolve to the same non-empty assistant message id. */
export function sameAssistantMessageId(
  startMessageId: string | null | undefined,
  endMessageId: string | null | undefined,
): boolean {
  if (!startMessageId || !endMessageId) return false
  return startMessageId === endMessageId
}
