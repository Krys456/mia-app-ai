/**
 * #335B1 — Ensō + landscape artwork contracts (no layout regressions).
 * Run: node --test src/lib/enso-landscape-335b1.test.mjs
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')

const sumi = read('src/components/home/SumiHero.tsx')
const home = read('src/components/home/HomeExperience.tsx')
const ensoFile = read('public/brand/shinkaido-enso-hero.svg')
const mtnFile = read('public/brand/shinkaido-sumi-mountains.svg')
const sunFile = read('public/brand/shinkaido-vermilion-sun.svg')

// Layout / IA unchanged
assert.match(home, /HomeBrandArea/)
assert.match(home, /ContextGreeting/)
assert.match(home, /DailyThought/)
assert.match(home, /QuickActions/)
assert.match(home, /SumiHero/)
assert.doesNotMatch(home, /Dove vuoi andare oggi/)

// Ensō: brush ink + fire + sun at tip; no separate sun layer required
assert.match(sumi, /ENSO_INK/)
assert.match(sumi, /sumiHeroFireGrad/)
assert.match(sumi, /sumiHeroFireMask/)
assert.match(sumi, /#C23B2A/)
assert.match(sumi, /#E07A3A/)
assert.match(sumi, /#F0A060/)
assert.match(sumi, /--enso-sun/)
assert.doesNotMatch(sumi, /sumi-hero__sun/)
assert.match(sumi, /Flame tongues|ember sparks|burning ink/i)

// Canonical assets
assert.match(ensoFile, /ensoFireGrad/)
assert.match(ensoFile, /ensoFireMask/)
assert.match(ensoFile, /#C23B2A/)
assert.match(ensoFile, /currentColor/)
assert.match(mtnFile, /opacity="0\.08"/)
assert.match(mtnFile, /opacity="0\.16"/)
assert.match(mtnFile, /opacity="0\.26"/)
assert.match(mtnFile, /peak-based|L42 152|L88 158/)
assert.ok(fs.existsSync(path.join(root, 'public/brand/shinkaido-vermilion-sun.svg')))
assert.match(sunFile, /#C23B2A/)

const ensoBytes = fs.statSync(path.join(root, 'public/brand/shinkaido-enso-hero.svg')).size
const mtnBytes = fs.statSync(path.join(root, 'public/brand/shinkaido-sumi-mountains.svg')).size
assert.ok(ensoBytes <= 24 * 1024, `enso ${ensoBytes}`)
assert.ok(mtnBytes <= 30 * 1024, `mountains ${mtnBytes}`)

assert.doesNotMatch(read('package.json'), /framer-motion|three|gsap/)
assert.equal(Object.keys(JSON.parse(read('vercel.json')).functions).length, 11)

console.log('enso-landscape-335b1: ok')
