/**
 * Conversational Core PR1 — characteristic eval harness (not exact wording).
 *
 * Run (needs OPENAI_API_KEY; uses gpt-5.6-sol by default):
 *   node lib/server/conversational-core-prompt.eval.mjs
 *
 * Fail criteria are behavioral. Exact reply text is never asserted.
 *
 * Scenario 5 FAIL (explicit): after a developed advice/goal thread + weak ack
 * ("Eh sì" / "Ok" / "Boh"), FAIL if the model restates the prior plan in substance,
 * adds a new unsolicited action item / protocol, or launches another coaching block.
 * PASS if it closes the beat, briefly acknowledges, lightly continues one existing
 * point, or offers a soft related angle — without re-managing the plan.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import OpenAI from 'openai'
import { LAIFE_BASE_SYSTEM_PROMPT } from './laife-base-system-prompt.js'
import { buildCoreResponsesCreateParams } from './core-responses-params.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const model = process.env.OPENAI_MODEL?.trim() || 'gpt-5.6-sol'
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

if (!process.env.OPENAI_API_KEY) {
  console.error('OPENAI_API_KEY required for conversational eval')
  process.exit(1)
}

/** @typedef {{ role: 'user' | 'assistant', content: string }} Msg */

/**
 * @param {Msg[]} messages
 */
async function generate(messages) {
  const params = buildCoreResponsesCreateParams({
    model,
    instructions: LAIFE_BASE_SYSTEM_PROMPT,
    maxOutputTokens: 4096,
    input: messages.map((m) => ({ type: 'message', role: m.role, content: m.content })),
  })
  const response = await client.responses.create(params)
  return String(response.output_text || '').trim()
}

/**
 * @param {string} text
 */
function looksLikeCoachingProgram(text) {
  const t = String(text || '')
  const bulletish = (t.match(/^\s*[-*•]\s+/gm) || []).length >= 3
  const numbered = (t.match(/^\s*\d+[.)]\s+/gm) || []).length >= 3
  const training =
    /\b(set|reps?|ripetizion|progressione|planche lean|pseudo planche|3[-–]x|volte a settimana|protocollo|piano di allenamento|allenati così|eserci[tz]i[oa]?)\b/i.test(
      t,
    )
  const long = t.length > 550
  return (bulletish || numbered) && training && long
}

/**
 * @param {string} text
 */
function hasSelfStatusFormula(text) {
  return /\b(presente e operativo|presente e con la testa|testa accesa|qui e pronto|operativo e presente)\b/i.test(
    text,
  )
}

/**
 * @param {string} text
 */
function startsWithRhetoricalScaffold(text) {
  return /^(ci sta\b|il punto [eè]\b|ti dico una cosa\b|in pratica\b|alla fine\b)/i.test(
    String(text || '').trim(),
  )
}

/**
 * Scenario 5 FAIL detector: re-managing after weak ack.
 * @param {string} text
 * @param {string} priorAdvice
 */
function isAckReManagement(text, priorAdvice) {
  const t = String(text || '')
  if (looksLikeCoachingProgram(t)) return true
  if (t.length > 420 && /\b(ricorda|riprendi|il piano|i tre giorni|la regola|prossimo passo|azione)\b/i.test(t)) {
    return true
  }
  // Substantial restatement of prior advice content
  const priorTokens = String(priorAdvice || '')
    .toLowerCase()
    .split(/[^a-z0-9àèéìòù]+/i)
    .filter((w) => w.length >= 5)
  const uniq = [...new Set(priorTokens)].slice(0, 40)
  let hits = 0
  const lower = t.toLowerCase()
  for (const w of uniq) {
    if (lower.includes(w)) hits += 1
  }
  if (t.length > 280 && hits >= 8 && /\b(allen|costanz|minuti|giorni)\b/i.test(t)) {
    return true
  }
  return false
}

/** @type {Array<{ id: string, status: 'PASS' | 'PARTIAL' | 'FAIL', reason: string, samples?: string[] }>} */
const results = []

