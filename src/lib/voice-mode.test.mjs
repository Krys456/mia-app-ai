/**
 * #292 Voice Mode — indexed SpeechRecognition slot ownership + wiring
 * Run: node src/lib/voice-mode.test.mjs
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const root = process.cwd()
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')

async function loadTs(rel, { bundle = false } = {}) {
  const entry = path.resolve(rel)
  try {
    const esbuild = await import('esbuild')
    const outfile = path.join(os.tmpdir(), `voice-${Date.now()}-${Math.random()}.mjs`)
    await esbuild.build({
      entryPoints: [entry],
      outfile,
      bundle,
      format: 'esm',
      platform: 'neutral',
      target: 'es2022',
      ...(bundle ? { packages: 'external' } : {}),
    })
    return await import(pathToFileURL(outfile).href)
  } catch {
    const ts = await import('typescript')
    const source = fs.readFileSync(entry, 'utf8')
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
      fileName: path.basename(entry),
    })
    const outfile = path.join(os.tmpdir(), `voice-${Date.now()}-${Math.random()}.mjs`)
    fs.writeFileSync(outfile, outputText)
    return await import(pathToFileURL(outfile).href)
  }
}

const speechText = await loadTs('src/lib/speechText.ts')
const voiceListen = await loadTs('src/lib/voiceListening.ts', { bundle: true })
const { prepareSpeechText, TTS_MAX_INPUT_CHARS } = speechText
const {
  accumulateVoiceFinals,
  applySpeechRecognitionEvent,
  buildFinalVoiceTranscript,
  commitRecognitionCycle,
  emptySpeechTranscriptState,
  isSpeechRecognitionSupported,
  reduceSpeechRecognitionResults,
} = voiceListen

assert.equal(isSpeechRecognitionSupported(), false)

function play(events, initial = emptySpeechTranscriptState()) {
  let state = initial
  const displays = []
  for (const ev of events) {
    state = applySpeechRecognitionEvent(state, ev)
    displays.push(state.displayTranscript)
  }
  return { state, displays }
}

// ---------------------------------------------------------------------------
// A — Progressive same-slot hypothesis (EXACT Android Preview regression)
// ---------------------------------------------------------------------------
{
  const { displays, state } = play([
    { resultIndex: 0, results: [{ isFinal: false, transcript: "Cos'è" }] },
    { resultIndex: 0, results: [{ isFinal: false, transcript: "Cos'è un" }] },
    {
      resultIndex: 0,
      results: [{ isFinal: true, transcript: "Cos'è un inverter" }],
    },
  ])
  assert.deepEqual(displays, ["Cos'è", "Cos'è un", "Cos'è un inverter"])
  assert.equal(state.displayTranscript, "Cos'è un inverter")
  assert.equal(state.committedFinalTranscript, "Cos'è un inverter")
  assert.equal(buildFinalVoiceTranscript(state), "Cos'è un inverter")
  assert.doesNotMatch(state.displayTranscript, /Cos'è Cos'è/)
  assert.notEqual(state.displayTranscript, "Cos'è Cos'è un Cos'è un inverter")
}

// Same-slot progressive FINALS (Android may mark revisions final then revise again)
{
  const { state } = play([
    { resultIndex: 0, results: [{ isFinal: true, transcript: "Cos'è" }] },
    { resultIndex: 0, results: [{ isFinal: true, transcript: "Cos'è un" }] },
    {
      resultIndex: 0,
      results: [{ isFinal: true, transcript: "Cos'è un inverter" }],
    },
  ])
  assert.equal(state.displayTranscript, "Cos'è un inverter")
  assert.equal(state.slots.length, 1)
  assert.notEqual(state.displayTranscript, "Cos'è Cos'è un Cos'è un inverter")
}

// ---------------------------------------------------------------------------
// B — Re-emitted final slot must not append again when resultIndex advances
// ---------------------------------------------------------------------------
{
  const { state } = play([
    {
      resultIndex: 0,
      results: [{ isFinal: true, transcript: "Cos'è un inverter" }],
    },
    {
      resultIndex: 1,
      results: [
        { isFinal: true, transcript: "Cos'è un inverter" },
        { isFinal: false, transcript: 'collegato' },
      ],
    },
  ])
  assert.equal(state.slots[0].transcript, "Cos'è un inverter")
  assert.equal(state.slots[1].transcript, 'collegato')
  assert.equal(state.displayTranscript, "Cos'è un inverter collegato")
  // Slot 0 appears once
  assert.equal(
    state.displayTranscript.match(/Cos'è un inverter/g)?.length,
    1,
  )
}

// ---------------------------------------------------------------------------
// C — Multiple genuine final slots
// ---------------------------------------------------------------------------
{
  const { state } = play([
    { resultIndex: 0, results: [{ isFinal: true, transcript: "Cos'è un inverter" }] },
    {
      resultIndex: 1,
      results: [
        { isFinal: true, transcript: "Cos'è un inverter" },
        { isFinal: true, transcript: 'e come funziona' },
      ],
    },
  ])
  assert.equal(state.displayTranscript, "Cos'è un inverter e come funziona")
}

// ---------------------------------------------------------------------------
// D / E — Legitimate repeated words / phrases preserved (no string-dedupe)
// ---------------------------------------------------------------------------
{
  const { state } = play([
    {
      resultIndex: 0,
      results: [{ isFinal: true, transcript: 'È molto molto importante.' }],
    },
  ])
  assert.equal(state.committedFinalTranscript, 'È molto molto importante.')
  assert.match(state.committedFinalTranscript, /molto molto/)
}
{
  const { state } = play([
    { resultIndex: 0, results: [{ isFinal: true, transcript: 'no no aspetta' }] },
  ])
  assert.equal(state.displayTranscript, 'no no aspetta')
}
{
  const { state } = play([
    { resultIndex: 0, results: [{ isFinal: true, transcript: 'che che cosa?' }] },
  ])
  assert.equal(state.displayTranscript, 'che che cosa?')
}

// ---------------------------------------------------------------------------
// F — Interim replacement on same slot
// ---------------------------------------------------------------------------
{
  const { displays, state } = play([
    { resultIndex: 0, results: [{ isFinal: true, transcript: 'Ciao' }] },
    {
      resultIndex: 1,
      results: [
        { isFinal: true, transcript: 'Ciao' },
        { isFinal: false, transcript: 'come' },
      ],
    },
    {
      resultIndex: 1,
      results: [
        { isFinal: true, transcript: 'Ciao' },
        { isFinal: false, transcript: 'come funziona' },
      ],
    },
    {
      resultIndex: 1,
      results: [
        { isFinal: true, transcript: 'Ciao' },
        { isFinal: false, transcript: 'come funziona il fotovoltaico' },
      ],
    },
  ])
  assert.equal(displays[1], 'Ciao come')
  assert.equal(displays[2], 'Ciao come funziona')
  assert.equal(state.displayTranscript, 'Ciao come funziona il fotovoltaico')
  assert.doesNotMatch(state.displayTranscript, /come come/)
}

// ---------------------------------------------------------------------------
// G — final → new slot
// ---------------------------------------------------------------------------
{
  const { state } = play([
    { resultIndex: 0, results: [{ isFinal: true, transcript: 'Ciao' }] },
    {
      resultIndex: 1,
      results: [
        { isFinal: true, transcript: 'Ciao' },
        { isFinal: true, transcript: 'come stai' },
      ],
    },
  ])
  assert.equal(state.displayTranscript, 'Ciao come stai')
}

// ---------------------------------------------------------------------------
// H — stop while interim exists → flush interim into send payload
// ---------------------------------------------------------------------------
{
  const state = reduceSpeechRecognitionResults([
    { isFinal: true, transcript: 'Ciao' },
    { isFinal: false, transcript: 'LAIfe' },
  ])
  assert.equal(buildFinalVoiceTranscript(state), 'Ciao')
  assert.equal(buildFinalVoiceTranscript(state, { includeInterim: true }), 'Ciao LAIfe')
}

// ---------------------------------------------------------------------------
// I — cancel / empty session
// ---------------------------------------------------------------------------
{
  let state = play([
    { resultIndex: 0, results: [{ isFinal: false, transcript: "Cos'è" }] },
  ]).state
  state = emptySpeechTranscriptState()
  assert.equal(state.displayTranscript, '')
  assert.equal(state.slots.length, 0)
  assert.equal(buildFinalVoiceTranscript(state, { includeInterim: true }), '')
}

// Cycle commit (continuous:false restart boundary) then new slot
{
  let state = play([
    { resultIndex: 0, results: [{ isFinal: true, transcript: 'Primo' }] },
  ]).state
  state = commitRecognitionCycle(state)
  assert.equal(state.committedCycles.join(' '), 'Primo')
  assert.equal(state.slots.length, 0)
  state = play(
    [{ resultIndex: 0, results: [{ isFinal: true, transcript: 'Secondo' }] }],
    state,
  ).state
  assert.equal(state.displayTranscript, 'Primo Secondo')
  assert.equal(buildFinalVoiceTranscript(state), 'Primo Secondo')
}

// ---------------------------------------------------------------------------
// Forbidden concatenation regression (join-all-finals without slot replace)
// ---------------------------------------------------------------------------
{
  // Simulate the broken approach: treat every progressive final as a new segment
  // when Android revises slot 0 in place (resultIndex always 0, length 1).
  const events = [
    { resultIndex: 0, results: [{ isFinal: true, transcript: "Cos'è" }] },
    { resultIndex: 0, results: [{ isFinal: true, transcript: "Cos'è un" }] },
    {
      resultIndex: 0,
      results: [{ isFinal: true, transcript: "Cos'è un inverter" }],
    },
  ]
  let buggy = ''
  for (const ev of events) {
    // BUG: append previous finals string + current finals (old #292 behavior family)
    const joined = ev.results.map((r) => r.transcript).join(' ')
    buggy = buggy ? `${buggy} ${joined}` : joined
  }
  assert.equal(buggy, "Cos'è Cos'è un Cos'è un inverter")

  const fixed = play(events).state.displayTranscript
  assert.equal(fixed, "Cos'è un inverter")
}

assert.deepEqual(accumulateVoiceFinals('ciao', 'mondo', true), {
  finals: 'ciao mondo',
  interim: '',
})

assert.equal(TTS_MAX_INPUT_CHARS, 1200)
assert.match(prepareSpeechText('Vedi https://x.com'), /Vedi/)

const hook = read('src/components/chat/useVoiceMode.ts')
const listen = read('src/lib/voiceListening.ts')
const shell = read('src/components/chat/ComposerShell.tsx')
const btn = read('src/components/chat/VoiceModeButton.tsx')
const apiChat = read('api/chat.ts')

// J — exactly-once send + stale-session guards
assert.match(hook, /sendLockRef/)
assert.match(hook, /if \(sendLockRef\.current\) return/)
assert.match(hook, /listenGenRef/)
assert.match(hook, /listenGenRef\.current !== listenGen/)
assert.match(listen, /sessionGen|activeGen/)
assert.match(listen, /finalEmitted/)
assert.match(listen, /continuous = false/)
assert.match(listen, /applySpeechRecognitionEvent/)
assert.match(listen, /resultIndex/)

// UI still icon-only waveform
assert.doesNotMatch(btn, />\s*Voce\s*|🎙|VOCE/)
assert.match(btn, /Avvia modalità vocale/)
assert.match(shell, /VoiceModeButton/)

// Core invariants
assert.equal((apiChat.match(/\.responses\.create\(/g) || []).length, 1)
assert.match(apiChat, /maxDuration:\s*120/)
assert.doesNotMatch(hook, /modality:\s*['"]voice['"]/)
assert.doesNotMatch(listen, /Realtime|WebRTC|MediaRecorder|getUserMedia/)

// No unsafe textual dedupe helpers
assert.doesNotMatch(listen, /startsWith\(|Set<string>|dedupeRepeated|uniqueWords/)

console.log('ok: #292 indexed SpeechRecognition slot ownership')
