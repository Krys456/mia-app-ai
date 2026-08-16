/**
 * #271 Composer draft model + lifecycle helpers
 * Run: node --experimental-strip-types src/components/chat/composer-draft.test.mjs
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const typesPath = path.resolve('src/components/chat/composerTypes.ts')

async function loadTypes() {
  try {
    const esbuild = await import('esbuild')
    const outfile = path.join(os.tmpdir(), `composer-types-${Date.now()}.mjs`)
    await esbuild.build({
      entryPoints: [typesPath],
      outfile,
      bundle: false,
      format: 'esm',
      platform: 'neutral',
      target: 'es2022',
    })
    return await import(pathToFileURL(outfile).href)
  } catch {
    const ts = await import('typescript')
    const source = fs.readFileSync(typesPath, 'utf8')
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
      fileName: 'composerTypes.ts',
    })
    const outfile = path.join(os.tmpdir(), `composer-types-${Date.now()}.mjs`)
    fs.writeFileSync(outfile, outputText)
    return await import(pathToFileURL(outfile).href)
  }
}

const mod = await loadTypes()
const { EMPTY_COMPOSER_DRAFT, createEmptyComposerDraft, composerDraftHasText } = mod

assert.deepEqual(EMPTY_COMPOSER_DRAFT, { text: '', attachments: [] })
assert.deepEqual(createEmptyComposerDraft(), { text: '', attachments: [] })
assert.equal(composerDraftHasText({ text: '', attachments: [] }), false)
assert.equal(composerDraftHasText({ text: '   ', attachments: [] }), false)
assert.equal(composerDraftHasText({ text: 'ciao', attachments: [] }), true)
assert.equal(composerDraftHasText({ text: '  ciao  ', attachments: [] }), true)

// Attachments array exists but stays empty in #271 contract
const empty = createEmptyComposerDraft()
assert.ok(Array.isArray(empty.attachments))
assert.equal(empty.attachments.length, 0)

console.log('ok: #271 composer draft model')
