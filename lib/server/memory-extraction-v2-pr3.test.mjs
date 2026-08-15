/**
 * Extraction V2 PR3 — fact_key identity + conflict upsert + legacy supersede.
 * Run: node lib/server/memory-extraction-v2-pr3.test.mjs
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  deriveFactKey,
  encodeFactKeyTag,
  extractDurableFacts,
  hasMemoryUpdateCue,
  isConflictingActiveSlotRow,
  isLegacyPredecessorForFactKey,
  isSingleValuedFactKey,
  mergeTagsWithFactKey,
  normalizeFavoriteSubjectKey,
  readFactKeyFromTags,
  selectLegacyPredecessorTarget,
  selectUpsertTarget,
} from './brain-memory.js'
import { buildCoreResponsesCreateParams } from './core-responses-params.js'
import { formatCoreMemoryPack, isRecallEligibleMemory } from './core-memory-recall.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')

function row(partial) {
  return {
    id: partial.id || 'row-1',
    user_id: partial.userId || 'user-a',
    category: partial.category || 'preferences',
    title: partial.title || 'Favorite',
    content: partial.content,
    importance: partial.importance ?? 6,
    status: partial.status || 'active',
    tags: partial.tags || [],
    updated_at: partial.updatedAt || '2026-01-01T00:00:00.000Z',
  }
}

/** Tiny in-memory store exercising selectUpsertTarget + legacy supersede. */
function createMemoryStore() {
  /** @type {any[]} */
  const rows = []
  let seq = 1

  function obsoleteConflicts(userId, factKey, keepId) {
    if (!isSingleValuedFactKey(factKey)) return
    for (const r of rows) {
      if (r.user_id !== userId) continue
      if (isConflictingActiveSlotRow(r, factKey, keepId)) {
        r.status = 'obsolete'
        r.updated_at = new Date().toISOString()
      }
    }
  }

  return {
    rows,
    upsert(userId, candidate) {
      const factKey =
        candidate.factKey ||
        deriveFactKey(candidate, { userMessage: candidate.userMessage || '' })
      const tags = mergeTagsWithFactKey(candidate.tags, factKey)
      const existing = selectUpsertTarget(
        rows.filter((r) => r.user_id === userId),
        {
          factKey,
          category: candidate.category,
          title: candidate.title,
          content: candidate.content,
        },
      )

      if (existing) {
        assert.equal(existing.user_id, userId, 'never cross-user update')
        if (
          String(existing.content).toLowerCase().trim() ===
          String(candidate.content).toLowerCase().trim()
        ) {
          existing.tags = mergeTagsWithFactKey(existing.tags, factKey)
          existing.status = 'active'
          obsoleteConflicts(userId, factKey, existing.id)
          return { action: 'skipped', memory: existing }
        }
        existing.category = candidate.category
        existing.title = candidate.title
        existing.content = candidate.content
        existing.tags = mergeTagsWithFactKey(existing.tags, factKey)
        existing.status = 'active'
        existing.updated_at = new Date().toISOString()
        obsoleteConflicts(userId, factKey, existing.id)
        return { action: 'updated', memory: existing }
      }

      const created = row({
        id: `m${seq++}`,
        userId,
        category: candidate.category,
        title: candidate.title,
        content: candidate.content,
        tags,
      })
      rows.push(created)
      obsoleteConflicts(userId, factKey, created.id)
      return { action: 'created', memory: created }
    },
    activeFor(userId, factKey) {
      return rows.filter(
        (r) =>
          r.user_id === userId &&
          r.status === 'active' &&
          readFactKeyFromTags(r.tags) === factKey,
      )
    },
    activeAll(userId) {
      return rows.filter((r) => r.user_id === userId && r.status === 'active')
    },
  }
}

function extractAndUpsert(store, userId, message) {
  const facts = extractDurableFacts(message)
  const results = []
  for (const fact of facts) {
    results.push(
      store.upsert(userId, {
        ...fact,
        userMessage: message,
      }),
    )
  }
  return { facts, results }
}

