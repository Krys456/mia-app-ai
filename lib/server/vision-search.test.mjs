/**
 * #312 Vision AI × Search — intent, query, context, privacy, regression.
 * Run: node lib/server/vision-search.test.mjs
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  detectVisionUncertainty,
  extractVisibleTextHint,
  hasRecentVisionContext,
  selectLatestVisionSearchContext,
  VISION_SEARCH_CONTEXT_WINDOW,
} from './vision-search-context.js'
import {
  detectVisionSearchIntent,
  isVisionSearchButtonTrigger,
  routeVisionSearchIntent,
} from './vision-search-intent.js'
import { buildVisionSearchAppendix, buildVisionSearchQuery } from './vision-search-query.js'
import {
  buildVisionSearchDiagPayload,
  isVisionSearchDiagEnabled,
  VISION_SEARCH_DIAG_BUILD,
} from './vision-search-diag.js'
import { detectExplicitWebSearchIntent } from './web-search.js'

const root = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(root, '../..')

function imgUser(content, id = 'u-img') {
  return {
    id,
    role: 'user',
    content,
    attachments: [{ type: 'image', mimeType: 'image/jpeg', dataUrl: 'data:image/jpeg;base64,AAA' }],
  }
}

function asst(content, id = 'a1') {
  return { id, role: 'assistant', content }
}

const sonyThread = [
  imgUser('Che cos’è?', 'u1'),
  asst('Sembrano Sony WH-1000XM5.', 'a1'),
]

const colosseumThread = [
  imgUser('Che cos’è?', 'u2'),
  asst('È probabilmente il Colosseo.', 'a2'),
]

const plantThread = [
  imgUser('Che pianta è?', 'u3'),
  asst('Vedo una pianta che sembra una Monstera deliciosa.', 'a3'),
]

const uncertainThread = [
  imgUser('Che modello è?', 'u4'),
  asst('Potrebbe essere un modello X, ma non ne sono sicuro.', 'a4'),
]

// ——— Reference resolution (NL) ———
{
  for (const phrase of [
    'Cercalo',
    'Cercalo online',
    'Quanto costa?',
    'Dove posso comprarlo?',
    'Dimmi di più',
    'Search this',
    'Look it up',
    'How much does it cost?',
    'Where can I buy it?',
    'Find this product',
    'What exact model is this?',
    'Verify what this is',
  ]) {
    const route = routeVisionSearchIntent(phrase, { messages: sonyThread })
    assert.equal(route.intent, 'vision_search', `should match: ${phrase}`)
    assert.notEqual(route.kind, 'none')
  }

  // Without vision context — must NOT steal
  assert.equal(routeVisionSearchIntent('Cercalo', { messages: [] }).intent, 'none')
  assert.equal(
    routeVisionSearchIntent('Cercalo', {
      messages: [{ role: 'user', content: 'ciao' }, asst('ciao!')],
    }).intent,
    'none',
  )
  assert.equal(isVisionSearchButtonTrigger('Cercalo online.'), true)
  assert.equal(isVisionSearchButtonTrigger('Search this online.'), true)
}

// ——— Search query generation ———
{
  const product = buildVisionSearchQuery({
    kind: 'price',
    userMessage: 'Quanto costano?',
    vision: selectLatestVisionSearchContext(sonyThread),
  })
  assert.equal(product.ok, true)
  assert.match(product.query.toLowerCase(), /sony/)
  assert.match(product.query.toLowerCase(), /price|1000xm5/)

  const landmark = buildVisionSearchQuery({
    kind: 'generic_lookup',
    userMessage: 'Cercalo',
    vision: selectLatestVisionSearchContext(colosseumThread),
  })
  assert.equal(landmark.ok, true)
  assert.match(landmark.query.toLowerCase(), /colosse/)

  const plant = buildVisionSearchQuery({
    kind: 'more_info',
    userMessage: 'Come si cura?',
    vision: selectLatestVisionSearchContext(plantThread),
  })
  assert.equal(plant.ok, true)
  assert.match(plant.query.toLowerCase(), /monstera/)
  assert.match(plant.query.toLowerCase(), /care/)

  const device = buildVisionSearchQuery({
    kind: 'identify',
    userMessage: 'Che modello è esattamente?',
    vision: selectLatestVisionSearchContext([
      imgUser(''),
      asst('Sembra un iPhone 15 Pro. Model: A3101'),
    ]),
  })
  assert.equal(device.ok, true)
  assert.ok(device.query.length > 3)

  const generic = buildVisionSearchQuery({
    kind: 'generic_lookup',
    userMessage: 'Cercalo online.',
    vision: selectLatestVisionSearchContext([
      imgUser(''),
      asst('Vedo una tazza blu sul tavolo.'),
    ]),
  })
  assert.equal(generic.ok, true)
  assert.ok(generic.query.length >= 2)
}

// ——— Uncertainty ———
{
  const u = detectVisionUncertainty('Potrebbe essere un modello X, ma non ne sono sicuro')
  assert.equal(u.uncertain, true)
  const ctx = selectLatestVisionSearchContext(uncertainThread)
  assert.equal(ctx.uncertain, true)
  const q = buildVisionSearchQuery({
    kind: 'verify',
    userMessage: 'Verifica cos’è',
    vision: ctx,
  })
  assert.equal(q.ok, true)
  assert.equal(q.uncertain, true)
  const appendix = buildVisionSearchAppendix({
    query: q.query,
    kind: 'verify',
    uncertain: true,
    visionSummary: ctx.summary,
  })
  assert.match(appendix, /UNCERTAIN/)
  assert.match(appendix, /web_search/)
}

// ——— Context selection ———
{
  const latest = selectLatestVisionSearchContext([
    imgUser('old', 'old-u'),
    asst('Vecchia foto di una penna.', 'old-a'),
    imgUser('Che cos’è?', 'new-u'),
    asst('Sembrano Sony WH-1000XM5.', 'new-a'),
  ])
  assert.ok(latest)
  assert.match(latest.summary, /Sony/)
  assert.equal(latest.sourceTurnId, 'new-a')

  // Stale vision buried under long text — not reused
  const filler = []
  for (let i = 0; i < VISION_SEARCH_CONTEXT_WINDOW + 3; i += 1) {
    filler.push({ role: 'user', content: `msg ${i}` }, asst(`ok ${i}`, `fa${i}`))
  }
  assert.equal(
    selectLatestVisionSearchContext([imgUser('old'), asst('old vision'), ...filler]),
    null,
  )
  assert.equal(hasRecentVisionContext(sonyThread), true)

  // Immediate Search follow-up preserves referent
  const afterSearch = [
    ...sonyThread,
    { role: 'user', content: 'Cercalo online.' },
    asst('Sul web risultano cuffie Sony WH-1000XM5…', 'a-search'),
    { role: 'user', content: 'E quanto costa?' },
  ]
  const follow = selectLatestVisionSearchContext(afterSearch)
  assert.ok(follow)
  assert.match(follow.summary, /Sony/)
  const priceQ = buildVisionSearchQuery({
    kind: 'price',
    userMessage: 'E quanto costa?',
    vision: follow,
  })
  assert.match(priceQ.query.toLowerCase(), /sony/)
}

// ——— Privacy ———
{
  const ctx = selectLatestVisionSearchContext(sonyThread)
  const built = buildVisionSearchQuery({
    kind: 'generic_lookup',
    userMessage: 'Cercalo',
    vision: {
      ...ctx,
      visibleText: 'Mario Rossi CF: RSSMRA80A01H501U via Privata 12',
    },
  })
  // Generic lookup must NOT auto-dump sensitive OCR
  assert.equal(built.usedVisibleText, false)
  assert.ok(!/RSSMRA|Privata|Mario Rossi CF/i.test(built.query))

  // Context object never carries data URLs
  const serialized = JSON.stringify(ctx)
  assert.ok(!/data:image|base64/i.test(serialized))

  // Query / appendix never include raw image bytes
  const appendix = buildVisionSearchAppendix({
    query: built.query,
    kind: 'generic_lookup',
    uncertain: false,
    visionSummary: ctx.summary,
  })
  assert.ok(!/base64|data:image/i.test(appendix))
}

// ——— Diagnostics ———
{
  const diag = buildVisionSearchDiagPayload({
    requestId: 'req_test',
    visionContextFound: true,
    sourceVisionTurnId: 'a1',
    visualEntityAvailable: true,
    visualSearchIntent: 'generic_lookup',
    generatedSearchQuery: 'Sony WH-1000XM5',
    existingSearchInvoked: true,
    searchResultCount: 2,
    searchContextSentToModel: true,
    finalResponseReceived: true,
    failureCode: null,
    webSearchUsed: true,
    env: { VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_SHA: 'abcdef1234567' },
  })
  assert.equal(diag.route, 'vision-search')
  assert.equal(diag.diagBuild, VISION_SEARCH_DIAG_BUILD)
  assert.equal(diag.buildId, 'abcdef1')
  assert.ok(!('rawImage' in diag))
  assert.equal(
    isVisionSearchDiagEnabled(
      { headers: { 'x-shinkaido-vision-search-diag': '1' } },
      {},
      { VERCEL_ENV: 'preview' },
    ),
    true,
  )
  assert.equal(
    isVisionSearchDiagEnabled(
      { headers: { 'x-shinkaido-vision-search-diag': '1' } },
      {},
      { VERCEL_ENV: 'production' },
    ),
    false,
  )
}

// ——— Regression: normal search / vision / chat paths untouched ———
{
  assert.equal(detectExplicitWebSearchIntent('Cerca sul web le novità su OpenAI'), 'require')
  assert.equal(detectExplicitWebSearchIntent("Cos'è un inverter?"), null)

  // Text-only "Dimmi di più" without vision → not vision-search
  assert.equal(routeVisionSearchIntent('Dimmi di più', { messages: [] }).intent, 'none')

  // detectVisionSearchIntent returns route object
  const r = detectVisionSearchIntent('Cercalo', { messages: sonyThread })
  assert.equal(r.intent, 'vision_search')

  // Calendar / Email packs must not be imported by vision-search modules
  for (const file of [
    'vision-search-context.js',
    'vision-search-intent.js',
    'vision-search-query.js',
    'vision-search-diag.js',
  ]) {
    const src = fs.readFileSync(path.join(root, file), 'utf8')
    assert.ok(!/calendar-chat|email-gmail|email-oauth|gmail/i.test(src), file)
  }

  // chat.ts wires forceWebSearch + vision bridge (no reverse-image)
  const chatSrc = fs.readFileSync(path.join(repoRoot, 'api/chat.ts'), 'utf8')
  assert.match(chatSrc, /vision-search/)
  assert.match(chatSrc, /forceWebSearch/)
  assert.match(chatSrc, /buildVisionSearchQuery/)
  // Phase #312: text query only — comment may mention reverse-image as out-of-scope.
  assert.match(chatSrc, /no reverse-image upload/i)
  assert.ok(!/google lens api|lens\.google/i.test(chatSrc))

  // UI action present
  const actionsSrc = fs.readFileSync(
    path.join(repoRoot, 'src/components/chat/MessageActions.tsx'),
    'utf8',
  )
  assert.match(actionsSrc, /showVisionSearch/)
  assert.match(actionsSrc, /IconSearch/)
}

console.log('vision-search.test.mjs: all assertions passed')
