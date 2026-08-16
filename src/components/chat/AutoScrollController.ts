/**
 * AutoScrollController — single authority for chat scroll follow during reveal.
 *
 * States:
 * - FOLLOWING: soft-follow content growth only while near bottom
 * - PAUSED_BY_USER: user reading above; never adjust scrollTop for growth
 * - IDLE: not revealing / settled at bottom; no active follow
 *
 * Resume from PAUSED_BY_USER only via:
 * - Scroll-to-Bottom button / scrollToBottom()
 * - onUserMessage / new send
 * - user-driven return to bottom AFTER the paused session left the near zone
 *
 * Never uses scrollIntoView() or scrollTop = scrollHeight jumps.
 */

export type AutoScrollState = 'FOLLOWING' | 'PAUSED_BY_USER' | 'IDLE'

export type AutoScrollListener = (snapshot: {
  state: AutoScrollState
  showButton: boolean
}) => void

/** Distance (px) treated as "at / near bottom" for follow + button. */
export const NEAR_BOTTOM_PX = 56

/** Upward touch delta (px) that counts as clear reading intent. */
const TOUCH_UP_INTENT_PX = 4

/** Wheel deltaY below this (negative = scroll up) counts as upward intent. */
const WHEEL_UP_INTENT = -2

function distanceFromBottom(el: HTMLElement): number {
  return el.scrollHeight - el.scrollTop - el.clientHeight
}

