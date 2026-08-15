/**
 * Memory Recall V1 — pack formatting, ownership lock, Core injection contracts.
 * Run: node lib/server/core-memory-recall.test.mjs
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveMemoryUserId } from './brain-memory.js'
import { buildCoreResponsesCreateParams } from './core-responses-params.js'
import {
  RECALL_MAX_MEMORIES,
  RECALL_MAX_PACK_CHARS,
  appendMemoryPackToInstructions,
  formatCoreMemoryPack,
  isRecallEligibleMemory,
  isUiOnlySettingsContent,
  loadCoreMemoryPack,
} from './core-memory-recall.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')

function mem(partial) {
  return {
    id: partial.id || 'm1',
    category: partial.category || 'preferences',
    title: partial.title || 'Favorite',
    content: partial.content || 'User likes blue.',
    importance: partial.importance ?? 6,
    usageCount: partial.usageCount ?? 0,
    lastUsedAt: partial.lastUsedAt ?? null,
    createdAt: partial.createdAt || '2026-01-01T00:00:00.000Z',
    updatedAt: partial.updatedAt || '2026-01-01T00:00:00.000Z',
    status: partial.status || 'active',
    tags: partial.tags || [],
    user_id: partial.userId,
  }
}

// --- Ownership: requireExplicitUserId forbids default-user fallback ---
{
  let defaultCalled = false
  try {
    await resolveMemoryUserId(
      { requireExplicitUserId: true },
      {
        from() {
          defaultCalled = true
          throw new Error('ensureDefaultUserId must not run')
        },
      },
    )
    assert.fail('expected throw without userId')
  } catch (error) {
    assert.match(String(error.message), /Explicit userId is required/)
  }
  assert.equal(defaultCalled, false)

  const explicit = await resolveMemoryUserId(
    { userId: 'auth-user-a', requireExplicitUserId: true },
    {
      from() {
        assert.fail('supabase must not be consulted when explicit id present')
      },
    },
  )
  assert.equal(explicit, 'auth-user-a')
}

// 1 + 2) authenticated user A only retrieves A memories; cannot retrieve B
{
  const calls = []
  const searchMemories = async (query, options) => {
    calls.push({ query, options })
    assert.equal(options.requireExplicitUserId, true)
    assert.equal(options.userId, 'user-a')
    assert.notEqual(options.userId, 'user-b')
    return [
      mem({
        id: 'a1',
        userId: 'user-a',
        category: 'preferences',
        content: "User's favorite: il viola.",
      }),
    ]
  }

  const packA = await loadCoreMemoryPack({
    userMessage: 'Qual è il mio colore preferito?',
    ownerUserId: 'user-a',
    memoryEnabled: true,
    searchMemories,
  })
  assert.match(packA, /il viola/)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].options.userId, 'user-a')

  // Simulated B isolation: search for A never receives B's id
  const searchBLeak = async (_q, options) => {
    assert.equal(options.userId, 'user-a')
    // If ownership were wrong, B rows could appear — assert we only return A's
    return [
      mem({ id: 'a1', userId: 'user-a', content: 'A fact only.' }),
      // Belongs to B — must not be requested; if somehow returned, pack still
      // is scoped by the search call's userId contract above.
    ]
  }
  const pack = await loadCoreMemoryPack({
    userMessage: 'ricordi il mio progetto?',
    ownerUserId: 'user-a',
    searchMemories: searchBLeak,
  })
  assert.match(pack, /A fact only/)
  assert.doesNotMatch(pack, /\bid\b|\buser-b\b/i)
}

// 3) no verified user → no recall and no default-user fallback
{
  let searchCalled = false
  const empty = await loadCoreMemoryPack({
    userMessage: 'Qual è il mio colore preferito?',
    ownerUserId: null,
    searchMemories: async () => {
      searchCalled = true
      return [mem({ content: 'should not load' })]
    },
  })
  assert.equal(empty, '')
  assert.equal(searchCalled, false)

  const empty2 = await loadCoreMemoryPack({
    userMessage: 'hi',
    ownerUserId: '   ',
    searchMemories: async () => {
      searchCalled = true
      return [mem({ content: 'nope' })]
    },
  })
  assert.equal(empty2, '')
  assert.equal(searchCalled, false)

  // searchMemories with requireExplicitUserId and missing userId must throw
  // before any default-user fallback (loadCoreMemoryPack soft-fails to '').
  {
    const { searchMemories } = await import('./brain-memory.js')
    let opened = false
    try {
      await searchMemories('colore', { requireExplicitUserId: true })
      assert.fail('expected throw')
    } catch (error) {
      assert.match(String(error.message), /Explicit userId is required/)
    }
    void opened
    void searchMemories
  }

  const soft = await loadCoreMemoryPack({
    userMessage: 'colore preferito',
    ownerUserId: 'user-x',
    searchMemories: async () => {
      throw new Error('Explicit userId is required for authenticated memory operations')
    },
  })
  assert.equal(soft, '')
}

// 4) max 3 memories
{
  const many = Array.from({ length: 8 }, (_, i) =>
    mem({
      id: `m${i}`,
      category: 'preferences',
      content: `User preference fact number ${i} about color and style.`,
    }),
  )
  const pack = formatCoreMemoryPack(many)
  const bullets = pack.split('\n').filter((l) => l.startsWith('- ['))
  assert.ok(bullets.length <= RECALL_MAX_MEMORIES)
  assert.equal(bullets.length, 3)
}

// 5) empty search → no appendix
{
  const pack = await loadCoreMemoryPack({
    userMessage: 'Qual è il mio colore preferito?',
    ownerUserId: 'user-a',
    searchMemories: async () => [],
  })
  assert.equal(pack, '')
  assert.equal(appendMemoryPackToInstructions('BASE PROMPT', pack), 'BASE PROMPT')
}

// 6) size cap
{
  const long = mem({
    category: 'projects',
    content: `User's project: ${'LAIfe '.repeat(80)}`,
  })
  const pack = formatCoreMemoryPack([long, long, long])
  assert.ok(pack.length <= RECALL_MAX_PACK_CHARS)
  assert.doesNotMatch(pack, /\bid\b|usageCount|createdAt|updatedAt|lastUsedAt/i)
  assert.match(pack, /\[projects\]/)
}

// 7) obsolete / archived excluded
{
  assert.equal(
    isRecallEligibleMemory(mem({ status: 'obsolete', content: 'Old favorite color blue.' })),
    false,
  )
  assert.equal(
    isRecallEligibleMemory(mem({ status: 'archived', content: 'Old project.' })),
    false,
  )
  const pack = formatCoreMemoryPack([
    mem({ status: 'obsolete', content: "User's favorite: blue." }),
    mem({ status: 'archived', content: "User's project: LAIfe." }),
    mem({ status: 'active', category: 'preferences', content: "User's favorite: viola." }),
  ])
  assert.match(pack, /viola/)
  assert.doesNotMatch(pack, /blue|LAIfe/)
}

// UI-only settings excluded; useful settings kept
{
  assert.equal(isUiOnlySettingsContent('User prefers dark theme.'), true)
  assert.equal(isRecallEligibleMemory(mem({ category: 'settings', content: 'User prefers dark theme.' })), false)
  assert.equal(
    isRecallEligibleMemory(
      mem({
        category: 'settings',
        content: 'User prefers: il mio progetto principale si chiama LAIfe.',
      }),
    ),
    true,
  )
}

// 8) current user message remains final authority (framing in pack)
{
  const pack = formatCoreMemoryPack([
    mem({ category: 'preferences', content: "User's favorite: il blu." }),
  ])
  assert.match(pack, /prefer the current message/i)
  assert.match(pack, /conflicts/i)

  const instructions = appendMemoryPackToInstructions(
    'BASE\n\nBias di stile: adattivo.',
    pack,
  )
  assert.ok(instructions.startsWith('BASE'))
  assert.ok(instructions.indexOf('BASE') < instructions.indexOf('Remembered user facts'))
  assert.ok(instructions.includes('prefer the current message'))
}

// Pack includes only category + content
{
  const pack = formatCoreMemoryPack([
    mem({
      id: 'secret-id',
      category: 'identity',
      title: 'Name',
      content: "User's name is Marco.",
      usageCount: 99,
      createdAt: '2020-01-01T00:00:00.000Z',
    }),
  ])
  assert.match(pack, /\[identity\] User's name is Marco\./)
  assert.doesNotMatch(pack, /secret-id|usageCount|2020-01-01|Name/)
}

// --- Source contracts: api/chat.ts ---
{
  const chatSrc = readFileSync(join(root, 'api/chat.ts'), 'utf8')
  assert.match(chatSrc, /loadCoreMemoryPack/)
  assert.match(chatSrc, /appendMemoryPackToInstructions/)
  assert.match(chatSrc, /requireExplicitUserId:\s*true/)
  assert.equal((chatSrc.match(/\.responses\.create\s*\(/g) || []).length, 1)
  assert.doesNotMatch(chatSrc, /ensureDefaultUserId/)
  assert.doesNotMatch(chatSrc, /runCognitiveEngine|conversation-runtime\/v1|v2\/brain/)
  // Post-chat write still present after create
  const createIdx = chatSrc.indexOf('client.responses.create')
  const writeCallIdx = chatSrc.indexOf('runMemoryIfEnabled(', createIdx)
  assert.ok(createIdx > 0 && writeCallIdx > createIdx)
  // Recall happens before create
  const loadIdx = chatSrc.indexOf('await loadCoreMemoryPack')
  assert.ok(loadIdx > 0 && loadIdx < createIdx)
}

// searchMemories Core contract in brain-memory
{
  const brainSrc = readFileSync(join(root, 'lib/server/brain-memory.js'), 'utf8')
  assert.match(
    brainSrc,
    /resolveMemoryUserId\(\s*\{[\s\S]*?requireExplicitUserId:\s*options\.requireExplicitUserId\s*===\s*true/,
  )
  assert.match(brainSrc, /export async function searchMemories/)
}

// companion prompt untouched by recall module
{
  const recallSrc = readFileSync(join(root, 'lib/server/core-memory-recall.js'), 'utf8')
  assert.doesNotMatch(recallSrc, /import.*laife-base-system-prompt/i)
  const promptSrc = readFileSync(join(root, 'lib/server/laife-base-system-prompt.js'), 'utf8')
  assert.doesNotMatch(promptSrc, /Remembered user facts|MEMORY PACK/)
}

// 9) one responses.create — covered above
// 10) GPT-5.6 Sol unchanged
{
  const sol = buildCoreResponsesCreateParams({
    model: 'gpt-5.6-sol',
    instructions: 'test',
    maxOutputTokens: 100,
    input: [{ type: 'message', role: 'user', content: 'hi' }],
  })
  assert.equal(sol.model, 'gpt-5.6-sol')
  assert.equal('temperature' in sol, false)
  assert.deepEqual(sol.reasoning, { effort: 'none' })

  const gpt54 = buildCoreResponsesCreateParams({
    model: 'gpt-5.4',
    instructions: 'test',
    maxOutputTokens: 100,
    input: [{ type: 'message', role: 'user', content: 'hi' }],
  })
  assert.equal(gpt54.temperature, 0.85)
  assert.equal('reasoning' in gpt54, false)
}

// 11) post-chat write behavior unchanged (source contract)
{
  const chatSrc = readFileSync(join(root, 'api/chat.ts'), 'utf8')
  assert.match(
    chatSrc,
    /runMemoryPipeline\(\{\s*[\s\S]*?userId:\s*ownerUserId,\s*[\s\S]*?requireExplicitUserId:\s*true/,
  )
  assert.match(chatSrc, /if\s*\(\s*!memoryEnabled\s*\|\|\s*!ownerUserId\s*\)/)
}

console.log('ok: core memory recall V1')