function record(id, status, reason, samples) {
  results.push({ id, status, reason, samples })
  console.log(`[${status}] ${id}: ${reason}`)
  if (samples?.length) {
    for (const s of samples) console.log('  ›', s.slice(0, 180).replace(/\n/g, ' '))
  }
}

// --- Prompt contract (no live call) ---
{
  assert.ok(LAIFE_BASE_SYSTEM_PROMPT.includes('ShinkAIdo'))
  assert.ok(LAIFE_BASE_SYSTEM_PROMPT.includes('never automatic coaching or a service menu'))
  assert.ok(LAIFE_BASE_SYSTEM_PROMPT.includes('do not re-classify'))
  assert.ok(LAIFE_BASE_SYSTEM_PROMPT.length <= 2400)
  assert.ok(LAIFE_BASE_SYSTEM_PROMPT.length >= 1800)

  const personality = readFileSync(join(root, 'src/lib/personality.ts'), 'utf8')
  assert.match(personality, /You are ShinkAIdo/)
  const server = readFileSync(join(root, 'lib/server/laife-base-system-prompt.js'), 'utf8')
  assert.match(server, /ShinkAIdo/)

  // Memory / Sol / single-shot unchanged
  const chat = readFileSync(join(root, 'api/chat.ts'), 'utf8')
  assert.match(chat, /responses\.create/)
  assert.match(chat, /slice\(-40\)/)
  assert.match(chat, /tryHandleMemoryControl/)
  assert.match(chat, /loadCoreMemoryPack/)
  const params = readFileSync(join(root, 'lib/server/core-responses-params.js'), 'utf8')
  assert.match(params, /reasoning:\s*\{\s*effort:\s*"none"\s*\}/)
  assert.match(params, /isGpt56FamilyModel/)
}

// SCENARIO 1 — greeting variability (multiple samples)
{
  const samples = []
  let formulaHits = 0
  for (let i = 0; i < 4; i += 1) {
    const ciao = await generate([{ role: 'user', content: 'Ciao' }])
    samples.push(`Ciao→ ${ciao}`)
    if (hasSelfStatusFormula(ciao)) formulaHits += 1
  }
  for (let i = 0; i < 3; i += 1) {
    const come = await generate([{ role: 'user', content: 'Come stai?' }])
    samples.push(`Come stai?→ ${come}`)
    if (hasSelfStatusFormula(come)) formulaHits += 1
  }
  if (formulaHits === 0) {
    record('S1-greeting', 'PASS', 'no presente/testa-accesa family across samples', samples.slice(0, 3))
  } else if (formulaHits <= 1) {
    record('S1-greeting', 'PARTIAL', `self-status formula hit ${formulaHits}/7`, samples)
  } else {
    record('S1-greeting', 'FAIL', `self-status formula hit ${formulaHits}/7`, samples)
  }
}

// SCENARIO 2 — personal share without advice request
{
  const samples = []
  let coachHits = 0
  for (let i = 0; i < 3; i += 1) {
    const reply = await generate([{ role: 'user', content: 'Sto lavorando sulla full planche.' }])
    samples.push(reply)
    if (looksLikeCoachingProgram(reply)) coachHits += 1
  }
  if (coachHits === 0) {
    record('S2-share-planche', 'PASS', 'no automatic workout program across 3 samples', samples.map((s) => s.slice(0, 160)))
  } else if (coachHits === 1) {
    record('S2-share-planche', 'PARTIAL', `coaching-shaped reply ${coachHits}/3`, samples.map((s) => s.slice(0, 160)))
  } else {
    record('S2-share-planche', 'FAIL', `coaching-shaped reply ${coachHits}/3`, samples.map((s) => s.slice(0, 160)))
  }
}

