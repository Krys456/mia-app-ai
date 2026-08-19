/**
 * #274 Vision Lens — wiring / regression guards
 * Run: node src/pages/vision-lens.test.mjs
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  isVisionTaskShortcut,
  listVisionTaskShortcutTexts,
  VISION_TASK_PROMPTS,
} from '../../lib/server/vision-task-shortcuts.js'

const root = process.cwd()
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')

async function loadTs(rel) {
  const entry = path.resolve(rel)
  const esbuild = await import('esbuild')
  const outfile = path.join(os.tmpdir(), `vision-${Date.now()}-${Math.random()}.mjs`)
  await esbuild.build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    target: 'es2022',
    packages: 'external',
  })
  return await import(pathToFileURL(outfile).href)
}

const client = await loadTs('src/lib/visionActions.ts')

// Client ↔ server shortcut lists must match (Memory skip + captions)
assert.deepEqual(
  [...client.listVisionTaskShortcutTexts()].sort(),
  [...listVisionTaskShortcutTexts()].sort(),
  'client/server Vision shortcuts must match',
)

assert.equal(client.captionForVisionAction('analyze', 'it'), '')
assert.equal(client.captionForVisionAction('read', 'it'), VISION_TASK_PROMPTS.it.read)
assert.equal(client.captionForVisionAction('explain', 'en'), VISION_TASK_PROMPTS.en.explain)
assert.equal(client.captionForVisionAction('identify', 'it'), VISION_TASK_PROMPTS.it.identify)
assert.match(client.captionForVisionAction('search', 'it'), /Cercalo online/)
assert.equal(isVisionTaskShortcut(VISION_TASK_PROMPTS.it.read), true)
assert.equal(isVisionTaskShortcut(VISION_TASK_PROMPTS.de.explain), true)
assert.equal(isVisionTaskShortcut(VISION_TASK_PROMPTS.it.identify), true)
assert.equal(isVisionTaskShortcut('Mi piace il rosso'), false)
assert.equal(isVisionTaskShortcut(''), false)

const vision = read('src/pages/Vision.tsx')
const visionCss = read('src/pages/Vision.css')
const app = read('src/App.tsx')
const header = read('src/components/Header.tsx')
const headerCss = read('src/components/Header.css')
const apiChat = read('api/chat.ts')
const shell = read('src/components/chat/ComposerShell.tsx')
const autoScroll = read('src/components/chat/AutoScrollController.ts')
const coreParams = read('lib/server/core-responses-params.js')

// A / B real feature, no Coming soon
assert.match(vision, /title="Vision AI"/)
assert.doesNotMatch(vision, /Coming soon|Coming Soon|BrAIn Vision/)
assert.doesNotMatch(header, /Coming soon|Soon/)
assert.doesNotMatch(headerCss, /header-btn--soon|header-btn__soon/)
assert.match(header, /aria-label="Vision AI"/)

// C permission only on explicit action
assert.match(vision, /getUserMedia/)
assert.match(vision, /Apri fotocamera/)
assert.doesNotMatch(vision, /getUserMedia\(\{[\s\S]*\}\)\s*\n\s*\}/, ) // rough
// no getUserMedia at module top
assert.ok(!/^[^]*getUserMedia/.test(vision.split('export function Vision')[0]))

// D / E / F / G camera + gallery + preview + retake
assert.match(vision, /facingMode: \{ ideal: 'environment' \}/)
assert.match(vision, /audio: false/)
assert.match(vision, /Scatta foto/)
assert.match(vision, /Scegli foto/)
assert.match(vision, /prepareImageAttachment/)
assert.match(vision, /Rimuovi/)
assert.match(vision, /Scatta di nuovo/)
assert.match(vision, /stopCameraTracks/)

// H Analyze → empty caption (or custom prompt wins via resolveVisionSubmitCaption)
assert.match(vision, /'analyze'/)
assert.match(vision, /resolveVisionSubmitCaption|captionForVisionAction/)
assert.equal(client.captionForVisionAction('analyze', 'fr'), '')

// I handoff
assert.match(vision, /onHandoffToChat/)
assert.match(vision, /sendMessage\(finalCaption, \[wire\]\)/)
assert.match(app, /onHandoffToChat=\{handoffVisionToChat\}/)
assert.match(app, /navigate\('chat'\)/)

// N / O Read + Explain + Identify + Search
assert.match(vision, /'read'/)
assert.match(vision, /'explain'/)
assert.match(vision, /'identify'/)
assert.match(vision, /'search'/)
assert.match(vision, /QUICK_ACTIONS|visionActionLabel/)
assert.match(vision, /laife-vision__prompt/)

// P Memory skip wiring
assert.match(apiChat, /isVisionTaskShortcut/)
assert.match(apiChat, /isVisionTaskShortcut\(lastUserCaption\)/)

// S Composer draft independent — Vision does not touch useComposerDraft
assert.doesNotMatch(vision, /useComposerDraft/)
assert.match(app, /Keep chat mounted/)

// T dictation suspends via inert (ComposerShell)
assert.match(shell, /useChatViewSuspended|suspended:/)

// U camera cleanup
assert.match(vision, /getTracks\(\)\.forEach/)
assert.match(vision, /revokeObjectURL|revokePreview/)

// X no base64 console of dataUrl
assert.doesNotMatch(vision, /console\.(log|info|warn|error)\([^)]*dataUrl/)
assert.match(vision, /summarizeImageForLog/)
assert.match(vision, /summarizeCaptureForLog/)

// #274 follow-up: language sticky + camera frame gate
assert.match(vision, /resolveVisionActionLang/)
assert.match(vision, /videoReady/)
assert.match(vision, /isVideoFrameReady/)
assert.match(vision, /captureVideoFrameToJpegBlob/)
assert.match(vision, /setCameraSession/)
assert.match(vision, /prepared\.width > 0 && prepared\.height > 0/)
assert.equal(client.resolveVisionActionLang({
  messages: [
    { role: 'user', content: 'Ciao, parliamo in italiano per favore.' },
    { role: 'assistant', content: 'Certo!' },
  ],
  navigatorLanguage: 'en-US',
}), 'it')
assert.equal(client.captionForVisionAction('read', 'it'), VISION_TASK_PROMPTS.it.read)
assert.equal(client.captionForVisionAction('analyze', 'it'), '')

// Y / Z stubs deleted
assert.equal(fs.existsSync(path.join(root, 'api/vision.ts')), false)
assert.equal(fs.existsSync(path.join(root, 'src/lib/visionApi.ts')), false)
assert.doesNotMatch(vision, /visionApi|sendVisionImage|\/api\/vision/)
assert.doesNotMatch(read('vercel.json'), /api\/vision/)

// Core invariants
assert.ok((apiChat.match(/\.responses\.create\(/g) || []).length >= 1)
assert.match(apiChat, /maxDuration:\s*120/)
assert.match(coreParams, /effort:\s*['"]none['"]/)
assert.doesNotMatch(autoScroll, /Vision|vision|dataUrl/)
assert.doesNotMatch(vision, /modality:\s*['"]voice['"]/)

// Mobile / a11y / immersive Vision layout
assert.match(visionCss, /safe-bottom|safe-area/)
assert.match(visionCss, /max-width:\s*100%/)
assert.match(visionCss, /prefers-reduced-motion/)
assert.match(visionCss, /laife-vision--immersive/)
assert.match(visionCss, /100dvh|dvh/)
assert.match(vision, /laife-vision--immersive/)
assert.match(vision, /aria-live="polite"/)
assert.match(vision, /alt="Anteprima foto selezionata/)
assert.match(app, /app-view--vision/)
assert.match(read('src/App.css'), /\.app-view--chat\[hidden\]/)

console.log('ok: #274 Vision Lens wiring / regression guards')
