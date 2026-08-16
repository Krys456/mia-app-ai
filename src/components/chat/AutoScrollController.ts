/**
 * AutoScrollController — single authority for chat scroll follow during reveal.
 *
 * States:
 * - FOLLOWING: soft-follow content growth only while near bottom
 * - PAUSED_BY_USER: user reading above; never adjust scrollTop for growth
 * - IDLE: not revealing / settled at bottom; no active follow
 *
 * Never uses scrollIntoView() or scrollTop = scrollHeight jumps.
 *
 * TEMP (#268): Preview/dev `[chat-scroll][trace]` instrumentation — remove after
 * the mid-reveal follow bug is fixed and proven.
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

type UserIntentType =
  | 'none'
  | 'wheel_up'
  | 'touch_move_up'
  | 'keyboard_up'
  | 'pointer_drag'
  | 'scroll_away'

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

/** Preview/dev only — never Production custom domains. */
export function isChatScrollTraceEnabled(): boolean {
  try {
    // Vite dev server
    if (typeof import.meta !== 'undefined' && import.meta.env?.DEV) return true
  } catch {
    // ignore
  }
  if (typeof globalThis === 'undefined') return false
  const loc = (globalThis as { location?: Location }).location
  if (!loc || typeof loc.hostname !== 'string') return false
  const host = loc.hostname
  // Vercel git Preview aliases (…-git-…vercel.app) and deployment URLs used for PR previews.
  if (host.includes('-git-') && host.endsWith('.vercel.app')) return true
  try {
    return new URLSearchParams(loc.search || '').has('scrollTrace')
  } catch {
    return false
  }
}

function readOverflowAnchor(el: Element | null): string | null {
  if (!el || typeof getComputedStyle !== 'function') return null
  try {
    return getComputedStyle(el).overflowAnchor || null
  } catch {
    return null
  }
}

