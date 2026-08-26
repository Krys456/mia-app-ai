/**
 * #335E — Active chat integration presentation contracts.
 * Run: node --test src/components/chat/chat-integration-335e.test.mjs
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')

const container = read('src/components/chat/ChatContainer.tsx')
const containerCss = read('src/components/chat/ChatContainer.css')
const bubble = read('src/components/chat/MessageBubble.tsx')
const bubbleCss = read('src/components/chat/MessageBubble.css')
const listCss = read('src/components/chat/MessageList.css')
const md = read('src/components/chat/StreamingRenderer.css')
const composer = read('src/components/chat/ComposerShell.tsx')
const home = read('src/components/home/HomeExperience.tsx')
const greeting = read('src/components/home/ContextGreeting.tsx')
const thought = read('src/components/home/DailyThought.tsx')
const hero = read('src/components/home/SumiHero.tsx')

// Thread atmosphere — quiet fiber, no scenic wash/hero
assert.match(container, /chat-container--thread/)
assert.match(container, /HomeAtmosphere/)
assert.match(container, /showWash=\{false\}/)
assert.match(containerCss, /chat-atmosphere/)
assert.match(containerCss, /prefers-reduced-motion/)
assert.doesNotMatch(container, /SumiHero|shinkaido-home-hero/)

// Assistant ink-on-paper + one seal
assert.match(bubble, /bubble__ink-seal/)
assert.match(bubbleCss, /\.bubble__ink-seal/)
assert.match(bubbleCss, /\.bubble--assistant \.bubble__body[\s\S]*?background:\s*transparent/)
assert.doesNotMatch(bubble, /bubble__avatar/)

// User paper slip
assert.match(bubbleCss, /radius-paper|paper-shadow-1/)
assert.match(bubbleCss, /\[data-theme='the-way-washi'\] \.bubble--user/)
assert.match(bubbleCss, /\[data-theme='the-way-sumi'\] \.bubble--user/)

// MA rhythm
assert.match(listCss, /bubble--assistant \+ \.bubble--user/)
assert.match(listCss, /max-width:\s*min\(42rem/)

// Markdown editorial
assert.match(md, /font-ui|font-sans/)
assert.match(md, /hanko|--accent/)

// #335D composer frozen surface still present
assert.match(composer, /composer__send--signature/)
assert.match(composer, /composer__ink-seal/)

// Home freeze
assert.match(greeting, /What will you improve today\?/)
assert.match(thought, /Improve every day\. Become better\. Find your true self\./)
assert.match(hero, /shinkaido-home-hero\.webp/)
assert.match(home, /SumiHero/)
assert.match(home, /QuickActions/)
assert.ok(fs.existsSync(path.join(root, 'public/brand/shinkaido-home-hero.webp')))

assert.equal(Object.keys(JSON.parse(read('vercel.json')).functions).length, 13)
assert.doesNotMatch(read('package.json'), /framer-motion|three|gsap/)

console.log('chat-integration-335e: ok')
