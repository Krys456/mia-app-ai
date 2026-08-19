/**
 * #291 hosted web_search helper contracts
 * Run: node lib/server/web-search.test.mjs
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  MAX_PUBLIC_CITATIONS,
  WEB_SEARCH_TOOL,
  buildSelectionSearchInstructions,
  buildWebSearchAppendix,
  buildWebSearchTools,
  detectExplicitWebSearchIntent,
  extractUrlCitations,
  modelSupportsWebSearchTool,
  responseUsedWebSearch,
  sanitizeCitationUrl,
} from './web-search.js'
import { buildCoreResponsesCreateParams } from './core-responses-params.js'
import { buildImageGenerationTools } from './image-generation.js'

const root = path.dirname(fileURLToPath(import.meta.url))

// A — tool config
assert.equal(WEB_SEARCH_TOOL.type, 'web_search')
assert.deepEqual(buildWebSearchTools('gpt-5.6-sol'), [WEB_SEARCH_TOOL])
assert.deepEqual(buildWebSearchTools('gpt-4o'), [])
assert.equal(modelSupportsWebSearchTool('gpt-5.6-sol'), true)
assert.equal(MAX_PUBLIC_CITATIONS, 5)

// B — explicit search
assert.equal(detectExplicitWebSearchIntent('Cerca sul web le ultime novità su OpenAI.'), 'require')
assert.equal(detectExplicitWebSearchIntent('Search the web for React releases'), 'require')
assert.equal(detectExplicitWebSearchIntent('Look this up online please'), 'require')
assert.equal(detectExplicitWebSearchIntent('Cerca: GPT-5.6'), 'require')

// C — stable / no explicit → null (model-led, not forced)
assert.equal(detectExplicitWebSearchIntent("Cos'è un inverter?"), null)
assert.equal(detectExplicitWebSearchIntent('Come funziona HTTP?'), null)

// D — explicit no-search
assert.equal(detectExplicitWebSearchIntent('Non cercare online. Cos\'è HTTP?'), 'forbid')
assert.equal(detectExplicitWebSearchIntent('Answer without browsing.'), 'forbid')
assert.equal(detectExplicitWebSearchIntent("Don't search the web for this."), 'forbid')

// E/F/G/H — citation extraction, dedupe, unsafe URL, malformed
{
  const response = {
    output: [
      { type: 'web_search_call', id: 'ws_1', status: 'completed', action: { type: 'search' } },
      {
        type: 'message',
        role: 'assistant',
        content: [
          {
            type: 'output_text',
            text: 'Hello',
            annotations: [
              {
                type: 'url_citation',
                url: 'https://example.com/a',
                title: 'Alpha',
                start_index: 0,
                end_index: 5,
              },
              {
                type: 'url_citation',
                url: 'https://example.com/a',
                title: 'Alpha dup',
              },
              {
                type: 'url_citation',
                url: 'javascript:alert(1)',
                title: 'Bad',
              },
              {
                type: 'url_citation',
                url: 'https://example.com/b',
                title: 'Beta',
              },
              { type: 'url_citation', url: 'not-a-url', title: 'Nope' },
              { type: 'other', url: 'https://example.com/c', title: 'Ignore' },
            ],
          },
        ],
      },
    ],
  }
  const citations = extractUrlCitations(response)
  assert.equal(citations.length, 2)
  assert.equal(citations[0].url, 'https://example.com/a')
  assert.equal(citations[1].title, 'Beta')
  assert.equal(responseUsedWebSearch(response), true)
  assert.equal(extractUrlCitations({ output: null }).length, 0)
  assert.equal(sanitizeCitationUrl('data:text/html,hi'), null)
  assert.equal(sanitizeCitationUrl('file:///etc/passwd'), null)
}

// I — LANGUAGE isolation guidance present; selected text not language authority
{
  const appendix = buildWebSearchAppendix()
  assert.match(appendix, /NOT language evidence/i)
  assert.match(appendix, /untrusted DATA/i)
  assert.match(appendix, /Proactive/i)
  const sel = buildSelectionSearchInstructions({
    selectedText: 'latest React',
    replyLanguage: 'it',
  })
  assert.match(sel, /Italian \(it\)/)
  assert.match(sel, /MUST use the web_search tool/)
}

// J — Memory non-pollution guidance
assert.match(buildWebSearchAppendix(), /not durable personal Memory/i)

// K/L — image tools still configured; both coexist
{
  const web = buildWebSearchTools('gpt-5.6-sol')
  const img = buildImageGenerationTools('gpt-5.6-sol')
  assert.equal(img[0]?.type, 'image_generation')
  const tools = [...web, ...img]
  assert.deepEqual(
    tools.map((t) => t.type),
    ['web_search', 'image_generation'],
  )
  const params = buildCoreResponsesCreateParams({
    model: 'gpt-5.6-sol',
    instructions: 'test',
    maxOutputTokens: 100,
    input: 'hi',
    tools,
    toolChoice: { type: 'web_search' },
  })
  assert.equal(params.stream, false)
  assert.deepEqual(params.reasoning, { effort: 'none' })
  assert.deepEqual(params.tool_choice, { type: 'web_search' })
  assert.ok(Array.isArray(params.tools) && params.tools.length === 2)
}

// M — no raw search JSON helpers that dump calls to client
{
  const src = fs.readFileSync(path.join(root, 'web-search.js'), 'utf8')
  assert.doesNotMatch(src, /JSON\.stringify\(.*web_search_call/)
  assert.match(src, /extractUrlCitations/)
}

// R/S — reasoning.none + stream:false already asserted above

// Chat wiring contracts
{
  const chat = fs.readFileSync(path.join(root, '../../api/chat.ts'), 'utf8')
  assert.match(chat, /buildWebSearchTools|buildWebSearchAppendix/)
  assert.match(chat, /extractUrlCitations/)
  assert.match(chat, /detectExplicitWebSearchIntent/)
  assert.match(chat, /citations/)
  assert.match(chat, /maxDuration:\s*120/)
  // #312 soft-fail retry may call responses.create a second time when Vision×Search upstream fails.
  assert.ok(((chat.match(/\.responses\.create\s*\(/g) || []).length) >= 1)
  assert.match(chat, /forceWebSearch|vision-search/)
}

{
  const selection = fs.readFileSync(path.join(root, '../../api/selection.ts'), 'utf8')
  assert.match(selection, /operation === 'search'/)
  assert.match(selection, /toolChoice:\s*\{\s*type:\s*'web_search'\s*\}/)
  assert.match(selection, /maxDuration:\s*60/)
  assert.match(selection, /extractUrlCitations/)
}

console.log('ok: #291 web-search helpers')
