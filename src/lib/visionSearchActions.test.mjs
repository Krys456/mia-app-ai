/**
 * #312 client Vision × Search UI helpers (source contracts).
 * Run: node src/lib/visionSearchActions.test.mjs
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')

const actions = read('src/lib/visionSearchActions.ts')
const diag = read('src/lib/visionSearchDiag.ts')
const messageActions = read('src/components/chat/MessageActions.tsx')
const messageList = read('src/components/chat/MessageList.tsx')
const chatApi = read('src/lib/chatApi.ts')

assert.match(actions, /Cerca/)
assert.match(actions, /Search/)
assert.match(actions, /Cercalo online/)
assert.match(actions, /shouldShowVisionSearchAction/)
assert.match(actions, /vision_search_diag/)

assert.match(messageActions, /showVisionSearch/)
assert.match(messageActions, /IconSearch/)
assert.match(messageList, /visionSearchButtonTrigger/)
assert.match(messageList, /shouldShowVisionSearchAction/)

assert.match(chatApi, /X-Shinkaido-Vision-Search-Diag/)
assert.match(chatApi, /visionSearchDiag/)
assert.match(diag, /route:\s*'vision-search'/)

// No Calendar / Email coupling
assert.ok(!/calendar-chat|email-oauth|gmail/i.test(actions + diag + messageList))

console.log('visionSearchActions.test.mjs: ok')
