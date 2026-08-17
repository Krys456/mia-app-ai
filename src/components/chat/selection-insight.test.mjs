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
assert.doesNotMatch(hook, /LONG_PRESS_MS|setTimeout\(\s*\(\)\s*=>/)
assert.match(bubble, /selectionActive/)
assert.match(bubble, /native text selection takes precedence|getSelection\(/)

// Assistant-only + data attributes
assert.match(bubble, /data-role=\{message\.role\}/)
assert.match(bubble, /data-plain-text/)
assert.match(hook, /data-role="assistant"/)
assert.match(hook, /composer|contenteditable/)

// Code blocks excluded from MVP selection toolbar path
assert.match(hook, /code-block|pre, \.code-block/)

// Actions Definisci / Spiega — no "Search the web"
assert.match(bar, /Definisci/)
assert.match(bar, /Spiega/)
assert.doesNotMatch(bar, /Search the web|Cerca sul web/i)
assert.doesNotMatch(sheet, /Search the web|Cerca sul web/i)

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

console.log('ok: #290 selection client wiring')
