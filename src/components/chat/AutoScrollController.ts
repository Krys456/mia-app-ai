/**
 * AutoScrollController — chat viewport ownership during assistant replies.
 *
 * Contract (#268):
 * - When a new assistant message starts: ONE intentional scroll so the
 *   beginning of that message is readable.
 * - During reveal / after finish: never mutate scrollTop for content growth.
 * - Unseen content below → show Scroll-to-Bottom.
 * - User moves via Scroll-to-Bottom or manual scroll only.
 *
 * States:
 * - IDLE: no active reveal ownership
 * - STABLE: answer start positioned (or user-owned); no growth-driven follow
 */

export type AutoScrollState = 'IDLE' | 'STABLE'

export type AutoScrollListener = (snapshot: {
  state: AutoScrollState
  showButton: boolean
}) => void

/** Distance (px) treated as "at / near bottom" for the jump button. */
export const NEAR_BOTTOM_PX = 56

/** Padding from the scroller top when pinning the assistant message start. */
const ASSISTANT_START_PAD_PX = 12

function distanceFromBottom(el: HTMLElement): number {
  return el.scrollHeight - el.scrollTop - el.clientHeight
}

function prefersReducedMotion(): boolean {
  if (typeof globalThis === 'undefined' || !globalThis.matchMedia) return false
  return globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export class AutoScrollController {
  private scroller: HTMLElement | null = null
  private state: AutoScrollState = 'IDLE'
  private lastHeight = 0
  private ignoreScroll = false
  private ignoreScrollRaf: number | null = null
  private rafId: number | null = null
  private pinRafId: number | null = null
  private streaming = false
  private hasUnseenGrowth = false
  /** Assistant message id already start-positioned for this turn. */
  private positionedAssistantId: string | null = null
  /** Extra frames after stream ends to catch markdown layout settle for the button. */
  private settleFrames = 0
  private listeners = new Set<AutoScrollListener>()
  private bound = false

  private isNearBottom(el: HTMLElement = this.scroller!): boolean {
    return distanceFromBottom(el) <= NEAR_BOTTOM_PX
  }

  private onScroll = () => {
    if (this.ignoreScroll || !this.scroller) return
    if (this.isNearBottom(this.scroller)) {
      this.hasUnseenGrowth = false
    } else {
      this.hasUnseenGrowth = true
    }
    this.emit()
  }

  subscribe(listener: AutoScrollListener): () => void {
    this.listeners.add(listener)
    listener(this.snapshot())
    return () => {
      this.listeners.delete(listener)
    }
  }

  snapshot() {
    const away =
      !!this.scroller && distanceFromBottom(this.scroller) > NEAR_BOTTOM_PX
    return {
      state: this.state,
      showButton: this.hasUnseenGrowth || away,
    }
  }

  /** Test helper — current controller state. */
  getState(): AutoScrollState {
    return this.state
  }

  /** Test helper — whether unseen content below is pending. */
  getHasUnseenGrowth(): boolean {
    return this.hasUnseenGrowth
  }

  /** Test helper — last assistant id that received start positioning. */
  getPositionedAssistantId(): string | null {
    return this.positionedAssistantId
  }

  private emit() {
    const snap = this.snapshot()
    for (const listener of this.listeners) listener(snap)
  }

  private setState(next: AutoScrollState) {
    if (this.state === next) {
      this.emit()
      if (this.needsLoop()) this.ensureLoop()
      return
    }
    this.state = next
    this.emit()
    if (this.needsLoop()) this.ensureLoop()
  }

  attach(scroller: HTMLElement) {
    this.detach()
    this.scroller = scroller
    this.lastHeight = scroller.scrollHeight
    this.bound = true

    scroller.addEventListener('scroll', this.onScroll, { passive: true })

    if (this.needsLoop()) this.ensureLoop()
    this.emit()
  }

  detach() {
    this.stopLoop()
    this.stopPin()
    if (this.ignoreScrollRaf != null) {
      cancelAnimationFrame(this.ignoreScrollRaf)
      this.ignoreScrollRaf = null
    }
    if (this.scroller && this.bound) {
      this.scroller.removeEventListener('scroll', this.onScroll)
    }
    this.scroller = null
    this.bound = false
    this.ignoreScroll = false
    this.positionedAssistantId = null
  }

  setStreaming(streaming: boolean) {
    this.streaming = streaming
    if (streaming) {
      this.settleFrames = 0
      // Do not reposition here — wait for onAssistantStart(messageId, el).
      this.ensureLoop()
      this.emit()
      return
    }

    // Stream finished: never jump. Keep STABLE; settle frames for markdown reflow button.
    this.settleFrames = 10
    this.ensureLoop()
    this.emit()
  }

  /**
   * User sent a message — clear prior turn positioning and bring the latest
   * turn area into view (bottom of current thread) so the new user bubble is visible.
   * Assistant start will re-pin when the answer bubble mounts.
   */
  onUserMessage() {
    this.positionedAssistantId = null
    this.hasUnseenGrowth = false
    this.scrollToBottom()
  }

  /**
   * Assistant bubble for this turn mounted / started — scroll ONCE so the
   * beginning of the answer is readable, then freeze (STABLE).
   */
  onAssistantStart(messageId: string, element: HTMLElement | null) {
    if (!messageId) return
    if (this.positionedAssistantId === messageId) return

    this.positionedAssistantId = messageId
    this.streaming = true
    this.hasUnseenGrowth = false
    this.settleFrames = 0

    if (element && this.scroller) {
      this.positionAssistantStart(element)
    }

    if (this.scroller) {
      this.lastHeight = this.scroller.scrollHeight
    }
    this.setState('STABLE')
    this.ensureLoop()
  }

  /**
   * Align the top of the assistant message near the top of the viewport.
   * Skip movement when the start is already comfortably visible and the
   * message fits (short reply).
   */
  private positionAssistantStart(element: HTMLElement) {
    const scroller = this.scroller
    if (!scroller) return

    const scrollerRect = scroller.getBoundingClientRect()
    const elRect = element.getBoundingClientRect()
    const topOffset = elRect.top - scrollerRect.top
    const alreadyReadable =
      topOffset >= -8 && topOffset <= ASSISTANT_START_PAD_PX + 48
    const fullyVisible =
      elRect.top >= scrollerRect.top - 4 && elRect.bottom <= scrollerRect.bottom + 4

    if (alreadyReadable && fullyVisible) {
      return
    }

    const delta = topOffset - ASSISTANT_START_PAD_PX
    if (Math.abs(delta) < 2) return

    this.writeScrollTop(scroller.scrollTop + delta)
  }

  private writeScrollTop(next: number) {
    const el = this.scroller
    if (!el) return
    const max = Math.max(0, el.scrollHeight - el.clientHeight)
    const clamped = Math.max(0, Math.min(max, next))
    if (Math.abs(clamped - el.scrollTop) < 1) return
    this.ignoreScroll = true
    el.scrollTop = clamped
    if (this.ignoreScrollRaf != null) cancelAnimationFrame(this.ignoreScrollRaf)
    this.ignoreScrollRaf = requestAnimationFrame(() => {
      this.ignoreScrollRaf = null
      this.ignoreScroll = false
    })
  }

  /** Run a single controller tick (used by tests). */
  tickOnce() {
    this.tick()
  }

  private tick = () => {
    this.rafId = null
    const el = this.scroller
    if (!el) return

    const height = el.scrollHeight
    const growth = height - this.lastHeight
    this.lastHeight = height

    if (growth > 0) {
      // Content grew below — never follow. Flag jump button when not at bottom.
      if (!this.isNearBottom(el)) {
        this.hasUnseenGrowth = true
        this.emit()
      }
    }

    if (this.settleFrames > 0) this.settleFrames -= 1

    if (this.needsLoop()) {
      this.rafId = requestAnimationFrame(this.tick)
    }
  }

  private needsLoop() {
    // Only while revealing (or brief post-finish settle) — never a permanent rAF loop.
    return this.streaming || this.settleFrames > 0
  }

  private ensureLoop() {
    if (this.rafId != null) return
    this.rafId = requestAnimationFrame(this.tick)
  }

  private stopLoop() {
    if (this.rafId == null) return
    cancelAnimationFrame(this.rafId)
    this.rafId = null
  }

  private stopPin() {
    if (this.pinRafId == null) return
    cancelAnimationFrame(this.pinRafId)
    this.pinRafId = null
  }

  /** Explicit user action — ease (or jump) to the latest content. */
  scrollToBottom() {
    const el = this.scroller
    if (!el) return

    this.stopPin()
    this.hasUnseenGrowth = false

    if (prefersReducedMotion()) {
      this.writeScrollTop(el.scrollHeight - el.clientHeight)
      this.lastHeight = el.scrollHeight
      this.setState(this.streaming ? 'STABLE' : 'IDLE')
      return
    }

    const pinTick = () => {
      this.pinRafId = null
      const scroller = this.scroller
      if (!scroller) return

      const remaining = distanceFromBottom(scroller)
      if (remaining <= 2) {
        if (remaining > 0) this.writeScrollTop(scroller.scrollTop + remaining)
        this.lastHeight = scroller.scrollHeight
        this.hasUnseenGrowth = false
        this.setState(this.streaming ? 'STABLE' : 'IDLE')
        this.emit()
        return
      }

      const step = Math.max(10, remaining * 0.18)
      this.writeScrollTop(scroller.scrollTop + step)
      this.lastHeight = scroller.scrollHeight
      this.pinRafId = requestAnimationFrame(pinTick)
    }

    this.pinRafId = requestAnimationFrame(pinTick)
  }
}
