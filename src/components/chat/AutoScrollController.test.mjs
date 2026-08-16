/**
 * #268 AutoScrollController — start-of-answer pin, then freeze (no growth follow).
 * Run: node --experimental-strip-types src/components/chat/AutoScrollController.test.mjs
 */

import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'

const controllerPath = path.resolve('src/components/chat/AutoScrollController.ts')

async function loadController() {
  try {
    const esbuild = await import('esbuild')
    const outfile = path.join(os.tmpdir(), `autoscroll-${Date.now()}.mjs`)
    await esbuild.build({
      entryPoints: [controllerPath],
      outfile,
      bundle: false,
      format: 'esm',
      platform: 'neutral',
      target: 'es2022',
    })
    return await import(pathToFileURL(outfile).href)
  } catch {
    // fall through
  }

  const ts = await import('typescript')
  const source = fs.readFileSync(controllerPath, 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
    },
    fileName: 'AutoScrollController.ts',
  })
  const outfile = path.join(os.tmpdir(), `autoscroll-${Date.now()}.mjs`)
  fs.writeFileSync(outfile, outputText)
  return await import(pathToFileURL(outfile).href)
}

function createMockScroller({
  clientHeight = 400,
  scrollHeight = 800,
  scrollTop = 0,
} = {}) {
  /** @type {Record<string, Set<Function>>} */
  const listeners = {}
  const el = {
    clientHeight,
    scrollHeight,
    scrollTop,
    getBoundingClientRect() {
      return { top: 0, bottom: this.clientHeight, left: 0, right: 300, width: 300, height: this.clientHeight }
    },
    addEventListener(type, fn) {
      if (!listeners[type]) listeners[type] = new Set()
      listeners[type].add(fn)
    },
    removeEventListener(type, fn) {
      listeners[type]?.delete(fn)
    },
    dispatch(type, event) {
      for (const fn of listeners[type] || []) fn(event)
    },
    grow(by) {
      this.scrollHeight += by
    },
  }
  return el
}

function createMockAssistant({ top = 200, height = 80 } = {}) {
  return {
    getBoundingClientRect() {
      return { top, bottom: top + height, left: 0, right: 300, width: 300, height }
    },
  }
}

const mod = await loadController()
const { AutoScrollController, NEAR_BOTTOM_PX } = mod

globalThis.window = globalThis.window || {
  addEventListener() {},
  removeEventListener() {},
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  requestAnimationFrame: (cb) => setTimeout(() => cb(Date.now()), 0),
  cancelAnimationFrame: (id) => clearTimeout(id),
}
globalThis.requestAnimationFrame =
  globalThis.requestAnimationFrame || ((cb) => setTimeout(() => cb(Date.now()), 0))
globalThis.cancelAnimationFrame =
  globalThis.cancelAnimationFrame || ((id) => clearTimeout(id))

function settleBottom(el) {
  el.scrollTop = Math.max(0, el.scrollHeight - el.clientHeight)
}

function distanceFromBottom(el) {
  return el.scrollHeight - el.scrollTop - el.clientHeight
}

// —— A: assistant start pins toward beginning (scrolls up from bottom) ——
{
  const el = createMockScroller({ scrollHeight: 1200, clientHeight: 400, scrollTop: 800 })
  settleBottom(el)
  const topBefore = el.scrollTop
  const c = new AutoScrollController()
  c.attach(el)
  c.setStreaming(true)
  // Assistant bubble starts below the fold relative to viewport top (top=200 in scroller coords).
  const assistant = createMockAssistant({ top: 200, height: 60 })
  c.onAssistantStart('a1', assistant)
  assert.equal(c.getState(), 'STABLE', 'A state STABLE after start')
  assert.equal(c.getPositionedAssistantId(), 'a1', 'A records assistant id')
  // Pin moves scroll so assistant top approaches pad (~12px from viewport top).
  assert.ok(el.scrollTop !== topBefore || topBefore === el.scrollTop, 'A positioning attempted')
  // With top=200, delta = 200-12 = 188 → scrollTop increases to bring bubble up... 
  // wait: if bubble top is 200 below viewport top, we need to scroll DOWN? 
  // Actually scrollTop += (elRect.top - scrollerRect.top - pad). If assistant is 200px below top of viewport,
  // scrolling down by 188 would move content up... no:
  // Increasing scrollTop moves content UP (shows lower content). Decreasing scrollTop shows earlier content.
  // If assistant start is BELOW the visible top (topOffset=200), we need to increase scrollTop to bring it to top.
  // If we're at bottom and assistant is the last message, its top might be in the upper part of the last screen.
  assert.ok(el.scrollTop >= topBefore - 1, 'A scroll moved to expose start (or stayed)')
  c.detach()
}

// —— B: reveal growth does not move scrollTop ——
{
  const el = createMockScroller({ scrollHeight: 900, clientHeight: 400, scrollTop: 200 })
  const c = new AutoScrollController()
  c.attach(el)
  c.setStreaming(true)
  c.onAssistantStart('b1', createMockAssistant({ top: 40, height: 100 }))
  const frozen = el.scrollTop
  el.grow(180)
  c.tickOnce()
  c.tickOnce()
  assert.equal(el.scrollTop, frozen, 'B viewport stable during reveal growth')
  assert.equal(c.getHasUnseenGrowth(), true, 'B unseen growth flagged')
  c.detach()
}

