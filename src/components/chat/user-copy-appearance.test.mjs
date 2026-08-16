/**
 * #270 User Copy + Appearance wiring / regression guards
 * Run: node src/components/chat/user-copy-appearance.test.mjs
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')

const messageActions = read('src/components/chat/MessageActions.tsx')
const messageBubble = read('src/components/chat/MessageBubble.tsx')
const messageList = read('src/components/chat/MessageList.tsx')
const messageActionsCss = read('src/components/chat/MessageActions.css')
const messageBubbleCss = read('src/components/chat/MessageBubble.css')
const streamingCss = read('src/components/chat/StreamingRenderer.css')
const codeBlockCss = read('src/components/chat/CodeBlock.css')
const indexCss = read('src/index.css')
const inputBarCss = read('src/components/chat/InputBar.css')
const chatContext = read('src/context/ChatContext.tsx')
const chatApi = read('src/lib/chatApi.ts')
const settingsDrawer = read('src/components/SettingsDrawer.tsx')
const header = read('src/components/Header.tsx')
const types = read('src/types.ts')
const clipboard = read('src/lib/clipboard.ts')

// A / B / C — Copy behavior
assert.match(messageActions, /copyText/)
assert.match(clipboard, /export async function copyText/)
assert.match(messageActions, /variant\?: MessageActionsVariant/)
assert.match(messageActions, /'assistant' \| 'user'/)
assert.match(messageActions, /isUser/)
assert.match(messageActions, /Azioni messaggio utente/)
// User toolbar = Copy only (no thumbs / regenerate in user branch)
assert.match(messageActions, /\{!isUser \? \(/)
assert.match(messageActions, /Mi è stata utile/)
assert.match(messageActions, /Rigenera/)
assert.ok(
  messageActions.indexOf("variant === 'user'") >= 0 ||
    messageActions.indexOf('isUser = variant ===') >= 0,
)

assert.match(messageBubble, /variant=\{isAssistant \? 'assistant' : 'user'\}/)
assert.match(messageList, /message\.role === 'user'/)
assert.match(messageActionsCss, /pointer: coarse/)
assert.match(messageActionsCss, /\.message-actions--user/)
assert.match(messageActionsCss, /\.bubble--user:hover \.message-actions/)

// D / E / F — appearance settings shape + persistence key
assert.match(types, /fontSize: AppearanceFontSize/)
assert.match(types, /fontFamily: AppearanceFontFamily/)
assert.match(types, /'small' \| 'default' \| 'large'/)
assert.match(types, /'outfit' \| 'system'/)
assert.match(types, /appearance: AppearanceSettings/)
assert.match(chatContext, /laife\.settings\.v2/)
assert.match(chatContext, /normalizeAppearance/)
assert.match(chatContext, /UPDATE_APPEARANCE/)
assert.match(chatContext, /updateAppearance/)
assert.match(chatContext, /applyAppearanceToDocument/)
assert.match(settingsDrawer, /appearance-settings-title/)
assert.match(settingsDrawer, /Dimensione testo/)
assert.match(settingsDrawer, /Small/)
assert.match(settingsDrawer, /Default/)
assert.match(settingsDrawer, /Large/)
assert.match(settingsDrawer, /Outfit/)
assert.match(settingsDrawer, /System/)
assert.match(settingsDrawer, /updateAppearance/)
assert.doesNotMatch(settingsDrawer, /V2 Experimental/)
assert.doesNotMatch(settingsDrawer, /V2DebugPanel/)

// G — appearance NOT in Core request payload
assert.doesNotMatch(chatApi, /appearance/)
const requestBodyMatch = chatApi.match(/body:\s*JSON\.stringify\(\{([\s\S]*?)\}\)/)
assert.ok(requestBodyMatch, 'expected JSON.stringify body in chatApi')
assert.doesNotMatch(requestBodyMatch[1], /appearance/)
const completionCall = chatContext.match(/await requestChatCompletion\(\s*\{([\s\S]*?)\},\s*\{\s*signal/)
assert.ok(completionCall, 'expected requestChatCompletion call site')
assert.doesNotMatch(completionCall[1], /appearance/)
assert.doesNotMatch(completionCall[1], /fontSize|fontFamily/)

// H / I / J — typography + overflow
assert.match(indexCss, /--chat-font-scale/)
assert.match(indexCss, /--font-sans/)
assert.match(indexCss, /--md-block-gap/)
assert.match(streamingCss, /--chat-font-scale/)
assert.match(streamingCss, /--md-block-gap/)
assert.match(streamingCss, /overflow-wrap:\s*anywhere/)
assert.match(streamingCss, /overflow-x:\s*hidden/)
assert.match(streamingCss, /overflow-x:\s*auto/)
assert.match(codeBlockCss, /overflow-x:\s*auto/)
assert.match(messageBubbleCss, /max-width:\s*100%/)
assert.match(messageBubbleCss, /overflow-wrap:\s*anywhere/)
assert.match(messageBubbleCss, /--chat-font-scale/)
assert.match(inputBarCss, /font-size:\s*1rem/)
assert.match(indexCss, /overflow-x:\s*hidden/)
assert.match(indexCss, /overflow-x:\s*clip/)

// L — #269 header/settings cleanup remains
assert.doesNotMatch(header, /Gestisci Memoria|onOpenMemory|Memoria/)
assert.doesNotMatch(header, /V2 Experimental|v2Experimental/)
assert.equal(fs.existsSync(path.join(root, 'src/components/chat/V2DebugPanel.tsx')), false)
assert.equal(fs.existsSync(path.join(root, 'src/components/chat/V2DebugPanel.css')), false)
assert.match(settingsDrawer, /memory-settings-title/)
assert.match(settingsDrawer, /memoryEnabled/)

console.log('ok: #270 user-copy + appearance wiring / regression guards')
