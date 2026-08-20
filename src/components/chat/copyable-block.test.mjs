/**
 * #331 — Copyable block helpers / toast wiring (deterministic).
 * Run: node src/components/chat/copyable-block.test.mjs
 */
import assert from 'node:assert/strict'
import {
  COPY_TOAST_DEFAULT,
  LONG_QUOTE_COPY_CHARS,
  showCopyToast,
  subscribeCopyToast,
} from '../../lib/copyFeedback.js'

assert.equal(LONG_QUOTE_COPY_CHARS, 300)
assert.equal(COPY_TOAST_DEFAULT, 'Copied to clipboard')

{
  const seen = []
  const unsub = subscribeCopyToast((msg) => seen.push(msg))
  showCopyToast()
  showCopyToast('Custom')
  unsub()
  showCopyToast('After unsub')
  assert.deepEqual(seen, ['Copied to clipboard', 'Custom'])
}

console.log('copyable-block.test.mjs: ok')
