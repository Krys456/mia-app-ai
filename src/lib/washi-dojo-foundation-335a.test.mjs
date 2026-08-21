/**
 * #335A — Washi Dojo design foundation contracts.
 * Run: node --test src/lib/washi-dojo-foundation-335a.test.mjs
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const root = process.cwd()
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')

const foundationCss = read('src/styles/washi-dojo-foundation.css')
const indexCss = read('src/index.css')
const heroTsx = read('src/components/HomeHero.tsx')
const atmTsx = read('src/components/HomeAtmosphere.tsx')
const themesSrc = read('src/lib/themes.ts')
const brandReadme = read('public/brand/README.md')
// heroTsx kept for re-export check below
void heroTsx

assert.match(indexCss, /washi-dojo-foundation\.css/)

// Semantic tokens
for (const token of [
  '--paper-bg',
  '--paper-surface',
  '--paper-raised',
  '--ink',
  '--ink-muted',
  '--ink-faint',
  '--hanko',
  '--hanko-hover',
  '--clay',
  '--hairline',
  '--paper-shadow-1',
  '--paper-shadow-2',
  '--sumi-wash',
  '--washi-fiber-opacity',
  '--font-ui',
  '--font-display',
  '--home-max',
  '--reading-max',
]) {
  assert.match(foundationCss, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
}

// Texture: data-URI SVG noise, no external request, no large raster
assert.match(foundationCss, /\.washi-texture/)
assert.match(foundationCss, /data:image\/svg\+xml/)
assert.doesNotMatch(foundationCss, /url\(\s*['"]?https?:\/\//)
assert.doesNotMatch(foundationCss, /\.png|\.jpg|\.webp/)

// Paper depth + ink primitives
assert.match(foundationCss, /\.paper-surface/)
assert.match(foundationCss, /\.paper-raised/)
assert.match(foundationCss, /\.ink-strong/)
assert.match(foundationCss, /\.ink-secondary/)
assert.match(foundationCss, /\.ink-hanko|\.vermilion-annotation/)
assert.match(foundationCss, /\.hairline-rule/)
assert.match(foundationCss, /\.sumi-wash/)

// Typography roles
assert.match(foundationCss, /\.type-hero-greeting/)
assert.match(foundationCss, /\.type-daily-thought/)
assert.match(foundationCss, /\.type-body/)
assert.match(foundationCss, /\.type-nav/)

// Motion + reduced motion
assert.match(foundationCss, /washi-paper-fade/)
assert.match(foundationCss, /washi-ink-reveal/)
assert.match(foundationCss, /washi-hero-recede/)
assert.match(foundationCss, /washi-enso-reveal/)
assert.match(foundationCss, /prefers-reduced-motion/)

// Atmosphere architecture (#335B: scenery in SumiHero; atmosphere = wash + fiber)
assert.match(atmTsx, /aria-hidden="true"/)
assert.match(atmTsx, /washi-texture|home-atmosphere__fiber/)
assert.match(read('src/components/home/HomeExperience.tsx'), /HomeAtmosphere/)
assert.match(read('src/components/HomeHero.tsx'), /HomeExperience/)

// Authored Home artwork (#335B)
assert.ok(fs.existsSync(path.join(root, 'public/brand/shinkaido-enso-hero.svg')))
assert.ok(fs.existsSync(path.join(root, 'public/brand/shinkaido-sumi-mountains.svg')))
assert.match(brandReadme, /shinkaido-enso-hero\.svg/)

// Runtime theme sets paper tokens on The Way
assert.match(themesSrc, /setProperty\('--paper-bg'/)
assert.match(themesSrc, /setProperty\('--hanko'/)
assert.match(themesSrc, /'--washi-fiber-opacity'/)

// Official palette unchanged
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
    const outfile = path.join('/tmp', `themes-335a-${Date.now()}.mjs`)
    fs.writeFileSync(outfile, outputText)
    return import(pathToFileURL(outfile).href)
  },
)

const { getBuiltinTheme, applyThemeToDocument, DEFAULT_THEME_ID } = themesMod
assert.equal(DEFAULT_THEME_ID, 'the-way-washi')
assert.equal(getBuiltinTheme('the-way-washi').colors.bg.toUpperCase(), '#F5F0E6')
assert.equal(getBuiltinTheme('the-way-sumi').colors.bg.toUpperCase(), '#100E0C')

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
assert.equal(fakeRoot.style.props['--paper-bg'], '#F5F0E6')
assert.equal(fakeRoot.style.props['--hanko'], '#C23B2A')
assert.equal(fakeRoot.style.props['--glow-cyan'], 'none')

applyThemeToDocument(getBuiltinTheme('the-way-sumi'))
assert.equal(fakeRoot.style.props['--paper-bg'], '#100E0C')
assert.match(fakeRoot.style.props['--hanko'], /^#D94A3A$/i)
assert.equal(fakeRoot.style.props['--washi-fiber-opacity'], '0.022')

// No new product deps / no Core touch
assert.equal(Object.keys(JSON.parse(read('vercel.json')).functions).length, 11)
assert.doesNotMatch(read('package.json'), /framer-motion|three|gsap/)

console.log('washi-dojo-foundation-335a.test.mjs: ok')
