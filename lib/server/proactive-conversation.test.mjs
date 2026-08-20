/**
 * #285 Proactive Intelligence — retained as reference module.
 * #325: Proactive is NO LONGER injected into Core (migrated into Natural Response Policy + Base boundaries).
 * Run: node lib/server/proactive-conversation.test.mjs
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  PROACTIVE_INTELLIGENCE_CONTRACT,
  buildCoreProactiveIntelligenceAppendix,
} from './proactive-conversation.js'
import { buildNaturalResponsePolicyAppendix } from './natural-response-policy.js'
import { LAIFE_BASE_SYSTEM_PROMPT } from './laife-base-system-prompt.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const chatSrc = readFileSync(join(root, 'api/chat.ts'), 'utf8')

const proactive = buildCoreProactiveIntelligenceAppendix()
assert.equal(proactive, PROACTIVE_INTELLIGENCE_CONTRACT)
assert.ok(proactive.startsWith('PROACTIVE INTELLIGENCE'))
assert.ok(/Vuoi che|Would you like me to/i.test(proactive))
assert.ok(/does NOT authorize external actions/i.test(proactive))

// Not injected
assert.ok(!chatSrc.includes('buildCoreProactiveIntelligenceAppendix'))
assert.ok(chatSrc.includes('buildNaturalResponsePolicyAppendix'))

const nrp = buildNaturalResponsePolicyAppendix()
assert.ok(/initiative/i.test(nrp))
assert.ok(/question_needed=false/i.test(nrp))
assert.ok(/service menus|Vuoi che|Would you like/i.test(nrp))
assert.ok(/Never imply external actions/i.test(LAIFE_BASE_SYSTEM_PROMPT))
assert.ok(/take initiative/i.test(LAIFE_BASE_SYSTEM_PROMPT))

assert.ok(!/runCognitiveEngine|curiosity-engine|conversation-spark/i.test(chatSrc))

console.log('proactive-conversation.test.mjs: PASS (reference retained; not injected)')
