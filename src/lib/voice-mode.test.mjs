/**
 * #292 Voice Mode — STT finalize, transcript reduction, UI, one-send guards
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
  emptySpeechTranscriptState,
  isSpeechRecognitionSupported,
  reduceSpeechRecognitionResults,
} = voiceListen

assert.equal(isSpeechRecognitionSupported(), false)

// ---------------------------------------------------------------------------
// Transcript event sequences (realistic cumulative Web Speech results)
// ---------------------------------------------------------------------------

function play(events) {
  let state = emptySpeechTranscriptState()
  const displays = []
  for (const ev of events) {
    state = applySpeechRecognitionEvent(state, ev)
    displays.push(state.displayTranscript)
  }
  return { state, displays }
}

// A — interim replacement (NOT append)
{
  const { displays, state } = play([
    { resultIndex: 0, results: [{ isFinal: false, transcript: "cos'è" }] },
    { resultIndex: 0, results: [{ isFinal: false, transcript: "cos'è un" }] },
    { resultIndex: 0, results: [{ isFinal: false, transcript: "cos'è un inverter" }] },
  ])
  assert.deepEqual(displays, ["cos'è", "cos'è un", "cos'è un inverter"])
  assert.equal(state.committedFinalTranscript, '')
  assert.equal(state.currentInterimTranscript, "cos'è un inverter")
}

// B — interim → final
{
  const { state } = play([
    { resultIndex: 0, results: [{ isFinal: false, transcript: "cos'è" }] },
    { resultIndex: 0, results: [{ isFinal: false, transcript: "cos'è un inverter" }] },
    { resultIndex: 0, results: [{ isFinal: true, transcript: "Cos'è un inverter?" }] },
  ])
  assert.equal(state.displayTranscript, "Cos'è un inverter?")
  assert.equal(state.committedFinalTranscript, "Cos'è un inverter?")
  assert.equal(state.currentInterimTranscript, '')
  assert.equal(buildFinalVoiceTranscript(state), "Cos'è un inverter?")
}

// C — repeated interim events with growing cumulative text must not duplicate
{
  const { displays } = play([
    { resultIndex: 0, results: [{ isFinal: false, transcript: "cos'è" }] },
    { resultIndex: 0, results: [{ isFinal: false, transcript: "cos'è" }] },
    { resultIndex: 0, results: [{ isFinal: false, transcript: "cos'è cos'è" }] }, // browser said this once
  ])
  // Our reducer must not turn single-index updates into "cos'è cos'è cos'è"
  assert.equal(displays[0], "cos'è")
  assert.equal(displays[1], "cos'è")
  assert.equal(displays[2], "cos'è cos'è")
}

// Regression: OLD buggy algorithm (seed previous finals + re-walk all) would explode.
{
  // Simulate the Preview bug sequence: same final re-included while interim updates.
  let buggy = ''
  const events = [
    [{ isFinal: false, transcript: "cos'è" }],
    [{ isFinal: false, transcript: "cos'è" }],
    [{ isFinal: true, transcript: "cos'è" }],
    [
      { isFinal: true, transcript: "cos'è" },
      { isFinal: false, transcript: "un" },
    ],
    [
      { isFinal: true, transcript: "cos'è" },
      { isFinal: false, transcript: "un inverter" },
    ],
  ]
  for (const results of events) {
    let nextFinals = buggy
    let nextInterim = ''
    for (const item of results) {
      if (item.isFinal) {
        nextFinals = nextFinals ? `${nextFinals} ${item.transcript}` : item.transcript
      } else {
        nextInterim = item.transcript
      }
    }
    buggy = nextFinals.replace(/\s+/g, ' ').trim()
    void nextInterim
  }
  assert.match(buggy, /cos'è cos'è/) // proves the old bug

  const fixed = play(
    events.map((results, i) => ({ resultIndex: i === 0 ? 0 : 0, results })),
  )
  assert.equal(fixed.state.committedFinalTranscript, "cos'è")
  assert.equal(fixed.state.currentInterimTranscript, 'un inverter')
  assert.equal(fixed.state.displayTranscript, "cos'è un inverter")
  assert.doesNotMatch(fixed.state.displayTranscript, /cos'è cos'è/)
}

// D — repeated final callback (same cumulative list) is idempotent
{
  const finalList = [{ isFinal: true, transcript: "Cos'è un inverter?" }]
  const { state } = play([
    { resultIndex: 0, results: finalList },
    { resultIndex: 0, results: finalList },
    { resultIndex: 0, results: finalList },
  ])
  assert.equal(state.committedFinalTranscript, "Cos'è un inverter?")
  assert.equal(buildFinalVoiceTranscript(state), "Cos'è un inverter?")
}

// E — multiple final segments (natural pause)
{
  const { state } = play([
    { resultIndex: 0, results: [{ isFinal: true, transcript: "Cos'è un inverter" }] },
    {
      resultIndex: 1,
      results: [
        { isFinal: true, transcript: "Cos'è un inverter" },
        { isFinal: false, transcript: 'e come' },
      ],
    },
    {
      resultIndex: 1,
      results: [
        { isFinal: true, transcript: "Cos'è un inverter" },
        { isFinal: true, transcript: 'e come funziona nel fotovoltaico?' },
      ],
    },
  ])
  assert.equal(
    state.committedFinalTranscript,
    "Cos'è un inverter e come funziona nel fotovoltaico?",
  )
  assert.equal(state.currentInterimTranscript, '')
}

// F — final + new interim
{
  const { state } = play([
    { resultIndex: 0, results: [{ isFinal: true, transcript: 'Il fotovoltaico' }] },
    {
      resultIndex: 1,
      results: [
        { isFinal: true, transcript: 'Il fotovoltaico' },
        { isFinal: false, transcript: 'come funziona' },
      ],
    },
  ])
  assert.equal(state.displayTranscript, 'Il fotovoltaico come funziona')
  assert.equal(state.committedFinalTranscript, 'Il fotovoltaico')
  assert.equal(state.currentInterimTranscript, 'come funziona')
}

// G — legitimate repeated words preserved
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

// H / I — cancel / empty session helpers
{
  const empty = emptySpeechTranscriptState()
  assert.equal(empty.displayTranscript, '')
  assert.equal(empty.committedFinalTranscript, '')
  assert.equal(buildFinalVoiceTranscript(empty), '')
  assert.equal(buildFinalVoiceTranscript(empty, { includeInterim: true }), '')
}

// Stop flush includes trailing interim once
{
  const state = reduceSpeechRecognitionResults([
    { isFinal: true, transcript: 'Ciao' },
    { isFinal: false, transcript: 'LAIfe' },
  ])
  assert.equal(buildFinalVoiceTranscript(state), 'Ciao')
  assert.equal(buildFinalVoiceTranscript(state, { includeInterim: true }), 'Ciao LAIfe')
}

// Legacy single-piece helper still sane
assert.deepEqual(accumulateVoiceFinals('', 'ciao', false), { finals: '', interim: 'ciao' })
assert.deepEqual(accumulateVoiceFinals('ciao', 'mondo', true), {
  finals: 'ciao mondo',
  interim: '',
})

// I — citation URLs not spoken
const spoken = prepareSpeechText(
  'Risposta utile.\n\nFonti:\n- https://example.com/a\n- [OpenAI](https://openai.com)',
)
assert.match(spoken, /Risposta utile/)
assert.doesNotMatch(spoken, /https?:\/\//)
assert.doesNotMatch(spoken, /Fonti/i)
assert.equal(TTS_MAX_INPUT_CHARS, 1200)

const hook = read('src/components/chat/useVoiceMode.ts')
const listen = read('src/lib/voiceListening.ts')
const shell = read('src/components/chat/ComposerShell.tsx')
const bar = read('src/components/chat/VoiceModeBar.tsx')
const btn = read('src/components/chat/VoiceModeButton.tsx')
const btnCss = read('src/components/chat/VoiceModeButton.css')
const chatContext = read('src/context/ChatContext.tsx')
const chatApi = read('src/lib/chatApi.ts')
const apiChat = read('api/chat.ts')
const ttsApi = read('src/lib/ttsApi.ts')
const ttsRoute = read('api/tts.ts')
const micBtn = read('src/components/chat/ComposerMicrophoneButton.tsx')

// Controller phases
assert.match(hook, /'idle'/)
assert.match(hook, /'listening'/)
assert.match(hook, /'processing'/)
assert.match(hook, /'speaking'/)
assert.match(hook, /'error'/)

// Interim never sent; finals sent once
assert.match(listen, /interimResults = true/)
assert.match(listen, /reduceSpeechRecognitionResults|applySpeechRecognitionEvent/)
assert.match(listen, /finalEmitted/)
assert.match(hook, /onInterim:\s*\(text\)\s*=>\s*setInterimText/)
assert.doesNotMatch(hook, /onInterim:[\s\S]{0,80}sendMessage/)
assert.match(hook, /sendLockRef/)
assert.match(hook, /if \(sendLockRef\.current\) return/)
assert.match(hook, /sendMessage\(finalText\)/)

// J / K / L — empty does not send; one-send; cancel clears
assert.match(hook, /Non ho sentito nulla/)
assert.match(hook, /cancelListening/)
assert.match(hook, /sessionRef\.current\?\.abort\(\)/)
assert.match(hook, /pendingSpeakRef\.current = null/)
assert.match(listen, /discarded = true/)
assert.match(listen, /emptySpeechTranscriptState/)

// G — API key not exposed
assert.doesNotMatch(ttsApi, /OPENAI_API_KEY/)
assert.match(ttsRoute, /process\.env\.OPENAI_API_KEY/)

// H — TTS uses visible assistant text
assert.match(hook, /speakAssistantText\(last\.content/)
assert.doesNotMatch(hook, /modality:\s*['"]voice['"]/)

// Memory / history
assert.doesNotMatch(chatContext, /voiceMode|ttsBlob|microphoneBlob|AudioBuffer/)
assert.doesNotMatch(hook, /kind:\s*['"]audio['"]|role:\s*['"]voice['"]/)

// Cleanup
assert.match(hook, /revokeObjectURL|releaseObjectUrl/)
assert.match(hook, /stopSpeaking/)
assert.match(hook, /Cleanup on unmount/)

// UI — no VOCE label; waveform icon; not a microphone; a11y
assert.doesNotMatch(btn, />\s*Voce\s*</)
assert.doesNotMatch(btn, /🎙|VOCE/)
assert.doesNotMatch(btnCss, /\.voice-mode-btn__text/)
assert.match(btn, /Avvia modalità vocale/)
assert.match(btn, /Modalità vocale attiva/)
assert.match(btn, /title="Avvia modalità vocale"/)
assert.match(btn, /Sound-wave|conversation-wave|strokeLinecap="round"/)
assert.doesNotMatch(btn, /M12 3a3 3 0 0 0-3 3v6|rect[\s\S]*microphone/i)
assert.match(micBtn, /Dettatura/)
assert.match(micBtn, /M12 3a3 3 0 0 0-3 3v6/)
assert.match(btnCss, /voice-mode-btn--active/)
assert.match(btnCss, /gradient-brand|glow-brand|accent-pink|theme-accent-3/)
assert.match(btnCss, /touch-min/)
assert.match(shell, /VoiceModeButton/)
assert.match(shell, /VoiceModeBar/)
assert.doesNotMatch(shell, /Modalità vocale attiva…/)
assert.match(bar, /Ti ascolto/)
assert.match(bar, /Sto elaborando/)
assert.match(bar, /Sto parlando/)
assert.match(bar, /Invia/)
assert.match(bar, /Annulla/)

// Dictation remains draft-only
assert.match(shell, /useSpeechDictation/)
assert.doesNotMatch(read('src/components/chat/useSpeechDictation.ts'), /sendMessage/)

// Core invariants
assert.equal((apiChat.match(/\.responses\.create\(/g) || []).length, 1)
assert.match(apiChat, /maxDuration:\s*120/)
assert.doesNotMatch(shell, /modality:\s*['"]voice['"]/)
assert.doesNotMatch(shell, /MediaRecorder|getUserMedia/)
assert.doesNotMatch(listen, /Realtime|WebRTC|MediaRecorder|getUserMedia/)

assert.match(hook, /needsManualPlay/)
assert.match(listen, /privacy|browser\/vendor|vendor/i)

console.log('ok: #292 voice mode contracts + transcript reduction')