// fact_key helpers
{
  assert.equal(encodeFactKeyTag('preferences.favorite.color'), 'fact_key:preferences.favorite.color')
  assert.equal(
    readFactKeyFromTags(['other', 'fact_key:preferences.favorite.color']),
    'preferences.favorite.color',
  )
  assert.equal(normalizeFavoriteSubjectKey('colore'), 'color')
  assert.equal(normalizeFavoriteSubjectKey('animale'), 'animal')
  assert.equal(hasMemoryUpdateCue('In realtà adesso preferisco il viola'), true)
  assert.equal(isSingleValuedFactKey('preferences.favorite.color'), true)
  assert.equal(isSingleValuedFactKey('preferences.favorite.animal'), true)
  assert.equal(isSingleValuedFactKey('preferences.interest.naruto'), false)
  assert.equal(isSingleValuedFactKey('preferences.like.blu'), false)
}

// Extraction assigns stable keys
{
  const color = extractDurableFacts('Il mio colore preferito è blu.')
  assert.equal(color[0].factKey, 'preferences.favorite.color')
  assert.ok(color[0].tags.includes('fact_key:preferences.favorite.color'))

  const animal = extractDurableFacts('Il mio animale preferito è il lupo.')
  assert.equal(animal[0].factKey, 'preferences.favorite.animal')

  const pet = extractDurableFacts('Il mio cane si chiama Rocky.')
  assert.equal(pet[0].factKey, 'relationships.pet.dog.name')

  const name = extractDurableFacts('Mi chiamo Marco')
  assert.equal(name[0].factKey, 'identity.name')

  // Preferred name must not overwrite identity.name
  const callMe = extractDurableFacts('Preferisco farmi chiamare Luca')
  assert.ok(callMe[0].factKey)
  assert.notEqual(callMe[0].factKey, 'identity.name')
  assert.match(callMe[0].factKey, /^preferences\./)
}

// blu → viola: one active favorite-color memory
{
  const store = createMemoryStore()
  extractAndUpsert(store, 'user-a', 'Il mio colore preferito è blu.')
  const second = extractAndUpsert(
    store,
    'user-a',
    'In realtà adesso il mio colore preferito è il viola.',
  )
  assert.equal(second.results[0].action, 'updated')
  const active = store.activeFor('user-a', 'preferences.favorite.color')
  assert.equal(active.length, 1)
  assert.match(active[0].content, /viola/i)
  assert.doesNotMatch(active[0].content, /\bblu\b/i)
}

// lupo → gatto: one current favorite-animal memory
{
  const store = createMemoryStore()
  extractAndUpsert(store, 'user-a', 'Il mio animale preferito è il lupo.')
  extractAndUpsert(store, 'user-a', 'Adesso il mio animale preferito è il gatto.')
  const active = store.activeFor('user-a', 'preferences.favorite.animal')
  assert.equal(active.length, 1)
  assert.match(active[0].content, /gatto/i)
  assert.doesNotMatch(active[0].content, /lupo/i)
}

// identical fact repeated → skipped / no duplicate
{
  const store = createMemoryStore()
  extractAndUpsert(store, 'user-a', 'Il mio colore preferito è blu.')
  const again = extractAndUpsert(store, 'user-a', 'Il mio colore preferito è blu.')
  assert.equal(again.results[0].action, 'skipped')
  assert.equal(store.activeFor('user-a', 'preferences.favorite.color').length, 1)
}

// paraphrased identical (EN/IT subject aliases) → same key, update or skip
{
  const store = createMemoryStore()
  extractAndUpsert(store, 'user-a', 'Il mio colore preferito è blu.')
  const en = extractAndUpsert(store, 'user-a', 'My favorite color is blue.')
  assert.ok(en.results[0].action === 'updated' || en.results[0].action === 'skipped')
  assert.equal(store.activeFor('user-a', 'preferences.favorite.color').length, 1)
}

// Naruto + Dragon Ball coexist (multi-valued interests)
{
  const store = createMemoryStore()
  extractAndUpsert(store, 'user-a', 'Adoro Naruto.')
  extractAndUpsert(store, 'user-a', 'Adoro Dragon Ball.')
  const interests = store.rows.filter(
    (r) =>
      r.user_id === 'user-a' &&
      String(readFactKeyFromTags(r.tags) || '').startsWith('preferences.interest.'),
  )
  assert.ok(interests.length >= 2)
  assert.ok(interests.some((r) => /Naruto/i.test(r.content)))
  assert.ok(interests.some((r) => /Dragon Ball/i.test(r.content)))
  // Writing a favorite color must NOT consolidate interests
  extractAndUpsert(store, 'user-a', 'Il mio colore preferito è il viola.')
  assert.ok(store.activeAll('user-a').some((r) => /Naruto/i.test(r.content) && r.status === 'active'))
  assert.ok(
    store.activeAll('user-a').some((r) => /Dragon Ball/i.test(r.content) && r.status === 'active'),
  )
}

