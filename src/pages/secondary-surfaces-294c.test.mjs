/**
 * #294C — Settings + Memory + Vision secondary-surface visual contracts
 * Run: node --test src/pages/secondary-surfaces-294c.test.mjs
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')

const settingsCss = read('src/components/SettingsDrawer.css')
const settingsTsx = read('src/components/SettingsDrawer.tsx')
const themeCss = read('src/components/ThemeSettings.css')
const themeTsx = read('src/components/ThemeSettings.tsx')
const memoryCss = read('src/pages/MemoryManage.css')
const memoryTsx = read('src/pages/MemoryManage.tsx')
const visionCss = read('src/pages/Vision.css')
const visionTsx = read('src/pages/Vision.tsx')
const pageHeaderCss = read('src/components/PageHeader.css')
const memoryToggleCss = read('src/components/MemoryToggle.css')
const memoryGate = read('src/lib/memoryManageUi.ts')
const appTsx = read('src/App.tsx')
const visionCapture = read('src/lib/visionCameraCapture.ts')
const visionActions = read('src/lib/visionActions.ts')
const memoryApi = read('src/lib/memoryApi.ts')
const chatApi = read('api/chat.ts')
const coreParams = read('lib/server/core-responses-params.js')
const themes = read('src/lib/themes.ts')
const chatContext = read('src/context/ChatContext.tsx')

// —— Settings geometry / behavior freezes ——
assert.match(settingsCss, /z-index:\s*200/)
assert.match(settingsCss, /transform:\s*translateX\(105%\)/)
assert.match(settingsCss, /@media \(min-width:\s*768px\)/)
assert.match(settingsCss, /max-width:\s*22\.5rem/)
assert.match(settingsTsx, /role="dialog"/)
assert.match(settingsTsx, /aria-modal="true"/)
assert.match(settingsTsx, /Escape/)
assert.match(settingsTsx, /Impostazioni/)
assert.match(settingsTsx, /ShinkAIdo/)
assert.match(settingsCss, /\[data-theme='the-way-washi'\]/)
assert.match(settingsCss, /\[data-theme='the-way-sumi'\]/)
assert.doesNotMatch(settingsCss, /backdrop-filter/)
assert.doesNotMatch(settingsCss, /--gradient-brand/)

// —— ThemeSettings: IDs + quieter primary ——
assert.match(themeTsx, /the-way-washi|isTheWayThemeId/)
assert.match(themeTsx, /OFFICIAL_THEME_ID/)
assert.match(themeTsx, /resetToOfficial/)
assert.match(themeTsx, /The Way/)
assert.match(themeTsx, /Classic/)
assert.match(themeCss, /theme-card--active/)
assert.match(themeCss, /\[data-theme='the-way-washi'\]/)
assert.doesNotMatch(themeCss, /--gradient-brand/)
assert.doesNotMatch(themeCss, /--glow-brand|--glow-cyan/)

// —— Appearance values preserved ——
assert.match(settingsTsx, /'small'/)
assert.match(settingsTsx, /'default'/)
assert.match(settingsTsx, /'large'/)
assert.match(settingsTsx, /'outfit'/)
assert.match(settingsTsx, /'system'/)

// —— Memory list presentational, logic frozen ——
assert.match(memoryTsx, /memory-manage__list/)
assert.match(memoryTsx, /memory-row/)
assert.match(memoryTsx, /listMemories/)
assert.match(memoryTsx, /updateMemory/)
assert.match(memoryTsx, /deleteMemory/)
assert.match(memoryTsx, /deleteAllMemories/)
assert.match(memoryTsx, /window\.confirm/)
assert.match(memoryTsx, /role="dialog"/)
assert.match(memoryCss, /z-index:\s*220/)
assert.match(memoryCss, /memory-row/)
assert.match(memoryCss, /\[data-theme='the-way-washi'\]/)
assert.match(memoryCss, /\[data-theme='the-way-sumi'\]/)
assert.match(memoryCss, /--danger/)
assert.doesNotMatch(memoryCss, /memory-manage__grid/)
assert.doesNotMatch(memoryCss, /backdrop-filter/)
assert.match(memoryGate, /VITE_MEMORY_MANAGE_UI/)
assert.doesNotMatch(memoryGate, /PROD\s*!==\s*true/)
assert.match(memoryApi, /listMemories|\/api\/memories/)

// —— #298B Privacy surface ——
const privacyTsx = read('src/pages/PrivacyData.tsx')
const privacyCopy = read('src/lib/privacyCopy.ts')
assert.match(privacyTsx, /Privacy e dati/)
assert.match(privacyCopy, /OpenAI/)
assert.match(settingsTsx, /Privacy/)
assert.match(appTsx, /PrivacyData/)
assert.match(appTsx, /'privacy'/)

// —— Vision state machine + geometry freezes ——
assert.match(visionTsx, /'empty'\s*\|\s*'camera'\s*\|\s*'ready'\s*\|\s*'sending'/)
assert.match(visionTsx, /getUserMedia/)
assert.match(visionTsx, /Analizza/)
assert.match(visionTsx, /Leggi testo/)
assert.match(visionTsx, /Spiega/)
assert.match(visionTsx, /onHandoffToChat/)
assert.match(visionTsx, /sendMessage/)
assert.match(visionCss, /aspect-ratio:\s*3\s*\/\s*4/)
assert.match(visionCss, /aspect-ratio:\s*4\s*\/\s*5/)
assert.match(visionCss, /\[data-theme='the-way-washi'\]/)
assert.match(visionCss, /\[data-theme='the-way-sumi'\]/)
assert.match(visionCss, /--danger/)
assert.doesNotMatch(visionCss, /--gradient-brand/)
assert.doesNotMatch(visionCss, /--glow-brand/)
assert.match(visionCapture, /captureVideoFrameToJpegBlob/)
assert.match(visionActions, /captionForVisionAction/)

// —— PageHeader ——
assert.match(pageHeaderCss, /z-index:\s*100/)
assert.match(pageHeaderCss, /\[data-theme='the-way-washi'\]/)
assert.match(pageHeaderCss, /\[data-theme='the-way-sumi'\]/)
assert.doesNotMatch(pageHeaderCss, /backdrop-filter/)

// —— Navigation architecture unchanged ——
assert.match(appTsx, /AppView/)
assert.match(appTsx, /hidden=\{view !== 'chat'\}/)
assert.match(appTsx, /memoryReturnToSettingsRef/)
assert.match(appTsx, /SettingsDrawer/)

// —— Memory toggle The Way ——
assert.match(memoryToggleCss, /\[data-theme='the-way-washi'\]/)

// —— Theme / settings persistence ——
assert.match(themes, /the-way-washi/)
assert.match(themes, /the-way-sumi/)
assert.match(themes, /OFFICIAL_THEME_ID/)
assert.match(chatContext, /laife\.settings\.v2/)

// —— Core invariants ——
assert.match(chatApi, /maxDuration:\s*120/)
assert.equal((chatApi.match(/responses\.create\(/g) || []).length, 1)
assert.match(coreParams, /stream:\s*false/)
assert.match(coreParams, /effort:\s*['"]none['"]/)

console.log('secondary-surfaces-294c: ok')
