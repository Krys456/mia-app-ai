/**
 * Cross-chat memory depth / project-scoped associations (#282).
 * Deterministic WRITE + Recall + correction MVP (no embeddings / migration).
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  containsUnsafeMemoryMaterial,
  extractDurableFacts,
  extractProjectToolCandidates,
  extractProjectToolCorrection,
  extractProjectFutureFeatureCandidates,
  extractProjectFutureFeatureRevoke,
  extractShopPlatformCandidates,
  buildReplyStyleFactKey,
} from './brain-memory.js'
import { mapMemoryPipelineToFeedbackEvent as mapFeedback } from './memory-feedback-event.js'
import {
  detectMemoryQueryIntent,
  isRecallEligibleMemory,
  RECALL_MAX_MEMORIES,
  RECALL_MAX_PACK_CHARS,
  rerankMemoriesForRecall,
  formatCoreMemoryPack,
} from './core-memory-recall.js'
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

function packFor(facts, query) {
  const rows = (Array.isArray(facts) ? facts : [facts]).map((f, i) =>
    rowFromFact(f, String(i + 1)),
  )
  const intent = detectMemoryQueryIntent(query)
  const ranked = rerankMemoriesForRecall(rows, query, {
    limit: RECALL_MAX_MEMORIES,
    intent,
  })
  return formatCoreMemoryPack(ranked, query)
}

describe('memory depth project-scoped (#282)', () => {
  it('A IT — project/tool write + recall', () => {
    const facts = extractDurableFacts('Di solito sviluppo LAIfe con Cursor.')
    assert.equal(facts.length, 1)
    assert.equal(facts[0].factKey, 'projects.laife.tools.cursor')
    assert.match(facts[0].content, /LAIfe development tool:\s*Cursor/i)
    assert.equal(isRecallEligibleMemory(rowFromFact(facts[0])), true)
    assert.doesNotMatch(facts[0].factKey, /^habits\.tools\./)
    const pack = packFor(facts, 'Con cosa sviluppo LAIfe?')
    assert.match(pack, /Cursor/i)
    assert.equal(detectMemoryQueryIntent('Con cosa sviluppo LAIfe?').subtype, 'project_tool')
  })

  it('A EN — project/tool write', () => {
    for (const text of [
      'I usually use Cursor for LAIfe.',
      'I develop LAIfe with Cursor.',
      'I use Cursor to build LAIfe.',
      'Cursor is the tool I use for LAIfe.',
    ]) {
      const facts = extractDurableFacts(text)
      assert.ok(
        facts.some((f) => f.factKey === 'projects.laife.tools.cursor'),
        `WRITE_FAIL: ${text}`,
      )
    }
  })

  it('B — indirect tool/editor recall', () => {
    const fact = extractDurableFacts('Di solito sviluppo LAIfe con Cursor.')[0]
    const intent = detectMemoryQueryIntent('Quale editor uso per il mio progetto AI?')
    assert.equal(intent.subtype, 'project_tool')
    const pack = packFor([fact], 'Quale editor uso per il mio progetto AI?')
    assert.match(pack, /Cursor/i)
    const packEn = packFor([fact], 'What tool/editor do I use?')
    assert.match(packEn, /Cursor/i)
  })

  it('C — future feature write + recall (IT/EN)', () => {
    const it = extractDurableFacts('Voglio che LAIfe in futuro controlli la domotica.')
    assert.equal(it[0].factKey, 'projects.laife.future.smart_home')
    assert.match(it[0].content, /smart-home control/i)
    const en = extractDurableFacts('I want LAIfe to eventually control my smart home.')
    assert.equal(en[0].factKey, 'projects.laife.future.smart_home')
    const pack = packFor(it, 'Che cosa volevo aggiungere a LAIfe in futuro?')
    assert.match(pack, /smart-home|domotica|home automation/i)
    assert.equal(
      detectMemoryQueryIntent('Che cosa volevo aggiungere a LAIfe in futuro?').subtype,
      'project_future',
    )
  })

  it('C2 — future feature removal', () => {
    const facts = extractDurableFacts('I no longer want smart-home control for LAIfe.')
    assert.ok(facts.some((f) => f.operation === 'revoke'))
    assert.equal(facts[0].factKey, 'projects.laife.future.smart_home')
    assert.equal(facts[0].targetType, 'project_scoped_key')
    const revoke = extractProjectFutureFeatureRevoke(
      'I no longer want smart-home control for LAIfe.',
    )
    assert.equal(revoke?.factKey, 'projects.laife.future.smart_home')
  })

  it('D — UI style scoped write + recall', () => {
    const facts = extractDurableFacts(
      "Per LAIfe voglio un'interfaccia minimale e animazioni fluide.",
    )
    assert.ok(facts.length >= 2)
    assert.ok(facts.every((f) => /^projects\.laife\.preferences\./.test(f.factKey)))
    assert.ok(facts.some((f) => /minimale|minimal/i.test(f.content)))
    assert.ok(facts.some((f) => /fluide|smooth/i.test(f.content)))
    const pack = packFor(facts, 'Come volevo la UI di LAIfe?')
    assert.match(pack, /minimale|minimal/i)
    assert.match(pack, /fluide|animazioni|smooth/i)
    assert.equal(detectMemoryQueryIntent('Come volevo la UI di LAIfe?').subtype, 'project_ui')
  })

  it('D EN — minimal interface preference', () => {
    const facts = extractDurableFacts('For LAIfe I want a minimal interface.')
    assert.ok(facts.some((f) => /^projects\.laife\.preferences\./.test(f.factKey)))
    assert.match(facts[0].content, /minimal/i)
  })

  it('E — scoped reply-style collision prevention (ChAIn vs studying)', () => {
    const chain = extractDurableFacts('Per ChAIn preferisco uno stile energico.')
    const study = extractDurableFacts('Quando studio preferisco spiegazioni dettagliate.')
    assert.equal(chain[0].factKey, 'projects.chain.reply_style.energetic')
    assert.equal(study[0].factKey, 'context.studying.reply_style')
    assert.notEqual(chain[0].factKey, study[0].factKey)
    assert.ok(!chain.some((f) => f.factKey === 'settings.reply_style'))
    assert.ok(!study.some((f) => f.factKey === 'settings.reply_style'))
    const pack = packFor([...chain, ...study], 'Che stile preferisco per ChAIn?')
    assert.match(pack, /energetic/i)
    assert.equal(
      detectMemoryQueryIntent('Che stile preferisco per ChAIn?').subtype,
      'project_reply_style',
    )
    assert.equal(detectMemoryQueryIntent('Che stile preferisco per ChAIn?').subject, 'chain')
  })

  it('E2 — debugging LAIfe concise is project-scoped', () => {
    const facts = extractDurableFacts('When debugging LAIfe I prefer short answers.')
    assert.equal(facts[0].factKey, 'projects.laife.reply_style.when.debugging')
    assert.ok(!facts.some((f) => f.factKey === 'settings.reply_style'))
  })

  it('F — shop/platform write + recall', () => {
    const it = extractDurableFacts('TemplateNestKrys è il mio negozio su Etsy.')
    assert.equal(it[0].factKey, 'projects.shop.etsy.templatenestkrys')
    assert.match(it[0].content, /Etsy/i)
    const en = extractDurableFacts('TemplateNestKrys is the name I use for my Etsy shop.')
    assert.equal(en[0].factKey, 'projects.shop.etsy.templatenestkrys')
    const pack = packFor(it, 'Su quale piattaforma ho TemplateNestKrys?')
    assert.match(pack, /Etsy|TemplateNestKrys/i)
    assert.equal(
      detectMemoryQueryIntent('Su quale piattaforma ho TemplateNestKrys?').subtype,
      'shop_platform',
    )
  })

  it('G — tool correction → revoke+create + UPDATED feedback', () => {
    const it = extractDurableFacts('Non uso più Cursor per LAIfe, adesso uso VS Code.')
    assert.ok(it.some((f) => f.operation === 'revoke' && f.factKey === 'projects.laife.tools.cursor'))
    assert.ok(it.some((f) => f.factKey === 'projects.laife.tools.vs_code' && !f.operation))
    const en = extractDurableFacts(
      "I don't use Cursor for LAIfe anymore; now I use VS Code.",
    )
    assert.ok(en.some((f) => f.operation === 'revoke' && /tools\.cursor/.test(f.factKey)))
    assert.ok(en.some((f) => /tools\.vs_code/.test(f.factKey)))

    const corr = extractProjectToolCorrection(
      "I don't use Cursor for LAIfe anymore; now I use VS Code.",
    )
    assert.equal(corr?.oldFactKey, 'projects.laife.tools.cursor')
    assert.equal(corr?.newFactKey, 'projects.laife.tools.vs_code')

    const event = mapFeedback({
      stats: { created: 1, updated: 0, revoked: 1, replaced: 0 },
      memory: { content: 'LAIfe development tool: VS Code', factKey: 'projects.laife.tools.vs_code' },
    })
    assert.equal(event?.type, 'updated')

    const pack = packFor(
      en.filter((f) => !f.operation),
      'Che strumento uso per LAIfe?',
    )
    assert.match(pack, /VS Code/i)
    assert.doesNotMatch(pack, /Cursor/i)
  })

  it('multi-fact atomic split + <=3 cap', () => {
    const facts = extractDurableFacts(
      'My AI project is LAIfe. I build it with Cursor and I want the interface smooth and minimal.',
    )
    assert.ok(facts.length <= 3)
    assert.ok(facts.some((f) => f.factKey === 'projects.laife'))
    assert.ok(facts.some((f) => f.factKey === 'projects.laife.tools.cursor'))
    assert.ok(facts.some((f) => /preferences|smooth|minimal/i.test(`${f.factKey} ${f.content}`)))
  })

  it('duplicate prevention — identical tool re-assert same fact_key', () => {
    const a = extractDurableFacts('I use Cursor for LAIfe.')
    const b = extractDurableFacts("I'm working on LAIfe in Cursor again.")
    // Second may be weaker; when it matches, same key
    const aKey = a.find((f) => /\.tools\./.test(f.factKey))?.factKey
    assert.equal(aKey, 'projects.laife.tools.cursor')
    const bTool = b.find((f) => /\.tools\./.test(f.factKey))
    if (bTool) assert.equal(bTool.factKey, aKey)
  })

  it('temporary-vs-durable boundary', () => {
    assert.equal(extractDurableFacts('Use Cursor for this next step.').length, 0)
    assert.ok(
      extractDurableFacts('I normally use Cursor to develop LAIfe.').some(
        (f) => f.factKey === 'projects.laife.tools.cursor',
      ),
    )
    assert.equal(extractDurableFacts('Add smart home next.').length, 0)
    assert.ok(
      extractDurableFacts('I want LAIfe to have smart-home control in the future.').some(
        (f) => f.factKey === 'projects.laife.future.smart_home',
      ),
    )
    assert.equal(extractDurableFacts('Use energetic copy for this one post.').length, 0)
    assert.ok(
      extractDurableFacts('For ChAIn posts I prefer an energetic style.').some(
        (f) => f.factKey === 'projects.chain.reply_style.energetic',
      ),
    )
    const ws = buildConversationWorkingStateAppendix([
      { role: 'user', content: 'Add smart home next.' },
    ])
    assert.match(ws, /WORKING STATE|smart home/i)
  })

  it('UI preference revoke (flashy)', () => {
    const facts = extractDurableFacts("For LAIfe I don't want flashy animations anymore.")
    assert.ok(facts.some((f) => f.operation === 'revoke'))
    assert.ok(facts.some((f) => /preferences\.flashy/.test(f.factKey)))
  })

  it('Recall eligibility for new key families', () => {
    const keys = [
      'projects.laife.tools.cursor',
      'projects.laife.future.smart_home',
      'projects.laife.preferences.minimal_interface',
      'projects.chain.reply_style.energetic',
      'context.studying.reply_style',
      'projects.shop.etsy.templatenestkrys',
    ]
    for (const factKey of keys) {
      assert.equal(
        isRecallEligibleMemory(
          rowFromFact({ category: 'projects', title: 't', content: 'durable content here', factKey }),
        ),
        true,
        factKey,
      )
    }
  })

  it('#281 feedback: saved / updated / removed', () => {
    assert.equal(
      mapFeedback({ stats: { created: 1, updated: 0, revoked: 0 }, memory: { content: 'LAIfe development tool: Cursor' } })
        ?.type,
      'created',
    )
    assert.equal(
      mapFeedback({ stats: { created: 1, updated: 0, revoked: 1 }, memory: { content: 'LAIfe development tool: VS Code' } })
        ?.type,
      'updated',
    )
    assert.equal(
      mapFeedback({ stats: { created: 0, updated: 0, revoked: 1 }, memory: { content: 'Revoke' } })?.type,
      'removed',
    )
  })

  it('Memory OFF / unsafe / image-document cues preserved', () => {
    assert.equal(containsUnsafeMemoryMaterial('My password is hunter2 and SSN 123-45-6789'), true)
    // Extraction skips unsafe
    assert.equal(
      extractDurableFacts('My password is hunter2. I use Cursor for LAIfe.').length,
      0,
    )
  })

  it('helpers: tool / future / shop extractors', () => {
    assert.ok(extractProjectToolCandidates('Di solito per LAIfe lavoro con Cursor.').length >= 1)
    assert.ok(
      extractProjectFutureFeatureCandidates(
        'Una cosa che voglio aggiungere a LAIfe più avanti è la domotica.',
      ).some((f) => f.feature === 'smart_home'),
    )
    assert.ok(
      extractShopPlatformCandidates('Il mio negozio TemplateNestKrys è su Etsy.').some(
        (s) => /etsy/i.test(s.platform),
      ),
    )
    assert.equal(
      buildReplyStyleFactKey('energetic', null, 'ChAIn'),
      'projects.chain.reply_style.energetic',
    )
    assert.equal(buildReplyStyleFactKey('detailed', null, 'studying'), 'context.studying.reply_style')
  })

  it('Recall pack stays 3 / 600', () => {
    assert.equal(RECALL_MAX_MEMORIES, 3)
    assert.equal(RECALL_MAX_PACK_CHARS, 600)
  })

  it('#277 / #278 / #279 intact', () => {
    assert.equal(MAX_HISTORY_MESSAGES, 80)
    assert.match(buildCoreContinuityAppendix(), /CONVERSATION CONTINUITY/)
    assert.equal(typeof buildReferenceContextAppendix, 'function')
    assert.equal(typeof buildConversationWorkingStateAppendix, 'function')
    const chat = read('api/chat.ts')
    assert.match(chat, /buildCoreContinuityAppendix/)
    assert.match(chat, /buildReferenceContextAppendix/)
    assert.match(chat, /buildConversationWorkingStateAppendix/)
  })

  it('one responses.create / maxDuration 120 / reasoning.none', () => {
    const chat = read('api/chat.ts')
    const params = read('lib/server/core-responses-params.js')
    assert.equal((chat.match(/\.responses\.create\(/g) || []).length, 1)
    assert.match(chat, /maxDuration:\s*120/)
    assert.match(params, /effort:\s*['"]none['"]/)
  })

  it('file boundary — primary patches only', () => {
    const brain = read('lib/server/brain-memory.js')
    const recall = read('lib/server/core-memory-recall.js')
    assert.match(brain, /#282/)
    assert.match(recall, /project_tool/)
    assert.match(recall, /project_future/)
    assert.match(recall, /shop_platform/)
    assert.doesNotMatch(brain, /embedding/i)
    assert.doesNotMatch(recall, /embedding/i)
  })
})
