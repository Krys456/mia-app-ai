/**
 * #273 Microphone dictation — speech helpers + wiring guards
 * Run: node src/lib/speech-dictation.test.mjs
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
  try {
    const esbuild = await import('esbuild')
    const outfile = path.join(os.tmpdir(), `dictation-${Date.now()}-${Math.random()}.mjs`)
    await esbuild.build({
      entryPoints: [entry],
      outfile,
      bundle: false,
      format: 'esm',
      platform: 'neutral',
      target: 'es2022',
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
    const outfile = path.join(os.tmpdir(), `dictation-${Date.now()}-${Math.random()}.mjs`)
    fs.writeFileSync(outfile, outputText)
    return await import(pathToFileURL(outfile).href)
  }
}

const speech = await loadTs('src/lib/speechRecognition.ts')
const dictLang = await loadTs('src/lib/dictationLanguage.ts')

const {
  mergeDictationTranscript,
  normalizeSpeechErrorCode,
  friendlySpeechError,
  isSpeechRecognitionSupported,
} = speech
const { resolveRecognitionLang, deriveDictationLangFromMessages } = dictLang

// A unsupported in Node (no window SpeechRecognition)
assert.equal(isSpeechRecognitionSupported(), false, 'A unsupported in node')

// G / H merge
assert.equal(mergeDictationTranscript('', 'Ciao LAIfe'), 'Ciao LAIfe')
assert.equal(mergeDictationTranscript('Domani voglio', 'allenarmi presto'), 'Domani voglio allenarmi presto')
assert.equal(mergeDictationTranscript('Domani voglio ', 'allenarmi presto'), 'Domani voglio allenarmi presto')
assert.equal(mergeDictationTranscript('  ', 'ciao'), 'ciao')

// Error mapping — no raw dumps
assert.equal(normalizeSpeechErrorCode('not-allowed'), 'not-allowed')
assert.match(friendlySpeechError('not-allowed'), /Microfono non autorizzato/)
assert.match(friendlySpeechError('no-speech'), /Non ho sentito nulla/)
assert.match(friendlySpeechError('network'), /Dettatura non riuscita/)
assert.equal(friendlySpeechError('aborted'), null)

// Language hybrid
assert.equal(
  resolveRecognitionLang({
    messages: [{ role: 'user', content: 'Ciao, parliamo in italiano domani.' }],
  }),
  'it-IT',
)
assert.equal(
  resolveRecognitionLang({
    messages: [{ role: 'user', content: 'Hello, how are you today?' }],
  }),
  'en-US',
)
assert.equal(
  resolveRecognitionLang({
    messages: [{ role: 'user', content: 'Bonjour, comment ça va aujourd’hui?' }],
  }),
  'fr-FR',
)
assert.equal(
  resolveRecognitionLang({ messages: [], navigatorLanguage: 'de-DE' }),
  'de-DE',
)
assert.equal(resolveRecognitionLang({ messages: [] }), 'en-US')
assert.equal(deriveDictationLangFromMessages([{ role: 'user', content: '' }]), null)

// Wiring / a11y / right-action rules
const shell = read('src/components/chat/ComposerShell.tsx')
const micBtn = read('src/components/chat/ComposerMicrophoneButton.tsx')
const micCss = read('src/components/chat/ComposerMicrophoneButton.css')
const hook = read('src/components/chat/useSpeechDictation.ts')
const speechSrc = read('src/lib/speechRecognition.ts')
const apiChat = read('api/chat.ts')
const chatApi = read('src/lib/chatApi.ts')
const chatContext = read('src/context/ChatContext.tsx')
const autoScroll = read('src/components/chat/AutoScrollController.ts')

// B/C/D right-action rules
assert.match(shell, /showMic/)
assert.match(shell, /composerDraftCanSend\(draft\)/)
assert.match(shell, /dictation\.listening/)
assert.match(shell, /ComposerMicrophoneButton/)
assert.match(shell, /useSpeechDictation/)

// E/F start/stop
assert.match(hook, /recognition\.start/)
assert.match(hook, /\.stop\(/)
assert.match(hook, /\.abort\(/)

// I no auto-send
assert.doesNotMatch(hook, /sendMessage/)
assert.doesNotMatch(speechSrc, /sendMessage/)

// J/K/L/M preserve draft on errors
assert.match(hook, /baseTextRef/)
assert.match(hook, /friendlySpeechError/)
assert.match(hook, /committedFinalRef/)

// N image attachment never touched by dictation
assert.doesNotMatch(hook, /setImageAttachment|removeAttachment|attachments/)

// O stale session identity
assert.match(hook, /sessionIdRef/)
assert.match(hook, /ignoreResultsRef/)
assert.match(hook, /onUserTyping/)

// P New Chat aborts
assert.match(shell, /messages\.length === 0 && prev > 0/)
assert.match(shell, /dictationAbortRef\.current\(\{ restore: false \}\)/)

// Q navigation suspended
assert.match(shell, /useChatViewSuspended|suspended:/)
assert.match(shell, /settingsOpen/)
assert.match(hook, /options\.suspended/)

// R a11y
assert.match(micBtn, /aria-label=\{label\}|Dettatura: scrive nel campo/)
assert.match(micBtn, /title=\{label\}|Dettatura: scrive nel campo/)
assert.match(micBtn, /aria-pressed=\{listening\}/)
assert.match(shell, /Dettatura attiva/)
assert.match(shell, /statusAnnouncement/)
assert.match(micCss, /prefers-reduced-motion/)
assert.match(micCss, /In ascolto|composer-mic__badge/)

// S no audio / api voice modality from composer
assert.doesNotMatch(shell, /modality:\s*['\"]voice['\"]|MediaRecorder|getUserMedia/)
assert.doesNotMatch(hook, /MediaRecorder|getUserMedia|FormData|audio\//)
assert.doesNotMatch(chatContext, /modality:\s*['\"]voice['\"]/)
{
  const creates = (apiChat.match(/\.responses\.create\(/g) || []).length
  assert.ok(creates >= 1 && creates <= 2, `unexpected responses.create count: ${creates}`)
}
assert.match(apiChat, /maxDuration:\s*120/)
assert.doesNotMatch(autoScroll, /SpeechRecognition|dictation|microphone/)

// continuous / interim MVP
assert.match(speechSrc, /continuous = false/)
assert.match(speechSrc, /interimResults = false/)

// Hidden when unsupported — no Coming soon
assert.doesNotMatch(shell, /Coming soon/)
assert.doesNotMatch(micBtn, /Coming soon/)

console.log('ok: #273 speech dictation helpers + wiring guards')
