/**
 * #298B — Privacy UI + Memory Manage production gate contracts.
 * #298D — Italian UI copy expectations.
 * Run: ./node_modules/.bin/tsx src/lib/privacy-298b.test.mjs
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  MEMORY_SETTINGS_COPY,
  PRIVACY_CONTACT_PLACEHOLDER,
  PRIVACY_DISCLOSURE,
  buildBetaContactLine,
  resolvePrivacyContactEmail,
} from './privacyCopy.ts'
import { isMemoryManageUiEnabled } from './memoryManageUi.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel) => readFileSync(join(root, rel), 'utf8')

// Memory Manage enabled by default (incl. production builds)
assert.equal(isMemoryManageUiEnabled(), true)
assert.doesNotMatch(read('src/lib/memoryManageUi.ts'), /PROD\s*!==\s*true/)

// Copy contracts — OFF does not claim deletion
assert.match(MEMORY_SETTINGS_COPY.off, /apprendimento automatico|richiamo/i)
assert.match(MEMORY_SETTINGS_COPY.off, /restano|finché non li elimini/i)
assert.doesNotMatch(MEMORY_SETTINGS_COPY.off, /deletes? existing/i)
assert.match(MEMORY_SETTINGS_COPY.delete, /Nuova chat/i)
assert.match(MEMORY_SETTINGS_COPY.on, /lungo termine|fatti utili/i)

assert.match(PRIVACY_DISCLOSURE.aiProcessing, /OpenAI/)
assert.match(PRIVACY_DISCLOSURE.files, /24 ore/)
assert.match(PRIVACY_DISCLOSURE.webSearch, /Fonti/)
assert.match(PRIVACY_DISCLOSURE.anonymousSession, /anonimo/i)
assert.match(PRIVACY_DISCLOSURE.sensitiveWarning, /password/i)
assert.match(PRIVACY_DISCLOSURE.newChatVsMemory, /eliminazione dell’account|Account/i)

assert.equal(resolvePrivacyContactEmail({}), PRIVACY_CONTACT_PLACEHOLDER)
assert.equal(
  resolvePrivacyContactEmail({ VITE_PRIVACY_CONTACT_EMAIL: 'beta@example.com' }),
  'beta@example.com',
)
assert.match(buildBetaContactLine('beta@example.com'), /beta@example.com/)

// Settings + App wiring
const settings = read('src/components/SettingsDrawer.tsx')
assert.match(settings, /Privacy e dati/)
assert.match(settings, /onOpenPrivacy/)
assert.match(settings, /MEMORY_SETTINGS_COPY/)
assert.match(settings, /sensitiveWarning/)
assert.doesNotMatch(settings, /Phase 0/)
assert.doesNotMatch(settings, /nascosta in Production/)

const app = read('src/App.tsx')
assert.match(app, /PrivacyData/)
assert.match(app, /'privacy'/)
assert.match(app, /privacyReturnToSettingsRef/)

const types = read('src/types.ts')
assert.match(types, /'privacy'/)

const privacyPage = read('src/pages/PrivacyData.tsx')
assert.match(privacyPage, /PRIVACY_DISCLOSURE/)
assert.match(privacyPage, /role="note"/)
assert.match(privacyPage, /Privacy e dati/)

const memoryPage = read('src/pages/MemoryManage.tsx')
assert.match(memoryPage, /deleteAllMemories/)
assert.match(memoryPage, /Cancella tutto/)
assert.match(memoryPage, /Nuova chat/)

// Service-role Memory path unchanged
const memoriesIndex = read('api/memories/index.ts')
assert.match(memoriesIndex, /requireMemoryApiUser/)
assert.match(memoriesIndex, /requireExplicitUserId:\s*true/)
assert.doesNotMatch(memoriesIndex, /createBrowserClient|createClient/)

const chat = read('api/chat.ts')
assert.match(chat, /requirePaidApiAccess/)
assert.equal((chat.match(/\.responses\.create\s*\(/g) || []).length, 1)

console.log('ok: #298B privacy UI + Memory Manage contracts')
