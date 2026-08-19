/**
 * #312A Vision custom prompt + caption UX contracts
 * Run: node src/pages/vision-custom-prompt.test.mjs
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
  resolveVisionStickyLang,
} from '../../lib/server/vision-task-shortcuts.js'
import {
  imageOnlyModelNudgeForMessages,
} from '../../lib/server/chat-image-input.js'
import {
  detectVisionSearchIntent,
} from '../../lib/server/vision-search-intent.js'

const root = process.cwd()
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')

async function loadTs(rel) {
  const entry = path.resolve(rel)
  const esbuild = await import('esbuild')
  const outfile = path.join(os.tmpdir(), `vision312a-${Date.now()}-${Math.random()}.mjs`)
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
const vision = read('src/pages/Vision.tsx')
const visionCss = read('src/pages/Vision.css')
const selection = read('src/components/chat/useMessageSelection.ts')
const chatApi = read('src/lib/chatApi.ts')
const chatCtx = read('src/context/ChatContext.tsx')
const apiChat = read('api/chat.ts')

// Client ↔ server shortcut lists must match
assert.deepEqual(
  [...client.listVisionTaskShortcutTexts()].sort(),
  [...listVisionTaskShortcutTexts()].sort(),
)

// Custom input appears under image
assert.match(vision, /laife-vision__prompt/)
assert.match(vision, /customPrompt/)
assert.match(vision, /Chiedi qualcosa su questa immagine|visionPromptPlaceholder/)
assert.match(vision, /laife-vision__prompt-send/)
assert.match(visionCss, /laife-vision__prompt-input/)

// Caption preserved / sent with image
assert.match(vision, /resolveVisionSubmitCaption/)
assert.match(vision, /sendMessage\(finalCaption, \[wire\]\)/)
assert.match(vision, /setCustomPrompt\(''\)/)

// No auto-submit on capture / prepare
assert.doesNotMatch(vision, /setPreparedAttachment[\s\S]{0,200}submitVision/)
assert.doesNotMatch(vision, /prepareFromFile[\s\S]{0,120}submitVision|runAction/)
assert.match(vision, /setPhase\('ready'\)/)

// Quick actions + Search
for (const a of ['analyze', 'explain', 'identify', 'read', 'search']) {
  assert.match(vision, new RegExp(`'${a}'`))
}
assert.match(vision, /QUICK_ACTIONS/)
assert.match(vision, /visionActionLabel/)

// Custom overrides shortcut
assert.equal(
  client.resolveVisionSubmitCaption({
    customText: 'Che modello è e quali sono le specifiche?',
    action: 'analyze',
    lang: 'it',
  }),
  'Che modello è e quali sono le specifiche?',
)
assert.equal(
  client.resolveVisionSubmitCaption({ customText: '  ', action: 'explain', lang: 'it' }),
  VISION_TASK_PROMPTS.it.explain,
)
assert.equal(
  client.resolveVisionSubmitCaption({ customText: '', action: 'identify', lang: 'en' }),
  VISION_TASK_PROMPTS.en.identify,
)
assert.equal(
  client.resolveVisionSubmitCaption({ customText: '', action: 'read', lang: 'it' }),
  VISION_TASK_PROMPTS.it.read,
)
assert.equal(
  client.resolveVisionSubmitCaption({ customText: '', action: 'analyze', lang: 'it' }),
  '',
)
assert.match(
  client.resolveVisionSubmitCaption({ customText: '', action: 'search', lang: 'it' }),
  /Cercalo online/,
)
assert.match(
  client.resolveVisionSubmitCaption({ customText: '', action: 'search', lang: 'en' }),
  /Search this online/,
)

// Identify + Search are Memory-skip shortcuts
assert.equal(isVisionTaskShortcut(VISION_TASK_PROMPTS.it.identify), true)
assert.equal(isVisionTaskShortcut('Cercalo online.'), true)

// Language: Italian session / Italian-first empty fallback
assert.equal(
  client.resolveVisionActionLang({
    messages: [
      { role: 'user', content: 'Ciao, parliamo in italiano.' },
      { role: 'assistant', content: 'Certo!' },
    ],
    navigatorLanguage: 'en-US',
  }),
  'it',
)
assert.equal(client.resolveVisionActionLang({ messages: [], navigatorLanguage: 'it-IT' }), 'it')
assert.equal(client.resolveVisionActionLang({ messages: [], navigatorLanguage: '' }), 'it')
assert.equal(client.resolveVisionActionLang({ messages: [], navigatorLanguage: 'en-US' }), 'en')
assert.equal(resolveVisionStickyLang([], 'it-IT'), 'it')
assert.equal(resolveVisionStickyLang([], ''), 'it')
assert.match(imageOnlyModelNudgeForMessages([], 'it-IT'), /Analizza/)
assert.match(imageOnlyModelNudgeForMessages([], ''), /Analizza/)

// Explicit language override still via caption text (user typed)
assert.equal(
  client.resolveVisionSubmitCaption({
    customText: 'Answer in Spanish. What is this?',
    action: 'analyze',
    lang: 'it',
  }),
  'Answer in Spanish. What is this?',
)

// #312 Vision Search still wired
assert.match(vision, /search/)
const searchCap = client.captionForVisionAction('search', 'it')
assert.equal(
  detectVisionSearchIntent(searchCap, {
    hasVisionContext: true,
    messages: [
      {
        role: 'user',
        content: '',
        attachments: [{ type: 'image', mimeType: 'image/jpeg', dataUrl: 'data:image/jpeg;base64,AA' }],
      },
      { role: 'assistant', content: 'Sembrano cuffie Sony.' },
    ],
  }).intent,
  'vision_search',
)

// Selected-text Search preserved (separate path)
assert.match(selection, /operation:\s*['"]search['"]|search/)
assert.match(read('api/selection.ts'), /operation === 'search'/)
assert.doesNotMatch(vision, /selectionApi|useMessageSelection/)

// browserLocale forwarded for Vision language
assert.match(chatApi, /browserLocale/)
assert.match(chatCtx, /browserLocale/)
assert.match(apiChat, /mapMessagesToResponsesInput\(messages,\s*\{/)
assert.match(apiChat, /browserLocale/)

// Accessibility
assert.match(vision, /aria-label=\{promptPlaceholder\}/)
assert.match(vision, /enterKeyHint="send"/)
assert.match(visionCss, /:focus|:focus-visible/)
assert.match(visionCss, /touch-min|--touch-min/)

console.log('ok: #312A Vision custom prompt + caption UX')