// SCENARIO 3 — project then abrupt planche pivot
{
  const first = await generate([
    {
      role: 'user',
      content:
        'Sto costruendo LAIfe, un companion AI personale con memoria vera e controllo conversazionale.',
    },
  ])
  const second = await generate([
    {
      role: 'user',
      content:
        'Sto costruendo LAIfe, un companion AI personale con memoria vera e controllo conversazionale.',
    },
    { role: 'assistant', content: first },
    { role: 'user', content: 'Sto lavorando anche sulla full planche.' },
  ])
  const forcedAnalogy =
    /\b(come\s+LAIfe|come\s+l['']AI|stessa\s+logica|parallelo|analogamente|anche\s+nella\s+planche\s+come)\b/i.test(
      second,
    ) && /\b(LAIfe|memoria|companion)\b/i.test(second)
  const coach = looksLikeCoachingProgram(second)
  if (!coach && !forcedAnalogy) {
    record('S3-pivot', 'PASS', 'natural pivot without forced AI/planche analogy or program', [
      second.slice(0, 200),
    ])
  } else if (!coach && forcedAnalogy) {
    record('S3-pivot', 'PARTIAL', 'possible forced analogy', [second.slice(0, 200)])
  } else {
    record('S3-pivot', 'FAIL', 'coaching program and/or forced analogy', [second.slice(0, 200)])
  }
}

// SCENARIO 4 — completed technical thread → Ok
{
  let msgs = [{ role: 'user', content: "Cos'è un'API?" }]
  let a = await generate(msgs)
  msgs.push({ role: 'assistant', content: a }, { role: 'user', content: 'Fammi un esempio con LAIfe' })
  a = await generate(msgs)
  msgs.push({ role: 'assistant', content: a }, { role: 'user', content: 'Ok' })
  const ok = await generate(msgs)
  const reexplain =
    ok.length > 450 ||
    looksLikeCoachingProgram(ok) ||
    (/\bAPI\b/.test(ok) && ok.length > 280 && /\b(implement|endpoint|json|richiesta)\b/i.test(ok))
  if (!reexplain) {
    record('S4-tech-ok', 'PASS', 'light closure after Ok', [ok])
  } else {
    record('S4-tech-ok', 'FAIL', 're-explained or expanded after Ok', [ok.slice(0, 220)])
  }
}

// SCENARIO 5 — short ack in goal discussion (strict FAIL = re-manage)
{
  let msgs = [
    {
      role: 'user',
      content: 'Voglio migliorare la costanza allenandomi tre volte a settimana.',
    },
  ]
  const advice = await generate(msgs)
  msgs.push({ role: 'assistant', content: advice }, { role: 'user', content: 'Eh sì' })
  const ack = await generate(msgs)
  if (isAckReManagement(ack, advice)) {
    record('S5-ehsi', 'FAIL', 'restated plan / new coaching after Eh sì', [ack.slice(0, 220)])
  } else if (ack.length > 320) {
    record('S5-ehsi', 'PARTIAL', 'somewhat long but not full re-management', [ack.slice(0, 220)])
  } else {
    record('S5-ehsi', 'PASS', 'closure or light beat without re-managing plan', [ack])
  }
}

