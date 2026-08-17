/**
 * #298B — RLS enablement migration contract (deny-by-default PostgREST).
 * Static verification of intended SQL (live apply is manual).
 * Run: node lib/server/rls-owner-policies-298b.test.mjs
 */

import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const migrationPath = 'supabase/migrations/20260817210000_rls_owner_policies_298b.sql'
const sql = readFileSync(join(root, migrationPath), 'utf8')
/** Executable SQL only (strip `--` line comments) for DDL assertions. */
const executable = sql
  .split('\n')
  .map((line) => line.replace(/--.*$/, ''))
  .join('\n')

assert.ok(sql.length > 200, 'migration must exist')

// Must NOT disable or FORCE RLS
assert.doesNotMatch(executable, /DISABLE\s+ROW\s+LEVEL\s+SECURITY/i)
assert.doesNotMatch(executable, /FORCE\s+ROW\s+LEVEL\s+SECURITY/i)

// Fresh-env reproducibility: all five tables explicitly ENABLE RLS
for (const table of ['users', 'memories', 'conversations', 'messages', 'settings']) {
  assert.match(
    executable,
    new RegExp(
      `ALTER\\s+TABLE\\s+public\\.${table}\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY\\s*;`,
      'i',
    ),
    `missing ENABLE RLS for public.${table}`,
  )
}

// Closed-beta strategy: no client policies in this migration
assert.equal(
  (executable.match(/CREATE\s+POLICY/gi) || []).length,
  0,
  'CREATE POLICY count must be 0',
)
assert.equal(
  (executable.match(/DROP\s+POLICY/gi) || []).length,
  0,
  'DROP POLICY count must be 0',
)

assert.doesNotMatch(executable, /USING\s*\(\s*true\s*\)/i)
assert.doesNotMatch(executable, /WITH\s+CHECK\s*\(\s*true\s*\)/i)
assert.doesNotMatch(executable, /TO\s+authenticated/i)
assert.doesNotMatch(executable, /TO\s+anon\b/i)
assert.doesNotMatch(executable, /TO\s+public\b/i)
assert.doesNotMatch(executable, /FOR\s+ALL\b/i)

// Documented security model
assert.match(sql, /service[- ]role/i)
assert.match(sql, /deny-by-default|deny by default/i)
assert.match(sql, /conversation_id/)

// README documents deny-by-default + API ownership boundary
const readme = readFileSync(join(root, 'supabase/migrations/README-298B-RLS.md'), 'utf8')
assert.match(readme, /Deny by default/i)
assert.match(readme, /service role/i)
assert.match(readme, /application APIs/i)
assert.match(readme, /NOT SHIPPED|not shipped|intentionally not/i)

// Browser must not introduce direct table clients for these public tables
const srcFiles = []
function walk(dir) {
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, name.name)
    if (name.isDirectory()) {
      if (name.name === 'node_modules' || name.name === 'dist') continue
      walk(p)
    } else if (/\.(ts|tsx|js|mjs)$/.test(name.name)) {
      srcFiles.push(p)
    }
  }
}
walk(join(root, 'src'))

for (const file of srcFiles) {
  const body = readFileSync(file, 'utf8')
  assert.doesNotMatch(
    body,
    /\.from\(\s*['"](?:users|memories|conversations|messages|settings)['"]\s*\)/,
    `${file} must not query public user-data tables directly`,
  )
}

// Memory Manage / CRUD still via authenticated API
const memoryApi = readFileSync(join(root, 'src/lib/memoryApi.ts'), 'utf8')
assert.match(memoryApi, /\/api\/memories/)
assert.match(memoryApi, /Authorization/)

const memoriesIndex = readFileSync(join(root, 'api/memories/index.ts'), 'utf8')
assert.match(memoriesIndex, /requireMemoryApiUser/)
assert.match(memoriesIndex, /requireExplicitUserId:\s*true/)

// #298A remains intact
const chat = readFileSync(join(root, 'api/chat.ts'), 'utf8')
assert.match(chat, /requirePaidApiAccess/)
assert.equal((chat.match(/\.responses\.create\s*\(/g) || []).length, 1)
const fieldLimits = readFileSync(join(root, 'lib/server/memory-field-limits.js'), 'utf8')
assert.match(fieldLimits, /title:\s*200/)
const memoryTest = readFileSync(join(root, 'api/memory-test.ts'), 'utf8')
assert.match(memoryTest, /VERCEL_ENV === 'production'/)
const rateLimit = readFileSync(join(root, 'lib/server/rate-limit.js'), 'utf8')
assert.match(rateLimit, /isProductionLikeDeploy/)
assert.match(rateLimit, /unavailable/)

console.log('ok: #298B RLS enable-only deny-by-default contracts')
