/**
 * #356B — Voice hardening + spoken capability verification (no rebuild).
 * Run: node src/lib/voice-hardening-356b.test.mjs
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
  const esbuild = await import('esbuild')
  const outfile = path.join(os.tmpdir(), `vh356b-${Date.now()}-${Math.random()}.mjs`)
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
}

const speech = await loadTs('src/lib/speechRecognition.ts')
const voiceListen = await loadTs('src/lib/voiceListening.ts', { bundle: true })
const { detectCalendarIntent } = await import(
  pathToFileURL(path.resolve('src/lib/calendar-chat/intent.js')).href
)
const { detectEmailIntent } = await import(
  pathToFileURL(path.resolve('src/lib/email-chat/intent.js')).href
)
const { detectPlacesIntent, detectPlacesFollowUp } = await import(
  pathToFileURL(path.resolve('src/lib/places-chat/intent.js')).href
)
const { detectWeatherIntent } = await import(
  pathToFileURL(path.resolve('src/lib/weather/intent.js')).href
)

const {
  friendlySpeechError,
  isSpeechRecognitionSupported,
  isSpeechRecognitionApiPresent,
  isLikelyIosWebkitSpeech,
  normalizeSpeechErrorCode,
} = speech
const { buildFinalVoiceTranscript, emptySpeechTranscriptState, applySpeechRecognitionEvent } =
  voiceListen

const hook = read('src/components/chat/useVoiceMode.ts')
const dictation = read('src/components/chat/useSpeechDictation.ts')
const shell = read('src/components/chat/ComposerShell.tsx')
const micBtn = read('src/components/chat/ComposerMicrophoneButton.tsx')
const voiceBtn = read('src/components/chat/VoiceModeButton.tsx')
const voiceBar = read('src/components/chat/VoiceModeBar.tsx')
const voiceBarCss = read('src/components/chat/VoiceModeBar.css')
const listenSrc = read('src/lib/voiceListening.ts')
const speechSrc = read('src/lib/speechRecognition.ts')
const ttsApi = read('src/lib/ttsApi.ts')
const apiTts = read('api/tts.ts')
const vercel = read('vercel.json')
const privacy = read('src/lib/privacyCopy.ts')
const privacyPage = read('src/pages/PrivacyData.tsx')
const chatContext = read('src/context/ChatContext.tsx')

// ---------------------------------------------------------------------------
// Function budget — still 11 Vercel functions; api/tts already counted
// ---------------------------------------------------------------------------
{
  const fnKeys = [...vercel.matchAll(/"api\/[^"]+\.ts"/g)].map((m) => m[0])
  assert.equal(fnKeys.length, 13, `expected 13 vercel functions, got ${fnKeys.length}`)
  assert.ok(fnKeys.includes('"api/tts.ts"'))
  assert.doesNotMatch(vercel, /api\/stt|api\/voice|api\/whisper|api\/realtime/i)
}

// ---------------------------------------------------------------------------
// No rebuild / no new STT / no capability-specific Voice routers
// ---------------------------------------------------------------------------
assert.doesNotMatch(hook, /Realtime|WebRTC|MediaRecorder|getUserMedia|Whisper|wake\s*word/i)
assert.doesNotMatch(listenSrc, /Realtime|WebRTC|MediaRecorder|getUserMedia|Whisper/i)
assert.doesNotMatch(dictation, /sendMessage/)
assert.doesNotMatch(hook, /modality:\s*['"]voice['"]/)
assert.doesNotMatch(hook, /detectCalendarIntent|detectEmailIntent|detectPlacesIntent|detectWeatherIntent/)
assert.match(hook, /sendMessage\(finalText\)/)
assert.match(hook, /sendLockRef/)

// ---------------------------------------------------------------------------
// State machine + TTS cancellation + duplicate prevention
// ---------------------------------------------------------------------------
assert.match(hook, /VoiceModePhase[\s\S]*idle[\s\S]*listening[\s\S]*processing[\s\S]*speaking[\s\S]*error/)
assert.match(hook, /turnIdRef\.current \+= 1/)
assert.match(hook, /ttsAbortRef\.current\?\.abort/)
assert.match(hook, /URL\.revokeObjectURL|releaseObjectUrl/)
assert.match(hook, /clearError[\s\S]*p === 'error' \? 'idle'/)
assert.match(hook, /if \(sendLockRef\.current\) return/)
assert.match(hook, /setPhase\('processing'\)/)
assert.match(hook, /stopSpeaking/)

// ---------------------------------------------------------------------------
// Dictation vs Voice Mode clarity
// ---------------------------------------------------------------------------
assert.match(micBtn, /Dettatura: scrive nel campo, poi invii tu/)
assert.match(voiceBtn, /Modalità vocale: ascolta, invia e risponde a voce/)
assert.match(shell, /dictation\.supported/)
assert.match(shell, /voice\.supported/)
assert.match(shell, /showMic/)
assert.match(shell, /showVoiceEntry/)

// ---------------------------------------------------------------------------
// Accessibility — interim not in live spam; touch targets; reduced motion
// ---------------------------------------------------------------------------
assert.match(voiceBar, /aria-hidden="true"/)
assert.match(voiceBar, /aria-live="polite"/)
assert.match(voiceBarCss, /--touch-min/)
assert.match(voiceBarCss, /prefers-reduced-motion/)
assert.match(shell, /Modalità vocale: in ascolto/)
assert.match(shell, /Modalità vocale: elaborazione/)
assert.match(shell, /Modalità vocale: riproduzione/)

// ---------------------------------------------------------------------------
// iOS / unsupported — feature detect + unreliable iOS hide path
// ---------------------------------------------------------------------------
assert.equal(isSpeechRecognitionSupported(), false) // Node
assert.equal(isSpeechRecognitionApiPresent(), false)
assert.equal(typeof isLikelyIosWebkitSpeech(), 'boolean')
assert.match(speechSrc, /isLikelyIosWebkitSpeech/)
assert.match(hook, /Modalità vocale non disponibile|non supportata/)
assert.doesNotMatch(shell, /Coming soon/)

// ---------------------------------------------------------------------------
// Error copy surfaces
// ---------------------------------------------------------------------------
assert.match(friendlySpeechError('network', 'dictation'), /Dettatura/)
assert.match(friendlySpeechError('network', 'voice'), /Ascolto|scrivere/)
assert.match(friendlySpeechError('no-speech', 'voice'), /Ascolta/)
assert.equal(friendlySpeechError('aborted', 'voice'), null)
assert.equal(normalizeSpeechErrorCode('not-allowed'), 'not-allowed')

// ---------------------------------------------------------------------------
// Android restart hardening present
// ---------------------------------------------------------------------------
assert.match(listenSrc, /setTimeout\(restart,\s*48\)/)
assert.match(listenSrc, /sessionGen|activeGen/)
assert.match(listenSrc, /finalEmitted/)

// ---------------------------------------------------------------------------
// Transcript rules — interim never sent without finalize; empty → error
// ---------------------------------------------------------------------------
{
  let state = emptySpeechTranscriptState()
  state = applySpeechRecognitionEvent(state, {
    resultIndex: 0,
    results: [{ isFinal: false, transcript: 'Ciao' }],
  })
  assert.equal(buildFinalVoiceTranscript(state), '')
  assert.equal(buildFinalVoiceTranscript(state, { includeInterim: true }), 'Ciao')
}
assert.match(hook, /if \(!finalText\)/)
assert.match(hook, /cancelListening[\s\S]*abort\(\)/)

// ---------------------------------------------------------------------------
// TTS path unchanged — OpenAI via /api/tts only
// ---------------------------------------------------------------------------
assert.match(ttsApi, /\/api\/tts/)
assert.match(apiTts, /gpt-4o-mini-tts|tts/)
assert.doesNotMatch(hook, /speechSynthesis/)
assert.doesNotMatch(ttsApi, /speechSynthesis/)

// ---------------------------------------------------------------------------
// Privacy — truthful Web Speech note; no raw audio persistence claims
// ---------------------------------------------------------------------------
assert.match(privacy, /PRIVACY_DISCLOSURE[\s\S]*voice:/)
assert.match(privacy, /Web Speech/)
assert.match(privacy, /non salva l’audio grezzo|non salva l'audio grezzo|non salva/)
assert.match(privacyPage, /PRIVACY_DISCLOSURE\.voice/)
assert.match(listenSrc, /does not persist raw microphone audio|Privacy/)

// ---------------------------------------------------------------------------
// Spoken capabilities — Voice reuses sendMessage; routers claim phrases
// (no Voice-specific Calendar/Gmail/Places code)
// ---------------------------------------------------------------------------
{
  const calendar = detectCalendarIntent('Cosa ho domani?', {})
  assert.equal(calendar.intent, 'calendar')

  const email = detectEmailIntent('Ho nuove email?', {})
  assert.equal(email.intent, 'email')

  const places = detectPlacesIntent('Trova una farmacia vicino a me.', {})
  assert.equal(places.intent, 'places')

  const weather = detectWeatherIntent('Che tempo fa?')
  assert.equal(weather.intent, 'weather')

  // Core / general chat: no capability steals "Come stai?"
  assert.equal(detectCalendarIntent('Come stai?', {}).intent, 'none')
  assert.equal(detectEmailIntent('Come stai?', {}).intent, 'none')
  assert.equal(detectPlacesIntent('Come stai?', {}).intent, 'none')
  assert.equal(detectWeatherIntent('Come stai?').intent, 'none')

  // Maps handoff follow-ups that Places already supports (frozen surface).
  assert.equal(detectPlacesFollowUp('il primo', { hasPlacesContext: true }).kind, 'select_index')
  assert.equal(detectPlacesFollowUp('portami lì', { hasPlacesContext: true }).kind, 'navigate')
  // Exact brief phrase "Portami alla prima." is not a Places follow-up today —
  // Voice still passes the transcript unchanged into sendMessage (Places freeze).
  assert.equal(detectPlacesFollowUp('Portami alla prima.', { hasPlacesContext: true }), false)
}

assert.match(chatContext, /applyCalendarIntent|resolveCalendarTurnClaim/)
assert.match(chatContext, /detectEmailIntent|applyEmailIntent/)
assert.match(chatContext, /detectPlacesIntent|applyPlacesIntent/)
assert.match(hook, /sendMessage\(finalText\)/)
assert.doesNotMatch(hook, /calendar-chat|email-chat|places-chat/)

// Freeze: this PR must not edit Calendar/Gmail/Places routers (wiring-only Voice).
assert.doesNotMatch(hook, /SHINKAIDO_CALENDAR|SHINKAIDO_EMAIL|PLACES_ENABLED/)

console.log('ok: #356B voice hardening + spoken capability verification')
