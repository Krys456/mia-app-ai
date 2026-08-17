/**
 * #298B — RLS owner-policy migration contract tests.
 * Static verification of intended SQL (live apply is manual).
 * Run: node lib/server/rls-owner-policies-298b.test.mjs
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
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

assert.ok(sql.length > 500, 'migration must exist and be non-trivial')

// Must NOT disable RLS
assert.doesNotMatch(executable, /DISABLE\s+ROW\s+LEVEL\s+SECURITY/i)

// Must NOT blindly re-enable (live already enabled — documented in comments only)
assert.doesNotMatch(executable, /ENABLE\s+ROW\s+LEVEL\s+SECURITY/i)

// No blanket policies
assert.doesNotMatch(executable, /USING\s*\(\s*true\s*\)/i)
assert.doesNotMatch(executable, /WITH\s+CHECK\s*\(\s*true\s*\)/i)
assert.doesNotMatch(executable, /TO\s+public\b/i)
assert.doesNotMatch(executable, /FOR\s+ALL\b/i)

// Only drop known #298B policy names (no broad DROP POLICY without IF EXISTS name)
const drops = [...executable.matchAll(/DROP\s+POLICY\s+IF\s+EXISTS\s+(\w+)\s+ON\s+public\.(\w+)/gi)]
assert.ok(drops.length >= 18, `expected owner policy drops, got ${drops.length}`)
for (const [, name, table] of drops) {
  assert.match(name, /_own$/)
  assert.ok(
    ['users', 'memories', 'conversations', 'messages', 'settings'].includes(table),
    `unexpected drop table ${table}`,
  )
}

// No anonymous DROP POLICY without IF EXISTS
assert.doesNotMatch(executable, /DROP\s+POLICY\s+(?!IF\s+EXISTS)/i)

const requiredPolicies = [
  ['memories', 'memories_select_own', 'SELECT', 'user_id = auth.uid()'],
  ['memories', 'memories_insert_own', 'INSERT', 'user_id = auth.uid()'],
  ['memories', 'memories_update_own', 'UPDATE', 'user_id = auth.uid()'],
  ['memories', 'memories_delete_own', 'DELETE', 'user_id = auth.uid()'],
  ['users', 'users_select_own', 'SELECT', 'id = auth.uid()'],
  ['users', 'users_update_own', 'UPDATE', 'id = auth.uid()'],
  ['conversations', 'conversations_select_own', 'SELECT', 'user_id = auth.uid()'],
  ['conversations', 'conversations_insert_own', 'INSERT', 'user_id = auth.uid()'],
  ['conversations', 'conversations_update_own', 'UPDATE', 'user_id = auth.uid()'],
  ['conversations', 'conversations_delete_own', 'DELETE', 'user_id = auth.uid()'],
  ['messages', 'messages_select_own', 'SELECT', 'user_id = auth.uid()'],
  ['messages', 'messages_insert_own', 'INSERT', 'user_id = auth.uid()'],
  ['messages', 'messages_update_own', 'UPDATE', 'user_id = auth.uid()'],
  ['messages', 'messages_delete_own', 'DELETE', 'user_id = auth.uid()'],
  ['settings', 'settings_select_own', 'SELECT', 'user_id = auth.uid()'],
  ['settings', 'settings_insert_own', 'INSERT', 'user_id = auth.uid()'],
  ['settings', 'settings_update_own', 'UPDATE', 'user_id = auth.uid()'],
  ['settings', 'settings_delete_own', 'DELETE', 'user_id = auth.uid()'],
]

for (const [table, policy, command, ownership] of requiredPolicies) {
  assert.match(
    sql,
    new RegExp(`CREATE POLICY ${policy}\\s+ON public\\.${table}`, 'i'),
    `missing policy ${policy}`,
  )
  assert.match(
    sql,
    new RegExp(`CREATE POLICY ${policy}[\\s\\S]*?FOR ${command}`, 'i'),
    `${policy} must be FOR ${command}`,
  )
  assert.match(
    sql,
    new RegExp(`CREATE POLICY ${policy}[\\s\\S]*?TO authenticated`, 'i'),
    `${policy} must target authenticated`,
  )
  assert.match(
    sql,
    new RegExp(
      `CREATE POLICY ${policy}[\\s\\S]*?(?:USING|WITH CHECK)\\s*\\(\\s*${ownership.replace(
        /[.*+?^${}()|[\]\\]/g,
        '\\$&',
      )}\\s*\\)`,
      'i',
    ),
    `${policy} must use ${ownership}`,
  )
}

// users: no authenticated INSERT policy (service-role bridge)
assert.doesNotMatch(sql, /CREATE POLICY users_insert/i)

// Service-role / mark_memories_used residual documented
assert.match(sql, /mark_memories_used/)
assert.match(sql, /service role/i)

// #298A field limits + memory-test still present in repo
const fieldLimits = readFileSync(join(root, 'lib/server/memory-field-limits.js'), 'utf8')
assert.match(fieldLimits, /title:\s*200/)
const memoryTest = readFileSync(join(root, 'api/memory-test.ts'), 'utf8')
assert.match(memoryTest, /VERCEL_ENV === 'production'/)

console.log('ok: #298B RLS owner-policy migration contracts')
