/**
 * #265 Specific Forget intent precision (directive vs descriptive).
 * Run: node lib/server/memory-forget-intent-precision.test.mjs
 */

import assert from 'node:assert/strict'
import {
  classifySpecificForgetTarget,
  isDescriptiveForgetUse,
  isGlobalForgetIntent,
  isSpecificForgetIntent,
  stripForgetWrapper,
  tryHandleSpecificForget,
} from './memory-control-forget.js'

function row(id, factKey, content) {
  return {
    id,
    user_id: 'user-a',
    category: 'preferences',
    content,
    status: 'active',
    tags: [`fk:${factKey}`, `fact_key:${factKey}`],
    importance: 8,
    title: '',
  }
}

/** Minimal fake supabase + list helpers via tryHandleSpecificForget overrides are limited;
 * we assert intent/classify/strip and use a fake client for mutation path. */
function createFakeSupabase(rows) {
  const store = rows.map((r) => ({ ...r }))
  const api = {
    _store: store,
    from() {
      return api
    },
    select() {
      return api
    },
    eq(col, val) {
      api._filtered = store.filter((r) => String(r[col] ?? r.user_id) === String(val) || true)
      if (col === 'user_id') api._filtered = store.filter((r) => r.user_id === val)
      return api
    },
    neq() {
      return api
    },
    in() {
      return api
    },
    order() {
      return api
    },
    limit() {
      return api
    },
    update(patch) {
      api._patch = patch
      return api
    },
    then(resolve, reject) {
      try {
        if (api._patch) {
          for (const r of store) {
            if (r.status === 'active') Object.assign(r, api._patch)
          }
          api._patch = null
          resolve({ data: store, error: null })
        } else {
          resolve({ data: store.filter((r) => r.status === 'active'), error: null })
        }
      } catch (e) {
        reject(e)
      }
    },
  }
  return api
}

// —— VALID directives ——
const valid = [
  'Forget Naruto.',
  'Forget that I like Naruto.',
  'Please forget Naruto.',
  'I want you to forget Naruto.',
  "I'd like you to forget Naruto.",
  'Dimentica Naruto.',
  'Dimentica che mi piace Naruto.',
  'Per favore dimentica Naruto.',
  'Voglio che dimentichi Naruto.',
  'Forget my favorite animal.',
  'Non ricordare più che adoro Naruto.',
  "Don't remember that I like Naruto.",
  'Il mio colore preferito è blu, dimenticalo.',
]
for (const msg of valid) {
  assert.equal(isSpecificForgetIntent(msg), true, `VALID intent: ${msg}`)
}

assert.equal(stripForgetWrapper('I want you to forget Naruto.'), 'Naruto')
assert.equal(stripForgetWrapper("I'd like you to forget that I like Naruto."), 'I like Naruto')
assert.equal(stripForgetWrapper('Voglio che dimentichi Naruto.'), 'Naruto')
assert.equal(classifySpecificForgetTarget('Forget that I like Naruto.').kind, 'like')
assert.equal(
  classifySpecificForgetTarget('Forget that I like Naruto.').factKey,
  'preferences.like.naruto',
)
assert.equal(classifySpecificForgetTarget('I want you to forget Naruto.').kind, 'bare_entity')

// —— FALSE POSITIVES ——
const invalid = [
  'I forget what you said about Naruto.',
  'I forget that I like Naruto.',
  'Sometimes I forget Naruto exists.',
  'People forget Naruto.',
  "She said 'forget Naruto'.",
  '"Forget Naruto" is a strange command.',
  'If I forget Naruto, remind me.',
  'Never forget Naruto.',
  "I don't want you to forget Naruto.",
  "Let's forget about Naruto.",
  "Let's forget about Naruto for a moment.",
  'La gente dimentica Naruto.',
  "Ha detto: 'Dimentica Naruto'.",
  'Non voglio che dimentichi Naruto.',
  'I forgot what you said about Naruto.',
  'I keep forgetting Naruto.',
  'Ho dimenticato cosa mi avevi detto su Naruto.',
  'Can you forget Naruto?',
  'Should I forget Naruto?',
  'Did you forget Naruto?',
]
for (const msg of invalid) {
  assert.equal(isSpecificForgetIntent(msg), false, `INVALID intent: ${msg}`)
}

assert.equal(isDescriptiveForgetUse('I forget that I like Naruto.'), true)
assert.equal(isDescriptiveForgetUse('Forget that I like Naruto.'), false)

// —— Global Forget ——
assert.equal(isGlobalForgetIntent('Forget everything about me.'), true)
assert.equal(isSpecificForgetIntent('Forget everything about me.'), false)
assert.equal(isSpecificForgetIntent('I forget everything.'), false)
assert.equal(isGlobalForgetIntent('I forget everything.'), false)
assert.equal(isGlobalForgetIntent('I forget everything about me.'), false)
assert.equal(isSpecificForgetIntent('People forget everything.'), false)
assert.equal(isGlobalForgetIntent('People forget everything.'), false)
assert.equal(isGlobalForgetIntent('People forget everything about me.'), false)
assert.equal(isGlobalForgetIntent('Dimentica tutto quello che sai su di me.'), true)

// —— Critical mutation regression (TEST 10) ——
{
  const like = row('m1', 'preferences.like.naruto', 'User likes Naruto.')
  const result = await tryHandleSpecificForget({
    userMessage: 'I forget that I like Naruto.',
    userId: 'user-a',
    supabase: createFakeSupabase([like]),
  })
  assert.equal(result.handled, false)
  assert.equal(result.status, 'not_forget')
  assert.equal(like.status, 'active')
}

// Valid typed delete still classifies
{
  const classified = classifySpecificForgetTarget('Forget that I like Naruto.')
  assert.equal(classified.kind, 'like')
  assert.equal(classified.factKey, 'preferences.like.naruto')
}

console.log('ok: #265 memory forget intent precision')
