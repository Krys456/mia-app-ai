/**
 * #294D — Final visual polish contracts
 * Run: node --test src/components/final-polish-294d.test.mjs
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')

const indexCss = read('src/index.css')
const themes = read('src/lib/themes.ts')
const headerCss = read('src/components/Header.css')
const composerCss = read('src/components/chat/ComposerShell.css')
const attachCss = read('src/components/chat/ComposerAttachMenu.css')
const barCss = read('src/components/chat/SelectionActionBar.css')
const sheetCss = read('src/components/chat/SelectionInsightSheet.css')
const voiceBarCss = read('src/components/chat/VoiceModeBar.css')
const scrollCss = read('src/components/chat/ScrollToBottomButton.css')
const homeCss = read('src/components/HomeHero.css')
const settingsCss = read('src/components/SettingsDrawer.css')
const memoryCss = read('src/pages/MemoryManage.css')
const pageHeaderCss = read('src/components/PageHeader.css')
const selection = read('src/components/chat/useMessageSelection.ts')
const layout = read('src/components/chat/selectionToolbarLayout.ts')
const chatApi = read('api/chat.ts')
const coreParams = read('lib/server/core-responses-params.js')
const chatContext = read('src/context/ChatContext.tsx')
const appTsx = read('src/App.tsx')

// —— Stage presence ——
assert.ok(fs.existsSync(path.join(root, 'src/components/EnsoMark.tsx')))
assert.ok(fs.existsSync(path.join(root, 'src/components/chat/chat-visual-294a.test.mjs')))
assert.ok(fs.existsSync(path.join(root, 'src/components/chat/overlays-294b.test.mjs')))
assert.ok(fs.existsSync(path.join(root, 'src/pages/secondary-surfaces-294c.test.mjs')))

// —— Theme IDs preserved ——
assert.match(themes, /the-way-washi/)
assert.match(themes, /the-way-sumi/)
assert.match(themes, /OFFICIAL_THEME_ID/)
for (const id of [
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
  assert.match(themes, new RegExp(`id:\\s*'${id}'`))
}
assert.match(chatContext, /laife\.settings\.v2/)

// —— Composer / selection geometry freezes ——
assert.match(indexCss, /--composer-h:\s*5\.75rem/)
assert.match(barCss, /z-index:\s*140/)
assert.match(barCss, /padding:\s*0\.3rem/)
assert.match(sheetCss, /z-index:\s*150/)
assert.match(attachCss, /z-index:\s*20/)
assert.match(voiceBarCss, /padding:\s*0\.7rem 0\.8rem/)
assert.match(voiceBarCss, /gap:\s*0\.65rem/)
assert.match(scrollCss, /z-index:\s*40/)
assert.match(composerCss, /z-index:\s*90/)
assert.match(headerCss, /z-index:\s*100/)
assert.match(pageHeaderCss, /z-index:\s*100/)
assert.match(settingsCss, /z-index:\s*200/)
assert.match(memoryCss, /z-index:\s*220/)
assert.match(layout, /MOBILE_SELECTION_SETTLE_MS\s*=\s*220/)
assert.match(layout, /MOBILE_HANDLE_SAFETY_PX\s*=\s*52/)
assert.match(selection, /MOBILE_SELECTION_SETTLE_MS|MOBILE_HANDLE_SAFETY_PX/)

// —— The Way elevation: no glass on key chrome ——
assert.match(headerCss, /\[data-theme='the-way-washi'\][\s\S]*?backdrop-filter:\s*none/)
assert.match(headerCss, /\[data-theme='the-way-sumi'\][\s\S]*?backdrop-filter:\s*none/)
assert.match(composerCss, /\[data-theme='the-way-washi'\][\s\S]*?\.composer[\s\S]*?backdrop-filter:\s*none/)
assert.match(attachCss, /\[data-theme='the-way-washi'\][\s\S]*?backdrop-filter:\s*none/)
assert.match(barCss, /\[data-theme='the-way-washi'\][\s\S]*?backdrop-filter:\s*none/)
assert.match(scrollCss, /\[data-theme='the-way-washi'\][\s\S]*?backdrop-filter:\s*none/)

// —— Classic may keep glass (default header still blurs) ——
assert.match(headerCss, /\.app-header\s*\{[\s\S]*?backdrop-filter:\s*blur/)

// —— HomeHero: no continuous glow-pulse ——
assert.doesNotMatch(homeCss, /glow-pulse/)
assert.doesNotMatch(homeCss, /animation:\s*glow-pulse/)

// —— Error surface (not color-only) ——
assert.match(composerCss, /\.composer-attach-error[\s\S]*?--danger-border/)
assert.match(composerCss, /\.composer-attach-error[\s\S]*?--danger-soft/)

// —— Washi danger readability ——
assert.match(indexCss, /html\[data-theme='the-way-washi'\][\s\S]*?--danger-text/)

// —— Navigation architecture unchanged ——
assert.match(appTsx, /hidden=\{view !== 'chat'\}/)
assert.match(appTsx, /memoryReturnToSettingsRef/)

// —— Core invariants ——
assert.match(chatApi, /maxDuration:\s*120/)
assert.equal((chatApi.match(/responses\.create\(/g) || []).length, 1)
assert.match(coreParams, /stream:\s*false/)
assert.match(coreParams, /effort:\s*['"]none['"]/)

console.log('final-polish-294d: ok')
