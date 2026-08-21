/**
 * #333B — Kami Chat Visual System contracts
 * Run: node --test src/components/chat/kami-chat-333b.test.mjs
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')

const bubbleCss = read('src/components/chat/MessageBubble.css')
const bubbleTsx = read('src/components/chat/MessageBubble.tsx')
const listTsx = read('src/components/chat/MessageList.tsx')
const listCss = read('src/components/chat/MessageList.css')
const composer = read('src/components/chat/ComposerShell.css')
const actions = read('src/components/chat/MessageActions.css')
const typing = read('src/components/chat/TypingAnimation.css')
const code = read('src/components/chat/CodeBlock.css')
const copyable = read('src/components/chat/CopyableBlock.css')
const toast = read('src/components/chat/CopyToast.css')
const scroll = read('src/components/chat/ScrollToBottomButton.css')
const tools = read('src/components/chat/chat-tool-surfaces.css')
const md = read('src/components/chat/StreamingRenderer.css')
const indexCss = read('src/index.css')
const kami = read('src/lib/kami-foundation-333a.test.mjs')

// —— Kami foundation still present ——
assert.match(indexCss, /color-scheme:\s*light/)
assert.match(indexCss, /--glow-cyan:\s*none/)
assert.match(kami, /kami-foundation-333a/)

// —— No per-message avatar stamp / legacy L mark ——
assert.doesNotMatch(bubbleTsx, /bubble__avatar-mark/)
assert.doesNotMatch(bubbleTsx, /bubble__avatar--assistant/)
assert.doesNotMatch(listTsx, /bubble__avatar-mark/)
assert.doesNotMatch(bubbleCss, /bubble__avatar--assistant/)

// —— Assistant unboxed ——
assert.match(bubbleCss, /\.bubble--assistant \.bubble__body[\s\S]*?background:\s*transparent/)
assert.match(bubbleCss, /\.bubble--assistant \.bubble__body[\s\S]*?box-shadow:\s*none/)

// —— User quiet paper ——
assert.match(bubbleCss, /\.bubble--user \.bubble__body/)
assert.match(bubbleCss, /\[data-theme='the-way-washi'\] \.bubble--user/)
assert.match(bubbleCss, /\[data-theme='the-way-sumi'\] \.bubble--user/)
assert.doesNotMatch(bubbleCss, /0 0 18px/)

// —— Composer paper dock ——
assert.match(composer, /border-radius:\s*var\(--radius-(?:paper|lg)/)
assert.match(composer, /\[data-theme='the-way-washi'\] \.composer/)
assert.match(composer, /\[data-theme='the-way-sumi'\] \.composer/)
assert.match(composer, /\.composer__send[\s\S]*?(?:background:\s*var\(--accent\)|var\(--hanko,\s*var\(--accent\)\))/)
assert.match(composer, /min-width:\s*max\(var\(--btn-send\),\s*var\(--touch-min\)\)|width:\s*max\(var\(--btn-send\),\s*var\(--touch-min\)\)/)
assert.doesNotMatch(composer, /backdrop-filter:\s*blur\(14px\)/)

// —— Actions discoverable on touch ——
assert.match(actions, /@media \(hover: none\)/)
assert.match(actions, /pointer: coarse/)
assert.match(actions, /var\(--touch-min/)

// —— Typing reduced motion ——
assert.match(typing, /prefers-reduced-motion/)
assert.match(typing, /chat-typing-ink|opacity/)

// —— Code / copyable / toast ——
assert.match(code, /\[data-theme='the-way-washi'\] \.code-block/)
assert.match(code, /\[data-theme='the-way-sumi'\] \.code-block/)
assert.match(copyable, /min-width:\s*44px/)
assert.match(copyable, /min-height:\s*44px/)
assert.match(toast, /\[data-theme='the-way-washi'\] \.copy-toast/)

// —— Scroll ——
assert.match(scroll, /z-index:\s*40/)
assert.match(scroll, /\[data-theme='the-way-washi'\]/)

// —— Tool harmonization ——
assert.match(tools, /\.weather-ui__card/)
assert.match(tools, /\.calc-ui__card/)
assert.match(tools, /the-way-washi/)
assert.match(tools, /the-way-sumi/)

// —— Typography ——
assert.match(md, /var\(--font-sans\)|var\(--font-ui/)
assert.match(md, /--md-block-gap/)
assert.match(listCss, /bubble--assistant \+ \.bubble--user|margin-top:\s*1\./)

// —— Behavior freezes (structure) ——
assert.match(read('src/components/chat/composer-enter-331a.test.mjs'), /331A|newline|Enter/)
assert.match(read('src/components/chat/copyable-block.test.mjs'), /copy|331/)

console.log('kami-chat-333b: ok')
