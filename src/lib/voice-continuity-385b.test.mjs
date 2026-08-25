/**
 * #385B — Voice Mode conversational continuity (auto-listen after TTS).
 * Run: node src/lib/voice-continuity-385b.test.mjs
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const root = process.cwd()
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')

async function loadTs(rel) {
  const entry = path.resolve(rel)
  const esbuild = await import('esbuild')
  const outfile = path.join(os.tmpdir(), `v385b-${Date.now()}-${Math.random()}.mjs`)
  await esbuild.build({
    entryPoints: [entry],
    outfile,
    bundle: false,
    format: 'esm',
    platform: 'neutral',
    target: 'es2022',
  })
  return await import(pathToFileURL(outfile).href)
}

const continuity = await loadTs('src/lib/voiceContinuity.ts')
const { shouldAutoListenAfterSpeech, VOICE_CONTINUITY_TRANSITIONS } = continuity

const { detectCalendarIntent } = await import(
  pathToFileURL(path.resolve('src/lib/calendar-chat/intent.js')).href,
)
const { detectEmailIntent } = await import(
  pathToFileURL(path.resolve('src/lib/email-chat/intent.js')).href,
)
const { detectReminderIntent } = await import(
  pathToFileURL(path.resolve('src/lib/reminder-chat/intent.js')).href,
)

const hook = read('src/components/chat/useVoiceMode.ts')
const bar = read('src/components/chat/VoiceModeBar.tsx')
const shell = read('src/components/chat/ComposerShell.tsx')
const listen = read('src/lib/voiceListening.ts')
const dictation = read('src/components/chat/useSpeechDictation.ts')

const baseOk = {
  voiceActive: true,
  continuousEnabled: true,
  turnMatches: true,
  needsManualPlay: false,
  hasPendingUnplayedAudio: false,
  recognitionOwned: false,
  sendLocked: false,
  chatBusy: false,
}

// ---------------------------------------------------------------------------
// Pure gate — TTS ended → auto-listen
// ---------------------------------------------------------------------------
assert.equal(shouldAutoListenAfterSpeech(baseOk), true)

// Repeated conversation cycles stay allowed while active + continuous.
assert.equal(shouldAutoListenAfterSpeech({ ...baseOk }), true)
assert.equal(shouldAutoListenAfterSpeech({ ...baseOk }), true)

// Close during TTS / processing → no restart
assert.equal(shouldAutoListenAfterSpeech({ ...baseOk, voiceActive: false }), false)

// Stop → continuous paused → no unexpected restart
assert.equal(shouldAutoListenAfterSpeech({ ...baseOk, continuousEnabled: false }), false)

// Stale callback after close / turn change → ignored
assert.equal(shouldAutoListenAfterSpeech({ ...baseOk, turnMatches: false }), false)
assert.equal(
  shouldAutoListenAfterSpeech({ ...baseOk, voiceActive: false, turnMatches: false }),
  false,
)

// Autoplay blocked → no microphone restart before manual playback
assert.equal(shouldAutoListenAfterSpeech({ ...baseOk, needsManualPlay: true }), false)
assert.equal(
  shouldAutoListenAfterSpeech({
    ...baseOk,
    needsManualPlay: true,
    hasPendingUnplayedAudio: true,
  }),
  false,
)

// After manual play path clears pending flags → auto-listen allowed
assert.equal(
  shouldAutoListenAfterSpeech({
    ...baseOk,
    needsManualPlay: false,
    hasPendingUnplayedAudio: false,
  }),
  true,
)

// Recognition already owns mic → no duplicate start
assert.equal(shouldAutoListenAfterSpeech({ ...baseOk, recognitionOwned: true }), false)

// Send / chat busy → wait
assert.equal(shouldAutoListenAfterSpeech({ ...baseOk, sendLocked: true }), false)
assert.equal(shouldAutoListenAfterSpeech({ ...baseOk, chatBusy: true }), false)

// State machine arcs documented
assert.ok(VOICE_CONTINUITY_TRANSITIONS.includes('speaking→listening'))
assert.ok(VOICE_CONTINUITY_TRANSITIONS.includes('ANY→closed'))
assert.ok(VOICE_CONTINUITY_TRANSITIONS.includes('processing→needsManualPlay'))

// ---------------------------------------------------------------------------
// Hook wiring contracts (#385B)
// ---------------------------------------------------------------------------
assert.match(hook, /shouldAutoListenAfterSpeech/)
assert.match(hook, /scheduleAutoListen/)
assert.match(hook, /cancelScheduledAutoListen|autoListenGenRef/)
assert.match(hook, /audio\.onended[\s\S]*scheduleAutoListen/)
assert.match(hook, /continuousListening|continuousRef|setContinuous/)
assert.match(hook, /stopSpeaking[\s\S]*setContinuous\(false\)/)
assert.match(hook, /activeRef\.current = false/)
assert.match(hook, /exit[\s\S]*cancelScheduledAutoListen/)
assert.match(hook, /needsManualPlay[\s\S]*Tocca Riproduci/)
assert.match(hook, /setManualPlayFlag\(true\)/)
assert.doesNotMatch(
  hook,
  /setManualPlayFlag\(true\)[\s\S]{0,80}scheduleAutoListen/,
)
// Autoplay catch must cancel auto-listen, not schedule it.
assert.match(hook, /Autoplay blocked[\s\S]*cancelScheduledAutoListen/)

// Fatal STT → error, no restart loop (no scheduleAutoListen in onError)
{
  const onErrorBlock = hook.slice(hook.indexOf('onError: (code)'), hook.indexOf('onEnd:'))
  assert.match(onErrorBlock, /cancelScheduledAutoListen/)
  assert.match(onErrorBlock, /setPhase\('error'\)/)
  assert.doesNotMatch(onErrorBlock, /scheduleAutoListen/)
}

// TTS failure → recoverable error (cancel auto-listen; do not schedule from catch body)
{
  const speakFn = hook.slice(
    hook.indexOf('const speakAssistantText'),
    hook.indexOf('// After Core finishes a voice-originated turn'),
  )
  assert.match(speakFn, /catch \(err\)/)
  assert.match(speakFn, /setPhase\('error'\)/)
  assert.match(speakFn, /cancelScheduledAutoListen\(\)/)
  // The catch body itself must not call scheduleAutoListen(
  const catchBody = speakFn.slice(speakFn.lastIndexOf('catch (err)'))
  const catchOnly = catchBody.slice(0, catchBody.indexOf('},'))
  assert.doesNotMatch(catchOnly, /scheduleAutoListen\(/)
}

// Duplicate startListening prevented
assert.match(hook, /if \(sessionRef\.current\) return/)
assert.match(hook, /startListeningRef/)

// Still sendMessage pipeline — no parallel router / Realtime / server STT
assert.match(hook, /sendMessage\(finalText\)/)
assert.doesNotMatch(hook, /modality:\s*['"]voice['"]/)
assert.doesNotMatch(hook, /Realtime|WebRTC|MediaRecorder|getUserMedia|Whisper/i)
assert.doesNotMatch(hook, /detectCalendarIntent|detectEmailIntent|detectReminderIntent/)

// Android slot ownership preserved in voiceListening
assert.match(listen, /applySpeechRecognitionEvent/)
assert.match(listen, /resultIndex/)
assert.match(listen, /continuous = false/)

// Dictation suspended while Voice Mode owns mic; works after close (shell)
assert.match(shell, /suspended: chatSuspended \|\| settingsOpen \|\| voice\.active/)
assert.match(shell, /continuousListening=\{voice\.continuousListening\}/)
assert.match(dictation, /useSpeechDictation/)
assert.doesNotMatch(dictation, /sendMessage/)

// UI: pause label after Stop; keep VoiceModeBar
assert.match(bar, /In pausa — tocca Ascolta/)
assert.match(bar, /continuousListening/)
assert.match(bar, /Ti ascolto/)
assert.match(bar, /Sto parlando/)

// ---------------------------------------------------------------------------
// Routing still utterance → existing detectors (spoken text samples)
// ---------------------------------------------------------------------------
assert.equal(
  detectCalendarIntent("What's on my calendar today?", { languageHint: 'en' }).intent !== 'none',
  true,
)
assert.equal(
  detectEmailIntent('Do I have unread emails?', { languageHint: 'en' }).intent !== 'none',
  true,
)
{
  const rem = detectReminderIntent('Remind me in ten minutes to drink water', {
    languageHint: 'en',
  })
  assert.ok(rem && rem.intent && rem.intent !== 'none', JSON.stringify(rem))
}

console.log('ok: #385B voice continuity auto-listen gates')
