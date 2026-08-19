/**
 * #313 client active-document UI contracts.
 * Run: node src/lib/activeDocumentContext.test.mjs
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')

const ctx = read('src/lib/activeDocumentContext.ts')
const shell = read('src/components/chat/ComposerShell.tsx')
const chatCtx = read('src/context/ChatContext.tsx')
const chatApi = read('src/lib/chatApi.ts')
const diag = read('src/lib/documentDiag.ts')

assert.match(ctx, /deriveActiveDocumentFromMessages/)
assert.match(ctx, /ActiveDocumentContext/)
assert.match(shell, /documento attivo/)
assert.match(shell, /clearActiveDocument/)
assert.match(shell, /showActiveDocChip/)
assert.match(chatCtx, /suppressDocReuseRef/)
assert.match(chatCtx, /suppressActiveDocumentReuse/)
assert.match(chatApi, /X-Shinkaido-Document-Diag/)
assert.match(chatApi, /documentDiag/)
assert.match(diag, /document_diag/)

// No Documents page
assert.equal(fs.existsSync(path.join(root, 'src/pages/Documents.tsx')), false)
assert.doesNotMatch(read('src/types.ts'), /'documents'/)

console.log('activeDocumentContext.test.mjs: ok')
