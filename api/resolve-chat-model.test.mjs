/**
 * Resolve OPENAI_MODEL for the new LAIfe core.
 * Run: node api/resolve-chat-model.test.mjs
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const src = readFileSync(new URL('./chat.ts', import.meta.url), 'utf8')
assert.match(src, /function resolveChatModel/)
assert.match(src, /gpt-40/)
assert.match(src, /return normalized \|\| 'gpt-4o'/)
assert.doesNotMatch(src, /OPENAI_MODEL\?\.trim\(\) \|\| 'gpt-4o-mini'/)

// Inline the same normalization used by api/chat.ts for unit checks.
function resolveChatModel(env) {
  const raw = typeof env.OPENAI_MODEL === 'string' ? env.OPENAI_MODEL.trim() : ''
  const normalized = raw.replace(/\bgpt-40\b/gi, 'gpt-4o')
  return normalized || 'gpt-4o'
}

assert.equal(resolveChatModel({}), 'gpt-4o')
assert.equal(resolveChatModel({ OPENAI_MODEL: '' }), 'gpt-4o')
assert.equal(resolveChatModel({ OPENAI_MODEL: 'gpt-4o' }), 'gpt-4o')
assert.equal(resolveChatModel({ OPENAI_MODEL: 'gpt-40' }), 'gpt-4o')
assert.equal(resolveChatModel({ OPENAI_MODEL: 'GPT-40' }), 'gpt-4o')
assert.equal(resolveChatModel({ OPENAI_MODEL: ' gpt-40 ' }), 'gpt-4o')
assert.equal(resolveChatModel({ OPENAI_MODEL: 'gpt-4o-mini' }), 'gpt-4o-mini')

console.log('ok: resolveChatModel maps gpt-40 → gpt-4o and defaults to gpt-4o')