// Different users can hold different values for the same fact_key
{
  const store = createMemoryStore()
  extractAndUpsert(store, 'user-a', 'Il mio colore preferito è blu.')
  extractAndUpsert(store, 'user-b', 'Il mio colore preferito è rosso.')
  assert.equal(store.activeFor('user-a', 'preferences.favorite.color').length, 1)
  assert.equal(store.activeFor('user-b', 'preferences.favorite.color').length, 1)
  assert.match(store.activeFor('user-a', 'preferences.favorite.color')[0].content, /blu/i)
  assert.match(store.activeFor('user-b', 'preferences.favorite.color')[0].content, /rosso/i)
}

// Pet-name key works + correction updates
{
  const store = createMemoryStore()
  extractAndUpsert(store, 'user-a', 'Il mio cane si chiama Rocky.')
  assert.equal(store.activeFor('user-a', 'relationships.pet.dog.name').length, 1)
  extractAndUpsert(store, 'user-a', 'Il mio cane si chiama Max.')
  const pets = store.activeFor('user-a', 'relationships.pet.dog.name')
  assert.equal(pets.length, 1)
  assert.match(pets[0].content, /Max/i)
}

// No cross-user update
{
  const store = createMemoryStore()
  extractAndUpsert(store, 'user-a', 'Il mio colore preferito è blu.')
  extractAndUpsert(store, 'user-b', 'Il mio colore preferito è viola.')
  assert.match(store.activeFor('user-a', 'preferences.favorite.color')[0].content, /blu/i)
  assert.match(store.activeFor('user-b', 'preferences.favorite.color')[0].content, /viola/i)
}

// Legacy predecessor detection (high-confidence color / animal only)
{
  assert.equal(
    isLegacyPredecessorForFactKey(
      row({ title: 'Favorite', content: "User's favorite: il blu.", tags: [] }),
      'preferences.favorite.color',
    ),
    true,
  )
  assert.equal(
    isLegacyPredecessorForFactKey(
      row({ title: 'Favorite', content: "User's favorite: il rosso.", tags: [] }),
      'preferences.favorite.color',
    ),
    true,
  )
  assert.equal(
    isLegacyPredecessorForFactKey(
      row({
        title: 'Preference',
        content: 'User likes / prefers: il blu.',
        tags: [],
      }),
      'preferences.favorite.color',
    ),
    true,
  )
  assert.equal(
    isLegacyPredecessorForFactKey(
      row({
        title: 'Preference',
        content: 'User likes / prefers: Naruto.',
        tags: [],
      }),
      'preferences.favorite.color',
    ),
    false,
  )
  assert.equal(
    isLegacyPredecessorForFactKey(
      row({ title: 'Favorite', content: "User's favorite: il lupo.", tags: [] }),
      'preferences.favorite.animal',
    ),
    true,
  )
  assert.equal(
    isLegacyPredecessorForFactKey(
      row({
        title: 'Favorite',
        content: "User's favorite: il blu.",
        tags: ['fact_key:preferences.favorite.color'],
      }),
      'preferences.favorite.color',
    ),
    false,
  )
}

