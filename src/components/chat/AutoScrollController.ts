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

const NEAR_BOTTOM_PX = 40

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
  private rafId: number | null = null
  private pinRafId: number | null = null
  private streaming = false
  private hasUnseenGrowth = false
  private listeners = new Set<AutoScrollListener>()
  private bound = false

  private onWheel = (event: WheelEvent) => {
    if (!this.scroller) return
    if (event.deltaY < 0 || distanceFromBottom(this.scroller) > NEAR_BOTTOM_PX) {
      this.pauseByUser()
    }
  }

  private onTouchMove = () => {
    this.pauseByUser()
  }

  private onPointerMove = (event: PointerEvent) => {
    // Mouse / pen drag on the scroller (scrollbar or content drag).
    if (event.pointerType === 'touch') return
    if (event.buttons === 0) return
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
      this.pauseByUser()
    }
  }

  private onScroll = () => {
    if (this.ignoreScroll || !this.scroller) return
    const near = distanceFromBottom(this.scroller) <= NEAR_BOTTOM_PX

    if (this.state === 'FOLLOWING') {
      if (!near) this.pauseByUser()
      return
    }

    if (near) {
      this.hasUnseenGrowth = false
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
      return
    }
    this.state = next
    if (next === 'FOLLOWING' && this.scroller) {
      this.lastHeight = this.scroller.scrollHeight
      this.hasUnseenGrowth = false
    }
    if (next !== 'FOLLOWING') {
      this.stopPin()
    }
    this.emit()
  }

  attach(scroller: HTMLElement) {
    this.detach()
    this.scroller = scroller
    this.lastHeight = scroller.scrollHeight
    this.bound = true

    scroller.addEventListener('wheel', this.onWheel, { passive: true })
    scroller.addEventListener('touchmove', this.onTouchMove, { passive: true })
    scroller.addEventListener('pointermove', this.onPointerMove, { passive: true })
    scroller.addEventListener('scroll', this.onScroll, { passive: true })
    window.addEventListener('keydown', this.onKeyDown)

    this.startLoop()
    this.emit()
  }

  detach() {
    this.stopLoop()
    this.stopPin()
    if (this.scroller && this.bound) {
      this.scroller.removeEventListener('wheel', this.onWheel)
      this.scroller.removeEventListener('touchmove', this.onTouchMove)
      this.scroller.removeEventListener('pointermove', this.onPointerMove)
      this.scroller.removeEventListener('scroll', this.onScroll)
      window.removeEventListener('keydown', this.onKeyDown)
    }
    this.scroller = null
    this.bound = false
  }

  setStreaming(streaming: boolean) {
    this.streaming = streaming
    if (streaming) {
      if (this.state !== 'PAUSED_BY_USER') {
        this.setState('FOLLOWING')
      } else {
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
  }

  /** User sent a message — always resume following the new turn. */
  onUserMessage() {
    this.hasUnseenGrowth = false
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
    this.ignoreScroll = false
  }

  private tick = () => {
    this.rafId = requestAnimationFrame(this.tick)
    const el = this.scroller
    if (!el) return

    const height = el.scrollHeight
    const growth = height - this.lastHeight
    this.lastHeight = height

    if (growth <= 0) return

    if (this.state === 'FOLLOWING') {
      this.applyDelta(growth)
      return
    }

    // New content while paused / idle away from bottom → show jump button.
    if (this.state === 'PAUSED_BY_USER' || distanceFromBottom(el) > NEAR_BOTTOM_PX) {
      this.hasUnseenGrowth = true
      this.emit()
    }
  }

  private startLoop() {
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
    this.setState('FOLLOWING')

    const pinTick = () => {
      this.pinRafId = null
      const scroller = this.scroller
      if (!scroller || this.state === 'PAUSED_BY_USER') return

      const remaining = distanceFromBottom(scroller)
      if (remaining <= NEAR_BOTTOM_PX) {
        if (remaining > 0) this.applyDelta(remaining)
        this.lastHeight = scroller.scrollHeight
        this.setState(this.streaming ? 'FOLLOWING' : 'IDLE')
        return
      }

      this.applyDelta(Math.max(12, remaining * 0.2))
      this.lastHeight = scroller.scrollHeight
      this.pinRafId = requestAnimationFrame(pinTick)
    }

    this.pinRafId = requestAnimationFrame(pinTick)
  }
}

/** @deprecated Use AutoScrollState */
export type AutoScrollMode = AutoScrollState
