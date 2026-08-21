/**
 * #298D — Production UX & closed-beta readiness contracts.
 * Run: node --experimental-strip-types src/lib/production-ux-298d.test.mjs
 *   or: ./node_modules/.bin/tsx src/lib/production-ux-298d.test.mjs
 */

import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  FIRST_RUN_HINT,
  MEMORY_SETTINGS_COPY,
  PRIVACY_DISCLOSURE,
  buildBetaContactLine,
} from './privacyCopy.ts'
import {
  USER_NETWORK_ERROR,
  USER_SESSION_FAILED,
  userFacingApiMessage,
  withErrorReference,
} from './apiError.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel) => readFileSync(join(root, rel), 'utf8')

// --- First-run hint constant preserved; #333A Kami hero uses ma (no secondary hint) ---
assert.match(FIRST_RUN_HINT, /Scrivi liberamente/)
assert.match(FIRST_RUN_HINT, /Impostazioni/)
const hero = read('src/components/HomeHero.tsx')
const homeExp = read('src/components/home/HomeExperience.tsx')
assert.doesNotMatch(hero, /FIRST_RUN_HINT/)
assert.doesNotMatch(homeExp, /FIRST_RUN_HINT/)
assert.match(homeExp, /HomeAtmosphere|SumiHero/)
assert.doesNotMatch(homeExp, /tour|coach|modal|wizard|onboarding/i)

// --- New Chat Memory clarification ---
const header = read('src/components/Header.tsx')
assert.match(header, /La Memoria salvata non verrà cancellata/)

// --- Rate / network Italian copy ---
assert.match(
  userFacingApiMessage({ code: 'rate_limit_exceeded' }),
  /molte richieste/i,
)
assert.match(
  userFacingApiMessage({ code: 'rate_limit_exceeded', retryAfter: 12 }),
  /12 secondi/,
)
assert.match(
  userFacingApiMessage({ code: 'rate_limit_unavailable' }),
  /temporaneamente occupato/i,
)
assert.match(
  userFacingApiMessage({ message: 'rate_limit_exceeded' }),
  /molte richieste/i,
)
assert.match(
  userFacingApiMessage({
    message: 'Rate limit service unavailable. Retry shortly.',
  }),
  /temporaneamente occupato/i,
)
assert.equal(USER_NETWORK_ERROR.includes('CORS'), false)
assert.equal(USER_NETWORK_ERROR.includes('Deployment Protection'), false)
assert.match(USER_NETWORK_ERROR, /Connessione non disponibile/)
assert.match(USER_SESSION_FAILED, /Ricarica/)

const chatApi = read('src/lib/chatApi.ts')
assert.match(chatApi, /USER_NETWORK_ERROR/)
assert.match(chatApi, /USER_SESSION_FAILED/)
assert.doesNotMatch(chatApi, /Check same-origin \/api\/chat, CORS/)
assert.equal(USER_NETWORK_ERROR.includes('CORS'), false)
assert.equal(USER_NETWORK_ERROR.includes('Deployment Protection'), false)
assert.equal(USER_NETWORK_ERROR.includes('maxDuration'), false)

const withRef = withErrorReference(
  userFacingApiMessage({ code: 'rate_limit_exceeded' }),
  'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
)
assert.match(withRef, /Riferimento: a1b2c3d4/)
assert.match(withRef, /molte richieste/)

// --- Privacy Italian ---
assert.match(PRIVACY_DISCLOSURE.aiProcessing, /OpenAI/)
assert.match(PRIVACY_DISCLOSURE.aiProcessing, /messaggi|Messaggi/i)
assert.match(PRIVACY_DISCLOSURE.files, /24 ore/)
assert.match(PRIVACY_DISCLOSURE.webSearch, /Fonti/)
assert.match(PRIVACY_DISCLOSURE.anonymousSession, /anonimo/i)
assert.match(PRIVACY_DISCLOSURE.sensitiveWarning, /password/i)
assert.match(PRIVACY_DISCLOSURE.sharedDevice, /profilo browser/i)
assert.match(PRIVACY_DISCLOSURE.highStakes, /commettere errori/i)
assert.match(MEMORY_SETTINGS_COPY.off, /ricordi già salvati|restano/i)
assert.doesNotMatch(MEMORY_SETTINGS_COPY.off, /deletes? existing/i)

const privacyPage = read('src/pages/PrivacyData.tsx')
assert.match(privacyPage, /Privacy e dati/)
assert.match(privacyPage, /Closed Beta/)
assert.match(privacyPage, /Build beta/)
assert.match(privacyPage, /Segnala un problema/)
assert.match(privacyPage, /buildBetaSupportMailto/)
assert.match(privacyPage, /getClientBuildId/)

const settings = read('src/components/SettingsDrawer.tsx')
assert.match(settings, /Privacy e dati/)
assert.match(settings, /Informazioni su privacy e dati/)
assert.match(settings, /Rivedi o elimina la Memoria/)
assert.match(settings, /Closed Beta/)
assert.match(settings, /getClientBuildId/)
assert.doesNotMatch(settings, /Privacy information/)
assert.doesNotMatch(settings, /Review or delete Memory/)

assert.match(buildBetaContactLine('beta@example.com'), /Closed Beta/)
assert.match(buildBetaContactLine('beta@example.com'), /beta@example.com/)

// --- noindex ---
const indexHtml = read('index.html')
assert.match(indexHtml, /noindex,\s*nofollow/)
assert.ok(existsSync(join(root, 'public/robots.txt')))
assert.match(read('public/robots.txt'), /Disallow:\s*\//)

// --- Docs ---
assert.ok(existsSync(join(root, 'docs/CLOSED-BETA-INVITE.md')))
assert.ok(existsSync(join(root, 'docs/CLOSED-BETA-OPS-CHECKLIST.md')))
const invite = read('docs/CLOSED-BETA-INVITE.md')
assert.match(invite, /Closed Beta/)
assert.match(invite, /Riferimento/)
assert.match(invite, /Android Chrome/)
assert.match(invite, /Deployment Protection|operativ/i)
const ops = read('docs/CLOSED-BETA-OPS-CHECKLIST.md')
assert.match(ops, /VITE_PRIVACY_CONTACT_EMAIL/)
assert.match(ops, /UPSTASH_REDIS_REST/)
assert.match(ops, /memory-test/)
assert.doesNotMatch(ops, /sk-[a-zA-Z0-9]{10,}/)

// --- No account / logout / persistence / tours ---
const app = read('src/App.tsx') + read('src/main.tsx') + hero + header
assert.doesNotMatch(app, /signOut|logout|invite.?code|onboarding.?tour/i)
assert.doesNotMatch(read('package.json'), /sentry|posthog|logrocket/i)

// --- No DB migration in this phase ---
assert.ok(existsSync(join(root, 'supabase/migrations/20260817210000_rls_owner_policies_298b.sql')))
// #298D must not add a new migration file
const migrations = read('supabase/migrations/20260817210000_rls_owner_policies_298b.sql')
assert.match(migrations, /ENABLE ROW LEVEL SECURITY/)

console.log('ok: #298D production UX + closed-beta readiness contracts')
