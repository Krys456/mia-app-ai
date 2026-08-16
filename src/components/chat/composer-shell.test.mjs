/**
 * #271 Composer shell wiring / regression guards
 * Run: node src/components/chat/composer-shell.test.mjs
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')

const shell = read('src/components/chat/ComposerShell.tsx')
const shellCss = read('src/components/chat/ComposerShell.css')
const draftHook = read('src/components/chat/useComposerDraft.ts')
const types = read('src/components/chat/composerTypes.ts')
const chatContainer = read('src/components/chat/ChatContainer.tsx')
const chatContext = read('src/context/ChatContext.tsx')
const header = read('src/components/Header.tsx')
const settings = read('src/components/SettingsDrawer.tsx')
const messageActions = read('src/components/chat/MessageActions.tsx')
const appearance = read('src/lib/appearance.ts')
const apiChat = read('api/chat.ts')
const autoScroll = read('src/components/chat/AutoScrollController.ts')
const app = read('src/App.tsx')

// A–E send behavior preserved in shell
assert.match(shell, /e\.key === 'Enter' && !e\.shiftKey/)
assert.match(shell, /sendMessage\(/)
assert.match(shell, /composerDraftHasText\(draft\) && !busy/)
assert.match(shell, /Puoi scrivere il prossimo messaggio/)
assert.match(shell, /Messaggio per LAIfe/)
assert.match(shell, /aria-live="polite"/)
assert.match(shell, /TEXTAREA_MAX_HEIGHT_PX = 128/)
assert.match(shellCss, /font-size:\s*1rem/)
assert.match(shellCss, /max-height:\s*8rem/)
assert.match(shellCss, /max-width:\s*100%/)
assert.match(shellCss, /safe-bottom|safe-area/)

// F / send success clears; reject preserves
assert.match(shell, /const accepted = sendMessage\(text\)/)
assert.match(shell, /if \(!accepted\)/)
assert.match(shell, /restoreText\(text\)/)
assert.match(shell, /clear\(\)/)
assert.match(chatContext, /sendMessage: \(content: string\) => boolean/)
assert.match(chatContext, /return false/)
assert.match(chatContext, /return true/)

// G new chat clears draft (messages 0 after having messages)
assert.match(shell, /messages\.length === 0 && prev > 0/)

// H navigation: chat stays mounted — shell does not clear on view change
assert.match(app, /Keep chat mounted/)
assert.match(app, /hidden=\{view !== 'chat'\}/)
assert.doesNotMatch(shell, /onNavigate|MemoryManage/)

// I regenerate does not clear draft — only message-count→0 path clears
assert.doesNotMatch(shell, /regenerateAssistant/)

// J autosize
assert.match(shell, /scrollHeight/)
assert.match(shell, /TEXTAREA_MAX_HEIGHT_PX/)

// K no fake controls in the rendered tree / default wiring
assert.doesNotMatch(shell, /getUserMedia|type=\"file\"|SpeechRecognition|MediaRecorder/)
assert.doesNotMatch(shell, /\bInstant\b|\bmicrophone\b|Coming soon/)
assert.match(chatContainer, /<ComposerShell onMessageSent=\{onUserMessage\} \/>/)
assert.doesNotMatch(chatContainer, /leftSlot|traySlot|secondarySlot|rightSlot/)
assert.doesNotMatch(shellCss, /\.composer__mic|\.composer__plus|\.composer__instant/)

// Slots exist as optional props but empty by default
assert.match(shell, /traySlot\?:/)
assert.match(shell, /leftSlot\?:/)
assert.match(shell, /\{traySlot \?/)
assert.match(shell, /\{leftSlot \?/)

// Draft model — local hook, no persistence imports
assert.match(types, /attachments: ComposerAttachment\[\]/)
assert.match(draftHook, /useComposerDraft/)
assert.doesNotMatch(draftHook, /from ['\"].*ChatContext|localStorage|laife\.settings/)

// L mobile width
assert.match(shellCss, /\.composer-dock[\s\S]*max-width:\s*100%/)
assert.match(shellCss, /\.composer \{[\s\S]*max-width:\s*var\(--content-max\)/)

// M #268 untouched contract markers
assert.match(autoScroll, /STABLE/)
assert.match(autoScroll, /never mutate scrollTop for content growth|no growth-driven follow/i)
assert.doesNotMatch(shell, /scrollIntoView|scrollTo\(|scrollTop\s*=/)

// N #269
assert.doesNotMatch(header, /Gestisci Memoria|V2 Experimental|v2Experimental/)
assert.equal(fs.existsSync(path.join(root, 'src/components/chat/V2DebugPanel.tsx')), false)
assert.match(settings, /memory-settings-title/)

// O #270
assert.match(messageActions, /variant/)
assert.match(appearance, /--chat-font-scale/)
assert.match(settings, /appearance-settings-title/)

// R / S Core smoke
assert.match(apiChat, /maxDuration:\s*120/)
assert.match(apiChat, /responses\.create/)
const createCount = (apiChat.match(/\.responses\.create\(/g) || []).length
assert.equal(createCount, 1, 'exactly one responses.create call site in api/chat.ts')

// No InputBar.css leftover dependency
assert.equal(fs.existsSync(path.join(root, 'src/components/chat/InputBar.css')), false)
assert.match(read('src/components/chat/InputBar.tsx'), /ComposerShell as InputBar/)

console.log('ok: #271 composer shell wiring / regression guards')
