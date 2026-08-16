/**
 * LANGUAGE × Memory Recall isolation (#283).
 * Retrieved Memory is evidence only — never reply-language authority.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  buildLanguageAwarenessPlan,
  buildCoreLanguageAppendix,
  detectLanguageSignal,
  detectLanguageIntent,
} from './language-awareness.js'
import {
  formatCoreMemoryPack,
  RECALL_MAX_MEMORIES,
  RECALL_MAX_PACK_CHARS,
  detectMemoryQueryIntent,
  rerankMemoriesForRecall,
  isRecallEligibleMemory,
} from './core-memory-recall.js'
import { extractDurableFacts } from './brain-memory.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel) => readFileSync(join(root, rel), 'utf8')

function replyOf(userMessage, messages, extra = {}) {
  const plan = buildLanguageAwarenessPlan({
    userMessage,
    messages: messages || [{ role: 'user', content: userMessage }],
    ...extra,
  })
  return plan.replyLanguage
}

function rowFromFact(fact, id = '1') {
  return {
    id,
    category: fact.category,
    title: fact.title,
    content: fact.content,
    tags: fact.factKey ? [`fact_key:${fact.factKey}`] : [],
    status: 'active',
    importance: fact.importance || 7,
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-01T00:00:00Z',
    usage_count: 0,
  }
}

describe('LANGUAGE × Memory Recall isolation (#283)', () => {
  it('A — Preview: EN Memory + fresh IT future probe → replyLanguage IT', () => {
    const q = 'Che cosa volevo aggiungere a LAIfe in futuro?'
    const signal = detectLanguageSignal(q)
    assert.notEqual(signal.scores.it, 0)
    assert.ok(signal.scores.it >= signal.scores.en, 'IT must not lose to EN stopwords')
    assert.equal(replyOf(q), 'it')

    const fact = extractDurableFacts('Voglio che LAIfe in futuro controlli la domotica.')[0]
    assert.equal(fact.factKey, 'projects.laife.future.smart_home')
    assert.match(fact.content, /smart-home control/i)
    const row = rowFromFact(fact)
    assert.equal(isRecallEligibleMemory(row), true)
    const pack = formatCoreMemoryPack(
      rerankMemoriesForRecall([row], q, {
        limit: RECALL_MAX_MEMORIES,
        intent: detectMemoryQueryIntent(q),
      }),
    )
    assert.match(pack, /smart-home control/i)
    assert.match(pack, /evidence only|must not determine/i)
    // LANGUAGE still IT despite English pack wording
    assert.equal(replyOf(q), 'it')
    const appendix = buildCoreLanguageAppendix({
      userMessage: q,
      messages: [{ role: 'user', content: q }],
    })
    assert.match(appendix, /response language: it/)
    assert.doesNotMatch(appendix, /response language: en/)
  })

  it('B — fresh EN future probe → EN', () => {
    assert.equal(replyOf('What did I want to add to LAIfe later?'), 'en')
    assert.equal(replyOf('What future feature did I want for LAIfe?'), 'en')
  })

  it('C — English project/tool Memory + Italian probe → IT', () => {
    const q = 'Con cosa sviluppo LAIfe?'
    assert.equal(replyOf(q), 'it')
    const fact = extractDurableFacts('Di solito sviluppo LAIfe con Cursor.')[0]
    assert.equal(fact.factKey, 'projects.laife.tools.cursor')
    const pack = formatCoreMemoryPack([rowFromFact(fact)])
    assert.match(pack, /Cursor/i)
    assert.equal(replyOf(q), 'it')
  })

  it('D — Italian-looking Memory content + English probe → EN', () => {
    const q = 'What tool do I use for LAIfe?'
    assert.equal(replyOf(q), 'en')
  })

  it('E — several EN pack lines do not flip IT current turn', () => {
    const q = 'Che cosa volevo aggiungere a LAIfe in futuro?'
    assert.equal(replyOf(q), 'it')
    const pack = formatCoreMemoryPack([
      rowFromFact({
        category: 'projects',
        title: 't',
        content: 'LAIfe future feature: smart-home control',
        factKey: 'projects.laife.future.smart_home',
      }),
      rowFromFact(
        {
          category: 'projects',
          title: 't',
          content: 'LAIfe development tool: Cursor',
          factKey: 'projects.laife.tools.cursor',
        },
        '2',
      ),
    ])
    assert.match(pack, /evidence only|must not determine/i)
    assert.equal(replyOf(q), 'it')
  })

  it('F — EN current turn stays EN', () => {
    assert.equal(replyOf('What editor do I use for my AI project?'), 'en')
  })

  it('G — sticky IT + E poi? stays IT', () => {
    assert.equal(
      replyOf('E poi?', [
        { role: 'user', content: 'Parliamo del mio progetto LAIfe in italiano.' },
        { role: 'assistant', content: 'Certo, dimmi pure.' },
        { role: 'user', content: 'E poi?' },
      ]),
      'it',
    )
  })

  it('H — sticky EN + And then? stays EN', () => {
    assert.equal(
      replyOf('And then?', [
        { role: 'user', content: 'Tell me about my LAIfe project please.' },
        { role: 'assistant', content: 'Sure — what would you like to know?' },
        { role: 'user', content: 'And then?' },
      ]),
      'en',
    )
  })

  it('I — explicit Italian→English request → EN', () => {
    assert.equal(detectLanguageIntent('Rispondimi in inglese.').explicit, 'en')
    assert.equal(
      replyOf('Rispondimi in inglese.', [
        { role: 'user', content: 'Ciao, parliamo in italiano del progetto.' },
        { role: 'assistant', content: 'Certo.' },
        { role: 'user', content: 'Rispondimi in inglese.' },
      ]),
      'en',
    )
    assert.equal(replyOf('Answer in English.'), 'en')
  })

  it('J — explicit English→Italian request → IT', () => {
    assert.equal(detectLanguageIntent('Rispondimi in italiano.').explicit, 'it')
    assert.equal(detectLanguageIntent('Answer in Italian.').explicit, 'it')
    assert.equal(
      replyOf('Answer in Italian.', [
        { role: 'user', content: 'Hello, let’s talk about my project.' },
        { role: 'assistant', content: 'Sure.' },
        { role: 'user', content: 'Answer in Italian.' },
      ]),
      'it',
    )
    assert.equal(replyOf('Rispondimi in italiano.'), 'it')
  })

  it('K/L/M/N — Italian recall probes → IT', () => {
    assert.equal(replyOf('Come volevo la UI di LAIfe?'), 'it')
    assert.equal(replyOf('Che strumento uso per LAIfe?'), 'it')
    assert.equal(replyOf('Che stile preferisco per ChAIn?'), 'it')
    assert.equal(replyOf('Con cosa sviluppo LAIfe?'), 'it')
  })

  it('O — clear English queries remain EN', () => {
    assert.equal(replyOf('How are you today?'), 'en')
    assert.equal(replyOf('What is my main project?'), 'en')
    assert.equal(replyOf('Do you remember my favorite anime?'), 'en')
  })

  it('P — ambiguous short / social does not force IT without sticky', () => {
    assert.equal(replyOf('ok'), 'en') // fresh → default en, not forced it
    assert.equal(
      replyOf('ok', [
        { role: 'user', content: 'Ciao, come stai oggi amico?' },
        { role: 'user', content: 'ok' },
      ]),
      'it',
    )
    // Code-heavy English question stays EN
    assert.equal(
      replyOf('```\nconst x = 1;\n```\nWhat does this mean?'),
      'en',
    )
  })

  it('image/document-only sticky preserved', () => {
    const itSticky = buildLanguageAwarenessPlan({
      userMessage: '',
      messages: [
        { role: 'user', content: 'Parliamo in italiano del progetto.' },
        { role: 'assistant', content: 'Certo.' },
      ],
    })
    assert.equal(itSticky.replyLanguage, 'it')
    assert.equal(itSticky.noLinguisticSignal, true)

    const enSticky = buildLanguageAwarenessPlan({
      userMessage: '',
      messages: [
        { role: 'user', content: 'Let’s talk about my project in English.' },
        { role: 'assistant', content: 'Sure.' },
      ],
    })
    assert.equal(enSticky.replyLanguage, 'en')
  })

  it('#282 future fact_key unchanged; pack 3/600; Core invariants', () => {
    const fact = extractDurableFacts(
      'I want LAIfe to eventually control my smart home.',
    )[0]
    assert.equal(fact.factKey, 'projects.laife.future.smart_home')
    assert.equal(RECALL_MAX_MEMORIES, 3)
    assert.equal(RECALL_MAX_PACK_CHARS, 600)
    const chat = read('api/chat.ts')
    assert.equal((chat.match(/\.responses\.create\(/g) || []).length, 1)
    assert.match(chat, /maxDuration:\s*120/)
    assert.match(read('lib/server/core-responses-params.js'), /effort:\s*['"]none['"]/)
    assert.doesNotMatch(read('lib/server/language-awareness.js'), /embedding/i)
  })
})
