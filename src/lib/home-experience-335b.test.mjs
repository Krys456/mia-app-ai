/**
 * #335B — Home Experience contracts.
 * Run: node --test src/lib/home-experience-335b.test.mjs
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const root = process.cwd()
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')

async function loadTs(rel) {
  const href = pathToFileURL(path.join(root, rel)).href
  try {
    return await import(href)
  } catch {
    const ts = await import('typescript')
    const source = read(rel)
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
      fileName: rel,
    })
    const outfile = path.join('/tmp', `335b-${path.basename(rel)}-${Date.now()}.mjs`)
    fs.writeFileSync(outfile, outputText)
    return import(pathToFileURL(outfile).href)
  }
}

const experience = read('src/components/home/HomeExperience.tsx')
const sumiHero = read('src/components/home/SumiHero.tsx')
const greeting = read('src/components/home/ContextGreeting.tsx')
const thought = read('src/components/home/DailyThought.tsx')
const actions = read('src/components/home/QuickActions.tsx')
const chat = read('src/components/chat/ChatContainer.tsx')
const composer = read('src/components/chat/ComposerShell.tsx')
const composerCss = read('src/components/chat/ComposerShell.css')
const header = read('src/components/Header.tsx')
const headerCss = read('src/components/Header.css')
const atm = read('src/components/HomeAtmosphere.tsx')

// Empty state uses HomeExperience; conversation hides it via isHome
assert.match(chat, /HomeExperience/)
assert.match(chat, /isHome \? \(/)
assert.match(chat, /messages\.length === 0/)
assert.doesNotMatch(experience, /Dove vuoi andare oggi/)
assert.doesNotMatch(experience, /emptyPromptIt/)

// Architecture pieces
assert.match(experience, /HomeAtmosphere/)
assert.match(experience, /SumiHero/)
assert.match(experience, /ContextGreeting/)
assert.match(experience, /DailyThought/)
assert.match(experience, /QuickActions/)
assert.match(experience, /HomeBrandArea/)

// Artwork decorative (#335B2 reference-locked raster hero)
assert.match(sumiHero, /aria-hidden="true"/)
assert.match(sumiHero, /sumi-hero__art/)
assert.match(sumiHero, /shinkaido-home-hero\.webp/)
assert.match(sumiHero, /shinkaido-home-hero-sumi\.webp/)
assert.doesNotMatch(sumiHero, /Messaggio a ShinkAIdo|Buon pomeriggio/)

// Hero assets exist + size budgets
const heroWashi = path.join(root, 'public/brand/shinkaido-home-hero.webp')
const heroSumi = path.join(root, 'public/brand/shinkaido-home-hero-sumi.webp')
assert.ok(fs.existsSync(heroWashi))
assert.ok(fs.existsSync(heroSumi))
assert.ok(fs.statSync(heroWashi).size <= 300 * 1024, `washi hero ${fs.statSync(heroWashi).size}`)
assert.ok(fs.statSync(heroSumi).size <= 300 * 1024, `sumi hero ${fs.statSync(heroSumi).size}`)

// Legacy SVG brand pieces remain available
const ensoPath = path.join(root, 'public/brand/shinkaido-enso-hero.svg')
const mtnPath = path.join(root, 'public/brand/shinkaido-sumi-mountains.svg')
const sunPath = path.join(root, 'public/brand/shinkaido-vermilion-sun.svg')
assert.ok(fs.existsSync(ensoPath))
assert.ok(fs.existsSync(mtnPath))
assert.ok(fs.existsSync(sunPath))
assert.ok(fs.statSync(ensoPath).size <= 20 * 1024)
assert.ok(fs.statSync(mtnPath).size <= 30 * 1024)
assert.ok(fs.statSync(sunPath).size <= 6 * 1024)

// Greeting / thought — #335B3 fixed English philosophy (no daypart / rotation)
assert.match(greeting, /What will you improve today\?/)
assert.doesNotMatch(greeting, /formatHomeGreeting|homeDayPart|displayName|Buongiorno|Buon pomeriggio/)
assert.match(thought, /Improve every day\. Become better\. Find your true self\./)
assert.doesNotMatch(thought, /dailyThoughtForDate|useMemo|DAILY_THOUGHTS/)
assert.equal(fs.existsSync(path.join(root, 'src/lib/homeGreeting.ts')), false)
assert.equal(fs.existsSync(path.join(root, 'src/lib/dailyThought.ts')), false)

const qaMod = await loadTs('src/lib/homeQuickActions.ts')

// Quick actions — no fake Focus/Calendar backends
const ids = qaMod.HOME_QUICK_ACTIONS.map((a) => a.id).sort()
assert.deepEqual(ids, ['briefing', 'calendario', 'focus', 'meteo'].sort())

const briefing = qaMod.homeQuickActionById('briefing')
assert.equal(briefing.kind, 'sendMessage')
assert.equal(briefing.message, 'Briefing')

const meteo = qaMod.homeQuickActionById('meteo')
assert.equal(meteo.kind, 'sendMessage')
assert.match(meteo.message, /tempo/i)

const cal = qaMod.homeQuickActionById('calendario')
assert.equal(cal.kind, 'sendMessage')
assert.equal(cal.message, 'Cosa ho oggi?')

const focus = qaMod.homeQuickActionById('focus')
assert.equal(focus.kind, 'sendMessage')
assert.match(focus.message, /Timer/i)
assert.match(focus.description, /Timer/i)

assert.match(actions, /openSettings/)
assert.match(actions, /sendMessage/)
assert.match(read('src/components/home/QuickActions.css'), /min-height:\s*44px/)

// Home composer visual mode preserves ComposerShell
assert.match(composer, /composer-dock--home/)
assert.match(composerCss, /\.composer-dock--home/)
assert.match(composer, /composerEnterShouldSubmit|onSubmit/)

// Home header quieter
assert.match(header, /app-header--home/)
assert.match(headerCss, /\.app-header--home/)
assert.match(header, /toggleSettings/)
assert.match(header, /onNavigate\('vision'\)/)

// No protected systems touched in this PR surface
assert.doesNotMatch(experience, /supabase|stripe|entitlement/i)
assert.equal(Object.keys(JSON.parse(read('vercel.json')).functions).length, 11)
assert.doesNotMatch(read('package.json'), /framer-motion|three|gsap/)

// Washi/Sumi class hooks
assert.match(read('src/components/home/HomeExperience.css'), /the-way-washi/)
assert.match(read('src/components/home/HomeExperience.css'), /the-way-sumi/)
assert.match(read('src/components/home/SumiHero.css'), /the-way-sumi/)

console.log('home-experience-335b: ok')
