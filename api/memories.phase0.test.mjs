/**
 * Phase 0 remnants + Phase 1A.3 memory CRUD JWT gate.
 * Run: node api/memories.phase0.test.mjs
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

// User-facing Memory CRUD: JWT ownership (Phase 1A.3), not admin secret.
for (const rel of ['api/memories/index.ts', 'api/memories/[id].ts']) {
  const src = readFileSync(join(root, rel), 'utf8')
  assert.match(src, /requireMemoryApiUser/, `${rel} must use requireMemoryApiUser`)
  assert.doesNotMatch(src, /assertMemoryAdminAccess/, `${rel} must not require admin secret`)
  assert.doesNotMatch(
    src,
    /LAIFE_MEMORY_ADMIN_SECRET\s*=/,
    `${rel} must not hardcode the admin secret`,
  )
}

// Developer memory-test keeps Phase 0 admin secret (no browser secret).
{
  const src = readFileSync(join(root, 'api/memory-test.ts'), 'utf8')
  assert.match(src, /assertMemoryAdminAccess/)
  assert.doesNotMatch(src, /LAIFE_MEMORY_ADMIN_SECRET\s*=/)
}

const chat = readFileSync(join(root, 'api/chat.ts'), 'utf8')
assert.match(chat, /responses\.create/)
assert.doesNotMatch(chat, /assertMemoryAdminAccess/)
assert.doesNotMatch(chat, /requireMemoryApiUser/)
assert.equal((chat.match(/responses\.create/g) || []).length, 1)

const ui = readFileSync(join(root, 'src/lib/memoryManageUi.ts'), 'utf8')
assert.match(ui, /Phase 0/)
assert.doesNotMatch(ui, /VITE_[A-Z0-9_]*SECRET/)
assert.doesNotMatch(ui, /process\.env/)
assert.doesNotMatch(ui, /import\.meta\.env\.[A-Z0-9_]*SECRET/)

console.log('ok: memory CRUD JWT gate; memory-test Phase 0; /api/chat Core untouched')
