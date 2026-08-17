/**
 * #298A — Memory CRUD field length validation (unit via validate pattern).
 * Run: node lib/server/memory-field-limits.test.mjs
 */

import assert from 'node:assert/strict'
import { MEMORY_FIELD_LIMITS, isWithinLength } from './memory-field-limits.js'

assert.ok(isWithinLength('a'.repeat(MEMORY_FIELD_LIMITS.title), MEMORY_FIELD_LIMITS.title))
assert.ok(!isWithinLength('a'.repeat(MEMORY_FIELD_LIMITS.title + 1), MEMORY_FIELD_LIMITS.title))
assert.ok(!isWithinLength('a'.repeat(MEMORY_FIELD_LIMITS.content + 1), MEMORY_FIELD_LIMITS.content))
assert.ok(!isWithinLength('a'.repeat(MEMORY_FIELD_LIMITS.category + 1), MEMORY_FIELD_LIMITS.category))

// Source-level: create + update routes reject oversized fields
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const indexSrc = readFileSync(join(root, 'api/memories/index.ts'), 'utf8')
const idSrc = readFileSync(join(root, 'api/memories/[id].ts'), 'utf8')

assert.ok(indexSrc.includes('title must be at most'))
assert.ok(indexSrc.includes('content must be at most'))
assert.ok(indexSrc.includes('category must be at most'))
assert.ok(idSrc.includes('title must be at most'))
assert.ok(idSrc.includes('content must be at most'))
assert.ok(idSrc.includes('Memory id is invalid'))

console.log('ok: memory field limits')
