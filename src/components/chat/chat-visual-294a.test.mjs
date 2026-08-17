/**
 * #294A — Chat & Composer visual redesign contracts
 * Run: node --test src/components/chat/chat-visual-294a.test.mjs
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')

const bubble = read('src/components/chat/MessageBubble.css')
const list = read('src/components/chat/MessageList.css')
const md = read('src/components/chat/StreamingRenderer.css')
const citationsTsx = read('src/components/chat/CitationSources.tsx')
const citationsCss = read('src/components/chat/CitationSources.css')
const composer = read('src/components/chat/ComposerShell.css')
const typing = read('src/components/chat/TypingAnimation.css')
const scroll = read('src/components/chat/ScrollToBottomButton.css')
const code = read('src/components/chat/CodeBlock.css')
const bubbleTsx = read('src/components/chat/MessageBubble.tsx')
const selection = read('src/components/chat/useMessageSelection.ts')
const toolbar = read('src/components/chat/selectionToolbarLayout.ts')
const autoScroll = read('src/components/chat/AutoScrollController.ts')
const voice = read('src/components/chat/useVoiceMode.ts')
const chatApi = read('api/chat.ts')
const coreParams = read('lib/server/core-responses-params.js')

// —— Message surfaces ——
assert.match(bubble, /\.bubble--assistant \.bubble__body/)
assert.match(bubble, /background:\s*transparent/)
assert.match(bubble, /\[data-theme='the-way-washi'\]/)
assert.match(bubble, /\[data-theme='the-way-sumi'\]/)
assert.match(bubble, /\.bubble--user \.bubble__body/)
assert.doesNotMatch(bubble, /0 0 18px color-mix\(in srgb, var\(--accent\) 12%/)

// —— Selection contracts preserved ——
assert.match(bubbleTsx, /data-message-id=\{message\.id\}/)
assert.match(bubbleTsx, /data-role=\{/)
assert.match(bubbleTsx, /className=\{`bubble__body/)
assert.match(selection, /\[data-message-id\]\[data-role="assistant"\]/)
assert.match(selection, /\.bubble__body/)
assert.match(selection, /\.composer-dock/)

// —— Fonti disclosure ——
assert.match(citationsTsx, /Fonti/)
assert.match(citationsTsx, /details/)
assert.match(citationsTsx, /summary/)
assert.match(citationsTsx, /Fonti ·|summary-count|· \{count\}/)
assert.match(citationsTsx, /noopener noreferrer/)
assert.match(citationsTsx, /target="_blank"/)
assert.match(citationsTsx, /open=\{compact/)
assert.match(citationsCss, /citation-sources__summary/)

// —— Composer geometry safety ——
assert.match(composer, /\.composer-dock/)
assert.match(composer, /z-index:\s*90/)
assert.match(composer, /var\(--safe-bottom\)/)
assert.match(composer, /\[data-theme='the-way-washi'\] \.composer/)
assert.match(composer, /\[data-theme='the-way-sumi'\] \.composer/)
assert.match(composer, /:focus-within/)

// —— Thinking / scroll visual ——
assert.match(typing, /prefers-reduced-motion/)
assert.match(scroll, /z-index:\s*40/)
assert.match(scroll, /\[data-theme='the-way-washi'\]/)

// —— Code contrast on The Way ——
assert.match(code, /\[data-theme='the-way-washi'\] \.code-block/)
assert.match(code, /\[data-theme='the-way-sumi'\] \.code-block/)

// —— Typography still sans ——
assert.match(md, /var\(--font-sans\)/)
assert.match(md, /--md-block-gap/)
assert.match(list, /gap:\s*1\.3/)

// —— Protected files must not be rewritten in this PR (spot-check presence) ——
assert.match(toolbar, /MOBILE_SELECTION_SETTLE_MS/)
assert.match(autoScroll, /NEAR_BOTTOM_PX|class AutoScrollController|export/)
assert.match(voice, /voiceListening|sessionGen|resultIndex/)

// —— Core invariants ——
assert.match(chatApi, /maxDuration:\s*120/)
assert.equal((chatApi.match(/responses\.create\(/g) || []).length, 1)
assert.match(coreParams, /stream:\s*false/)
assert.match(coreParams, /effort:\s*['"]none['"]/)

console.log('ok: #294A chat visual contracts')
