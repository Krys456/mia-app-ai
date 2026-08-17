/**
 * #292 TTS speech-text cleanup + request validation
 * Run: node lib/server/tts-speech.test.mjs
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  TTS_CONTENT_TYPE,
  TTS_MAX_INPUT_CHARS,
  TTS_MODEL,
  TTS_RESPONSE_FORMAT,
  prepareSpeechText,
  sanitizeTtsRequest,
} from './tts-speech.js'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')

// Model / format contract
assert.equal(TTS_MODEL, 'gpt-4o-mini-tts')
assert.equal(TTS_RESPONSE_FORMAT, 'mp3')
assert.equal(TTS_CONTENT_TYPE, 'audio/mpeg')
assert.equal(TTS_MAX_INPUT_CHARS, 1200)

// F — sanitize validation
assert.equal(sanitizeTtsRequest(null).ok, false)
assert.equal(sanitizeTtsRequest({}).ok, false)
assert.equal(sanitizeTtsRequest({ text: '   ' }).ok, false)
assert.equal(sanitizeTtsRequest({ text: '   ' }).code, 'empty_text')

const ok = sanitizeTtsRequest({ text: 'Ciao, sono LAIfe.' })
assert.equal(ok.ok, true)
assert.equal(ok.text, 'Ciao, sono LAIfe.')
assert.equal(ok.voice, 'alloy')

const voiced = sanitizeTtsRequest({ text: 'Ciao', voice: 'coral' })
assert.equal(voiced.ok, true)
assert.equal(voiced.voice, 'coral')

const badVoice = sanitizeTtsRequest({ text: 'Ciao', voice: 'evil-clone' })
assert.equal(badVoice.ok, true)
assert.equal(badVoice.voice, 'alloy')

// H / I — speak visible answer text; strip URLs + Fonti
const withSources = [
  'OpenAI ha annunciato nuovi modelli.',
  '',
  'Fonti:',
  '- https://openai.com/blog/example',
  '- [Docs](https://platform.openai.com/docs)',
].join('\n')
const spoken = prepareSpeechText(withSources)
assert.match(spoken, /OpenAI ha annunciato/)
assert.doesNotMatch(spoken, /https?:\/\//)
assert.doesNotMatch(spoken, /Fonti/i)
assert.doesNotMatch(spoken, /platform\.openai/)

const md = prepareSpeechText('Vedi [la guida](https://example.com/x) e **attenzione**.')
assert.equal(md, 'Vedi la guida e attenzione.')

const code = prepareSpeechText('Ecco:\n```js\nconsole.log(1)\n```\nFine.')
assert.match(code, /Ecco/)
assert.match(code, /Fine/)
assert.doesNotMatch(code, /console\.log/)

// Length cap
const long = 'Parola. '.repeat(400)
const capped = prepareSpeechText(long)
assert.ok(capped.length <= TTS_MAX_INPUT_CHARS + 1)
assert.ok(capped.length < long.length)

// Route wiring — no key client-side; server maxDuration 30
const ttsRoute = read('api/tts.ts')
assert.match(ttsRoute, /maxDuration:\s*30/)
assert.match(ttsRoute, /sanitizeTtsRequest/)
assert.match(ttsRoute, /TTS_MODEL/)
assert.match(ttsRoute, /process\.env\.OPENAI_API_KEY/)
assert.doesNotMatch(ttsRoute, /VITE_OPENAI/)
assert.match(ttsRoute, /audio\/mpeg|TTS_CONTENT_TYPE/)

const client = read('src/lib/ttsApi.ts')
assert.match(client, /\/api\/tts/)
assert.doesNotMatch(client, /OPENAI_API_KEY/)
assert.doesNotMatch(client, /sk-[a-zA-Z0-9]/)
assert.match(client, /credentials:\s*['"]include['"]/)

const vercel = read('vercel.json')
assert.match(vercel, /"api\/tts\.ts"/)
assert.match(vercel, /"maxDuration":\s*30/)

console.log('ok: #292 tts-speech cleanup + route contracts')
