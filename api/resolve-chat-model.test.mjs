/**
 * Resolve OPENAI_MODEL for the new LAIfe core (#388G shared helper).
 * Run: node api/resolve-chat-model.test.mjs
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  resolveConfiguredChatModel,
  STANDARD_CHAT_MODEL,
} from '../lib/server/chat-model.js'

const chatSrc = readFileSync(new URL('./chat.ts', import.meta.url), 'utf8')
assert.match(chatSrc, /resolveEntitledChatModel/)
assert.doesNotMatch(chatSrc, /function resolveChatModel/)
assert.doesNotMatch(chatSrc, /OPENAI_MODEL\?\.trim\(\) \|\| 'gpt-4o-mini'/)

const selectionSrc = readFileSync(new URL('./selection.ts', import.meta.url), 'utf8')
assert.match(selectionSrc, /resolveEntitledChatModel/)
assert.doesNotMatch(selectionSrc, /function resolveChatModel/)

assert.equal(STANDARD_CHAT_MODEL, 'gpt-4o')
assert.equal(resolveConfiguredChatModel({}), 'gpt-4o')
assert.equal(resolveConfiguredChatModel({ OPENAI_MODEL: '' }), 'gpt-4o')
assert.equal(resolveConfiguredChatModel({ OPENAI_MODEL: 'gpt-4o' }), 'gpt-4o')
assert.equal(resolveConfiguredChatModel({ OPENAI_MODEL: 'gpt-40' }), 'gpt-4o')
assert.equal(resolveConfiguredChatModel({ OPENAI_MODEL: 'GPT-40' }), 'gpt-4o')
assert.equal(resolveConfiguredChatModel({ OPENAI_MODEL: ' gpt-40 ' }), 'gpt-4o')
assert.equal(resolveConfiguredChatModel({ OPENAI_MODEL: 'gpt-4o-mini' }), 'gpt-4o-mini')

console.log('ok: resolveConfiguredChatModel maps gpt-40 → gpt-4o and defaults to gpt-4o')