// Real-world regression: legacy Favorite blue/red (+ Preference) → viola only
{
  const store = createMemoryStore()
  store.rows.push(
    row({
      id: 'legacy-blue',
      userId: 'user-a',
      title: 'Favorite',
      content: "User's favorite: il blu.",
      tags: [],
      updatedAt: '2026-01-01T00:00:00.000Z',
    }),
    row({
      id: 'legacy-red',
      userId: 'user-a',
      title: 'Favorite',
      content: "User's favorite: il rosso.",
      tags: [],
      updatedAt: '2026-01-02T00:00:00.000Z',
    }),
    row({
      id: 'legacy-pref-blue',
      userId: 'user-a',
      title: 'Preference',
      content: 'User likes / prefers: il blu.',
      tags: [],
      updatedAt: '2026-01-01T12:00:00.000Z',
    }),
  )

  const hit = selectUpsertTarget(store.rows, {
    factKey: 'preferences.favorite.color',
    category: 'preferences',
    title: 'Favorite',
    content: "User's favorite colore: il viola.",
  })
  assert.ok(hit, 'must select a legacy color predecessor')
  assert.ok(
    ['legacy-blue', 'legacy-red', 'legacy-pref-blue'].includes(hit.id),
    'target must be a known color-slot legacy row',
  )

  const write = extractAndUpsert(
    store,
    'user-a',
    'In realtà adesso il mio colore preferito è il viola.',
  )
  assert.ok(write.facts.some((f) => f.factKey === 'preferences.favorite.color'))
  assert.ok(write.results[0].action === 'updated' || write.results[0].action === 'created')

  const activeColor = store.activeFor('user-a', 'preferences.favorite.color')
  assert.equal(activeColor.length, 1, 'exactly one active favorite-color memory')
  assert.match(activeColor[0].content, /viola/i)
  assert.ok(activeColor[0].tags.includes('fact_key:preferences.favorite.color'))

  // No other active color-slot leftovers (legacy Favorite/Preference colors obsolete)
  const activeColorish = store.activeAll('user-a').filter(
    (r) =>
      /\b(blu|rosso|blue|red|viola|purple)\b/i.test(r.content) &&
      (/favorite/i.test(r.title) ||
        /favorite/i.test(r.content) ||
        (/preference/i.test(r.title) && /likes\s*\/\s*prefers/i.test(r.content))),
  )
  assert.equal(activeColorish.length, 1)
  assert.match(activeColorish[0].content, /viola/i)

  const obsolete = store.rows.filter((r) => r.user_id === 'user-a' && r.status === 'obsolete')
  assert.ok(obsolete.length >= 2, 'legacy conflicting color rows must be obsolete')
  assert.ok(obsolete.every((r) => !/viola/i.test(r.content) || r.id !== activeColor[0].id))

  // Recall V1 excludes obsolete — only viola eligible
  const eligible = store.rows
    .filter((r) => r.user_id === 'user-a')
    .filter(isRecallEligibleMemory)
  assert.ok(eligible.some((r) => /viola/i.test(r.content)))
  assert.ok(!eligible.some((r) => /\b(blu|rosso)\b/i.test(r.content) && !/viola/i.test(r.content)))
  const pack = formatCoreMemoryPack(eligible, { maxMemories: 3 })
  assert.match(pack, /viola/i)
  assert.doesNotMatch(pack, /\b(blu|rosso)\b/i)
}

// New write must not create a duplicate when a legacy predecessor exists
{
  const store = createMemoryStore()
  store.rows.push(
    row({
      id: 'legacy-only-blue',
      userId: 'user-a',
      title: 'Favorite',
      content: "User's favorite: il blu.",
      tags: [],
    }),
  )
  const result = extractAndUpsert(
    store,
    'user-a',
    'In realtà adesso il mio colore preferito è il viola.',
  )
  assert.equal(result.results[0].action, 'updated')
  assert.equal(result.results[0].memory.id, 'legacy-only-blue')
  assert.equal(store.rows.filter((r) => r.user_id === 'user-a').length, 1)
  assert.equal(store.activeFor('user-a', 'preferences.favorite.color').length, 1)
}

// Equivalent animal coverage: legacy Favorite wolf + Preference cat → gatto only
{
  const store = createMemoryStore()
  store.rows.push(
    row({
      id: 'legacy-wolf',
      userId: 'user-a',
      title: 'Favorite',
      content: "User's favorite: il lupo.",
      tags: [],
      updatedAt: '2026-01-01T00:00:00.000Z',
    }),
    row({
      id: 'legacy-pref-cat',
      userId: 'user-a',
      title: 'Preference',
      content: 'User likes / prefers: il gatto.',
      tags: [],
      updatedAt: '2026-01-02T00:00:00.000Z',
    }),
  )

  assert.ok(
    selectLegacyPredecessorTarget(store.rows, 'preferences.favorite.animal', "User's favorite animale: il cane."),
  )

  extractAndUpsert(store, 'user-a', 'Adesso il mio animale preferito è il cane.')
  const active = store.activeFor('user-a', 'preferences.favorite.animal')
  assert.equal(active.length, 1)
  assert.match(active[0].content, /cane/i)
  assert.ok(active[0].tags.includes('fact_key:preferences.favorite.animal'))
  assert.ok(store.rows.some((r) => r.status === 'obsolete' && /lupo|gatto/i.test(r.content)))
  assert.equal(
    store.activeAll('user-a').filter((r) => /lupo|gatto|cane/i.test(r.content)).length,
    1,
  )
}

