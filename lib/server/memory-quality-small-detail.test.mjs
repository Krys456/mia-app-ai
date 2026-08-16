/**
 * Memory quality / small-detail retention (#280).
 * Distinguishes WRITE_FAIL vs RECALL_FAIL explicitly.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  containsUnsafeMemoryMaterial,
  extractDurableFacts,
  extractProjectNamingCandidates,
  extractProjectRenameCorrection,
  isSingleValuedFactKey,
  selectUpsertTarget,
  stripExplicitMemoryIntent,
  stripNamingVerbPrefix,
} from './brain-memory.js'
import {
  detectMemoryQueryIntent,
  isRecallEligibleMemory,
  RECALL_MAX_MEMORIES,
  RECALL_MAX_PACK_CHARS,
  rerankMemoriesForRecall,
  formatCoreMemoryPack,
} from './core-memory-recall.js'
import { scoreMemoryRelevance, detectMemoryTopic } from './brain-memory.js'
import { MAX_HISTORY_MESSAGES } from './core-history-select.js'
import { buildCoreContinuityAppendix } from './conversation-continuity.js'
import { buildReferenceContextAppendix } from './core-reference-context.js'
import { buildConversationWorkingStateAppendix } from './core-working-state.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel) => readFileSync(join(root, rel), 'utf8')

function rowFromFact(fact, id = '1') {
  return {
    id,
    category: fact.category,
    title: fact.title,
    content: fact.content,
    tags: fact.factKey ? [`fact_key:${fact.factKey}`] : fact.tags || [],
    status: 'active',
    importance: fact.importance || 6,
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-01T00:00:00Z',
    usage_count: 0,
  }
}

describe('memory quality small-detail (#280)', () => {
  it('A — project called LAIfe → clean project value (WRITE)', () => {
    const facts = extractDurableFacts('My project is called LAIfe.')
    assert.equal(facts.length, 1)
    assert.match(facts[0].content, /User's project:\s*LAIfe/i)
    assert.doesNotMatch(facts[0].content, /called LAIfe/i)
    assert.equal(facts[0].factKey, 'projects.laife')
    assert.equal(stripNamingVerbPrefix('called LAIfe'), 'LAIfe')
  })

  it('A2 — My AI project is called LAIfe (WRITE)', () => {
    const facts = extractDurableFacts('My AI project is called LAIfe.')
    assert.ok(facts.some((f) => /LAIfe/i.test(f.content) && !/called LAIfe/i.test(f.content)))
    assert.ok(facts.some((f) => f.factKey === 'projects.laife'))
  })

  it('B — Etsy shop called TemplateNestKrys → scoped durable name (WRITE)', () => {
    const facts = extractDurableFacts('The Etsy shop is called TemplateNestKrys.')
    assert.equal(facts.length, 1)
    assert.match(facts[0].content, /etsy shop:\s*TemplateNestKrys/i)
    assert.match(facts[0].factKey, /projects\.shop\.etsy\.templatenestkrys/)
  })

  it('C — For LAIfe prefer minimal interface retains scope (WRITE)', () => {
    const facts = extractDurableFacts('For LAIfe, I prefer a minimal interface.')
    assert.ok(facts.length >= 1)
    assert.match(facts[0].content, /For LAIfe:/i)
    assert.match(facts[0].content, /minimal interface/i)
    assert.match(facts[0].factKey, /^projects\.laife\.preferences\./)
  })

  it('D — For LAIfe never change api/chat.ts retains scope + qualifier (WRITE)', () => {
    const facts = extractDurableFacts(
      'For LAIfe, never change api/chat.ts unless necessary.',
    )
    assert.equal(facts.length, 1)
    assert.match(facts[0].content, /For LAIfe:/i)
    assert.match(facts[0].content, /api\/chat\.ts/i)
    assert.match(facts[0].content, /unless necessary/i)
    assert.match(facts[0].factKey, /projects\.laife\.constraint\./)
  })

  it('E — temporary next-step constraint NOT durable (WRITE)', () => {
    const facts = extractDurableFacts("Don't edit api/chat.ts for the next step.")
    assert.equal(facts.length, 0, 'WRITE: temporary instruction must not save')
    const ws = buildConversationWorkingStateAppendix([
      { role: 'user', content: 'Do not modify api/chat.ts.' },
    ])
    assert.match(ws, /CONVERSATION WORKING STATE|do not modify/i)
  })

  it('F/G/H — conditioned reply styles preserved and do not collide (WRITE)', () => {
    const debug = extractDurableFacts('I prefer short answers when we are debugging.')
    const study = extractDurableFacts('I like detailed explanations when studying.')
    assert.equal(debug[0].factKey, 'settings.reply_style.when.debugging')
    assert.equal(study[0].factKey, 'settings.reply_style.when.studying')
    assert.match(debug[0].content, /when debugging/i)
    assert.match(study[0].content, /when studying/i)
    assert.notEqual(debug[0].factKey, study[0].factKey)
    const target = selectUpsertTarget([rowFromFact(debug[0])], study[0])
    assert.equal(target, null, 'conditioned reply styles must not merge')
  })

  it('I/J — Keep answers brief + concise/short synonyms → same reply_style (WRITE)', () => {
    const a = extractDurableFacts('I prefer concise replies.')[0]
    const b = extractDurableFacts('Keep answers brief.')[0]
    const c = extractDurableFacts('I prefer short answers.')[0]
    assert.equal(a.factKey, 'settings.reply_style')
    assert.equal(b.factKey, 'settings.reply_style')
    assert.equal(c.factKey, 'settings.reply_style')
    assert.equal(isSingleValuedFactKey('settings.reply_style'), true)
    assert.equal(selectUpsertTarget([rowFromFact(a)], b)?.id, '1')
    assert.equal(selectUpsertTarget([rowFromFact(a)], c)?.id, '1')
  })

  it('K — multi-clause LAIfe UI preference → two atomic facts (WRITE)', () => {
    const facts = extractDurableFacts(
      'For LAIfe I prefer a minimal interface, but animations should feel smooth.',
    )
    assert.ok(facts.length >= 2)
    assert.ok(facts.some((f) => /minimal interface/i.test(f.content)))
    assert.ok(facts.some((f) => /smooth animations/i.test(f.content)))
    assert.ok(facts.every((f) => /For LAIfe:/i.test(f.content)))
  })

  it('K2 — Italian multi-clause (WRITE)', () => {
    const facts = extractDurableFacts(
      "Per LAIfe preferisco un'interfaccia minimale, ma le animazioni devono essere fluide.",
    )
    assert.ok(facts.length >= 2)
    assert.ok(facts.some((f) => /interfaccia minimale/i.test(f.content)))
    assert.ok(facts.some((f) => /smooth animations/i.test(f.content)))
  })

  it('L — max 3 fact cap preserved (WRITE)', () => {
    const facts = extractDurableFacts(
      'My name is Marco. I prefer concise replies. My main project is LAIfe. I live in Milan. I like jazz.',
    )
    assert.ok(facts.length <= 3)
  })

  it('M/N — rename Nexus → LAIfe obsoletes relevant name ops (WRITE)', () => {
    const facts = extractDurableFacts("Don't call the project Nexus anymore; it's LAIfe.")
    assert.ok(facts.some((f) => f.operation === 'revoke' && /Nexus/i.test(f.content)))
    assert.ok(facts.some((f) => f.factKey === 'projects.primary' && /LAIfe/i.test(f.content) && f.operation !== 'revoke'))
    const it = extractDurableFacts('Non chiamarlo più Nexus, adesso si chiama LAIfe.')
    assert.ok(it.some((f) => /LAIfe/i.test(f.content) && f.factKey === 'projects.primary'))
    assert.equal(extractProjectRenameCorrection("Don't call the project Nexus anymore; it's LAIfe.")?.newName, 'LAIfe')
  })

  it('O — Italian quando debugging conditioned reply (WRITE)', () => {
    const facts = extractDurableFacts('Quando facciamo debugging preferisco risposte brevi.')
    assert.equal(facts[0].factKey, 'settings.reply_style.when.debugging')
    assert.match(facts[0].content, /when debugging/i)
  })

  it('P — multi-valued likes remain multi-valued (WRITE)', () => {
    const a = extractDurableFacts('I like jazz.')[0]
    const b = extractDurableFacts('I like pizza.')[0]
    assert.match(a.factKey, /^preferences\.like\./)
    assert.match(b.factKey, /^preferences\.like\./)
    assert.notEqual(a.factKey, b.factKey)
    assert.equal(isSingleValuedFactKey(a.factKey), false)
    assert.equal(selectUpsertTarget([rowFromFact(a)], b), null)
  })

  it('Q — like/dislike polarity still extracts (WRITE)', () => {
    const like = extractDurableFacts('I like hiking.')[0]
    const dislike = extractDurableFacts('I dislike celery.')[0]
    assert.match(like.factKey, /preferences\.like\./)
    assert.match(dislike.factKey, /preferences\.dislike\./)
  })

  it('R — project-name Recall intent + eligibility (RECALL)', () => {
    const fact = extractDurableFacts('My AI project is called LAIfe.')[0]
    const row = rowFromFact(fact)
    assert.equal(isRecallEligibleMemory(row), true)
    const intent = detectMemoryQueryIntent('Come si chiama il mio progetto AI?')
    assert.equal(intent.domain, 'projects')
    assert.equal(intent.subtype, 'project_list')
    const topic = detectMemoryTopic('What is my AI project called?')
    const scored = scoreMemoryRelevance(row, 'What is my AI project called?', topic)
    assert.equal(scored.matched, true)
    assert.ok(scored.score >= 6)
  })

  it('S — shop-name Recall (RECALL)', () => {
    const fact = extractDurableFacts('The Etsy shop is called TemplateNestKrys.')[0]
    const row = rowFromFact(fact)
    assert.equal(isRecallEligibleMemory(row), true)
    const intent = detectMemoryQueryIntent('What was the name of my Etsy shop?')
    assert.equal(intent.domain, 'projects')
    const topic = detectMemoryTopic('What was the name of my Etsy shop?')
    const scored = scoreMemoryRelevance(row, 'What was the name of my Etsy shop?', topic)
    assert.ok(scored.matched && scored.score >= 6)
  })

  it('T — reply_style Recall eligibility (RECALL)', () => {
    const fact = extractDurableFacts('I prefer concise replies.')[0]
    assert.equal(fact.factKey, 'settings.reply_style')
    assert.equal(
      isRecallEligibleMemory(rowFromFact(fact)),
      true,
      'RECALL_FAIL if reply_style still UI-blocked',
    )
  })

  it('U — scoped interface preference Recall (RECALL)', () => {
    const facts = extractDurableFacts(
      'For LAIfe I prefer a minimal interface, but animations should feel smooth.',
    )
    const rows = facts.map((f, i) => rowFromFact(f, String(i + 1)))
    for (const row of rows) assert.equal(isRecallEligibleMemory(row), true)
    const q = "How did I want LAIfe's interface to feel?"
    const topic = detectMemoryTopic(q)
    const hits = rows.filter((r) => scoreMemoryRelevance(r, q, topic).matched)
    assert.ok(hits.length >= 1, 'RECALL_FAIL: scoped interface prefs not retrieved')
  })

  it('V — cross-chat simulation: stored rows recallable in later probe (RECALL)', () => {
    // Simulate Chat A writes → New Chat probe using only durable rows.
    const stored = [
      ...extractDurableFacts('My AI project is called LAIfe.'),
      ...extractDurableFacts('For LAIfe, I prefer a minimal interface.'),
      ...extractDurableFacts('I prefer short answers when we are debugging.'),
    ].map((f, i) => rowFromFact(f, `c${i}`))

    const q1 = 'What is my AI project called?'
    const ranked1 = rerankMemoriesForRecall(
      stored.filter((r) => scoreMemoryRelevance(r, q1, detectMemoryTopic(q1)).matched),
      q1,
      { limit: RECALL_MAX_MEMORIES, intent: detectMemoryQueryIntent(q1) },
    )
    assert.ok(ranked1.some((r) => /LAIfe/i.test(r.content)))

    const q2 = 'Come preferisco le risposte quando facciamo debugging?'
    const ranked2 = stored.filter((r) =>
      scoreMemoryRelevance(r, 'debugging short replies concise', detectMemoryTopic(q2)).matched,
    )
    assert.ok(ranked2.some((r) => /debugging/i.test(r.content)))
  })

  it('W/X/Y — Memory OFF / caption-only / no document contents (contract)', () => {
    const chat = read('api/chat.ts')
    assert.match(chat, /memoryEnabled !== false|!memoryEnabled/)
    assert.match(chat, /visibleUserText|lastUserCaption/)
    assert.match(chat, /!lastUserCaption/)
    assert.doesNotMatch(chat, /dataUrl.*runMemoryPipeline|fileId.*extractDurableFacts/)
  })

  it('Z/AA — unsafe secrets blocked; remember cannot bypass (WRITE)', () => {
    assert.equal(containsUnsafeMemoryMaterial('password is hunter2secret99'), true)
    assert.equal(containsUnsafeMemoryMaterial('sk-abcdefghijklmnopqrstuvwxyz'), true)
    assert.equal(extractDurableFacts('Remember that my password is hunter2secret99').length, 0)
    assert.equal(extractDurableFacts('Remember that my API key is sk-abcdefghijklmnopqrst').length, 0)
    const stripped = stripExplicitMemoryIntent('Remember that my project is called LAIfe.')
    assert.equal(stripped.explicitIntent, true)
    assert.ok(extractDurableFacts('Remember that my project is called LAIfe.').length >= 1)
  })

  it('AB — assistant text cannot create user memory (WRITE contract)', () => {
    const brain = read('lib/server/brain-memory.js')
    assert.match(brain, /void assistantMessage/)
  })

  it('AC — Recall max 3 / 600 unchanged (RECALL)', () => {
    assert.equal(RECALL_MAX_MEMORIES, 3)
    assert.equal(RECALL_MAX_PACK_CHARS, 600)
  })

  it('AD/AE/AF — Forget/Overview/#264 modules still present', () => {
    assert.match(read('api/chat.ts'), /tryHandleMemoryControl|memory-control-forget/)
    assert.match(read('api/chat.ts'), /tryHandleMemoryOverview|memory-control-overview/)
    assert.match(read('lib/server/core-memory-recall.js'), /applyNonProbePreferenceRecallGuard/)
  })

  it('AG/AH/AI — one responses.create, maxDuration 120, reasoning.none', () => {
    const chat = read('api/chat.ts')
    const params = read('lib/server/core-responses-params.js')
    assert.equal((chat.match(/\.responses\.create\(/g) || []).length, 1)
    assert.match(chat, /maxDuration:\s*120/)
    assert.match(params, /effort:\s*['"]none['"]/)
  })

  it('AJ — #262–#279 instruction appendices still wired', () => {
    const chat = read('api/chat.ts')
    assert.match(chat, /buildCoreLanguageAppendix/)
    assert.match(chat, /buildCoreContinuityAppendix/)
    assert.match(chat, /buildReferenceContextAppendix/)
    assert.match(chat, /buildConversationWorkingStateAppendix/)
    assert.match(buildCoreContinuityAppendix(), /CONVERSATION CONTINUITY/)
    assert.equal(MAX_HISTORY_MESSAGES, 80)
    assert.equal(typeof buildReferenceContextAppendix, 'function')
  })

  it('this_project English prompts (WRITE)', () => {
    const facts = extractDurableFacts('For this project I want English prompts.')
    assert.ok(facts.some((f) => /English prompts/i.test(f.content)))
  })

  it('naming candidates helper smoke', () => {
    const named = extractProjectNamingCandidates('My project is called LAIfe.')
    assert.equal(named[0].name, 'LAIfe')
  })

  it('pack format still works with reply_style rows', () => {
    const fact = extractDurableFacts('Keep answers brief.')[0]
    const pack = formatCoreMemoryPack([rowFromFact(fact)], 'How brief should replies be?')
    assert.match(pack, /concise replies|DURABLE LAIFE MEMORY/i)
  })
})
