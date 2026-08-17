/**
 * #290 selection toolbar layout + settle contracts
 * Run: node --experimental-strip-types src/components/chat/selectionToolbarLayout.test.mjs
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const root = process.cwd()
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')

const layoutPath = path.join(root, 'src/components/chat/selectionToolbarLayout.ts')
const major = Number(process.versions.node.split('.')[0])
const supportsStrip = major >= 22

let computeActionBarPlacement
let sameAssistantMessageId
let MOBILE_HANDLE_SAFETY_PX
let MOBILE_SELECTION_SETTLE_MS
let DESKTOP_SELECTION_SETTLE_MS
let isCoarsePointerMobile

if (!supportsStrip) {
  const src = read('src/components/chat/selectionToolbarLayout.ts')
  assert.match(src, /MOBILE_SELECTION_SETTLE_MS\s*=\s*220/)
  assert.match(src, /MOBILE_HANDLE_SAFETY_PX\s*=\s*52/)
  assert.match(src, /function computeActionBarPlacement/)
  assert.match(src, /function sameAssistantMessageId/)
  console.log('ok: #290 selection toolbar layout (source contracts; no strip-types)')
  process.exit(0)
}

const mod = await import(pathToFileURL(layoutPath).href)
computeActionBarPlacement = mod.computeActionBarPlacement
sameAssistantMessageId = mod.sameAssistantMessageId
MOBILE_HANDLE_SAFETY_PX = mod.MOBILE_HANDLE_SAFETY_PX
MOBILE_SELECTION_SETTLE_MS = mod.MOBILE_SELECTION_SETTLE_MS
DESKTOP_SELECTION_SETTLE_MS = mod.DESKTOP_SELECTION_SETTLE_MS
isCoarsePointerMobile = mod.isCoarsePointerMobile

assert.equal(sameAssistantMessageId('a', 'a'), true)
assert.equal(sameAssistantMessageId('a', 'b'), false)
assert.equal(sameAssistantMessageId('', 'a'), false)
assert.equal(sameAssistantMessageId(null, 'a'), false)

assert.ok(MOBILE_SELECTION_SETTLE_MS >= 150 && MOBILE_SELECTION_SETTLE_MS <= 300)
assert.equal(DESKTOP_SELECTION_SETTLE_MS, 0)
assert.ok(MOBILE_HANDLE_SAFETY_PX >= 40)

assert.equal(
  isCoarsePointerMobile((q) => q.includes('pointer: coarse')),
  true,
)
assert.equal(
  isCoarsePointerMobile(() => false),
  false,
)

// Prefer below with safety gap on mobile when space allows
{
  const p = computeActionBarPlacement({
    anchor: { top: 120, left: 40, right: 200, bottom: 160, width: 160, height: 40 },
    viewport: { width: 390, height: 800, offsetTop: 0, offsetLeft: 0 },
    composerInsetPx: 100,
    isMobile: true,
  })
  assert.equal(p.placement, 'below')
  assert.ok(p.top >= 160 + MOBILE_HANDLE_SAFETY_PX)
  assert.ok(p.top + 48 <= 800 - 100)
}

// Flip above when below would collide with composer
{
  const p = computeActionBarPlacement({
    anchor: { top: 620, left: 40, right: 200, bottom: 680, width: 160, height: 60 },
    viewport: { width: 390, height: 800, offsetTop: 0, offsetLeft: 0 },
    composerInsetPx: 120,
    isMobile: true,
  })
  assert.equal(p.placement, 'above')
  assert.ok(p.top + 48 <= 620)
  assert.ok(p.top < 620 - 40)
}

// Never cover composer band
{
  const p = computeActionBarPlacement({
    anchor: { top: 100, left: 10, right: 300, bottom: 140, width: 290, height: 40 },
    viewport: { width: 390, height: 700, offsetTop: 0, offsetLeft: 0 },
    composerInsetPx: 140,
    isMobile: true,
  })
  assert.ok(p.top + 48 <= 700 - 140 + 1)
}

// Desktop uses smaller safety gap
{
  const mobile = computeActionBarPlacement({
    anchor: { top: 200, left: 100, right: 300, bottom: 240, width: 200, height: 40 },
    viewport: { width: 1024, height: 800 },
    composerInsetPx: 80,
    isMobile: true,
  })
  const desktop = computeActionBarPlacement({
    anchor: { top: 200, left: 100, right: 300, bottom: 240, width: 200, height: 40 },
    viewport: { width: 1024, height: 800 },
    composerInsetPx: 80,
    isMobile: false,
  })
  assert.ok(mobile.top > desktop.top)
}

console.log('ok: #290 selection toolbar layout')
