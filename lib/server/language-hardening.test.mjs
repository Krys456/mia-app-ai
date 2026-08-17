/**
 * #287 LANGUAGE hardening — IT↔FR false positives, elisions, shared tokens.
 * Run: node --test lib/server/language-hardening.test.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  buildCoreLanguageAppendix,
  buildLanguageAwarenessPlan,
  detectLanguageIntent,
  detectLanguageSignal,
  formatCoreLanguageAppendix,
} from './language-awareness.js'
import { buildCoreResponsesCreateParams, isGpt56FamilyModel } from './core-responses-params.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel) => readFileSync(join(root, rel), 'utf8')

function reply(userMessage, history = [], extra = {}) {
  const messages = [
    ...history.map((content) =>
      typeof content === 'string' ? { role: 'user', content } : content,
    ),
    { role: 'user', content: userMessage },
  ]
  return buildLanguageAwarenessPlan({ userMessage, messages, ...extra }).replyLanguage
}

function planOf(userMessage, history = [], extra = {}) {
  const messages = [
    ...history.map((content) =>
      typeof content === 'string' ? { role: 'user', content } : content,
    ),
    { role: 'user', content: userMessage },
  ]
  return buildLanguageAwarenessPlan({ userMessage, messages, ...extra })
}

const PREVIEW_FAIL =
  "Stasera c'è temporale fortissimo. Che faccio per lui?"

const IT_MATRIX = [
  "Stasera c'è un temporale fortissimo.",
  'Che faccio per lui?',
  "Com'è andata oggi?",
  "Dov'è il problema?",
  "L'ho già fatto.",
  "Cos'è successo?",
  "Non c'è niente da fare.",
  'Qual è la soluzione migliore?',
  'Perché non funziona?',
  "Anch'io la penso così.",
  'Ma dai.',
  "Ce l'ho.",
  "Te l'ho detto.",
]

const FR_MATRIX = [
  "Qu'est-ce que je dois faire ?",
  "C'est une bonne idée.",
  "Je l'ai déjà fait.",
  'Où est le problème ?',
  'Pourquoi ça ne marche pas ?',
  'Il faut faire attention.',
  'Je lui ai parlé.',
  'Ma voiture est ici.',
]

describe('#287 LANGUAGE hardening', () => {
  it('A — exact Preview failing sentence → IT (not sticky-dependent)', () => {
    const signal = detectLanguageSignal(PREVIEW_FAIL)
    assert.equal(signal.language, 'it')
    assert.ok(signal.confident)
    assert.ok(signal.scores.it > signal.scores.fr, 'Italian decisively ahead of French')
    assert.ok(signal.scores.it - signal.scores.fr >= 4)

    const plan = planOf(PREVIEW_FAIL)
    assert.equal(plan.replyLanguage, 'it')
    const appendix = formatCoreLanguageAppendix(plan)
    assert.match(appendix, /response language: it/)
    assert.doesNotMatch(appendix, /response language: fr/)
  })

  it("B — c'è scores IT; c'est scores FR", () => {
    const it = detectLanguageSignal("Non c'è niente da fare.")
    assert.equal(it.language, 'it')
    assert.ok(it.scores.it > it.scores.fr)

    const fr = detectLanguageSignal("C'est une bonne idée.")
    assert.equal(fr.language, 'fr')
    assert.ok(fr.scores.fr > fr.scores.it)
  })

  it("C — l'ho is IT; French l' forms stay FR", () => {
    const it = detectLanguageSignal("L'ho già fatto.")
    assert.equal(it.language, 'it')
    assert.ok(it.scores.it > it.scores.fr)

    const fr = detectLanguageSignal("Je l'ai déjà fait.")
    assert.equal(fr.language, 'fr')
    assert.ok(fr.scores.fr > fr.scores.it)

    const homme = detectLanguageSignal("L'homme est ici avec moi.")
    assert.equal(homme.language, 'fr')
  })

  it('D — lui Italian vs French-in-context', () => {
    assert.equal(reply('Che faccio per lui?'), 'it')
    const itSig = detectLanguageSignal('Che faccio per lui?')
    assert.ok(itSig.scores.fr === 0 || itSig.scores.it > itSig.scores.fr)

    assert.equal(reply('Je lui ai parlé.'), 'fr')
    const frSig = detectLanguageSignal('Je lui ai parlé.')
    assert.ok(frSig.scores.fr > frSig.scores.it)
  })

  it('E — ma Italian vs French-in-context', () => {
    assert.equal(reply('Ma dai.'), 'it')
    assert.equal(reply('Ma voiture est ici.'), 'fr')
  })

  it('F — Italian matrix → IT', () => {
    for (const t of IT_MATRIX) {
      const plan = planOf(t)
      assert.equal(plan.replyLanguage, 'it', t)
      const sig = detectLanguageSignal(t)
      assert.ok(
        sig.language === 'it' || plan.replyLanguage === 'it',
        `detector/plan for ${t}`,
      )
      if (sig.scores.fr > 0) {
        assert.ok(sig.scores.it > sig.scores.fr, `it>fr for ${t}`)
      }
    }
  })

  it('G — French matrix → FR', () => {
    for (const t of FR_MATRIX) {
      assert.equal(reply(t), 'fr', t)
      const sig = detectLanguageSignal(t)
      assert.equal(sig.language, 'fr', t)
      assert.ok(sig.scores.fr > sig.scores.it, `fr>it for ${t}`)
    }
  })

  it('H — sticky IT/FR for short turns', () => {
    assert.equal(reply('Ok', ['Ciao, come stai oggi amico?']), 'it')
    assert.equal(reply('Ok', ["Comment ça va aujourd'hui mon ami?"]), 'fr')
    assert.equal(reply('E poi?', ['Parliamo del progetto in italiano insieme.']), 'it')
    assert.equal(reply('Et puis ?', ['Parlons du projet en français ensemble.']), 'fr')
    // Fresh ambiguous short may hard-default EN (#287 scope note)
    assert.equal(reply('ok'), 'en')
  })

  it('I — explicit language request gaps', () => {
    const cases = [
      ['Rispondimi in francese.', 'fr'],
      ['Rispondimi in spagnolo.', 'es'],
      ['Rispondimi in tedesco.', 'de'],
      ['Réponds-moi en italien.', 'it'],
      ['Réponds-moi en anglais.', 'en'],
      ['Answer me in English.', 'en'],
      ['Answer me in Italian.', 'it'],
      ['Now answer me in English.', 'en'],
      ['Ora torniamo a parlare in italiano.', 'it'],
    ]
    for (const [t, lang] of cases) {
      assert.equal(detectLanguageIntent(t).explicit, lang, t)
      assert.equal(
        reply(t, ['Ciao, parliamo in italiano del progetto LAIfe oggi.']),
        lang,
        `switch ${t}`,
      )
    }
  })

  it('I2 — IT→FR→IT sequence: prior FR must not poison later Italian short turns', () => {
    const hist = []
    const turns = [
      ['Bruno ha paura dei temporali.', 'it'],
      ['Réponds-moi en français.', 'fr'],
      ['Que dois-je faire pour lui ?', 'fr'],
      ['Ora torniamo a parlare in italiano.', 'it'],
      ['Ok perfetto.', 'it'],
    ]
    for (const [t, expected] of turns) {
      assert.equal(reply(t, hist), expected, t)
      hist.push(t)
    }
  })

  it('I3 — short ack sticky + explicit switch updates conversational language', () => {
    assert.equal(
      reply('Ok perfetto.', ['Bruno ha paura dei temporali.', 'Che faccio per lui?']),
      'it',
    )
    assert.equal(
      reply('Perfetto.', ['Bruno ha paura dei temporali.', 'Che faccio per lui?']),
      'it',
    )
    assert.equal(
      reply('Va bene.', ['Bruno ha paura dei temporali.', 'Che faccio per lui?']),
      'it',
    )
    assert.equal(
      reply('Parfait.', ["Comment ça va aujourd'hui mon ami?", "C'est une bonne idée."]),
      'fr',
    )
    // Explicit IT switch must update sticky for following short Italian ack
    assert.equal(
      reply('Perfetto.', ["Comment ça va aujourd'hui mon ami?", 'Rispondimi in italiano.']),
      'it',
    )
  })

  it('J — #283 Memory isolation (LANGUAGE ignores pack language)', () => {
    assert.equal(reply('Che cosa volevo aggiungere a LAIfe in futuro?'), 'it')
    assert.equal(reply('What did I want to add to LAIfe later?'), 'en')
    assert.equal(reply("Qu'est-ce que je dois faire pour LAIfe ?"), 'fr')
    assert.equal(reply('Stasera c\'è un temporale fortissimo.'), 'it')
  })

  it('K — WS / Reference / Understanding are non-authority (user turn wins)', () => {
    const itTurn = PREVIEW_FAIL
    const plan = buildLanguageAwarenessPlan({
      userMessage: itTurn,
      messages: [{ role: 'user', content: itTurn }],
      // Extra English context must not flip reply language.
      priorLanguage: 'en',
      session: { conversationLanguage: 'en' },
    })
    // Confident IT current turn still wins over EN sticky/session.
    assert.equal(plan.replyLanguage, 'it')
    assert.match(formatCoreLanguageAppendix(plan), /response language: it/)
    assert.match(
      buildCoreLanguageAppendix({
        userMessage: itTurn,
        messages: [{ role: 'user', content: itTurn }],
      }),
      /response language: it/,
    )
  })

  it('L — image/document-only sticky IT/FR', () => {
    const itSticky = buildLanguageAwarenessPlan({
      userMessage: '',
      messages: [
        { role: 'user', content: 'Parliamo in italiano del progetto insieme.' },
        { role: 'assistant', content: 'Certo.' },
      ],
    })
    assert.equal(itSticky.replyLanguage, 'it')
    assert.equal(itSticky.noLinguisticSignal, true)

    const frSticky = buildLanguageAwarenessPlan({
      userMessage: '',
      messages: [
        { role: 'user', content: "Comment ça va aujourd'hui mon ami?" },
        { role: 'assistant', content: 'Bien.' },
      ],
    })
    assert.equal(frSticky.replyLanguage, 'fr')
    assert.equal(frSticky.noLinguisticSignal, true)

    // Caption switch wins
    assert.equal(
      reply('Perché non funziona?', [
        "Comment ça va aujourd'hui mon ami?",
      ]),
      'it',
    )
  })

  it('M — code-heavy input stays with natural language', () => {
    assert.equal(reply('Perché questo `if (x in obj)` non funziona?'), 'it')
    assert.equal(reply('Pourquoi ce `const foo = bar` échoue ?'), 'fr')
    assert.equal(reply('Why does `const x = 1` fail?'), 'en')
  })

  it('N — brand tokens remain neutral', () => {
    assert.equal(reply('LAIfe non funziona su Vercel.'), 'it')
    assert.equal(reply('Pourquoi LAIfe plante sur Vercel ?'), 'fr')
    assert.equal(reply('Cursor non vede il file.'), 'it')
  })

  it('O/P/Q/R — one responses.create, reasoning.none, stream:false, maxDuration 120', () => {
    const chat = read('api/chat.ts')
    assert.equal((chat.match(/\.responses\.create\(/g) || []).length, 1)
    assert.match(chat, /maxDuration:\s*120/)
    assert.match(read('lib/server/core-responses-params.js'), /effort:\s*['"]none['"]/)
    assert.ok(isGpt56FamilyModel('gpt-5.6-sol'))
    const params = buildCoreResponsesCreateParams({
      model: 'gpt-5.6-sol',
      input: [],
      instructions: 'x',
      maxOutputTokens: 100,
    })
    assert.equal(params.stream, false)
    assert.equal(params.reasoning?.effort, 'none')
    assert.equal(params.model, 'gpt-5.6-sol')
  })

  it('S — #284/#285/#286 modules still present and untouched by LANGUAGE', () => {
    assert.ok(read('lib/server/conversation-expression.js').includes('ADAPTIVE EXPRESSION'))
    assert.ok(read('lib/server/proactive-conversation.js').length > 100)
    assert.ok(read('lib/server/conversational-understanding.js').length > 100)
    const chat = read('api/chat.ts')
    assert.match(chat, /buildCoreExpressionAppendix/)
    assert.match(chat, /buildCoreProactiveIntelligenceAppendix/)
    assert.match(chat, /buildCoreConversationalUnderstandingAppendix/)
    // No language-detection library
    const pkg = read('package.json')
    assert.doesNotMatch(pkg, /"franc"|cld|language-detector/)
  })
})
