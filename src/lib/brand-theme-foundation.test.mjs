/**
 * #293A ShinkAIdo brand + The Way theme foundation
 * Run: node src/lib/brand-theme-foundation.test.mjs
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const root = process.cwd()
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')

const brandMod = await import(pathToFileURL(path.join(root, 'src/lib/brand.ts')).href).catch(
  async () => {
    const ts = await import('typescript')
    const source = read('src/lib/brand.ts')
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
      fileName: 'brand.ts',
    })
    const outfile = path.join('/tmp', `brand-${Date.now()}.mjs`)
    fs.writeFileSync(outfile, outputText)
    return import(pathToFileURL(outfile).href)
  },
)

const themesMod = await import(pathToFileURL(path.join(root, 'src/lib/themes.ts')).href).catch(
  async () => {
    const ts = await import('typescript')
    const source = read('src/lib/themes.ts')
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
      fileName: 'themes.ts',
    })
    const outfile = path.join('/tmp', `themes-${Date.now()}.mjs`)
    fs.writeFileSync(outfile, outputText)
    return import(pathToFileURL(outfile).href)
  },
)

const { BRAND } = brandMod
const {
  BUILTIN_THEMES,
  DEFAULT_THEME_ID,
  OFFICIAL_THEME_ID,
  getBuiltinTheme,
  isTheWayThemeId,
  resolveTheme,
} = themesMod

// A — brand config
assert.equal(BRAND.productName, 'ShinkAIdo')
assert.equal(BRAND.accessibleProductName, 'ShinkAIdo')
assert.equal(BRAND.tagline, 'The Way to Your True Self.')
assert.equal(BRAND.wordmark.ai, 'AI')
assert.match(BRAND.markSrc, /shinkaido-mark\.svg/)
assert.match(BRAND.fullSrc, /shinkaido-logo\.svg/)

// B / C — visible UI strings
const header = read('src/components/Header.tsx')
const hero = read('src/components/HomeHero.tsx')
const shell = read('src/components/chat/ComposerShell.tsx')
const bubble = read('src/components/chat/MessageBubble.tsx')
const list = read('src/components/chat/MessageList.tsx')
const themeSettings = read('src/components/ThemeSettings.tsx')
const indexHtml = read('index.html')
const brandLogo = read('src/components/BrandLogo.tsx')
const wordmark = read('src/components/BrandWordmark.tsx')

assert.match(header, /BrandWordmark/)
assert.match(header, /BRAND\.accessibleProductName/)
assert.doesNotMatch(header, /Your AI, Your Life\.|>LAIfe</)
assert.match(hero, /BRAND\.emptyPromptIt|Dove vuoi andare oggi/)
assert.match(shell, /Messaggio a ShinkAIdo/)
assert.match(shell, /ShinkAIdo sta pensando/)
assert.doesNotMatch(shell, /Messaggio a LAIfe|LAIfe sta pensando/)
assert.match(bubble, /ShinkAIdo/)
assert.doesNotMatch(bubble, /'LAIfe'|"LAIfe"/)
assert.match(list, /ShinkAIdo/)
assert.match(themeSettings, /The Way — Washi/)
assert.match(themeSettings, /Reset to The Way — Washi/)
assert.doesNotMatch(themeSettings, /Reset to LAIfe|official <strong>LAIfe Theme/)
assert.match(indexHtml, /<title>ShinkAIdo/)
assert.match(indexHtml, /shinkaido-mark\.svg/)
assert.match(brandLogo, /EnsoMark/)
assert.match(wordmark, /accessibleProductName/)
assert.match(wordmark, /brand-wordmark__ai/)

// Organic Ensō mark (visual refinement)
const enso = read('src/components/EnsoMark.tsx')
assert.match(enso, /enso-mark__ink/)
assert.match(enso, /enso-mark__fire/)
assert.match(enso, /enso-mark__sun/)
assert.match(enso, /--enso-ink/)
assert.match(enso, /linearGradient/)
assert.doesNotMatch(enso, /stroke-dasharray/)

const themesSrc = read('src/lib/themes.ts')
assert.match(themesSrc, /--enso-ink/)
assert.match(themesSrc, /'#141210'/)
assert.match(themesSrc, /'#F5F0E8'/)
assert.match(themesSrc, /--enso-sun/)
assert.match(themesSrc, /--enso-fire-ambient/)
assert.match(themesSrc, /theme\.id === 'the-way-washi'/)

// D — internal storage key unchanged
const chatContext = read('src/context/ChatContext.tsx')
assert.match(chatContext, /laife\.settings\.v2/)
assert.match(chatContext, /X-LAIfe-User-Id|STORAGE_KEY = 'laife\.settings\.v2'/)

// E — old theme id laife still resolves
assert.ok(getBuiltinTheme('laife'))
assert.equal(getBuiltinTheme('laife').id, 'laife')
assert.equal(resolveTheme('laife', []).id, 'laife')

// F / G — Washi + Sumi exist
assert.equal(isTheWayThemeId('the-way-washi'), true)
assert.equal(isTheWayThemeId('the-way-sumi'), true)
assert.ok(getBuiltinTheme('the-way-washi'))
assert.ok(getBuiltinTheme('the-way-sumi'))
assert.equal(getBuiltinTheme('the-way-washi').colorScheme, 'light')
assert.equal(getBuiltinTheme('the-way-sumi').colorScheme, 'dark')
assert.equal(getBuiltinTheme('the-way-washi').official, true)

// H — Washi is fresh default / official
assert.equal(DEFAULT_THEME_ID, 'the-way-washi')
assert.equal(OFFICIAL_THEME_ID, 'the-way-washi')
assert.equal(resolveTheme('missing-id', []).id, 'the-way-washi')

// I — persisted existing theme remains selected (resolve keeps id)
assert.equal(resolveTheme('laife', []).id, 'laife')
assert.equal(resolveTheme('dark', []).id, 'dark')
assert.equal(resolveTheme('cyber', []).id, 'cyber')

// J — reset-to-official wiring
const themeCtx = read('src/context/ThemeContext.tsx')
assert.match(themeCtx, /OFFICIAL_THEME_ID/)
assert.match(themeCtx, /activeThemeId: OFFICIAL_THEME_ID/)
assert.doesNotMatch(themeCtx, /activeThemeId: 'laife'/)

// K / L — custom path + all builtins remain
assert.ok(BUILTIN_THEMES.length >= 13)
const ids = BUILTIN_THEMES.map((t) => t.id)
for (const id of [
  'the-way-washi',
  'the-way-sumi',
  'laife',
  'dark',
  'light',
  'amoled',
  'ocean',
  'forest',
  'sunset',
  'royal',
  'cyber',
  'minimal',
  'midnight',
]) {
  assert.ok(ids.includes(id), `missing builtin ${id}`)
}

// M / N — header / hero keep functional wiring
assert.match(header, /newChat|Nuova chat/)
assert.match(header, /onNavigate\('vision'\)/)
assert.match(header, /toggleSettings/)
assert.match(hero, /home-hero/)

// O — assets exist
assert.equal(fs.existsSync(path.join(root, 'public/shinkaido-mark.svg')), true)
assert.equal(fs.existsSync(path.join(root, 'public/shinkaido-logo.svg')), true)
assert.equal(fs.existsSync(path.join(root, 'public/laife-mark.png')), true)

// P — Core prompt not modified
const personality = read('src/lib/personality.ts')
assert.match(personality, /Sei LAIfe/)

// Q / R / S — protected modules untouched in this PR surface
assert.equal(fs.existsSync(path.join(root, 'src/lib/voiceListening.ts')), true)
const voice = read('src/lib/voiceListening.ts')
assert.match(voice, /resultIndex|applySpeechRecognitionEvent|slots/)
const selection = read('src/components/chat/useMessageSelection.ts')
assert.match(selection, /SETTLE|same-message|Range/)
assert.doesNotMatch(read('lib/server/web-search.js').slice(0, 200), /ShinkAIdo/)
assert.match(read('api/chat.ts'), /maxDuration:\s*120/)
assert.equal((read('api/chat.ts').match(/\.responses\.create\(/g) || []).length, 1)

console.log('ok: #293A brand + The Way theme foundation')
