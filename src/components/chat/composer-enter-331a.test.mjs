/**
 * #331A — Mobile Composer Enter / Send behavior
 * Run: node src/components/chat/composer-enter-331a.test.mjs
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')
const shell = read('src/components/chat/ComposerShell.tsx')
const shellCss = read('src/components/chat/ComposerShell.css')

/** Mirrors ComposerShell.composerEnterShouldSubmit */
function composerEnterShouldSubmit(event, finePointer) {
  return finePointer && event.key === 'Enter' && !event.shiftKey
}

// --- Pure behavior matrix ---
assert.equal(
  composerEnterShouldSubmit({ key: 'Enter', shiftKey: false }, false),
  false,
  'mobile Enter must NOT submit',
)
assert.equal(
  composerEnterShouldSubmit({ key: 'Enter', shiftKey: true }, false),
  false,
  'mobile Shift+Enter must NOT submit',
)
assert.equal(
  composerEnterShouldSubmit({ key: 'Enter', shiftKey: false }, true),
  true,
  'desktop Enter submits',
)
assert.equal(
  composerEnterShouldSubmit({ key: 'Enter', shiftKey: true }, true),
  false,
  'desktop Shift+Enter newline',
)
assert.equal(
  composerEnterShouldSubmit({ key: 'a', shiftKey: false }, true),
  false,
  'other keys never submit',
)

// --- Wiring in ComposerShell ---
assert.match(shell, /composerEnterShouldSubmit/)
assert.match(shell, /enterKeyHint=\{showKeyboardHint \? 'send' : 'enter'\}/)
assert.doesNotMatch(shell, /enterKeyHint="send"/)
assert.match(shell, /hover: hover\) and \(pointer: fine\)/)
assert.match(shell, /type="submit"/)
assert.match(shell, /composer__send/)
assert.match(shell, /Invia messaggio/)
assert.match(shell, /onSubmit=\{onSubmit\}/)
assert.match(shell, /e\.preventDefault\(\)/)
assert.match(shell, /void submit\(\)/)

// Desktop hint still documents Enter/Shift+Enter
assert.match(shell, /Invio per mandare · Shift\+Invio per andare a capo/)
assert.match(shellCss, /@media \(hover: hover\) and \(pointer: fine\)/)

// No UA sniffing
assert.doesNotMatch(shell, /userAgent|navigator\.platform|Android|iPhone|isMobile\s*=/)

// Visual Send control unchanged (single submit button class)
const sendBtnCount = (shell.match(/className=\{`composer__send/g) || []).length
assert.equal(sendBtnCount, 1, 'exactly one Composer Send button')

// Multisend guard still present
assert.match(shell, /composerDraftCanSend\(draft\) && !busy/)
assert.match(shell, /const accepted = sendMessage\(/)

console.log('ok: #331A composer enter / send behavior')
