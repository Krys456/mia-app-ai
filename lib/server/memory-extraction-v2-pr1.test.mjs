/**
 * Extraction V2 PR1 — safety gate + explicit intent normalization.
 * Run: node lib/server/memory-extraction-v2-pr1.test.mjs
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  analyzeConversation,
  containsUnsafeMemoryMaterial,
  extractDurableFacts,
  stripExplicitMemoryIntent,
} from './brain-memory.js'
import { buildCoreResponsesCreateParams } from './core-responses-params.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')

function categories(facts) {
  return facts.map((f) => f.category)
}

function primary(msg) {
  const facts = extractDurableFacts(msg)
  return { facts, decision: analyzeConversation(msg, 'ok') }
}

// Explicit intent → preference (not settings)
{
  const { facts } = primary('Ricorda che il mio colore preferito è viola')
  assert.ok(facts.length >= 1)
  assert.equal(facts[0].category, 'preferences')
  assert.match(facts[0].content, /viola/i)
  assert.equal(facts[0].source, 'explicit')
  assert.ok((facts[0].confidence ?? 0) >= 0.9)
  assert.ok(!categories(facts).includes('settings') || facts[0].category === 'preferences')
}

// Explicit intent → project
{
  const { facts } = primary('Ricorda che sto sviluppando LAIfe')
  assert.ok(facts.some((f) => f.category === 'projects'))
  const project = facts.find((f) => f.category === 'projects')
  assert.match(project.content, /LAIfe/i)
  assert.equal(project.source, 'explicit')
}

// Explicit intent → settings (reply preference)
{
  const { facts } = primary('Ricorda che preferisco risposte dettagliate')
  assert.ok(facts.some((f) => f.category === 'settings'))
  assert.ok(facts.every((f) => f.category === 'settings' || f.category === 'preferences'))
  const setting = facts.find((f) => f.category === 'settings')
  assert.match(setting.content, /dettagliat|detailed/i)
  assert.equal(setting.source, 'explicit')
}

// Non dimenticare → favorite film
{
  const { facts } = primary('Non dimenticare che il mio film preferito è Interstellar')
  assert.ok(facts.some((f) => f.category === 'preferences'))
  assert.match(facts.find((f) => f.category === 'preferences').content, /Interstellar/i)
  assert.equal(facts[0].source, 'explicit')
}

// Remember this for later → favorite color
{
  const { facts } = primary('Remember this for later: my favorite color is blue')
  assert.ok(facts.some((f) => f.category === 'preferences'))
  assert.match(facts.find((f) => f.category === 'preferences').content, /blue/i)
  assert.equal(facts[0].source, 'explicit')
}

// Wrapper stripping helper
{
  const a = stripExplicitMemoryIntent('Ricorda che sto sviluppando LAIfe')
  assert.equal(a.explicitIntent, true)
  assert.equal(a.inner, 'sto sviluppando LAIfe')

  const b = stripExplicitMemoryIntent('Il mio colore preferito è blu.')
  assert.equal(b.explicitIntent, false)
  assert.match(b.inner, /colore preferito/)
}

// Non mi piace → dislike only (no positive like)
{
  const { facts } = primary('Non mi piace il coriandolo')
  assert.ok(facts.length >= 1)
  assert.ok(facts.every((f) => f.title === 'Dislike' || /dislikes/i.test(f.content)))
  assert.ok(!facts.some((f) => /likes\s*\/\s*prefers/i.test(f.content) && !/dislikes/i.test(f.content)))
  assert.equal(facts.filter((f) => f.title === 'Preference').length, 0)
}

// Secrets with and without remember → no store
{
  const blocked = [
    'Ricorda che la mia API key è sk-abcdefghijklmnopqrstuvwxyz',
    'la mia API key è sk-abcdefghijklmnopqrstuvwxyz',
    'password: hunter2supersecret',
    'Remember that my password is hunter2supersecret',
    'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.aaaa.bbbb',
    'access_token=abc123def456ghi789jkl',
    '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA0Z3VS5JJcds3xfn\n-----END RSA PRIVATE KEY-----',
    'postgres://user:secret@localhost:5432/db',
    'il mio IBAN è IT60X0542811101000000123456',
    'il codice di verifica OTP è 123456',
  ]
  for (const msg of blocked) {
    assert.equal(containsUnsafeMemoryMaterial(msg), true, `unsafe detect: ${msg.slice(0, 40)}`)
    assert.equal(extractDurableFacts(msg).length, 0, `no store: ${msg.slice(0, 40)}`)
    assert.equal(analyzeConversation(msg, 'ok').save, false, `no save: ${msg.slice(0, 40)}`)
  }
}

// Distress / crisis → no durable memory
{
  const crisis = [
    'Voglio morire',
    'I want to kill myself',
    'sto pensando al suicidio',
    'I want to end my life',
  ]
  for (const msg of crisis) {
    assert.equal(containsUnsafeMemoryMaterial(msg), true, msg)
    assert.equal(extractDurableFacts(msg).length, 0, msg)
  }
}

// Ordinary safe fact still stores normally (automatic source)
{
  const { facts } = primary('Il mio colore preferito è blu.')
  assert.ok(facts.length >= 1)
  assert.equal(facts[0].category, 'preferences')
  assert.match(facts[0].content, /blu/i)
  assert.equal(facts[0].source, 'automatic')
  assert.ok((facts[0].confidence ?? 1) < 0.95)
}

// Cap ≤3 preserved
{
  const facts = extractDurableFacts(
    'Mi chiamo Marco e abito a Cagliari e preferisco il jazz e odio il calcio e sto sviluppando LAIfe e studio medicina',
  )
  assert.ok(facts.length <= 3)
}

// --- Unchanged Core / Recall / Sol / ownership contracts ---
{
  const chatSrc = readFileSync(join(root, 'api/chat.ts'), 'utf8')
  assert.equal((chatSrc.match(/\.responses\.create\s*\(/g) || []).length, 1)
  assert.match(chatSrc, /loadCoreMemoryPack/)
  assert.match(chatSrc, /requireExplicitUserId:\s*true/)
  assert.doesNotMatch(chatSrc, /ensureDefaultUserId/)

  const recallSrc = readFileSync(join(root, 'lib/server/core-memory-recall.js'), 'utf8')
  assert.match(recallSrc, /requireExplicitUserId:\s*true/)

  const sol = buildCoreResponsesCreateParams({
    model: 'gpt-5.6-sol',
    instructions: 'test',
    maxOutputTokens: 100,
    input: [{ type: 'message', role: 'user', content: 'hi' }],
  })
  assert.equal(sol.model, 'gpt-5.6-sol')
  assert.equal('temperature' in sol, false)
  assert.deepEqual(sol.reasoning, { effort: 'none' })

  const promptSrc = readFileSync(join(root, 'lib/server/laife-base-system-prompt.js'), 'utf8')
  assert.doesNotMatch(promptSrc, /Remembered user facts|Extraction V2|containsUnsafeMemoryMaterial/)
}

console.log('ok: memory extraction V2 PR1 safety + explicit intent')
