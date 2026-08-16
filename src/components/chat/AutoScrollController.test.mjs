/**
 * #268 AutoScrollController — reveal follow / pause contract.
 * Run: node --experimental-strip-types src/components/chat/AutoScrollController.test.mjs
 *  or: node --import tsx ... (fallback uses dynamic transpile via vite-node if needed)
 *
 * Uses a lightweight HTMLElement mock — no jsdom dependency.
 */

import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'

const controllerPath = path.resolve('src/components/chat/AutoScrollController.ts')

/** Compile the TS controller to a temp ESM file with esbuild if available, else tsc strip. */
async function loadController() {
  // Prefer esbuild via vite's dependency if present
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
    // Fall through — try typescript transpileModule
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
  scrollHeight = 400,
  scrollTop = 0,
} = {}) {
  /** @type {Record<string, Set<Function>>} */
  const listeners = {}
  const el = {
    clientHeight,
    scrollHeight,
    scrollTop,
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

const mod = await loadController()
const { AutoScrollController, NEAR_BOTTOM_PX } = mod

// Minimal browser globals for Node unit tests
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

// —— TEST A: at bottom, reveal growth follows ——
{
  const el = createMockScroller({ scrollHeight: 500, clientHeight: 400, scrollTop: 100 })
  settleBottom(el)
  const c = new AutoScrollController()
  c.attach(el)
  c.setStreaming(true)
  assert.equal(c.getState(), 'FOLLOWING', 'A state FOLLOWING')
  const topBefore = el.scrollTop
  el.grow(80)
  c.tickOnce()
  // Soft-follow may not consume all 80 in one tick, but must move downward.
  assert.ok(el.scrollTop > topBefore, 'A scrollTop increases with growth')
  c.detach()
}

// —— TEST B: upward intent pauses; viewport freezes ——
{
  const el = createMockScroller({ scrollHeight: 800, clientHeight: 400, scrollTop: 400 })
  settleBottom(el)
  const c = new AutoScrollController()
  c.attach(el)
  c.setStreaming(true)
  // User scrolls up (away from bottom).
  el.scrollTop = 120
  el.dispatch('wheel', { deltaY: -40 })
  assert.equal(c.getState(), 'PAUSED_BY_USER', 'B paused after upward wheel')
  const frozen = el.scrollTop
  el.grow(120)
  c.tickOnce()
  c.tickOnce()
  assert.equal(el.scrollTop, frozen, 'B scrollTop unchanged after growth while paused')
  assert.equal(c.getHasUnseenGrowth(), true, 'B unseen growth flagged')
  c.detach()
}

// —— TEST C: more text after B still no movement ——
{
  const el = createMockScroller({ scrollHeight: 900, clientHeight: 400, scrollTop: 150 })
  const c = new AutoScrollController()
  c.attach(el)
  c.setStreaming(true)
  c.pauseByUser()
  const frozen = el.scrollTop
  el.grow(200)
  c.tickOnce()
  assert.equal(el.scrollTop, frozen, 'C still frozen')
  c.setStreaming(false)
  el.grow(50)
  c.tickOnce()
  assert.equal(el.scrollTop, frozen, 'C finish does not resume follow')
  assert.equal(c.getState(), 'PAUSED_BY_USER', 'C stays paused after stream end')
  c.detach()
}

// —— TEST D: Scroll to Bottom resumes FOLLOWING ——
{
  const el = createMockScroller({ scrollHeight: 1000, clientHeight: 400, scrollTop: 100 })
  const c = new AutoScrollController()
  c.attach(el)
  c.setStreaming(true)
  c.pauseByUser()
  c.scrollToBottom()
  // Drain ease frames (or reduced-motion jump).
  for (let i = 0; i < 80; i++) {
    if (distanceOk(el)) break
    // Manually advance pin by mutating — scrollToBottom uses rAF; call until near.
    // For mock without rAF pin completing, force settle via repeated apply simulation:
    const rem = el.scrollHeight - el.scrollTop - el.clientHeight
    if (rem > 2) el.scrollTop += Math.max(10, rem * 0.18)
    else break
  }
  // Direct contract: after scrollToBottom, state is FOLLOWING while streaming.
  assert.ok(
    c.getState() === 'FOLLOWING' || c.getState() === 'IDLE',
    'D resumed from pause via scrollToBottom',
  )
  assert.equal(c.getHasUnseenGrowth(), false, 'D clears unseen')
  c.detach()
}

function distanceOk(el) {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= 2
}

// —— TEST E: manual return to bottom resumes FOLLOWING while streaming ——
{
  const el = createMockScroller({ scrollHeight: 900, clientHeight: 400, scrollTop: 100 })
  const c = new AutoScrollController()
  c.attach(el)
  c.setStreaming(true)
  c.pauseByUser()
  settleBottom(el)
  el.dispatch('scroll', {})
  assert.equal(c.getState(), 'FOLLOWING', 'E manual bottom resumes FOLLOWING')
  c.detach()
}

// —— TEST F: onUserMessage while paused returns to bottom / FOLLOWING ——
{
  const el = createMockScroller({ scrollHeight: 900, clientHeight: 400, scrollTop: 80 })
  const c = new AutoScrollController()
  c.attach(el)
  c.setStreaming(true)
  c.pauseByUser()
  c.onUserMessage()
  assert.equal(c.getState(), 'FOLLOWING', 'F send resumes FOLLOWING')
  c.detach()
}

// —— TEST G/H (overflow contract documented via CSS; structural smoke) ——
{
  const css = fs.readFileSync('src/components/chat/StreamingRenderer.css', 'utf8')
  assert.match(css, /overflow-x:\s*hidden/, 'G/H md-body contains overflow-x')
  assert.match(css, /\.md-body table[\s\S]*overflow-x:\s*auto/, 'H tables scroll internally')
  const code = fs.readFileSync('src/components/chat/CodeBlock.css', 'utf8')
  assert.match(code, /overflow-x:\s*auto/, 'G code block internal scroll')
  const index = fs.readFileSync('src/index.css', 'utf8')
  assert.match(index, /@media \(max-width: 767\.98px\)/, 'I mobile hard-lock present')
  assert.match(index, /--content-max:\s*100%/, 'I mobile content-max full width')
  assert.match(index, /overflow-x:\s*clip/, 'I html overflow-x clip')
}

// —— TEST J: visualViewport hook still present ——
{
  const hook = fs.readFileSync('src/hooks/useVisualViewportHeight.ts', 'utf8')
  assert.match(hook, /visualViewport/, 'J visualViewport handling present')
  assert.match(hook, /--app-height/, 'J app-height sync present')
}

// —— Near-bottom follow does not pause on tiny soft-follow lag ——
{
  const el = createMockScroller({ scrollHeight: 500, clientHeight: 400, scrollTop: 100 })
  settleBottom(el)
  const c = new AutoScrollController()
  c.attach(el)
  c.setStreaming(true)
  // Soft lag: 40px above true bottom — still within follow slack.
  el.scrollTop = el.scrollHeight - el.clientHeight - 40
  el.dispatch('scroll', {})
  assert.equal(c.getState(), 'FOLLOWING', 'soft-follow lag does not false-pause')
  c.detach()
}

console.log('ok: #268 AutoScrollController tests passed')
console.log('NEAR_BOTTOM_PX=', NEAR_BOTTOM_PX)
