/**
 * Phase 0 — prove memory CRUD route modules require admin auth.
 * Run: node api/memories.phase0.test.mjs
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const files = [
  'api/memories/index.ts',
  'api/memories/[id].ts',
  'api/memory-test.ts',
]

for (const rel of files) {
  const src = readFileSync(join(root, rel), 'utf8')
  assert.match(src, /assertMemoryAdminAccess/, `${rel} must gate with assertMemoryAdminAccess`)
  assert.doesNotMatch(
    src,
    /LAIFE_MEMORY_ADMIN_SECRET\s*=/,
    `${rel} must not hardcode the admin secret`,
  )
}

const chat = readFileSync(join(root, 'api/chat.ts'), 'utf8')
assert.match(chat, /responses\.create/)
assert.doesNotMatch(chat, /assertMemoryAdminAccess/)
assert.equal((chat.match(/responses\.create/g) || []).length, 1)

const ui = readFileSync(join(root, 'src/lib/memoryManageUi.ts'), 'utf8')
assert.match(ui, /Phase 0/)
assert.doesNotMatch(ui, /VITE_[A-Z0-9_]*SECRET/)
assert.doesNotMatch(ui, /process\.env/)
assert.doesNotMatch(ui, /import\.meta\.env\.[A-Z0-9_]*SECRET/)

console.log('ok: Phase 0 memory routes gated; /api/chat Core untouched')
