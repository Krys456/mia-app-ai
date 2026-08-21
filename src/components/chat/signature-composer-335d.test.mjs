/**
 * #335D — Signature composer presentation contracts (behavior frozen).
 * Run: node --test src/components/chat/signature-composer-335d.test.mjs
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')

const shell = read('src/components/chat/ComposerShell.tsx')
const css = read('src/components/chat/ComposerShell.css')
const homeArt = read('src/components/home/SumiHero.tsx')
const homeExp = read('src/components/home/HomeExperience.tsx')

// Single ComposerShell — presentation modes only
assert.match(shell, /composer-dock--home/)
assert.match(shell, /composer__send--signature/)
assert.match(shell, /composer__send-enso/)
assert.match(shell, /composer__ink-seal/)
assert.match(shell, /composerEnterShouldSubmit/)
assert.match(shell, /sendMessage\(/)
assert.match(shell, /Messaggio a ShinkAIdo/)

// Behavior frozen — no stop/send logic rewrite markers removed
assert.match(shell, /composerDraftCanSend/)
assert.match(shell, /enterKeyHint=\{showKeyboardHint \? 'send' : 'enter'\}/)
assert.equal((shell.match(/className=\{`composer__send/g) || []).length, 1)

// Paper tray / no glass
assert.match(css, /paper-shadow|paper-surface|radius-paper/)
assert.match(css, /composer__ink-seal/)
assert.match(css, /min-width:\s*44px/)
assert.match(css, /min-height:\s*44px/)
assert.doesNotMatch(css, /backdrop-filter:\s*blur\([1-9]/)
assert.doesNotMatch(css, /0 0 18px|neon|glow-cyan/)

// Home art untouched
assert.match(homeArt, /shinkaido-home-hero\.webp/)
assert.match(homeExp, /SumiHero/)
assert.doesNotMatch(homeExp, /bottom-nav|BottomNav/)

// Approved hero assets still present
assert.ok(fs.existsSync(path.join(root, 'public/brand/shinkaido-home-hero.webp')))
assert.ok(fs.existsSync(path.join(root, 'public/brand/shinkaido-home-hero-sumi.webp')))

assert.equal(Object.keys(JSON.parse(read('vercel.json')).functions).length, 11)
assert.doesNotMatch(read('package.json'), /framer-motion|three|gsap/)

console.log('signature-composer-335d: ok')
