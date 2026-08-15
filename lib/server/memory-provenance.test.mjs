/**
 * Memory 2.1 PR1 — durable provenance + empty-durable signal.
 * Run: node lib/server/memory-provenance.test.mjs
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isMemoryOverviewIntent } from './memory-control-overview.js'
import {
  EMPTY_DURABLE_MEMORY_RESULT_LINE,
  RECALL_MAX_MEMORIES,
  appendMemoryPackToInstructions,
  formatCoreMemoryPack,
  formatEmptyDurableMemorySignal,
  isPersonalMemoryProbe,
  loadCoreMemoryPack,
} from './core-memory-recall.js'
import { LAIFE_BASE_SYSTEM_PROMPT } from './laife-base-system-prompt.js'
import { buildCoreResponsesCreateParams } from './core-responses-params.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')

function mem(partial) {
  return {
    id: partial.id || 'm1',
    category: partial.category || 'projects',
    title: partial.title || 'Project',
    content: partial.content || "User's project: LAIfe",
    importance: partial.importance ?? 7,
    usageCount: 0,
    lastUsedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    status: partial.status || 'active',
    tags: partial.tags || [],
  }
}

// --- Probe detection ---
{
  const positives = [
    'Ti ricordi qual è il mio progetto principale?',
    "Ti ricordi qual'è il mio progetto principale?",
    'Qual è il mio progetto principale?',
    'Quali sono i miei progetti?',
    'Qual è il mio anime preferito?',
    'Quali sono i miei personaggi preferiti?',
    'Chi sono i miei personaggi preferiti?',
    'Chi è il mio personaggio preferito?',
    'Cosa mi piace?',
    'Ti ricordi cosa ti ho detto su Naruto?',
    'Cosa ti ho detto su LAIfe?',
    'What is my main project?',
    'Do you remember my favorite anime?',
    'What do you remember about my project?',
    'Who are my favorite characters?',
    'Who is my favorite character?',
  ]
  for (const p of positives) {
    assert.equal(isPersonalMemoryProbe(p), true, `expected probe: ${p}`)
  }

  const negatives = [
    "Cos'è un'API?",
    'Sto lavorando sulla full planche.',
    'Ciao',
    'Cosa ricordi di me?',
    'Che cosa sai di me?',
    'What do you remember about me?',
    'Dimentica il mio colore preferito.',
    'Sei un poeta 😂',
  ]
  for (const n of negatives) {
    assert.equal(isPersonalMemoryProbe(n), false, `not a probe: ${n}`)
  }

  // Overview remains separate
  assert.equal(isMemoryOverviewIntent('Cosa ricordi di me?'), true)
  assert.equal(isPersonalMemoryProbe('Cosa ricordi di me?'), false)
}

// TEST 1 — real failure shape: empty durable + probe
{
  const pack = await loadCoreMemoryPack({
    userMessage: 'Ti ricordi qual è il mio progetto principale?',
    ownerUserId: 'user-a',
    memoryEnabled: true,
    searchMemories: async () => [],
  })
  assert.match(pack, /DURABLE LAIFE MEMORY 2\.0/)
  assert.match(pack, new RegExp(EMPTY_DURABLE_MEMORY_RESULT_LINE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  assert.match(pack, /CURRENT THREAD/)
  assert.match(pack, /Never present thread-only/)
  assert.doesNotMatch(pack, /planche|full planche/i)
  assert.doesNotMatch(pack, /Persisted durable facts:/)

  const instructions = appendMemoryPackToInstructions(LAIFE_BASE_SYSTEM_PROMPT, pack)
  assert.match(instructions, /DURABLE MEMORY RESULT/)
  assert.match(instructions, /CURRENT THREAD/)
  // Companion constitution untouched as base
  assert.ok(instructions.startsWith('IDENTITY'))
}

// TEST 2 — durable project present
{
  const pack = await loadCoreMemoryPack({
    userMessage: 'Ti ricordi qual è il mio progetto principale?',
    ownerUserId: 'user-a',
    memoryEnabled: true,
    searchMemories: async () => [
      mem({
        category: 'projects',
        content: "User's project: LAIfe",
        tags: ['fact_key:projects.primary'],
      }),
    ],
  })
  assert.match(pack, /DURABLE LAIFE MEMORY 2\.0/)
  assert.match(pack, /LAIfe/)
  assert.match(pack, /Persisted durable facts:/)
  assert.doesNotMatch(pack, /DURABLE MEMORY RESULT/)
  assert.doesNotMatch(pack, /no relevant persisted/)
}

// TEST 3 — durable present; thread planche must not be injected into pack
{
  const pack = formatCoreMemoryPack([
    mem({ content: "User's project: LAIfe", tags: ['fact_key:projects.primary'] }),
  ])
  assert.match(pack, /LAIfe/)
  assert.doesNotMatch(pack, /planche/i)
  assert.match(pack, /only the persisted facts listed/i)
  // Pass condition for answer: durable primary = LAIfe; planche only as optional CURRENT THREAD mention
  assert.match(pack, /current-thread context/i)
}

// TEST 4 — empty favorite anime probe
{
  const pack = await loadCoreMemoryPack({
    userMessage: 'Qual è il mio anime preferito?',
    ownerUserId: 'user-a',
    searchMemories: async () => [],
  })
  assert.match(pack, /DURABLE MEMORY RESULT/)
}

// TEST 5 — Naruto topic recall
{
  const pack = await loadCoreMemoryPack({
    userMessage: 'Ti ricordi cosa ti ho detto su Naruto?',
    ownerUserId: 'user-a',
    searchMemories: async () => [
      mem({
        category: 'preferences',
        content: 'User likes / prefers: Naruto',
        tags: ['fact_key:preferences.like.naruto'],
      }),
    ],
  })
  assert.match(pack, /Naruto/)
  assert.doesNotMatch(pack, /DURABLE MEMORY RESULT/)
}

// TEST 6 — ordinary question
{
  let called = false
  const pack = await loadCoreMemoryPack({
    userMessage: "Cos'è un'API?",
    ownerUserId: 'user-a',
    searchMemories: async () => {
      called = true
      return []
    },
  })
  assert.equal(called, true) // Recall may still run when Memory ON
  assert.equal(pack, '')
  assert.doesNotMatch(pack, /DURABLE MEMORY RESULT/)
}

// TEST 7 — Overview not this path
{
  assert.equal(isPersonalMemoryProbe('Cosa ricordi di me?'), false)
  assert.equal(isMemoryOverviewIntent('Cosa ricordi di me?'), true)
  const chatSrc = readFileSync(join(root, 'api/chat.ts'), 'utf8')
  const overviewIdx = chatSrc.indexOf('tryHandleMemoryOverview')
  const recallIdx = chatSrc.indexOf('await loadCoreMemoryPack')
  assert.ok(overviewIdx > 0 && recallIdx > overviewIdx)
}

// TEST 9 — Memory OFF
{
  let called = false
  const pack = await loadCoreMemoryPack({
    userMessage: 'Ti ricordi qual è il mio progetto principale?',
    ownerUserId: 'user-a',
    memoryEnabled: false,
    searchMemories: async () => {
      called = true
      return []
    },
  })
  assert.equal(pack, '')
  assert.equal(called, false)
}

// TEST 10 — isolation contract
{
  const calls = []
  await loadCoreMemoryPack({
    userMessage: 'Qual è il mio progetto principale?',
    ownerUserId: 'user-a',
    searchMemories: async (_q, options) => {
      calls.push(options)
      assert.equal(options.userId, 'user-a')
      assert.equal(options.requireExplicitUserId, true)
      assert.notEqual(options.userId, 'user-b')
      return []
    },
  })
  assert.equal(calls.length, 1)
}

// TEST 11 — one responses.create + max 3 unchanged
{
  const chatSrc = readFileSync(join(root, 'api/chat.ts'), 'utf8')
  assert.equal((chatSrc.match(/\.responses\.create\s*\(/g) || []).length, 1)
  assert.equal(RECALL_MAX_MEMORIES, 3)
}

// TEST 12 — Core #250 companion prompt unchanged by this PR
{
  assert.match(LAIFE_BASE_SYSTEM_PROMPT, /Contribuire non significa coaching automatico/)
  assert.doesNotMatch(LAIFE_BASE_SYSTEM_PROMPT, /DURABLE MEMORY RESULT/)
  assert.doesNotMatch(LAIFE_BASE_SYSTEM_PROMPT, /DURABLE LAIFE MEMORY 2\.0/)
  const promptFile = readFileSync(join(root, 'lib/server/laife-base-system-prompt.js'), 'utf8')
  assert.doesNotMatch(promptFile, /DURABLE MEMORY RESULT/)
}

// Forget / Extraction untouched (source contracts)
{
  const chatSrc = readFileSync(join(root, 'api/chat.ts'), 'utf8')
  assert.match(chatSrc, /tryHandleMemoryControl/)
  assert.match(chatSrc, /tryHandleMemoryOverview/)
  const brain = readFileSync(join(root, 'lib/server/brain-memory.js'), 'utf8')
  assert.match(brain, /export function extractDurableFacts/)
  assert.match(brain, /projects\.primary/)
}

// Sol unchanged
{
  const sol = buildCoreResponsesCreateParams({
    model: 'gpt-5.6-sol',
    instructions: formatEmptyDurableMemorySignal(),
    maxOutputTokens: 100,
    input: [{ type: 'message', role: 'user', content: 'hi' }],
  })
  assert.equal('temperature' in sol, false)
  assert.deepEqual(sol.reasoning, { effort: 'none' })
}

console.log('ok: memory provenance PR1')
