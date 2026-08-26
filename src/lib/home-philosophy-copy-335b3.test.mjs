/**
 * #335B3 — Home philosophy copy contracts.
 * Run: node --test src/lib/home-philosophy-copy-335b3.test.mjs
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')

const greeting = read('src/components/home/ContextGreeting.tsx')
const thought = read('src/components/home/DailyThought.tsx')
const home = read('src/components/home/HomeExperience.tsx')
const hero = read('src/components/home/SumiHero.tsx')

assert.match(greeting, /What will you improve today\?/)
assert.match(thought, /Improve every day\. Become better\. Find your true self\./)
assert.doesNotMatch(greeting, /Buongiorno|Buon pomeriggio|Buonasera|displayName/)
assert.doesNotMatch(thought, /dailyThoughtForDate|La forma si rivela/)

assert.match(home, /ContextGreeting/)
assert.match(home, /DailyThought/)
assert.match(home, /SumiHero/)
assert.match(home, /QuickActions/)

// Artwork / composer untouched by this PR surface
assert.match(hero, /shinkaido-home-hero\.webp/)
assert.ok(fs.existsSync(path.join(root, 'public/brand/shinkaido-home-hero.webp')))
assert.equal(fs.existsSync(path.join(root, 'src/lib/homeGreeting.ts')), false)
assert.equal(fs.existsSync(path.join(root, 'src/lib/dailyThought.ts')), false)

assert.equal(Object.keys(JSON.parse(read('vercel.json')).functions).length, 13)

console.log('home-philosophy-copy-335b3: ok')