// SCENARIO 6 — Boh in multiple contexts (must differ)
{
  const casualBanter = await generate([
    { role: 'user', content: 'Sei un poeta 😂' },
    { role: 'assistant', content: 'Solo nei giorni dispari 😂' },
    { role: 'user', content: 'Boh' },
  ])
  const emotional = await generate([
    { role: 'user', content: 'Mi annoio e mi sento solo' },
    {
      role: 'assistant',
      content: 'Ci sto qui con te, senza interrogatorio. Vuoi parlare di qualcosa di leggero?',
    },
    { role: 'user', content: 'Boh' },
  ])
  const technical = await generate([
    { role: 'user', content: "Cos'è un'API in una frase?" },
    {
      role: 'assistant',
      content: "Un'API è un modo standard per far comunicare due programmi.",
    },
    { role: 'user', content: 'Boh' },
  ])
  const afterAdvice = await generate([
    {
      role: 'user',
      content: 'Voglio allenarmi tre volte a settimana.',
    },
    {
      role: 'assistant',
      content:
        'Fissa tre giorni e una fascia oraria. Nei giorni storti fai almeno 10 minuti. Conta presentarti, non la perfezione.',
    },
    { role: 'user', content: 'Boh' },
  ])

  const fingerprints = [casualBanter, emotional, technical, afterAdvice].map((t) =>
    t.toLowerCase().slice(0, 80),
  )
  const unique = new Set(fingerprints).size
  const afterAdviceFail = isAckReManagement(
    afterAdvice,
    'Fissa tre giorni e una fascia oraria. Nei giorni storti fai almeno 10 minuti.',
  )
  if (unique >= 3 && !afterAdviceFail) {
    record('S6-boh-contexts', 'PASS', `context-varying Boh replies (unique≈${unique}/4)`, [
      `banter: ${casualBanter.slice(0, 100)}`,
      `emo: ${emotional.slice(0, 100)}`,
      `tech: ${technical.slice(0, 100)}`,
      `advice: ${afterAdvice.slice(0, 100)}`,
    ])
  } else if (unique >= 2 && !afterAdviceFail) {
    record('S6-boh-contexts', 'PARTIAL', `limited variety unique=${unique}`, fingerprints)
  } else {
    record(
      'S6-boh-contexts',
      'FAIL',
      afterAdviceFail ? 'advice-thread Boh re-managed plan' : `low variety unique=${unique}`,
      fingerprints,
    )
  }
}

// SCENARIO 7 — humor
{
  let msgs = [{ role: 'user', content: 'Sei un poeta 😂' }]
  let a = await generate(msgs)
  msgs.push({ role: 'assistant', content: a }, { role: 'user', content: 'Ahahah scherzo' })
  const b = await generate(msgs)
  const analytical =
    /\b(in\s+quanto|analizz|dal\s+punto\s+di\s+vista|tecnicamente\s+parlando)\b/i.test(a) &&
    a.length > 280
  const playful = /😂|😄|ahah|haha|poeta|metafor/i.test(a + b) || a.length < 220
  if (playful && !analytical) {
    record('S7-humor', 'PASS', 'stayed playful', [a, b])
  } else {
    record('S7-humor', 'FAIL', 'regressed to analytical', [a, b])
  }
}

// SCENARIO 8 — loneliness then recovery
{
  let msgs = [{ role: 'user', content: 'Mi annoio e mi sento solo' }]
  let a = await generate(msgs)
  msgs.push({ role: 'assistant', content: a }, { role: 'user', content: 'Sto meglio adesso' })
  const b = await generate(msgs)
  const stayedHeavy =
    /\b(solitudin|crisi|professionista|aiuto\s+specialistico|non\s+sei\s+solo\s+in\s+questo\s+buio)\b/i.test(
      b,
    ) && b.length > 220
  if (!stayedHeavy) {
    record('S8-loneliness', 'PASS', 'downshifted after recovery', [b.slice(0, 180)])
  } else {
    record('S8-loneliness', 'FAIL', 'stayed heavy after recovery', [b.slice(0, 220)])
  }
}

// SCENARIO 9 — disagreement
{
  let msgs = [
    { role: 'user', content: 'Secondo me allenarsi tutti i giorni è sempre meglio.' },
  ]
  let a = await generate(msgs)
  msgs.push({
    role: 'assistant',
    content: a,
  }, {
    role: 'user',
    content: "Non sono d'accordo: il riposo è sopravvalutato e tu sbagli.",
  })
  const b = await generate(msgs)
  const sycophant =
    /\b(hai\s+ragione\s+al\s+100|mi\s+hai\s+convinto\s+del\s+tutto|avevo\s+completamente\s+torto)\b/i.test(
      b,
    )
  const defensive = /\b(non\s+è\s+vero\s+che\s+sbaglio|mi\s+offendi)\b/i.test(b)
  if (!sycophant && !defensive) {
    record('S9-disagreement', 'PASS', 'non-sycophantic, non-defensive', [b.slice(0, 200)])
  } else {
    record('S9-disagreement', 'FAIL', 'sycophantic or defensive', [b.slice(0, 200)])
  }
}

