/**
 * #315 wiring contracts.
 * Run: node src/lib/phone-action/wiring.test.mjs
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')

const chat = read('src/context/ChatContext.tsx')
const app = read('src/App.tsx')
assert.match(chat, /applyPhoneAction/)
assert.match(chat, /#315/)
assert.match(chat, /applyTimerIntent/)
assert.match(app, /setAppNavigateHandler/)
assert.match(app, /vision/)
assert.doesNotMatch(chat, /createReminderFromProposal/)
// Calendar / Email APIs not touched by phone router
assert.ok(fs.existsSync(path.join(root, 'src/lib/calendarApi.ts')))
assert.ok(fs.existsSync(path.join(root, 'src/lib/timer/intent.js')))

console.log('wiring.test.mjs: ok')
