/**
 * #314 wiring contracts (no LLM timer ownership).
 * Run: node src/lib/timer/wiring.test.mjs
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')

const chatCtx = read('src/context/ChatContext.tsx')
const shell = read('src/components/chat/ComposerShell.tsx')
const chip = read('src/components/chat/ActiveTimerChip.tsx')

assert.match(chatCtx, /LOCAL_EXCHANGE/)
assert.match(chatCtx, /applyTimerIntent/)
assert.match(chatCtx, /activeTimer/)
assert.match(chatCtx, /loadActiveTimerFromStorage/)
assert.match(chatCtx, /playTimerCompletionSound/)
assert.match(chatCtx, /endsAt/)
assert.doesNotMatch(chatCtx, /createReminderFromProposal/)

assert.match(shell, /ActiveTimerChip/)
assert.match(shell, /stopActiveTimer/)
assert.match(chip, /formatCountdown/)
assert.match(chip, /Ferma|Stop/)

// Reminders / Calendar / Email untouched by this PR surface
assert.ok(fs.existsSync(path.join(root, 'src/pages/ReminderManage.tsx')))
const rem = read('src/lib/reminderApi.ts')
assert.match(rem, /createReminderFromProposal/)

console.log('wiring.test.mjs: ok')
