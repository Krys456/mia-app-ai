/**
 * #333A — Kami foundation (tokens + header + home hero)
 * Run: node --experimental-strip-types --test src/lib/kami-foundation-333a.test.mjs
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const root = process.cwd()
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')

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
    const outfile = path.join('/tmp', `themes-kami-${Date.now()}.mjs`)
    fs.writeFileSync(outfile, outputText)
    return import(pathToFileURL(outfile).href)
  },
)

const {
  DEFAULT_THEME_ID,
  OFFICIAL_THEME_ID,
  getBuiltinTheme,
  isTheWayThemeId,
  applyThemeToDocument,
} = themesMod

const indexCss = read('src/index.css')
const indexHtml = read('index.html')
const headerTsx = read('src/components/Header.tsx')
const headerCss = read('src/components/Header.css')
const heroTsx = read('src/components/HomeHero.tsx')
const heroCss = read('src/components/HomeHero.css')
const themesSrc = read('src/lib/themes.ts')
const brandLogoCss = read('src/components/BrandLogo.css')
const wordmarkCss = read('src/components/BrandWordmark.css')

// —— Official theme ids unchanged ——
assert.equal(DEFAULT_THEME_ID, 'the-way-washi')
assert.equal(OFFICIAL_THEME_ID, 'the-way-washi')
assert.equal(isTheWayThemeId('the-way-washi'), true)
assert.equal(isTheWayThemeId('the-way-sumi'), true)
assert.equal(getBuiltinTheme('the-way-washi').colorScheme, 'light')
assert.equal(getBuiltinTheme('the-way-sumi').colorScheme, 'dark')
assert.equal(getBuiltinTheme('the-way-washi').official, true)

const washi = getBuiltinTheme('the-way-washi').colors
assert.equal(washi.bg.toUpperCase(), '#F5F0E6')
assert.equal(washi.surface.toUpperCase(), '#FFFBF5')
assert.equal(washi.surface2.toUpperCase(), '#EDE6DA')
assert.equal(washi.text.toUpperCase(), '#1C1916')
assert.equal(washi.textMuted.toUpperCase(), '#6B645C')
assert.equal(washi.accent.toUpperCase(), '#C23B2A')

const sumi = getBuiltinTheme('the-way-sumi').colors
assert.equal(sumi.bg.toUpperCase(), '#100E0C')
assert.equal(sumi.text.toUpperCase(), '#F5F0E8')
assert.match(sumi.accent, /^#D94A3A$/i)

// —— Static token layer matches Washi; light color-scheme ——
assert.match(indexCss, /--theme-bg:\s*#F5F0E6/i)
assert.match(indexCss, /--theme-surface:\s*#FFFBF5/i)
assert.match(indexCss, /--theme-surface-2:\s*#EDE6DA/i)
assert.match(indexCss, /--theme-text:\s*#1C1916/i)
assert.match(indexCss, /--theme-text-muted:\s*#6B645C/i)
assert.match(indexCss, /--theme-accent:\s*#C23B2A/i)
assert.match(indexCss, /color-scheme:\s*light/)
assert.doesNotMatch(indexCss, /color-scheme:\s*dark/)
assert.match(indexCss, /--glow-cyan:\s*none/)
assert.match(indexCss, /--glow-pink:\s*none/)
assert.match(indexCss, /--glow-brand:\s*none/)
assert.match(indexCss, /--touch-min:\s*2\.75rem/)

// —— Runtime applyTheme: Washi light / Sumi dark; no neon glows on The Way ——
assert.match(themesSrc, /setProperty\('--glow-cyan',\s*'none'\)/)
assert.match(themesSrc, /setProperty\('--glow-pink',\s*'none'\)/)
assert.match(themesSrc, /setProperty\('--glow-brand',\s*'none'\)/)
assert.match(themesSrc, /root\.style\.colorScheme = colorScheme/)

const fakeRoot = {
  style: {
    props: /** @type {Record<string, string>} */ ({}),
    setProperty(k, v) {
      this.props[k] = String(v)
    },
    removeProperty(k) {
      delete this.props[k]
    },
  },
  dataset: /** @type {Record<string, string>} */ ({}),
}
globalThis.document = {
  documentElement: fakeRoot,
  querySelector: () => null,
}
applyThemeToDocument(getBuiltinTheme('the-way-washi'))
assert.equal(fakeRoot.style.colorScheme, 'light')
assert.equal(fakeRoot.style.props['--glow-cyan'], 'none')
assert.equal(fakeRoot.dataset.theme, 'the-way-washi')
assert.equal(fakeRoot.dataset.colorScheme, 'light')

applyThemeToDocument(getBuiltinTheme('the-way-sumi'))
assert.equal(fakeRoot.style.colorScheme, 'dark')
assert.equal(fakeRoot.style.props['--glow-cyan'], 'none')
assert.equal(fakeRoot.dataset.colorScheme, 'dark')

// —— Header: all actions + touch targets ——
assert.match(headerTsx, /Nuova chat/)
assert.match(headerTsx, /onNavigate\('vision'\)/)
assert.match(headerTsx, /onNavigate\('plans'\)/)
assert.match(headerTsx, /toggleSettings/)
assert.match(headerTsx, /BrandWordmark/)
assert.match(headerTsx, /BrandLogo/)
assert.match(headerCss, /min-width:\s*max\(var\(--btn-icon\),\s*var\(--touch-min\)\)/)
assert.match(headerCss, /min-height:\s*max\(var\(--btn-icon\),\s*var\(--touch-min\)\)/)
assert.doesNotMatch(headerCss, /box-shadow:\s*var\(--glow-cyan\)/)
assert.match(headerCss, /--accent-ring|inset 0 0 0 1px/)
assert.match(headerCss, /@media \(max-width:\s*380px\)/)
assert.match(headerCss, /@media \(max-width:\s*360px\)/)
assert.doesNotMatch(headerTsx, /hamburger|drawer.*nav|menu-architecture/i)

// —— HomeHero hierarchy (no secondary hint / tour) ——
assert.match(heroTsx, /BrandLogo/)
assert.match(heroTsx, /BrandWordmark/)
assert.match(heroTsx, /emptyPromptIt/)
assert.doesNotMatch(heroTsx, /FIRST_RUN_HINT|home-hero__hint/)
assert.doesNotMatch(heroTsx, /carousel|onboarding|wizard/i)
assert.match(heroCss, /\.home-hero__lead/)
assert.doesNotMatch(heroCss, /home-hero__hint/)

// —— Brand: seal plate, no heavy drop shadow ——
assert.doesNotMatch(brandLogoCss, /drop-shadow/)
assert.match(wordmarkCss, /brand-wordmark__ai/)
assert.match(wordmarkCss, /@media \(max-width:\s*430px\)/)

// —— A11y: pinch zoom allowed ——
assert.doesNotMatch(indexHtml, /maximum-scale\s*=\s*1/)
assert.match(indexHtml, /viewport-fit=cover/)
assert.match(indexHtml, /theme-color" content="#F5F0E6"/)

// —— Legacy themes remain ——
assert.ok(getBuiltinTheme('laife'))
assert.ok(getBuiltinTheme('cyber'))

console.log('kami-foundation-333a: ok')
