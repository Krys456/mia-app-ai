/**
 * #290 inline selection client wiring / regression guards
 * Run: node src/components/chat/selection-insight.test.mjs
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')

const hook = read('src/components/chat/useMessageSelection.ts')
const bar = read('src/components/chat/SelectionActionBar.tsx')
const barCss = read('src/components/chat/SelectionActionBar.css')
const layout = read('src/components/chat/selectionToolbarLayout.ts')
const sheet = read('src/components/chat/SelectionInsightSheet.tsx')
const bubble = read('src/components/chat/MessageBubble.tsx')
const list = read('src/components/chat/MessageList.tsx')
const container = read('src/components/chat/ChatContainer.tsx')
const selectionApi = read('src/lib/selectionApi.ts')
const chatApi = read('src/lib/chatApi.ts')
const chatCtx = read('src/context/ChatContext.tsx')
const apiSelection = read('api/selection.ts')
const apiChat = read('api/chat.ts')

// Selection via native Selection API — no custom long-press for #290
assert.match(hook, /selectionchange/)
assert.match(hook, /getSelection\(/)
assert.doesNotMatch(hook, /LONG_PRESS_MS/)
assert.doesNotMatch(hook, /\.removeAllRanges\s*\(|\.addRange\s*\(|\.collapse\s*\(/)
assert.doesNotMatch(hook, /scrollIntoView/)
assert.match(bubble, /selectionActive/)
assert.match(bubble, /native text selection takes precedence|getSelection\(/)

// Same-message Range validation — BOTH endpoints → .bubble__body
assert.match(hook, /resolveAssistantBubbleBody/)
assert.match(hook, /range\.startContainer/)
assert.match(hook, /range\.endContainer/)
assert.match(hook, /startBody !== endBody/)
assert.match(hook, /\.bubble__body/)
assert.match(hook, /sameAssistantMessageId/)

// Explicit exclusions (composer, chrome, toolbar, sheet, actions, images)
assert.match(hook, /EXCLUDED_SELECTION_ANCESTOR/)
assert.match(hook, /\.composer/)
assert.match(hook, /\.message-actions/)
assert.match(hook, /\.selection-action-bar/)
assert.match(hook, /\.selection-insight/)
assert.match(hook, /\.app-header/)
assert.match(hook, /bubble__attachment/)

// Mobile settle: hide while changing, commit after delay; desktop delay 0
assert.match(hook, /MOBILE_SELECTION_SETTLE_MS/)
assert.match(hook, /scheduleSelectionRefresh|clearSettleTimer/)
assert.match(hook, /setSnapshot\(null\)/)
assert.match(layout, /MOBILE_SELECTION_SETTLE_MS\s*=\s*220/)
assert.match(layout, /DESKTOP_SELECTION_SETTLE_MS\s*=\s*0/)
assert.match(layout, /MOBILE_HANDLE_SAFETY_PX\s*=\s*52/)

// Assistant-only + data attributes
assert.match(bubble, /data-role=\{message\.role\}/)
assert.match(bubble, /data-plain-text/)
assert.match(hook, /data-role="assistant"/)
assert.match(hook, /composer|contenteditable/)

// Code blocks excluded from MVP selection toolbar path
assert.match(hook, /code-block|pre, \.code-block|\.code-block/)

// Actions Definisci / Spiega — no "Search the web"
assert.match(bar, /Definisci/)
assert.match(bar, /Spiega/)
assert.doesNotMatch(bar, /Search the web|Cerca sul web/i)
assert.doesNotMatch(sheet, /Search the web|Cerca sul web/i)

// Toolbar: portal overlay, preserve selection on pointerdown, safe placement
assert.match(bar, /createPortal/)
assert.match(bar, /document\.body/)
assert.match(bar, /computeActionBarPlacement/)
assert.match(bar, /preventDefault/)
assert.match(bar, /composer-dock/)
assert.match(barCss, /z-index:\s*140/)
assert.match(barCss, /user-select:\s*none/)
assert.match(layout, /computeActionBarPlacement/)
assert.match(layout, /placement:\s*'below'\s*\|\s*'above'/)

// Captured text for Define/Explain — snapshotRef / capturedText, not live DOM re-read on click
assert.match(hook, /snapshotRef\.current|capturedText/)
assert.match(hook, /selectedText: capturedText|selectedText: current\.selectedText/)

// Ephemeral UI wired in ChatContainer — not ChatContext history
assert.match(container, /useMessageSelection/)
assert.match(container, /SelectionActionBar/)
assert.match(container, /SelectionInsightSheet/)
assert.doesNotMatch(chatCtx, /requestSelectionInsight|SelectionInsight|selectedText/)
assert.doesNotMatch(selectionApi, /memoryEvent/)
assert.match(apiSelection, /result/)
assert.doesNotMatch(apiSelection, /memoryEvent/)

// API path separate from chat
assert.match(selectionApi, /\/api\/selection/)
assert.match(apiSelection, /buildCoreResponsesCreateParams/)
assert.doesNotMatch(apiSelection, /tools:\s*\[|buildImageGenerationTools|type:\s*['"]web_search['"]/)
assert.equal((apiChat.match(/\.responses\.create\s*\(/g) || []).length, 1)
assert.match(apiChat, /maxDuration:\s*120/)

// MessageList passes selectionActive
assert.match(list, /selectionActive/)

// Escape dismiss
assert.match(hook, /Escape/)

// No prefetch — only on tap
assert.match(hook, /runOperation/)
assert.match(bar, /onDefine|onExplain/)

// Mobile sheet must sit above sticky composer (z-index 90) and clear live composer height
const sheetCss = read('src/components/chat/SelectionInsightSheet.css')
const sheetTsx = read('src/components/chat/SelectionInsightSheet.tsx')
const composerCss = read('src/components/chat/ComposerShell.css')
assert.match(composerCss, /\.composer-dock[\s\S]*z-index:\s*90/)
assert.match(sheetCss, /z-index:\s*150/)
assert.match(sheetCss, /--selection-composer-inset/)
assert.match(sheetCss, /safe-area-inset-bottom/)
assert.match(
  sheetCss,
  /padding-bottom:\s*var\(\s*--selection-composer-inset,\s*calc\(var\(--composer-h/,
)
assert.match(sheetCss, /selection-insight__body[\s\S]*overflow-y:\s*auto/)
assert.match(sheetCss, /max-height:\s*min\(62dvh/)
assert.match(sheetCss, /flex-shrink:\s*0/)
assert.match(sheetTsx, /createPortal/)
assert.match(sheetTsx, /document\.body/)
assert.match(sheetTsx, /composer-dock/)
assert.match(sheetTsx, /ResizeObserver/)
assert.match(sheetTsx, /--selection-composer-inset/)

console.log('ok: #290 selection client wiring')
