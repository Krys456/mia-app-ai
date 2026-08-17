/**
 * #292 Voice Mode — STT finalize, one-send, wiring, privacy guards
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
      ...(bundle
        ? {
            packages: 'external',
          }
        : {}),
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
const { accumulateVoiceFinals, isSpeechRecognitionSupported } = voiceListen

// O — unsupported STT in Node
assert.equal(isSpeechRecognitionSupported(), false)

// B / C / D — accumulate finals; interim never merges into finals
assert.deepEqual(accumulateVoiceFinals('', 'ciao', false), { finals: '', interim: 'ciao' })
assert.deepEqual(accumulateVoiceFinals('', 'ciao', true), { finals: 'ciao', interim: '' })
assert.deepEqual(accumulateVoiceFinals('ciao', 'mondo', true), {
  finals: 'ciao mondo',
  interim: '',
})
assert.deepEqual(accumulateVoiceFinals('ciao', 'provvisorio', false), {
  finals: 'ciao',
  interim: 'provvisorio',
})

// I — citation URLs not spoken (client mirror)
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
const chatContext = read('src/context/ChatContext.tsx')
const chatApi = read('src/lib/chatApi.ts')
const apiChat = read('api/chat.ts')
const ttsApi = read('src/lib/ttsApi.ts')
const ttsRoute = read('api/tts.ts')

// A — controller phases
assert.match(hook, /'idle'/)
assert.match(hook, /'listening'/)
assert.match(hook, /'processing'/)
assert.match(hook, /'speaking'/)
assert.match(hook, /'error'/)

// B — interim never sent
assert.match(listen, /interimResults = true/)
assert.match(listen, /onInterim/)
assert.match(hook, /onInterim:\s*\(text\)\s*=>\s*setInterimText/)
assert.doesNotMatch(hook, /onInterim:[\s\S]{0,80}sendMessage/)

// C / D — one-send lock; duplicate finals ignored
assert.match(hook, /sendLockRef/)
assert.match(hook, /if \(sendLockRef\.current\) return/)
assert.match(hook, /sendLockRef\.current = true/)
assert.match(hook, /sendMessage\(finalText\)/)

// E — cancel prevents send
assert.match(hook, /cancelListening/)
assert.match(hook, /sessionRef\.current\?\.abort\(\)/)
assert.match(hook, /pendingSpeakRef\.current = null/)
assert.match(listen, /discarded = true/)
assert.match(listen, /finalizeRequested = false/)

// G — API key not exposed client-side
assert.doesNotMatch(ttsApi, /OPENAI_API_KEY/)
assert.doesNotMatch(hook, /OPENAI_API_KEY/)
assert.doesNotMatch(shell, /OPENAI_API_KEY/)
assert.match(ttsRoute, /process\.env\.OPENAI_API_KEY/)

// H — TTS uses visible assistant response text
assert.match(hook, /speakAssistantText\(last\.content/)
assert.match(hook, /prepareSpeechText\(text\)/)
assert.doesNotMatch(hook, /modality:\s*['"]voice['"]/)

// J — Memory path uses transcript only (same sendMessage; no audio persistence)
assert.match(hook, /sendMessage\(finalText\)/)
assert.doesNotMatch(hook, /sendMessage\([^)]*blob|sendMessage\([^)]*audio/i)
assert.doesNotMatch(chatContext, /voiceMode|ttsBlob|microphoneBlob|AudioBuffer/)
assert.doesNotMatch(chatApi, /audioBlob|ttsBytes|microphone/)

// K — no separate audio history format
assert.doesNotMatch(hook, /kind:\s*['"]audio['"]|role:\s*['"]voice['"]/)
assert.doesNotMatch(shell, /kind:\s*['"]audio['"]/)

// L / M / N — cleanup, stop playback, unmount
assert.match(hook, /revokeObjectURL|releaseObjectUrl/)
assert.match(hook, /audio\.pause/)
assert.match(hook, /stopSpeaking/)
assert.match(hook, /clearAudio/)
assert.match(hook, /Cleanup on unmount/)
assert.match(hook, /sessionRef\.current\?\.dispose\(\)/)

// O / P — unsupported + permission denied graceful
assert.match(hook, /Modalità vocale non supportata/)
assert.match(hook, /friendlySpeechError/)
assert.match(hook, /isSpeechRecognitionSupported/)

// UI differentiation: Voice ≠ Dictation
assert.match(shell, /VoiceModeButton/)
assert.match(shell, /VoiceModeBar/)
assert.match(shell, /useVoiceMode/)
assert.match(shell, /voice\.active/)
assert.match(btn, /Avvia modalità vocale|Modalità vocale/)
assert.match(btn, /Voce/)
assert.match(bar, /Ti ascolto/)
assert.match(bar, /Sto elaborando/)
assert.match(bar, /Sto parlando/)
assert.match(bar, /Riproduci/)
assert.match(bar, /Chiudi/)
assert.match(bar, /Invia/)
assert.match(bar, /Annulla/)
assert.match(bar, /Stop/)

// Dictation remains draft-only; Voice uses Core send
assert.match(shell, /useSpeechDictation/)
assert.match(shell, /suspended: chatSuspended \|\| settingsOpen \|\| voice\.active/)
assert.doesNotMatch(read('src/components/chat/useSpeechDictation.ts'), /sendMessage/)

// Core invariants preserved — no second brain, no modality:voice from Voice Mode
assert.equal((apiChat.match(/\.responses\.create\(/g) || []).length, 1)
assert.match(apiChat, /maxDuration:\s*120/)
assert.doesNotMatch(hook, /modality:\s*['"]voice['"]/)
assert.doesNotMatch(shell, /modality:\s*['"]voice['"]/)
assert.doesNotMatch(shell, /MediaRecorder|getUserMedia/)
assert.doesNotMatch(listen, /MediaRecorder|getUserMedia|openai\.|\/api\/transcri/i)

// No Realtime / WebRTC
assert.doesNotMatch(hook, /Realtime|WebRTC|RTCPeerConnection/)
assert.doesNotMatch(shell, /Realtime|WebRTC/)

// Autoplay fallback
assert.match(hook, /needsManualPlay/)
assert.match(hook, /Riproduci/)

// Privacy docs in STT module
assert.match(listen, /privacy|browser\/vendor|vendor/i)

console.log('ok: #292 voice mode contracts')