function sampleVisualAnchor(scroller: HTMLElement | null): {
  tag: string | null
  id: string | null
  top: number | null
} {
  if (!scroller || typeof document === 'undefined' || !document.elementFromPoint) {
    return { tag: null, id: null, top: null }
  }
  try {
    const rect = scroller.getBoundingClientRect()
    const x = rect.left + Math.min(48, rect.width * 0.5)
    const y = rect.top + Math.min(72, rect.height * 0.2)
    const hit = document.elementFromPoint(x, y)
    if (!(hit instanceof HTMLElement)) return { tag: null, id: null, top: null }
    const bubble = hit.closest('.bubble, [data-message-id]') as HTMLElement | null
    const target = bubble || hit
    return {
      tag: target.tagName.toLowerCase(),
      id: target.getAttribute('data-message-id') || target.id || target.className?.toString?.().slice(0, 64) || null,
      top: target.getBoundingClientRect().top,
    }
  } catch {
    return { tag: null, id: null, top: null }
  }
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

  private traceEnabled = false
  private traceStartedAt = 0
  private lastUserIntentType: UserIntentType = 'none'
  private lastUserIntentAt = 0
  private resizeObserver: ResizeObserver | null = null
  private lastVisualAnchorTop: number | null = null

  private markUserIntent(type: UserIntentType) {
    this.userIntent = true
    this.lastUserIntentType = type
    this.lastUserIntentAt = Date.now()
  }

  private trace(event: string, extra: Record<string, unknown> = {}) {
    if (!this.traceEnabled) return
    const el = this.scroller
    const scrollTop = el?.scrollTop ?? null
    const scrollHeight = el?.scrollHeight ?? null
    const clientHeight = el?.clientHeight ?? null
    const dist =
      el != null ? distanceFromBottom(el) : null
    const anchor = sampleVisualAnchor(el)
    console.log(
      JSON.stringify({
        tag: '[chat-scroll][trace]',
        event,
        elapsedMs: Date.now() - this.traceStartedAt,
        timestamp: Date.now(),
        controllerState: this.state,
        scrollTop,
        scrollHeight,
        clientHeight,
        distanceFromBottom: dist,
        previousScrollHeight: this.lastHeight,
        growthDelta: extra.growthDelta ?? null,
        isRevealing: this.streaming,
        nearBottom: el != null ? this.isNearBottom(el) : null,
        unseenGrowth: this.hasUnseenGrowth,
        lastUserIntentType: this.lastUserIntentType,
        lastUserIntentAt: this.lastUserIntentAt || null,
        programmaticScrollInProgress: this.ignoreScroll,
        pendingDelta: this.pendingDelta,
        rafId: this.rafId,
        pinRafId: this.pinRafId,
        visualAnchorTag: anchor.tag,
        visualAnchorId: anchor.id,
        visualAnchorTop: anchor.top,
        visualAnchorTopDelta:
          anchor.top != null && this.lastVisualAnchorTop != null
            ? anchor.top - this.lastVisualAnchorTop
            : null,
        overflowAnchorScroller: readOverflowAnchor(el),
        overflowAnchorMessageList: readOverflowAnchor(
          el?.querySelector?.('.message-list') ?? null,
        ),
        overflowAnchorStreaming: readOverflowAnchor(
          el?.querySelector?.('.md-body--streaming, .md-body--plain') ?? null,
        ),
        source: extra.source ?? 'AutoScrollController',
        ...extra,
      }),
    )
    if (anchor.top != null) this.lastVisualAnchorTop = anchor.top
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
      if (event.deltaY < WHEEL_UP_INTENT) {
        this.trace('wheel_up', { source: 'onWheel', deltaY: event.deltaY })
        this.markUserIntent('wheel_up')
      } else {
        this.markUserIntent('scroll_away')
      }
      this.pauseByUser()
    }
  }

  private onTouchStart = (event: TouchEvent) => {
    this.lastTouchY = event.touches[0]?.clientY ?? null
    this.trace('touch_start', {
      source: 'onTouchStart',
      touchY: this.lastTouchY,
    })
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
      if (dy > TOUCH_UP_INTENT_PX) {
        this.trace('touch_move_up', {
          source: 'onTouchMove',
          touchDy: dy,
          stateBeforePause: this.state,
        })
        this.markUserIntent('touch_move_up')
      } else {
        this.markUserIntent('scroll_away')
      }
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
      this.markUserIntent('pointer_drag')
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
      this.trace('keyboard_up', { source: 'onKeyDown', key: event.key })
      this.markUserIntent('keyboard_up')
      this.pauseByUser()
    }
  }

  private onScroll = () => {
    if (this.ignoreScroll || !this.scroller) return
    const near = this.isNearBottom(this.scroller)
    const inFollowZone = this.isWithinFollowZone(this.scroller)
    const stateBefore = this.state

    this.trace('scroll_event', {
      source: 'onScroll',
      near,
      inFollowZone,
      userIntentFlag: this.userIntent,
      ignoreScroll: this.ignoreScroll,
    })

    if (this.state === 'FOLLOWING') {
      // Soft-follow may lag true bottom — only pause on clear away + intent,
      // or when position is beyond soft-follow slack (user scrolled up).
      if ((this.userIntent && !near) || !inFollowZone) {
        this.trace('user_scroll_up', {
          source: 'onScroll',
          reason: this.userIntent && !near ? 'intent_not_near' : 'left_follow_zone',
        })
        this.pauseByUser()
      }
      this.userIntent = false
      return
    }

    this.userIntent = false

    if (near) {
      this.hasUnseenGrowth = false
      this.pendingDelta = 0
      // Manual return to bottom may resume FOLLOWING while revealing.
      // DIAG: also fires when still within NEAR_BOTTOM after a small upward pause.
      this.trace('manual_bottom_detected', {
        source: 'onScroll',
        stateBefore,
        willResumeFollowing: this.streaming,
        resumeReason: 'near_bottom_while_not_following',
      })
      this.setState(this.streaming ? 'FOLLOWING' : 'IDLE')
      if (stateBefore === 'PAUSED_BY_USER' && this.streaming) {
        this.trace('pause_exit', {
          source: 'onScroll',
          reason: 'near_bottom_auto_resume',
        })
      }
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
    const prev = this.state
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
    if (next === 'PAUSED_BY_USER' && prev !== 'PAUSED_BY_USER') {
      this.trace('pause_enter', { source: 'setState', prev })
    }
    if (prev === 'PAUSED_BY_USER' && next !== 'PAUSED_BY_USER') {
      this.trace('pause_exit', { source: 'setState', next })
    }
    this.emit()
    if (this.needsLoop()) this.ensureLoop()
  }

  attach(scroller: HTMLElement) {
    this.detach()
    this.scroller = scroller
    this.lastHeight = scroller.scrollHeight
    this.bound = true
    this.traceEnabled = isChatScrollTraceEnabled()
    this.traceStartedAt = Date.now()
    this.lastVisualAnchorTop = null

    scroller.addEventListener('wheel', this.onWheel, { passive: true })
    scroller.addEventListener('touchstart', this.onTouchStart, { passive: true })
    scroller.addEventListener('touchmove', this.onTouchMove, { passive: true })
    scroller.addEventListener('touchend', this.onTouchEnd, { passive: true })
    scroller.addEventListener('touchcancel', this.onTouchEnd, { passive: true })
    scroller.addEventListener('pointermove', this.onPointerMove, { passive: true })
    scroller.addEventListener('scroll', this.onScroll, { passive: true })
    globalThis.addEventListener?.('keydown', this.onKeyDown)

    // TEMP diagnostic: disable native scroll anchoring on Preview/dev only.
    if (this.traceEnabled) {
      this.scroller.classList?.add?.('chat-container__viewport--diag-no-anchor')
      this.scroller.querySelector?.('.message-list')?.classList?.add?.(
        'message-list--diag-no-anchor',
      )
      if (typeof ResizeObserver !== 'undefined') {
        this.resizeObserver = new ResizeObserver(() => {
          this.trace('resize_observer', { source: 'ResizeObserver' })
        })
        this.resizeObserver.observe(scroller)
      }
    }

    this.trace('controller_init', {
      source: 'attach',
      traceEnabled: this.traceEnabled,
    })

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
    this.resizeObserver?.disconnect()
    this.resizeObserver = null
    if (this.scroller && this.bound) {
      this.scroller.classList?.remove?.('chat-container__viewport--diag-no-anchor')
      this.scroller
        .querySelector?.('.message-list')
        ?.classList?.remove?.('message-list--diag-no-anchor')
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
    this.ignoreScroll = false
    this.traceEnabled = false
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
    this.trace('stream_finish', { source: 'setStreaming', state: this.state })
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
    this.trace('new_user_message', { source: 'onUserMessage' })
    this.hasUnseenGrowth = false
    this.pendingDelta = 0
    this.userIntent = false
    this.setState('FOLLOWING')
    this.scrollToBottom()
  }

  pauseByUser() {
    // Drop any pending soft-follow so the next rAF cannot drag the reader.
    this.pendingDelta = 0
    if (this.state === 'PAUSED_BY_USER') {
      this.emit()
      return
    }
    this.setState('PAUSED_BY_USER')
  }

  private applyDelta(delta: number) {
    if (!this.scroller || delta === 0) return
    // Hard guard: never move scrollTop while paused. Re-read CURRENT state
    // (stale rAF must not trust the state from schedule time).
    if (this.state === 'PAUSED_BY_USER') {
      this.trace('scroll_write_before', {
        source: 'applyDelta',
        writeAllowed: false,
        reason: 'paused',
        delta,
      })
      return
    }
    const before = this.scroller.scrollTop
    this.trace('scroll_write_before', {
      source: 'applyDelta',
      writeAllowed: true,
      delta,
      scrollTopBefore: before,
    })
    this.ignoreScroll = true
    this.scroller.scrollTop += delta
    this.trace('scroll_write_after', {
      source: 'applyDelta',
      delta,
      scrollTopBefore: before,
      scrollTopAfter: this.scroller.scrollTop,
    })
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

    const stateAtCallback = this.state
    const height = el.scrollHeight
    const growth = height - this.lastHeight
    this.lastHeight = height

    // Trace rAF callback when it can mutate scroll or when growth is observed
    // (avoid logging every empty settle frame).
    if (growth > 0 || this.pendingDelta > 0.5 || stateAtCallback === 'FOLLOWING') {
      this.trace('raf_callback', {
        source: 'tick',
        stateAtCallback,
        growthDelta: growth,
        writeWouldBeAllowed: stateAtCallback === 'FOLLOWING',
      })
    }

    if (growth > 0) {
      this.trace('reveal_growth', {
        source: 'tick',
        growthDelta: growth,
        willWriteScroll: this.state === 'FOLLOWING' && this.isWithinFollowZone(el),
        skipWrite: this.state === 'PAUSED_BY_USER',
      })
    }

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
      if (this.state === 'PAUSED_BY_USER' || distanceFromBottom(el) > NEAR_BOTTOM_PX) {
        this.hasUnseenGrowth = true
        this.emit()
      }
    }

    if (this.settleFrames > 0) this.settleFrames -= 1

    if (this.needsLoop()) {
      this.rafId = requestAnimationFrame(this.tick)
      if (growth > 0 || this.state === 'FOLLOWING' || this.pendingDelta > 0.5) {
        this.trace('raf_scheduled', {
          source: 'tick',
          stateAtSchedule: this.state,
        })
      }
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
    this.trace('raf_scheduled', {
      source: 'ensureLoop',
      stateAtSchedule: this.state,
    })
  }

  private stopLoop() {
    if (this.rafId == null) return
    cancelAnimationFrame(this.rafId)
    this.rafId = null
    this.trace('raf_cancelled', { source: 'stopLoop' })
  }

  private stopPin() {
    if (this.pinRafId == null) return
    cancelAnimationFrame(this.pinRafId)
    this.pinRafId = null
    this.trace('raf_cancelled', { source: 'stopPin' })
  }

  /** Smoothly ease toward bottom (or jump if reduced motion), then FOLLOWING/IDLE. */
  scrollToBottom() {
    const el = this.scroller
    if (!el) return

    this.trace('scroll_to_bottom_click', { source: 'scrollToBottom' })
    this.stopPin()
    this.hasUnseenGrowth = false
    this.pendingDelta = 0
    this.userIntent = false
    this.setState('FOLLOWING')

    if (prefersReducedMotion()) {
      this.ignoreScroll = true
      this.trace('scroll_write_before', {
        source: 'scrollToBottom_reducedMotion',
        writeAllowed: true,
      })
      const before = el.scrollTop
      el.scrollTop = el.scrollHeight - el.clientHeight
      this.trace('scroll_write_after', {
        source: 'scrollToBottom_reducedMotion',
        scrollTopBefore: before,
        scrollTopAfter: el.scrollTop,
      })
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
      if (!scroller || this.state === 'PAUSED_BY_USER') {
        this.trace('raf_callback', {
          source: 'pinTick',
          writeAllowed: false,
          reason: !scroller ? 'no_scroller' : 'paused',
        })
        return
      }

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