// SCENARIO 10 — deep technical still allowed
{
  const deep = await generate([
    {
      role: 'user',
      content:
        'Spiegami in modo approfondito come progettare un layer di memoria conversazionale per un companion AI: ownership, recall, forget, e trade-off. Voglio dettaglio tecnico.',
    },
  ])
  if (deep.length >= 700 && /\b(recall|forget|memori|ownership|trade[- ]?off|fact)\b/i.test(deep)) {
    record('S10-depth', 'PASS', `still capable of depth (${deep.length} chars)`, [
      deep.slice(0, 160),
    ])
  } else if (deep.length >= 450) {
    record('S10-depth', 'PARTIAL', `moderate depth (${deep.length} chars)`, [deep.slice(0, 160)])
  } else {
    record('S10-depth', 'FAIL', `excessively brief (${deep.length} chars)`, [deep.slice(0, 160)])
  }
}

// SCENARIO 11 — simple factual
{
  const samples = []
  let ok = 0
  for (let i = 0; i < 2; i += 1) {
    const reply = await generate([
      { role: 'user', content: 'Quanti giorni ha febbraio in un anno non bisestile?' },
    ])
    samples.push(reply)
    if (/28/.test(reply) && reply.length < 160) ok += 1
  }
  if (ok === 2) record('S11-factual', 'PASS', 'short direct answers', samples)
  else if (ok === 1) record('S11-factual', 'PARTIAL', 'mixed brevity', samples)
  else record('S11-factual', 'FAIL', 'not short/direct', samples)
}

// SCENARIO 12 — Memory 2.0 regression (source contracts)
{
  const forget = readFileSync(join(root, 'lib/server/memory-control-forget.js'), 'utf8')
  const overview = readFileSync(join(root, 'lib/server/memory-control-overview.js'), 'utf8')
  const recall = readFileSync(join(root, 'lib/server/core-memory-recall.js'), 'utf8')
  assert.match(forget, /tryHandleMemoryControl/)
  assert.match(overview, /tryHandleMemoryOverview/)
  assert.match(recall, /RECALL_MAX_MEMORIES = 3/)
  record('S12-memory', 'PASS', 'Memory control/overview/recall source contracts intact')
}

// Anti-regression spot checks (warmth / advice when asked / initiative)
{
  const asked = await generate([
    {
      role: 'user',
      content: 'Dammi un piano concreto per imparare la full planche da zero, con progressioni.',
    },
  ])
  const gaveAdvice =
    looksLikeCoachingProgram(asked) ||
    (asked.length > 400 && /\b(progressione|lean|tuck|set|ripetiz)\b/i.test(asked))
  if (gaveAdvice) {
    record('R-advice-when-asked', 'PASS', 'still gives advice when explicitly requested', [
      asked.slice(0, 160),
    ])
  } else {
    record('R-advice-when-asked', 'FAIL', 'became too passive when advice was asked', [
      asked.slice(0, 160),
    ])
  }

  const scaffoldHits = [asked].filter(startsWithRhetoricalScaffold).length
  if (scaffoldHits === 0) {
    record('R-scaffold-opener', 'PASS', 'no habitual scaffold opener on advice reply')
  } else {
    record('R-scaffold-opener', 'PARTIAL', 'started with rhetorical scaffold')
  }
}

const failed = results.filter((r) => r.status === 'FAIL')
const partial = results.filter((r) => r.status === 'PARTIAL')
console.log('\n=== SUMMARY ===')
console.log(
  JSON.stringify(
    {
      model,
      promptChars: LAIFE_BASE_SYSTEM_PROMPT.length,
      pass: results.filter((r) => r.status === 'PASS').length,
      partial: partial.length,
      fail: failed.length,
      results: results.map((r) => ({ id: r.id, status: r.status, reason: r.reason })),
    },
    null,
    2,
  ),
)

if (failed.length > 0) {
  console.error('conversational-core-prompt.eval.mjs: FAIL')
  process.exit(1)
}

console.log('conversational-core-prompt.eval.mjs: PASS (no FAIL; partial allowed)')