// Generic Preference (non-color) must NOT be obsoleted by favorite.color write
{
  const store = createMemoryStore()
  store.rows.push(
    row({
      id: 'pref-naruto',
      userId: 'user-a',
      title: 'Preference',
      content: 'User likes / prefers: Naruto.',
      tags: [],
    }),
    row({
      id: 'legacy-blue',
      userId: 'user-a',
      title: 'Favorite',
      content: "User's favorite: il blu.",
      tags: [],
    }),
  )
  extractAndUpsert(store, 'user-a', 'Il mio colore preferito è il viola.')
  const naruto = store.rows.find((r) => r.id === 'pref-naruto')
  assert.equal(naruto.status, 'active')
  assert.equal(store.activeFor('user-a', 'preferences.favorite.color').length, 1)
}

// Legacy structured subject form still matches via predecessor / overlap
{
  const legacy = row({
    id: 'legacy',
    userId: 'user-a',
    category: 'preferences',
    title: 'Favorite',
    content: "User's favorite colore: blu.",
    tags: [],
  })
  const hit = selectUpsertTarget([legacy], {
    factKey: 'preferences.favorite.color',
    category: 'preferences',
    title: 'Favorite',
    content: "User's favorite colore: viola.",
  })
  assert.equal(hit?.id, 'legacy')

  const byOverlap = selectUpsertTarget(
    [
      row({
        id: 'legacy2',
        title: 'Old title',
        content: "User's favorite colore: blu.",
        tags: [],
      }),
    ],
    {
      factKey: null,
      category: 'preferences',
      title: 'Favorite',
      content: "User's favorite colore: blu.",
    },
  )
  assert.equal(byOverlap?.id, 'legacy2')
}

// Recall consistency: after supersede, only new value is active (in-place update)
{
  const store = createMemoryStore()
  extractAndUpsert(store, 'user-a', 'Il mio colore preferito è blu.')
  extractAndUpsert(store, 'user-a', 'Ora il mio colore preferito è viola.')
  const recalled = store.rows.filter(
    (r) =>
      r.user_id === 'user-a' &&
      r.status === 'active' &&
      readFactKeyFromTags(r.tags) === 'preferences.favorite.color',
  )
  assert.equal(recalled.length, 1)
  assert.match(recalled[0].content, /viola/i)
}

// Mi chiamo vs preferred name do not collide
{
  const store = createMemoryStore()
  extractAndUpsert(store, 'user-a', 'Mi chiamo Marco')
  extractAndUpsert(store, 'user-a', 'Preferisco farmi chiamare Luca')
  assert.equal(store.activeFor('user-a', 'identity.name').length, 1)
  assert.match(store.activeFor('user-a', 'identity.name')[0].content, /Marco/)
  assert.ok(
    store.rows.some(
      (r) =>
        r.user_id === 'user-a' &&
        readFactKeyFromTags(r.tags) !== 'identity.name' &&
        /Luca/i.test(r.content),
    ),
  )
}

// —— Regression contracts ——
{
  const chatSrc = readFileSync(join(root, 'api/chat.ts'), 'utf8')
  assert.equal((chatSrc.match(/\.responses\.create\s*\(/g) || []).length, 1)
  assert.match(chatSrc, /loadCoreMemoryPack/)
  assert.match(chatSrc, /requireExplicitUserId:\s*true/)

  const sol = buildCoreResponsesCreateParams({
    model: 'gpt-5.6-sol',
    instructions: 'test',
    maxOutputTokens: 50,
    input: [{ type: 'message', role: 'user', content: 'hi' }],
  })
  assert.equal(sol.model, 'gpt-5.6-sol')
  assert.equal('temperature' in sol, false)
  assert.deepEqual(sol.reasoning, { effort: 'none' })
}

console.log('ok: memory extraction V2 PR3 fact keys + conflicts + legacy supersede')
