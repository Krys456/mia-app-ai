/**
 * #335B2 — Reference-locked Home art contracts.
 * Run: node --test src/lib/reference-home-art-335b2.test.mjs
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')

const sumi = read('src/components/home/SumiHero.tsx')
const css = read('src/components/home/SumiHero.css')
const home = read('src/components/home/HomeExperience.tsx')

// Home shell unchanged — real React UI, not a flattened screenshot
assert.match(home, /HomeBrandArea/)
assert.match(home, /ContextGreeting/)
assert.match(home, /DailyThought/)
assert.match(home, /QuickActions/)
assert.match(home, /SumiHero/)
assert.doesNotMatch(home, /bottom-nav|BottomNav|#335C/)

// Decorative hero only
assert.match(sumi, /aria-hidden="true"/)
assert.match(sumi, /shinkaido-home-hero\.webp/)
assert.match(sumi, /shinkaido-home-hero-sumi\.webp/)
assert.doesNotMatch(sumi, /https?:\/\//)
assert.doesNotMatch(sumi, /Messaggio|Buon pomeriggio|Calendario|Briefing/)

// Seamless integration CSS — no card plate
assert.match(css, /mask-image/)
assert.match(css, /transparent/)
assert.match(css, /box-shadow:\s*none/)
assert.doesNotMatch(css, /border-radius:\s*[1-9]/)
assert.doesNotMatch(css, /box-shadow:\s*[0-9]/)
assert.match(css, /the-way-sumi/)

const washi = path.join(root, 'public/brand/shinkaido-home-hero.webp')
const sumiArt = path.join(root, 'public/brand/shinkaido-home-hero-sumi.webp')
assert.ok(fs.existsSync(washi))
assert.ok(fs.existsSync(sumiArt))
assert.ok(fs.statSync(washi).size <= 300 * 1024)
assert.ok(fs.statSync(sumiArt).size <= 300 * 1024)
assert.ok(fs.statSync(washi).size > 40 * 1024, 'hero should be a real raster scene')

// No protected surface churn
assert.equal(Object.keys(JSON.parse(read('vercel.json')).functions).length, 13)
assert.doesNotMatch(read('package.json'), /framer-motion|three|gsap/)

console.log('reference-home-art-335b2: ok')
