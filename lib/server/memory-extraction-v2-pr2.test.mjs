/**
 * Extraction V2 PR2 — natural coverage pack (deterministic).
 * Run: node lib/server/memory-extraction-v2-pr2.test.mjs
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  analyzeConversation,
  containsUnsafeMemoryMaterial,
  extractDurableFacts,
} from './brain-memory.js'
import { buildCoreResponsesCreateParams } from './core-responses-params.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')

function cats(facts) {
  return facts.map((f) => f.category)
}

function only(facts, category) {
  return facts.filter((f) => f.category === category)
}

// —— Open favorites (no Ricorda required) ——
{
  const animal = extractDurableFacts('Il mio animale preferito è il lupo.')
  assert.ok(animal.some((f) => f.category === 'preferences'))
  assert.match(animal.find((f) => f.category === 'preferences').content, /lupo/i)
  assert.match(animal.find((f) => f.category === 'preferences').content, /animale/i)

  const anime = extractDurableFacts('Il mio anime preferito è Naruto.')
  assert.ok(anime.some((f) => f.category === 'preferences' && /Naruto/i.test(f.content)))

  const game = extractDurableFacts('Il mio gioco preferito è Minecraft.')
  assert.ok(game.some((f) => f.category === 'preferences' && /Minecraft/i.test(f.content)))

  const series = extractDurableFacts('La mia serie preferita è Breaking Bad.')
  assert.ok(series.some((f) => f.category === 'preferences' && /Breaking Bad/i.test(f.content)))

  const enAnimal = extractDurableFacts('My favorite animal is the wolf.')
  assert.ok(enAnimal.some((f) => f.category === 'preferences' && /wolf/i.test(f.content)))

  const enAnime = extractDurableFacts('My favorite anime is Naruto.')
  assert.ok(enAnime.some((f) => f.category === 'preferences' && /Naruto/i.test(f.content)))
}

// Bare preferito chatter without subject/value structure → no favorite
{
  assert.equal(extractDurableFacts('Questo è il mio preferito!').length, 0)
  assert.equal(extractDurableFacts('I have a favorite.').length, 0)
}

// —— Natural interests ——
{
  const naruto = extractDurableFacts('Adoro Naruto.')
  assert.equal(only(naruto, 'preferences').length, 1)
  assert.match(naruto[0].content, /Naruto/i)

  const photo = extractDurableFacts('Amo la fotografia.')
  assert.ok(photo.some((f) => f.category === 'preferences' && /fotografia/i.test(f.content)))

  const astro = extractDurableFacts('Sono appassionato di astronomia.')
  assert.ok(astro.some((f) => f.category === 'preferences' && /astronomia/i.test(f.content)))

  const f1 = extractDurableFacts('I love Formula 1.')
  assert.ok(f1.some((f) => f.category === 'preferences' && /Formula 1/i.test(f.content)))

  const into = extractDurableFacts("I'm really into photography.")
  assert.ok(into.some((f) => f.category === 'preferences' && /photography/i.test(f.content)))
}

// Momentary reactions ignored
{
  assert.equal(extractDurableFacts('Adoro questa risposta!').length, 0)
  assert.equal(extractDurableFacts('I love this!').length, 0)
  assert.equal(extractDurableFacts('I love this reply!').length, 0)
}

// —— Pets ——
{
  const dog = extractDurableFacts('Il mio cane si chiama Rocky.')
  assert.ok(dog.some((f) => f.category === 'relationships' && /Rocky/i.test(f.content)))
  assert.ok(dog.every((f) => f.category === 'relationships'))

  const cat = extractDurableFacts('Il mio gatto si chiama Luna.')
  assert.ok(cat.some((f) => f.category === 'relationships' && /Luna/i.test(f.content)))

  const enDog = extractDurableFacts("My dog's name is Rocky.")
  assert.ok(enDog.some((f) => f.category === 'relationships' && /Rocky/i.test(f.content)))

  const enCat = extractDurableFacts('I have a cat named Luna.')
  assert.ok(enCat.some((f) => f.category === 'relationships' && /Luna/i.test(f.content)))
}

// —— Learning vs goals ——
{
  const learning = extractDurableFacts('Sto imparando il giapponese.')
  assert.ok(learning.some((f) => f.category === 'skills'))
  assert.ok(!learning.some((f) => f.category === 'goals'))

  const studying = extractDurableFacts('Sto studiando programmazione.')
  assert.ok(studying.some((f) => f.category === 'skills'))

  const want = extractDurableFacts('Voglio imparare il giapponese.')
  assert.ok(want.some((f) => f.category === 'goals'))
  assert.ok(!want.some((f) => f.category === 'skills' && /learning/i.test(f.title)))

  const vorrei = extractDurableFacts('Vorrei imparare a suonare il piano.')
  assert.ok(vorrei.some((f) => f.category === 'goals' && /piano/i.test(f.content)))

  const enLearn = extractDurableFacts("I'm learning Japanese.")
  assert.ok(enLearn.some((f) => f.category === 'skills'))

  const enWant = extractDurableFacts('I want to learn Japanese.')
  assert.ok(enWant.some((f) => f.category === 'goals'))
}

// —— Projects vs habits ——
{
  for (const msg of [
    'Lavoro su LAIfe.',
    'Sto lavorando a LAIfe.',
    "I'm working on LAIfe.",
    'Sto sviluppando LAIfe.',
  ]) {
    const facts = extractDurableFacts(msg)
    assert.ok(
      facts.some((f) => f.category === 'projects' && /LAIfe/i.test(f.content)),
      `project for: ${msg}`,
    )
    assert.equal(
      facts.filter((f) => f.category === 'habits').length,
      0,
      `no habit for: ${msg}`,
    )
  }
}

// —— PR1 safety still intact ——
{
  assert.equal(
    extractDurableFacts('Ricorda che la mia API key è sk-abcdefghijklmnopqrstuvwxyz').length,
    0,
  )
  assert.equal(extractDurableFacts('password: hunter2supersecret').length, 0)
  assert.equal(containsUnsafeMemoryMaterial('Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.a.b'), true)
  assert.equal(extractDurableFacts('Voglio morire').length, 0)
}

// Explicit intent still reclassifies (PR1)
{
  const color = analyzeConversation('Ricorda che il mio colore preferito è viola', 'ok')
  assert.equal(color.save, true)
  assert.equal(color.category, 'preferences')
  assert.equal(color.source, 'explicit')

  const project = analyzeConversation('Ricorda che sto sviluppando LAIfe', 'ok')
  assert.equal(project.category, 'projects')
  assert.equal(project.source, 'explicit')
}

// Non mi piace → dislike only
{
  const facts = extractDurableFacts('Non mi piace il coriandolo')
  assert.ok(facts.every((f) => f.title === 'Dislike' || /dislikes/i.test(f.content)))
  assert.equal(facts.filter((f) => f.title === 'Preference').length, 0)
}

// ≤3 facts/turn
{
  const facts = extractDurableFacts(
    'Mi chiamo Marco e abito a Cagliari e il mio animale preferito è il lupo e adoro Naruto e sto sviluppando LAIfe e sto imparando il giapponese',
  )
  assert.ok(facts.length <= 3)
}

// Adoro Naruto → single preference (not multi near-dup)
{
  const facts = extractDurableFacts('Adoro Naruto.')
  assert.equal(facts.length, 1)
  assert.equal(facts[0].category, 'preferences')
}

// Ordinary safe fact still works
{
  const facts = extractDurableFacts('Il mio colore preferito è blu.')
  assert.ok(facts.some((f) => f.category === 'preferences' && /blu/i.test(f.content)))
  assert.equal(facts[0].source, 'automatic')
}

// —— Regression: Recall / Auth / Core / Sol unchanged ——
{
  const chatSrc = readFileSync(join(root, 'api/chat.ts'), 'utf8')
  assert.equal((chatSrc.match(/\.responses\.create\s*\(/g) || []).length, 1)
  assert.match(chatSrc, /loadCoreMemoryPack/)
  assert.match(chatSrc, /requireExplicitUserId:\s*true/)

  const sol = buildCoreResponsesCreateParams({
    model: 'gpt-5.6-sol',
    instructions: 'test',
    maxOutputTokens: 100,
    input: [{ type: 'message', role: 'user', content: 'hi' }],
  })
  assert.equal(sol.model, 'gpt-5.6-sol')
  assert.equal('temperature' in sol, false)
  assert.deepEqual(sol.reasoning, { effort: 'none' })

  assert.doesNotMatch(
    readFileSync(join(root, 'lib/server/laife-base-system-prompt.js'), 'utf8'),
    /Extraction V2 PR2|favorite animal/,
  )
  void cats
}

console.log('ok: memory extraction V2 PR2 natural coverage')
