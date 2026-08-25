/**
 * #385D — Voice Mode tap-to-barge-in.
 * Run: node src/lib/voice-barge-in-385d.test.mjs
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
  const outfile = path.join(os.tmpdir(), `v385d-${Date.now()}-${Math.random()}.mjs`)
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
const { shouldAllowTapBargeIn, shouldAutoListenAfterSpeech, VOICE_CONTINUITY_TRANSITIONS } =
  continuity

const { detectEmailIntent } = await import(
  pathToFileURL(path.resolve('src/lib/email-chat/intent.js')).href,
)
const { detectCalendarIntent } = await import(
  pathToFileURL(path.resolve('src/lib/calendar-chat/intent.js')).href,
)

const hook = read('src/components/chat/useVoiceMode.ts')
const bar = read('src/components/chat/VoiceModeBar.tsx')
const shell = read('src/components/chat/ComposerShell.tsx')
const listen = read('src/lib/voiceListening.ts')
const dictation = read('src/components/chat/useSpeechDictation.ts')

// ---------------------------------------------------------------------------
// Pure barge-in gate
// ---------------------------------------------------------------------------
assert.equal(
  shouldAllowTapBargeIn({ voiceActive: true, phase: 'speaking', needsManualPlay: false }),
  true,
)
assert.equal(
  shouldAllowTapBargeIn({ voiceActive: false, phase: 'speaking', needsManualPlay: false }),
  false,
)
assert.equal(
  shouldAllowTapBargeIn({ voiceActive: true, phase: 'listening', needsManualPlay: false }),
  false,
)
assert.equal(
  shouldAllowTapBargeIn({ voiceActive: true, phase: 'processing', needsManualPlay: false }),
  false,
)
assert.equal(
  shouldAllowTapBargeIn({ voiceActive: true, phase: 'idle', needsManualPlay: false }),
  false,
)
assert.equal(
  shouldAllowTapBargeIn({ voiceActive: true, phase: 'speaking', needsManualPlay: true }),
  false,
)
assert.equal(
  shouldAllowTapBargeIn({ voiceActive: true, phase: 'idle', needsManualPlay: true }),
  false,
)

// #385B auto-listen still allowed after a normal (non-interrupted) TTS end
assert.equal(
  shouldAutoListenAfterSpeech({
    voiceActive: true,
    continuousEnabled: true,
    turnMatches: true,
    needsManualPlay: false,
    hasPendingUnplayedAudio: false,
    recognitionOwned: false,
    sendLocked: false,
    chatBusy: false,
  }),
  true,
)

// Stop still pauses continuity (gate false when continuousEnabled false)
assert.equal(
  shouldAutoListenAfterSpeech({
    voiceActive: true,
    continuousEnabled: false,
    turnMatches: true,
    needsManualPlay: false,
    hasPendingUnplayedAudio: false,
    recognitionOwned: false,
    sendLocked: false,
    chatBusy: false,
  }),
  false,
)

assert.ok(VOICE_CONTINUITY_TRANSITIONS.includes('speaking→listening'))
assert.ok(VOICE_CONTINUITY_TRANSITIONS.includes('speaking→idle'))

// ---------------------------------------------------------------------------
// Hook contracts — bargeIn ≠ stopSpeaking
// ---------------------------------------------------------------------------
assert.match(hook, /bargeIn/)
assert.match(hook, /#385D/)
assert.match(hook, /const bargeIn = useCallback/)
assert.match(hook, /if \(phase !== 'speaking'\) return/)
assert.match(hook, /bargeIn[\s\S]*startListening\(\)/)

// bargeIn must NOT call stopSpeaking / setContinuous(false)
{
  const bargeBlock = hook.slice(hook.indexOf('const bargeIn = useCallback'), hook.indexOf('const stopAndSend'))
  assert.match(bargeBlock, /startListening\(\)/)
  assert.doesNotMatch(bargeBlock, /stopSpeaking\(/)
  assert.doesNotMatch(bargeBlock, /setContinuous\(false\)/)
}

// stopSpeaking still pauses continuity
{
  const stopBlock = hook.slice(hook.indexOf('const stopSpeaking = useCallback'), hook.indexOf('const playBlob'))
  assert.match(stopBlock, /setContinuous\(false\)/)
  assert.match(stopBlock, /setPhase\('idle'\)/)
  assert.doesNotMatch(stopBlock, /startListening\(/)
}

// startListening teardown used by barge-in: turnId, cancel auto-listen, clearAudio, continuous on
assert.match(hook, /setContinuous\(true\)/)
assert.match(hook, /cancelScheduledAutoListen/)
assert.match(hook, /turnIdRef\.current \+= 1/)
assert.match(hook, /clearAudio\(\)/)
assert.match(hook, /if \(sessionRef\.current\) return/)

// Stale onended still turn-guarded
assert.match(hook, /audio\.onended[\s\S]*turnIdRef\.current !== turnId/)
assert.match(hook, /autoListenGenRef/)

// No automatic acoustic barge-in / VAD / Realtime / getUserMedia
assert.doesNotMatch(hook, /getUserMedia|AnalyserNode|VAD|Realtime|WebRTC|MediaRecorder|Whisper/i)
assert.doesNotMatch(bar, /getUserMedia|VAD|Realtime/i)

// Still sendMessage only — no voice router
assert.match(hook, /sendMessage\(finalText\)/)
assert.doesNotMatch(hook, /modality:\s*['"]voice['"]/)
assert.doesNotMatch(hook, /detectCalendarIntent|detectEmailIntent/)

// ---------------------------------------------------------------------------
// UI — Interrompi e parla primary; Stop secondary; needsManualPlay unchanged
// ---------------------------------------------------------------------------
assert.match(bar, /Interrompi e parla/)
assert.match(bar, /onBargeIn/)
assert.match(bar, /Tocca per parlare/)
assert.match(bar, /onStopSpeaking/)
assert.match(bar, />\s*Stop\s*</)
assert.match(bar, /Riproduci/)
assert.match(shell, /onBargeIn=\{voice\.bargeIn\}/)

// Dictation ownership preserved
assert.match(shell, /suspended: chatSuspended \|\| settingsOpen \|\| voice\.active/)
assert.doesNotMatch(dictation, /sendMessage/)
assert.match(listen, /applySpeechRecognitionEvent/)
assert.match(listen, /continuous = false/)

// Spoken routing still works for interrupted-turn examples
assert.ok(detectEmailIntent('Do I have unread emails?', { languageHint: 'en' }).intent !== 'none')
assert.ok(
  detectCalendarIntent("What's on my calendar today?", { languageHint: 'en' }).intent !== 'none',
)

console.log('ok: #385D voice tap-to-barge-in')
