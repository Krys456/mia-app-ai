/**
 * #386C — Client account deletion source contracts.
 * Run: node --test src/lib/account-deletion-386c.test.mjs
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const apiSrc = readFileSync(join(root, 'src/lib/accountDeletionApi.ts'), 'utf8')
const cleanSrc = readFileSync(join(root, 'src/lib/accountDeletionCleanup.ts'), 'utf8')
const panelSrc = readFileSync(join(root, 'src/components/AccountDeletionPanel.tsx'), 'utf8')

describe('#386C client confirmation contracts', () => {
  it('accepts ELIMINA / DELETE only', () => {
    assert.match(apiSrc, /t === 'ELIMINA' \|\| t === 'DELETE'/)
  })
  it('never sends user_id in request body', () => {
    assert.match(apiSrc, /confirm: confirmation\.trim\(\)/)
    assert.doesNotMatch(apiSrc, /user_id\s*:/)
    assert.doesNotMatch(apiSrc, /userId\s*:/)
  })
  it('UI kill switch documented', () => {
    assert.match(apiSrc, /VITE_ACCOUNT_DELETION_ENABLED/)
  })
})

describe('#386C client cleanup contracts', () => {
  it('clears laife/shinkaido keys', () => {
    assert.match(cleanSrc, /laife\.settings\.v2/)
    assert.match(cleanSrc, /clearAccountLocalState/)
    assert.match(cleanSrc, /startsWith\('laife\.'\)/)
    assert.match(cleanSrc, /startsWith\('shinkaido\.'\)/)
  })
})

describe('#386C deletion panel UX', () => {
  it('requires typed confirm and disables double submit', () => {
    assert.match(panelSrc, /isValidDeletionConfirmation/)
    assert.match(panelSrc, /disabled=\{busy \|\| !confirmOk\}/)
    assert.match(panelSrc, /requestAccountDeletion/)
    assert.match(panelSrc, /disableWebPush/)
    assert.match(panelSrc, /clearAccountLocalState/)
    assert.match(panelSrc, /signOutCurrentUser/)
    assert.match(panelSrc, /location\.assign\('\/'\)/)
  })
})

console.log('ok: #386C client account deletion contracts')
