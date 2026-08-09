/**
 * AutoScrollController — single-responsibility scroll follow for streaming chat.
 *
 * States:
 * - FOLLOWING: apply content growth each frame (scrollTop += Δheight)
 * - PAUSED_BY_USER: user took over; never force scroll
 * - IDLE: model finished; no active follow
 *
 * Never uses scrollIntoView() or scrollTop = scrollHeight jumps.
 */

export type AutoScrollState = 'FOLLOWING' | 'PAUSED_BY_USER' | 'IDLE'

export type AutoScrollListener = (snapshot: {
  state: AutoScrollState
  showButton: boolean
}) => void

const NEAR_BOTTOM_PX = 56

function distanceFromBottom(el: HTMLElement): number {
  return el.scrollHeight - el.scrollTop - el.clientHeight
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    target.isContentEditable
  )
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
  /** Residual growth to ease in when a single frame adds a large block. */
  private pendingDelta = 0
  /** Real user input (wheel/touch/key/drag) — not programmatic soft-follow. */
  private userIntent = false
  /** Extra frames after stream ends to catch markdown layout settle. */
  private settleFrames = 0
  private lastTouchY: number | null = null
  private listeners = new Set<AutoScrollListener>()
  private bound = false

  private markUserIntent() {
    this.userIntent = true
  }

  private onWheel = (event: WheelEvent) => {
    if (!this.scroller) return
    if (event.deltaY < 0 || distanceFromBottom(this.scroller) > NEAR_BOTTOM_PX) {
      this.markUserIntent()
      this.pauseByUser()
    }
  }

  private onTouchStart = (event: TouchEvent) => {
    this.lastTouchY = event.touches[0]?.clientY ?? null
  }

  private onTouchMove = (event: TouchEvent) => {
    if (!this.scroller) return
    const y = event.touches[0]?.clientY
    if (y == null) return

    if (this.lastTouchY == null) {
      this.lastTouchY = y
      return
    }

    const dy = y - this.lastTouchY
    this.lastTouchY = y

    // Finger moving down → content scrolls up (reading earlier messages).
    // Also pause if already away from bottom (user is browsing history).
    if (dy > 6 || distanceFromBottom(this.scroller) > NEAR_BOTTOM_PX) {
      this.markUserIntent()
      this.pauseByUser()
    }
  }

  private onTouchEnd = () => {
    this.lastTouchY = null
  }

  private onPointerMove = (event: PointerEvent) => {
    // Mouse / pen drag on the scroller (scrollbar or content drag).
    if (event.pointerType === 'touch') return
    if (event.buttons === 0) return
    this.markUserIntent()
    this.pauseByUser()
  }

  private onKeyDown = (event: KeyboardEvent) => {
    if (!this.scroller || isEditableTarget(event.target)) return
    const away = distanceFromBottom(this.scroller) > NEAR_BOTTOM_PX
    if (
      event.key === 'PageUp' ||
      event.key === 'Home' ||
      event.key === 'ArrowUp' ||
      (event.key === 'PageDown' && away) ||
      (event.key === 'ArrowDown' && away) ||
      (event.key === ' ' && !event.shiftKey && away)
    ) {
      this.markUserIntent()
      this.pauseByUser()
    }
  }

  private onScroll = () => {
    if (this.ignoreScroll || !this.scroller) return
    const near = distanceFromBottom(this.scroller) <= NEAR_BOTTOM_PX

    if (this.state === 'FOLLOWING') {
      // Soft-follow intentionally lags true bottom. Only pause on real user intent.
      if (this.userIntent && !near) this.pauseByUser()
      this.userIntent = false
      return
    }

    this.userIntent = false

    if (near) {
      this.hasUnseenGrowth = false
      this.pendingDelta = 0
      this.setState(this.streaming ? 'FOLLOWING' : 'IDLE')
      return
    }

    // Away from bottom while idle → treat as user-paused so the jump button shows.
    if (this.state === 'IDLE') {
      this.pauseByUser()
    } else {
      this.emit()
    }
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
      showButton:
        this.state === 'PAUSED_BY_USER' || this.hasUnseenGrowth || away,
    }
  }

  private emit() {
    const snap = this.snapshot()
    for (const listener of this.listeners) listener(snap)
  }

  private setState(next: AutoScrollState) {
    if (this.state === next) {
      this.emit()
      if (next === 'FOLLOWING' || this.needsLoop()) this.ensureLoop()
      return
    }
    this.state = next
    if (next === 'FOLLOWING' && this.scroller) {
      this.lastHeight = this.scroller.scrollHeight
      this.hasUnseenGrowth = false
      this.pendingDelta = 0
      this.userIntent = false
    }
    if (next !== 'FOLLOWING') {
      this.stopPin()
      this.pendingDelta = 0
    }
    this.emit()
    if (this.needsLoop()) this.ensureLoop()
  }

  attach(scroller: HTMLElement) {
    this.detach()
    this.scroller = scroller
    this.lastHeight = scroller.scrollHeight
    this.bound = true

    scroller.addEventListener('wheel', this.onWheel, { passive: true })
    scroller.addEventListener('touchstart', this.onTouchStart, { passive: true })
    scroller.addEventListener('touchmove', this.onTouchMove, { passive: true })
    scroller.addEventListener('touchend', this.onTouchEnd, { passive: true })
    scroller.addEventListener('touchcancel', this.onTouchEnd, { passive: true })
    scroller.addEventListener('pointermove', this.onPointerMove, { passive: true })
    scroller.addEventListener('scroll', this.onScroll, { passive: true })
    window.addEventListener('keydown', this.onKeyDown)

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
      this.scroller.removeEventListener('wheel', this.onWheel)
      this.scroller.removeEventListener('touchstart', this.onTouchStart)
      this.scroller.removeEventListener('touchmove', this.onTouchMove)
      this.scroller.removeEventListener('touchend', this.onTouchEnd)
      this.scroller.removeEventListener('touchcancel', this.onTouchEnd)
      this.scroller.removeEventListener('pointermove', this.onPointerMove)
      this.scroller.removeEventListener('scroll', this.onScroll)
      window.removeEventListener('keydown', this.onKeyDown)
    }
    this.scroller = null
    this.bound = false
    this.lastTouchY = null
    this.userIntent = false
    this.ignoreScroll = false
  }

  setStreaming(streaming: boolean) {
    this.streaming = streaming
    if (streaming) {
      this.settleFrames = 0
      if (this.state !== 'PAUSED_BY_USER') {
        this.setState('FOLLOWING')
      } else {
        this.ensureLoop()
        this.emit()
      }
      return
    }

    // Streaming ended → IDLE if we were following.
    if (this.state === 'FOLLOWING') {
      this.setState('IDLE')
    } else {
      this.emit()
    }
    // Catch plain→markdown layout settle for the jump button.
    this.settleFrames = 10
    this.ensureLoop()
  }

  /** User sent a message — always resume following the new turn. */
  onUserMessage() {
    this.hasUnseenGrowth = false
    this.pendingDelta = 0
    this.userIntent = false
    this.setState('FOLLOWING')
    this.scrollToBottom()
  }

  pauseByUser() {
    if (this.state === 'PAUSED_BY_USER') {
      this.emit()
      return
    }
    this.setState('PAUSED_BY_USER')
  }

  private applyDelta(delta: number) {
    if (!this.scroller || delta === 0) return
    this.ignoreScroll = true
    this.scroller.scrollTop += delta
    // Clear after paint so async scroll events from this write are ignored.
    if (this.ignoreScrollRaf != null) cancelAnimationFrame(this.ignoreScrollRaf)
    this.ignoreScrollRaf = requestAnimationFrame(() => {
      this.ignoreScrollRaf = null
      this.ignoreScroll = false
    })
  }

  /**
   * Follow content growth smoothly: small deltas apply immediately;
   * large spikes are eased over a few frames so scroll never jumps.
   */
  private followGrowth(growth: number) {
    this.pendingDelta += growth
    if (this.pendingDelta <= 0) {
      this.pendingDelta = 0
      return
    }

    // Soft follow: take most of the pending delta each frame, never all of a huge spike at once.
    const step =
      this.pendingDelta <= 24
        ? this.pendingDelta
        : Math.max(16, this.pendingDelta * 0.42)

    this.applyDelta(step)
    this.pendingDelta -= step
  }

  private tick = () => {
    this.rafId = null
    const el = this.scroller
    if (!el) return

    const height = el.scrollHeight
    const growth = height - this.lastHeight
    this.lastHeight = height

    if (this.state === 'FOLLOWING') {
      if (growth > 0) {
        this.followGrowth(growth)
      } else if (this.pendingDelta > 0.5) {
        this.followGrowth(0)
      }
    } else if (growth > 0) {
      // New content while paused / idle away from bottom → show jump button.
      if (this.state === 'PAUSED_BY_USER' || distanceFromBottom(el) > NEAR_BOTTOM_PX) {
        this.hasUnseenGrowth = true
        this.emit()
      }
    }

    if (this.settleFrames > 0) this.settleFrames -= 1

    if (this.needsLoop()) {
      this.rafId = requestAnimationFrame(this.tick)
    }
  }

  /** Keep the loop only while follow work or streaming growth detection is needed. */
  private needsLoop() {
    return (
      this.state === 'FOLLOWING' ||
      this.pendingDelta > 0.5 ||
      this.settleFrames > 0 ||
      (this.streaming && this.state === 'PAUSED_BY_USER')
    )
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

  /** Smoothly ease toward bottom, then enter FOLLOWING (or IDLE if not streaming). */
  scrollToBottom() {
    const el = this.scroller
    if (!el) return

    this.stopPin()
    this.hasUnseenGrowth = false
    this.pendingDelta = 0
    this.userIntent = false
    this.setState('FOLLOWING')

    const pinTick = () => {
      this.pinRafId = null
      const scroller = this.scroller
      if (!scroller || this.state === 'PAUSED_BY_USER') return

      const remaining = distanceFromBottom(scroller)
      if (remaining <= 2) {
        if (remaining > 0) this.applyDelta(remaining)
        this.lastHeight = scroller.scrollHeight
        this.pendingDelta = 0
        this.setState(this.streaming ? 'FOLLOWING' : 'IDLE')
        return
      }

      // Ease-out toward bottom — never teleport.
      const step = Math.max(10, remaining * 0.18)
      this.applyDelta(step)
      this.lastHeight = scroller.scrollHeight
      this.pinRafId = requestAnimationFrame(pinTick)
    }

    this.pinRafId = requestAnimationFrame(pinTick)
  }
}
