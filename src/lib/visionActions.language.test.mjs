/**
 * #274 follow-up — Vision sticky language must not flip to EN.
 * Run: node --test src/lib/visionActions.language.test.mjs
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  VISION_TASK_PROMPTS,
  resolveVisionStickyLang,
} from '../../lib/server/vision-task-shortcuts.js'
import {
  IMAGE_ONLY_MODEL_NUDGE,
  imageOnlyModelNudgeForMessages,
  mapMessagesToResponsesInput,
  visibleUserText,
} from '../../lib/server/chat-image-input.js'
import {
  buildCoreLanguageAppendix,
  buildLanguageAwarenessPlan,
} from '../../lib/server/language-awareness.js'

const tinyJpeg =
  'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGfAP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAQUCf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQMBAT8Bf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQIBAT8Bf//Z'

async function loadClient() {
  const esbuild = await import('esbuild')
  const outfile = path.join(os.tmpdir(), `vision-lang-${Date.now()}.mjs`)
  await esbuild.build({
    entryPoints: [path.resolve('src/lib/visionActions.ts')],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    target: 'es2022',
    packages: 'external',
  })
  return import(pathToFileURL(outfile).href)
}

const client = await loadClient()

function itThread() {
  return [
    { role: 'user', content: 'Ciao, parliamo in italiano per favore.' },
    { role: 'assistant', content: 'Certo, parliamo pure in italiano.' },
    { role: 'user', content: 'Dimmi qualcosa sulla fotografia e la luce naturale.' },
    { role: 'assistant', content: 'La luce naturale aiuta i ritratti.' },
  ]
}

describe('Vision sticky language (#274 follow-up)', () => {
  it('IT sticky + Analyze → empty caption + Italian image-only nudge + replyLanguage it', () => {
    const sticky = client.resolveVisionActionLang({
      messages: itThread(),
      navigatorLanguage: 'en-US',
    })
    assert.equal(sticky, 'it')
    assert.equal(client.captionForVisionAction('analyze', sticky), '')

    const msgs = [...itThread(), { role: 'user', content: '', attachments: [{ type: 'image', mimeType: 'image/jpeg', dataUrl: tinyJpeg }] }]
    assert.equal(visibleUserText(msgs.at(-1)), '')
    assert.equal(imageOnlyModelNudgeForMessages(msgs).includes('Analizza'), true)
    assert.notEqual(imageOnlyModelNudgeForMessages(msgs), IMAGE_ONLY_MODEL_NUDGE)

    const mapped = mapMessagesToResponsesInput(msgs)
    const textParts = mapped.at(-1).content.filter((p) => p.type === 'input_text').map((p) => p.text)
    assert.deepEqual(textParts, [imageOnlyModelNudgeForMessages(msgs)])

    const plan = buildLanguageAwarenessPlan({
      userMessage: '',
      messages: msgs.map((m) => ({ role: m.role, content: m.content })),
    })
    assert.equal(plan.replyLanguage, 'it')
    const appendix = buildCoreLanguageAppendix({
      userMessage: '',
      messages: msgs.map((m) => ({ role: m.role, content: m.content })),
    })
    assert.match(appendix, /response language: it/)
  })

  it('IT sticky + ReadText / Explain → Italian captions; never EN when sticky exists', () => {
    const sticky = client.resolveVisionActionLang({
      messages: itThread(),
      navigatorLanguage: 'en-US',
    })
    assert.equal(sticky, 'it')
    assert.equal(client.captionForVisionAction('read', sticky), VISION_TASK_PROMPTS.it.read)
    assert.equal(client.captionForVisionAction('explain', sticky), VISION_TASK_PROMPTS.it.explain)
    assert.notEqual(client.captionForVisionAction('read', sticky), VISION_TASK_PROMPTS.en.read)

    for (const action of ['read', 'explain']) {
      const caption = client.captionForVisionAction(action, sticky)
      const plan = buildLanguageAwarenessPlan({
        userMessage: caption,
        messages: [...itThread(), { role: 'user', content: caption }],
      })
      assert.equal(plan.replyLanguage, 'it', `${action} must stay IT`)
    }
  })

  it('EN/FR/ES/DE sticky equivalents for Analyze/Read/Explain', () => {
    const cases = [
      {
        lang: 'en',
        nav: 'it-IT',
        msgs: [
          { role: 'user', content: 'Hello, please speak English with me today.' },
          { role: 'assistant', content: 'Sure, we can talk in English.' },
        ],
      },
      {
        lang: 'fr',
        nav: 'en-US',
        msgs: [
          { role: 'user', content: 'Bonjour, parlons français aujourd’hui s’il te plaît.' },
          { role: 'assistant', content: 'Bien sûr, parlons français.' },
        ],
      },
      {
        lang: 'es',
        nav: 'en-US',
        msgs: [
          { role: 'user', content: 'Hola, hablemos en español por favor hoy.' },
          { role: 'assistant', content: 'Claro, hablamos en español.' },
        ],
      },
      {
        lang: 'de',
        nav: 'en-US',
        msgs: [
          { role: 'user', content: 'Guten Tag, bitte sprich heute Deutsch mit mir.' },
          { role: 'assistant', content: 'Natürlich, wir können auf Deutsch sprechen.' },
        ],
      },
    ]

    for (const c of cases) {
      const sticky = client.resolveVisionActionLang({
        messages: c.msgs,
        navigatorLanguage: c.nav,
      })
      assert.equal(sticky, c.lang, `sticky for ${c.lang}`)
      assert.equal(client.captionForVisionAction('analyze', sticky), '')
      assert.equal(client.captionForVisionAction('read', sticky), VISION_TASK_PROMPTS[c.lang].read)
      assert.equal(client.captionForVisionAction('explain', sticky), VISION_TASK_PROMPTS[c.lang].explain)
      assert.equal(resolveVisionStickyLang(c.msgs, c.nav), c.lang)
    }
  })

  it('navigator EN is ignored when Italian sticky exists (A1/A2)', () => {
    assert.equal(
      client.resolveVisionActionLang({ messages: itThread(), navigatorLanguage: 'en-US' }),
      'it',
    )
    assert.equal(resolveVisionStickyLang(itThread(), 'en-US'), 'it')
  })

  it('navigator only when thread has no recoverable language', () => {
    assert.equal(client.resolveVisionActionLang({ messages: [], navigatorLanguage: 'fr-FR' }), 'fr')
    assert.equal(resolveVisionStickyLang([], 'de-DE'), 'de')
  })
})
