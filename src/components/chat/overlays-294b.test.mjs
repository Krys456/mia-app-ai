/**
 * #294B — Overlays & tools visual redesign contracts
 * Run: node --test src/components/chat/overlays-294b.test.mjs
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')

const barCss = read('src/components/chat/SelectionActionBar.css')
const sheetCss = read('src/components/chat/SelectionInsightSheet.css')
const voiceCss = read('src/components/chat/VoiceModeBar.css')
const attachCss = read('src/components/chat/ComposerAttachMenu.css')
const fontiCss = read('src/components/chat/CitationSources.css')
const barTsx = read('src/components/chat/SelectionActionBar.tsx')
const sheetTsx = read('src/components/chat/SelectionInsightSheet.tsx')
const voiceTsx = read('src/components/chat/VoiceModeBar.tsx')
const selection = read('src/components/chat/useMessageSelection.ts')
const layout = read('src/components/chat/selectionToolbarLayout.ts')
const voiceMode = read('src/components/chat/useVoiceMode.ts')
const voiceListening = read('src/lib/voiceListening.ts')
const chatApi = read('api/chat.ts')
const coreParams = read('lib/server/core-responses-params.js')

// —— Z-index freeze ——
assert.match(barCss, /z-index:\s*140/)
assert.match(sheetCss, /z-index:\s*150/)
assert.match(attachCss, /z-index:\s*20/)

// —— Geometry freeze (selection toolbar padding / button min-height) ——
assert.match(barCss, /padding:\s*0\.3rem/)
assert.match(barCss, /min-height:\s*2\.25rem/)
assert.match(voiceCss, /padding:\s*0\.7rem 0\.8rem/)
assert.match(voiceCss, /gap:\s*0\.65rem/)
assert.match(voiceCss, /min-height:\s*2\.35rem/)

// —— Composer inset / mobile attach contracts ——
assert.match(sheetCss, /--selection-composer-inset/)
assert.match(sheetCss, /var\(--composer-h/)
assert.match(attachCss, /var\(--composer-h\)/)
assert.match(attachCss, /position:\s*fixed/)

// —— The Way overlay family ——
assert.match(barCss, /\[data-theme='the-way-washi'\]/)
assert.match(barCss, /\[data-theme='the-way-sumi'\]/)
assert.match(sheetCss, /\[data-theme='the-way-washi'\]/)
assert.match(sheetCss, /\[data-theme='the-way-sumi'\]/)
assert.match(voiceCss, /\[data-theme='the-way-washi'\]/)
assert.match(attachCss, /\[data-theme='the-way-washi'\]/)
assert.match(fontiCss, /citation-sources--compact/)

// —— Error ≠ brand-only ——
assert.match(sheetCss, /--danger|#c44/)
assert.match(voiceCss, /--danger|#c44/)

// —— Text-only selection actions preserved ——
assert.match(barTsx, /Definisci/)
assert.match(barTsx, /Spiega/)
assert.match(barTsx, /Cerca/)
assert.match(barTsx, /createPortal/)
assert.match(sheetTsx, /createPortal/)
assert.match(sheetTsx, /CitationSources/)
assert.match(sheetTsx, /compact/)
assert.match(voiceTsx, /Ti ascolto|Sto elaborando|Sto parlando/)

// —— Protected logic files must still exist with key contracts ——
assert.match(selection, /\.bubble__body/)
assert.match(layout, /MOBILE_SELECTION_SETTLE_MS\s*=\s*220/)
assert.match(layout, /MOBILE_HANDLE_SAFETY_PX\s*=\s*52/)
assert.match(voiceMode, /voiceListening|VoiceModePhase/)
assert.match(voiceListening, /resultIndex|sessionGen/)

// —— Core invariants ——
assert.match(chatApi, /maxDuration:\s*120/)
assert.equal((chatApi.match(/responses\.create\(/g) || []).length, 1)
assert.match(coreParams, /stream:\s*false/)
assert.match(coreParams, /effort:\s*['"]none['"]/)

// —— Reduced motion ——
assert.match(barCss, /prefers-reduced-motion/)
assert.match(voiceCss, /prefers-reduced-motion/)
assert.match(sheetCss, /prefers-reduced-motion/)

console.log('ok: #294B overlays visual contracts')