function prefersReducedMotion(): boolean {
  if (typeof globalThis === 'undefined' || !globalThis.matchMedia) return false
  return globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches
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
  /**
   * While PAUSED_BY_USER: true only after the user has been meaningfully away
   * from the near-bottom zone. Prevents the same upward gesture's scroll event
   * (still near) from auto-resuming FOLLOWING.
   */
  private hasLeftNearZone = false
  /** Extra frames after stream ends to catch markdown layout settle. */
  private settleFrames = 0
  private lastTouchY: number | null = null
  private listeners = new Set<AutoScrollListener>()
  private bound = false

  private markUserIntent() {
    this.userIntent = true
  }

  /**
   * Slack above NEAR_BOTTOM while FOLLOWING: soft-follow eases and can lag
   * true bottom. Beyond this, treat position as "user reading above".
   */
  private followSlackPx(): number {
    return Math.max(96, this.pendingDelta + 24)
  }

  private isNearBottom(el: HTMLElement = this.scroller!): boolean {
    return distanceFromBottom(el) <= NEAR_BOTTOM_PX
  }

  /** Near enough that soft-follow may still catch up without dragging a reader. */
  private isWithinFollowZone(el: HTMLElement): boolean {
    return distanceFromBottom(el) <= NEAR_BOTTOM_PX + this.followSlackPx()
  }

  private onWheel = (event: WheelEvent) => {
    if (!this.scroller) return
    // Clear upward intent pauses immediately — do not wait for scroll settle.
    if (event.deltaY < WHEEL_UP_INTENT || distanceFromBottom(this.scroller) > NEAR_BOTTOM_PX) {
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
    // Also pause if already away from bottom (browsing history).
    if (dy > TOUCH_UP_INTENT_PX || distanceFromBottom(this.scroller) > NEAR_BOTTOM_PX) {
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
    if (!this.scroller) return
    // Only pause when drag moves us away from bottom or during reveal follow.
    if (this.state === 'FOLLOWING' || distanceFromBottom(this.scroller) > NEAR_BOTTOM_PX) {
      this.markUserIntent()
      this.pauseByUser()
    }
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
    const near = this.isNearBottom(this.scroller)
    const inFollowZone = this.isWithinFollowZone(this.scroller)

    if (this.state === 'FOLLOWING') {
      // Soft-follow may lag true bottom — only pause on clear away + intent,
      // or when position is beyond soft-follow slack (user scrolled up).
      if ((this.userIntent && !near) || !inFollowZone) {
        this.pauseByUser()
      }
      this.userIntent = false
      return
    }

    // Track meaningful leave of the near zone while paused (or idle-away).
    if (!near) {
      this.hasLeftNearZone = true
    }

    this.userIntent = false

    if (near) {
      // Same upward gesture often still reports nearBottom — stay paused until
      // the user has left the near zone and later returns, or uses explicit resume.
      if (this.state === 'PAUSED_BY_USER' && !this.hasLeftNearZone) {
        this.emit()
        return
      }

      this.hasUnseenGrowth = false
      this.pendingDelta = 0
      this.hasLeftNearZone = false
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

  /** Test helper — current controller state. */
  getState(): AutoScrollState {
    return this.state
  }

  /** Test helper — whether unseen reveal growth is pending. */
  getHasUnseenGrowth(): boolean {
    return this.hasUnseenGrowth
  }

  /** Test helper — whether this pause session left the near-bottom zone. */
  getHasLeftNearZone(): boolean {
    return this.hasLeftNearZone
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
      this.hasLeftNearZone = false
    }
    if (next === 'IDLE') {
      this.hasLeftNearZone = false
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
    globalThis.addEventListener?.('keydown', this.onKeyDown)

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
      globalThis.removeEventListener?.('keydown', this.onKeyDown)
    }
    this.scroller = null
    this.bound = false
    this.lastTouchY = null
    this.userIntent = false
    this.hasLeftNearZone = false
    this.ignoreScroll = false
  }

  setStreaming(streaming: boolean) {
    this.streaming = streaming
    if (streaming) {
      this.settleFrames = 0
      // Never auto-unpause: growth alone must not resume FOLLOWING.
      if (this.state !== 'PAUSED_BY_USER') {
        this.setState('FOLLOWING')
      } else {
        this.ensureLoop()
        this.emit()
      }
      return
    }

    // Streaming ended → IDLE if we were following. Stay PAUSED if user is reading.
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
    this.hasLeftNearZone = false
    this.setState('FOLLOWING')
    this.scrollToBottom()
  }

  pauseByUser() {
    // Drop any pending soft-follow so the next rAF cannot drag the reader.
    this.pendingDelta = 0
    if (this.state === 'PAUSED_BY_USER') {
      // Already paused — still mark leave-zone if the user kept scrolling away.
      if (this.scroller && !this.isNearBottom(this.scroller)) {
        this.hasLeftNearZone = true
      }
      this.emit()
      return
    }
    // Fresh pause: require a later leave of the near zone before near can resume.
    this.hasLeftNearZone = this.scroller ? !this.isNearBottom(this.scroller) : false
    this.setState('PAUSED_BY_USER')
  }

  private applyDelta(delta: number) {
    if (!this.scroller || delta === 0) return
    // Hard guard: never move scrollTop while paused. Re-read CURRENT state.
    if (this.state === 'PAUSED_BY_USER') return
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
    if (this.state !== 'FOLLOWING') {
      this.pendingDelta = 0
      return
    }
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

    if (this.state === 'FOLLOWING') {
      if (!this.isWithinFollowZone(el)) {
        // Reader moved above the follow zone — freeze viewport; mark unseen growth.
        if (growth > 0) this.hasUnseenGrowth = true
        this.pendingDelta = 0
        this.pauseByUser()
      } else if (growth > 0) {
        this.followGrowth(growth)
      } else if (this.pendingDelta > 0.5) {
        this.followGrowth(0)
      }
    } else if (growth > 0) {
      // New content while paused / idle away from bottom → show jump button.
      // Never adjust scrollTop here — reading position must stay put.
      // Reveal growth must NOT mark hasLeftNearZone (layout ≠ user leave).
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

  /** Smoothly ease toward bottom (or jump if reduced motion), then FOLLOWING/IDLE. */
  scrollToBottom() {
    const el = this.scroller
    if (!el) return

    this.stopPin()
    this.hasUnseenGrowth = false
    this.pendingDelta = 0
    this.userIntent = false
    this.hasLeftNearZone = false
    this.setState('FOLLOWING')

    if (prefersReducedMotion()) {
      this.ignoreScroll = true
      el.scrollTop = el.scrollHeight - el.clientHeight
      this.lastHeight = el.scrollHeight
      this.pendingDelta = 0
      requestAnimationFrame(() => {
        this.ignoreScroll = false
      })
      this.setState(this.streaming ? 'FOLLOWING' : 'IDLE')
      return
    }

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