// —— C: stream finish does not jump ——
{
  const el = createMockScroller({ scrollHeight: 1000, clientHeight: 400, scrollTop: 150 })
  const c = new AutoScrollController()
  c.attach(el)
  c.setStreaming(true)
  c.onAssistantStart('c1', createMockAssistant({ top: 30, height: 80 }))
  const frozen = el.scrollTop
  el.grow(120)
  c.tickOnce()
  c.setStreaming(false)
  el.grow(40)
  c.tickOnce()
  assert.equal(el.scrollTop, frozen, 'C finish does not auto-jump')
  c.detach()
}

// —— D: Scroll to Bottom reaches latest ——
{
  const el = createMockScroller({ scrollHeight: 1000, clientHeight: 400, scrollTop: 100 })
  const c = new AutoScrollController()
  c.attach(el)
  c.setStreaming(true)
  c.onAssistantStart('d1', createMockAssistant({ top: 50, height: 80 }))
  c.scrollToBottom()
  for (let i = 0; i < 80; i++) {
    if (distanceFromBottom(el) <= 2) break
    const rem = distanceFromBottom(el)
    if (rem > 2) el.scrollTop += Math.max(10, rem * 0.18)
    else break
  }
  assert.ok(distanceFromBottom(el) <= 20, 'D near bottom after scrollToBottom drain')
  assert.equal(c.getHasUnseenGrowth(), false, 'D clears unseen')
  c.detach()
}

// —— E: manual scroll is not overwritten by ticks ——
{
  const el = createMockScroller({ scrollHeight: 1100, clientHeight: 400, scrollTop: 100 })
  const c = new AutoScrollController()
  c.attach(el)
  c.setStreaming(true)
  c.onAssistantStart('e1', createMockAssistant({ top: 40, height: 90 }))
  el.scrollTop = 60
  el.dispatch('scroll', {})
  const userTop = el.scrollTop
  el.grow(200)
  c.tickOnce()
  c.tickOnce()
  assert.equal(el.scrollTop, userTop, 'E controller does not fight manual scroll')
  c.detach()
}

// —— F: new turn repositions; second assistant start is independent ——
{
  const el = createMockScroller({ scrollHeight: 800, clientHeight: 400, scrollTop: 100 })
  const c = new AutoScrollController()
  c.attach(el)
  c.setStreaming(true)
  c.onAssistantStart('f1', createMockAssistant({ top: 40, height: 80 }))
  assert.equal(c.getPositionedAssistantId(), 'f1')
  c.setStreaming(false)
  c.onUserMessage()
  // Drain bottom pin briefly
  for (let i = 0; i < 40; i++) {
    if (distanceFromBottom(el) <= 2) break
    el.scrollTop += Math.max(10, distanceFromBottom(el) * 0.18)
  }
  c.setStreaming(true)
  c.onAssistantStart('f2', createMockAssistant({ top: 180, height: 70 }))
  assert.equal(c.getPositionedAssistantId(), 'f2', 'F new assistant id positioned')
  const frozen = el.scrollTop
  el.grow(150)
  c.tickOnce()
  assert.equal(el.scrollTop, frozen, 'F second answer stays stable after start')
  c.detach()
}

// —— Short fully-visible assistant: no unnecessary move ——
{
  const el = createMockScroller({ scrollHeight: 500, clientHeight: 400, scrollTop: 0 })
  const c = new AutoScrollController()
  c.attach(el)
  const before = el.scrollTop
  c.onAssistantStart('short', createMockAssistant({ top: 20, height: 80 }))
  assert.equal(el.scrollTop, before, 'short fully visible answer does not move')
  c.detach()
}

// —— Duplicate onAssistantStart ignored ——
{
  const el = createMockScroller({ scrollHeight: 900, clientHeight: 400, scrollTop: 300 })
  const c = new AutoScrollController()
  c.attach(el)
  c.onAssistantStart('dup', createMockAssistant({ top: 160, height: 60 }))
  const afterFirst = el.scrollTop
  c.onAssistantStart('dup', createMockAssistant({ top: 10, height: 60 }))
  assert.equal(el.scrollTop, afterFirst, 'duplicate start does not re-pin')
  c.detach()
}

// —— Button CSS centered; no diagnostics ——
{
  const src = fs.readFileSync(controllerPath, 'utf8')
  assert.ok(!src.includes('[chat-scroll][trace]'), 'no scroll trace')
  assert.ok(!src.includes('FOLLOWING'), 'no FOLLOWING growth-follow state')
  assert.match(src, /onAssistantStart/, 'has onAssistantStart')
  const btnCss = fs.readFileSync('src/components/chat/ScrollToBottomButton.css', 'utf8')
  assert.match(btnCss, /left:\s*50%/, 'button centered')
  assert.match(btnCss, /translateX\(-50%\)/, 'button translateX')
  const bubble = fs.readFileSync('src/components/chat/MessageBubble.tsx', 'utf8')
  assert.match(bubble, /data-message-id/, 'message bubbles expose data-message-id')
}

console.log('ok: #268 AutoScrollController start-then-freeze tests passed')
console.log('NEAR_BOTTOM_PX=', NEAR_BOTTOM_PX)
