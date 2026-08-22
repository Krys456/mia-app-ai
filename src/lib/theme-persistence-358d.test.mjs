/**
 * #358D — Theme persistence across refresh / OAuth return / PWA bootstrap.
 * Run: node --experimental-strip-types --test src/lib/theme-persistence-358d.test.mjs
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

const root = process.cwd()
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')

const require = createRequire(import.meta.url)

async function loadPersistence() {
  try {
    return await import(pathToFileURL(path.join(root, 'src/lib/themePersistence.ts')).href)
  } catch {
    // Node without strip-types: transpile lightly via dynamic eval of built path
    const esbuild = await import('esbuild').catch(() => null)
    if (!esbuild) {
      // Fallback: read and use node --experimental-strip-types expectation
      throw new Error('Unable to load themePersistence.ts')
    }
    const source = read('src/lib/themePersistence.ts')
    const outfile = path.join('/tmp', `theme-persist-${Date.now()}.mjs`)
    await esbuild.build({
      stdin: { contents: source, resolveDir: path.join(root, 'src/lib'), sourcefile: 'themePersistence.ts', loader: 'ts' },
      bundle: true,
      write: true,
      format: 'esm',
      platform: 'neutral',
      outfile,
      external: [],
      plugins: [
        {
          name: 'stub-themes',
          setup(build) {
            build.onResolve({ filter: /^\.\/themes$/ }, () => ({
              path: 'themes-stub',
              namespace: 'stub',
            }))
            build.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
              contents: 'export const DEFAULT_THEME_ID = "the-way-washi"',
              loader: 'js',
            }))
          },
        },
      ],
    })
    return import(pathToFileURL(outfile).href)
  }
}

function memoryStorage(seed = {}) {
  const map = new Map(Object.entries(seed))
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => {
      map.set(k, String(v))
    },
    _map: map,
  }
}

describe('#358D theme persistence', async () => {
  const mod = await loadPersistence()

  it('no saved theme → WASHI', () => {
    assert.equal(mod.readPersistedActiveThemeId(memoryStorage()), 'the-way-washi')
    assert.equal(mod.resolveActiveThemeIdFromSettingsJson(null), 'the-way-washi')
    assert.equal(mod.resolveActiveThemeIdFromSettingsJson(''), 'the-way-washi')
    assert.equal(mod.resolveActiveThemeIdFromSettingsJson('{}'), 'the-way-washi')
    assert.equal(mod.DEFAULT_PERSISTED_THEME_ID, 'the-way-washi')
  })

  it('saved WASHI → WASHI', () => {
    const raw = JSON.stringify({ theme: { activeThemeId: 'the-way-washi', customThemes: [] } })
    const store = memoryStorage({ 'laife.settings.v2': raw })
    assert.equal(mod.readPersistedActiveThemeId(store), 'the-way-washi')
  })

  it('saved SUMI → SUMI', () => {
    const raw = JSON.stringify({ theme: { activeThemeId: 'the-way-sumi', customThemes: [] } })
    const store = memoryStorage({ 'laife.settings.v2': raw })
    assert.equal(mod.readPersistedActiveThemeId(store), 'the-way-sumi')
  })

  it('legacy v1 key still reads theme', () => {
    const raw = JSON.stringify({ theme: { activeThemeId: 'the-way-sumi' } })
    const store = memoryStorage({ 'laife.settings.v1': raw })
    assert.equal(mod.readPersistedActiveThemeId(store), 'the-way-sumi')
  })

  it('legacy builtin ids degrade safely (kept as saved)', () => {
    const raw = JSON.stringify({ theme: { activeThemeId: 'laife' } })
    assert.equal(mod.resolveActiveThemeIdFromSettingsJson(raw), 'laife')
  })

  it('Calendar OAuth return preserves WASHI', () => {
    const before = JSON.stringify({ theme: { activeThemeId: 'the-way-washi' } })
    const { themeId, searchAfter } = mod.themeIdAfterOAuthReturnNavigation({
      settingsJsonBefore: before,
      returnSearch: '?calendar=connected',
    })
    assert.equal(themeId, 'the-way-washi')
    assert.equal(searchAfter, '')
  })

  it('Calendar OAuth return preserves SUMI', () => {
    const before = JSON.stringify({ theme: { activeThemeId: 'the-way-sumi' } })
    const { themeId } = mod.themeIdAfterOAuthReturnNavigation({
      settingsJsonBefore: before,
      returnSearch: '?calendar=connected&code=oauth_noise',
    })
    assert.equal(themeId, 'the-way-sumi')
  })

  it('Gmail OAuth return preserves selected theme', () => {
    const before = JSON.stringify({ theme: { activeThemeId: 'the-way-washi' } })
    const { themeId, searchAfter } = mod.themeIdAfterOAuthReturnNavigation({
      settingsJsonBefore: before,
      returnSearch: '?email=connected',
    })
    assert.equal(themeId, 'the-way-washi')
    assert.equal(searchAfter, '')
  })

  it('refresh / PWA bootstrap preserves theme via document dataset', () => {
    const raw = JSON.stringify({ theme: { activeThemeId: 'the-way-sumi' } })
    const store = memoryStorage({ 'laife.settings.v2': raw })
    const dataset = /** @type {Record<string, string>} */ ({})
    const style = /** @type {{ colorScheme: string }} */ ({ colorScheme: '' })
    const meta = {
      content: '#F5F0E6',
      setAttribute(_k, v) {
        this.content = v
      },
    }
    const doc = {
      documentElement: { dataset, style },
      querySelector(sel) {
        return String(sel).includes('theme-color') ? meta : null
      },
    }
    const id = mod.bootstrapDocumentThemeFromStorage(doc, store)
    assert.equal(id, 'the-way-sumi')
    assert.equal(dataset.theme, 'the-way-sumi')
    assert.equal(dataset.colorScheme, 'dark')
    assert.equal(style.colorScheme, 'dark')
    assert.equal(meta.content, '#100E0C')
  })

  it('system dark preference is never consulted', () => {
    const src = read('src/lib/themePersistence.ts')
    assert.doesNotMatch(src, /matchMedia\s*\(/)
    assert.doesNotMatch(src, /prefers-color-scheme/)
    const chat = read('src/context/ChatContext.tsx')
    assert.match(chat, /resolveActiveThemeIdFromSettingsJson/)
    assert.doesNotMatch(chat, /prefers-color-scheme/)
    assert.doesNotMatch(chat, /matchMedia\s*\(/)
  })

  it('OAuth query consumers do not write theme / localStorage settings', () => {
    const cal = read('src/lib/calendarApi.ts')
    const email = read('src/lib/emailApi.ts')
    assert.match(cal, /consumeCalendarReturnQuery/)
    assert.match(email, /consumeEmailReturnQuery/)
    assert.doesNotMatch(cal, /activeThemeId|laife\.settings|UPDATE_THEME|theme\.active/)
    assert.doesNotMatch(email, /activeThemeId|laife\.settings|UPDATE_THEME|theme\.active/)
    // Only history.replaceState — no settings mutation
    assert.match(cal, /history\.replaceState/)
    assert.match(email, /history\.replaceState/)
  })

  it('index.html early boot defaults WASHI and reads same storage keys', () => {
    const html = read('index.html')
    assert.match(html, /laife\.settings\.v2/)
    assert.match(html, /laife\.settings\.v1/)
    assert.match(html, /the-way-washi/)
    assert.match(html, /#358D/)
    assert.match(read('src/main.tsx'), /bootstrapDocumentThemeFromStorage/)
  })

  it('DEFAULT_THEME_ID remains WASHI (no silent SUMI default)', () => {
    assert.equal(mod.DEFAULT_PERSISTED_THEME_ID, 'the-way-washi')
    const themes = read('src/lib/themes.ts')
    assert.match(themes, /DEFAULT_THEME_ID[^=]*=\s*'the-way-washi'/)
  })
})
