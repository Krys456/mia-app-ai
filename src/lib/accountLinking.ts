/**
 * #332E2 — Account link / sign-in actions (client Supabase Auth).
 *
 * LINK CURRENT anonymous session (same auth.uid) ≠ SIGN INTO EXISTING account.
 * No automatic data merge when signing into a different durable account.
 */

import { getSupabase, isSupabaseConfigured } from './supabase'
import {
  isGoogleLinkingEnabled,
  resolveIdentityStatus,
  type IdentityStatus,
} from './durableIdentity'
import { bootstrapLaifeAuth } from './authSession'

export type AccountActionResult = {
  ok: boolean
  code:
    | 'ok'
    | 'not_configured'
    | 'email_sent'
    | 'email_change_pending'
    | 'redirecting'
    | 'already_linked'
    | 'identity_conflict'
    | 'same_email'
    | 'not_durable'
    | 'cancelled'
    | 'provider_unavailable'
    | 'invalid_email'
    | 'error'
  message: string
  userId?: string | null
  identity?: IdentityStatus
}

function mapAuthError(error: { message?: string; code?: string; status?: number } | null): AccountActionResult {
  const message = error?.message || 'Operazione non riuscita'
  const lower = message.toLowerCase()
  if (/already|registered|exists|identity.*linked|conflict|taken|duplicate/i.test(lower)) {
    return {
      ok: false,
      code: 'identity_conflict',
      message: 'Questa email è già associata a un altro account.',
    }
  }
  if (/popup|closed|cancelled|canceled/i.test(lower)) {
    return { ok: false, code: 'cancelled', message: 'Collegamento annullato.' }
  }
  return { ok: false, code: 'error', message }
}

function redirectOrigin(): string {
  if (typeof window === 'undefined') return ''
  return window.location.origin
}

export async function loadIdentitySnapshot(): Promise<IdentityStatus> {
  if (!isSupabaseConfigured()) {
    return resolveIdentityStatus(null)
  }
  try {
    const client = getSupabase()
    const { data } = await client.auth.getUser()
    return resolveIdentityStatus(data.user ?? null)
  } catch {
    return resolveIdentityStatus(null)
  }
}

/**
 * LINK: attach email to the current anonymous user (same UUID).
 * Supabase sends a confirmation email; after confirm, is_anonymous becomes false.
 */
export async function linkEmailToCurrentUser(email: string): Promise<AccountActionResult> {
  const trimmed = email.trim().toLowerCase()
  if (!trimmed || !trimmed.includes('@')) {
    return { ok: false, code: 'invalid_email', message: 'Inserisci un’email valida.' }
  }
  if (!isSupabaseConfigured()) {
    return { ok: false, code: 'not_configured', message: 'Autenticazione non configurata.' }
  }

  await bootstrapLaifeAuth()
  const client = getSupabase()
  const before = await client.auth.getUser()
  const beforeId = before.data.user?.id ?? null

  const { data, error } = await client.auth.updateUser(
    { email: trimmed },
    { emailRedirectTo: `${redirectOrigin()}/` },
  )

  if (error) {
    const mapped = mapAuthError(error)
    // Keep prior link-flow wording for anonymous→email conflicts.
    if (mapped.code === 'identity_conflict') {
      return {
        ...mapped,
        message:
          'Questo account esiste già. Non uniamo automaticamente le identità. Resta sulla sessione attuale; i tuoi dati anonimi non sono stati cancellati.',
      }
    }
    return mapped
  }

  const afterId = data.user?.id ?? beforeId
  if (beforeId && afterId && beforeId !== afterId) {
    return {
      ok: false,
      code: 'error',
      message: 'L’identità è cambiata in modo inatteso. Operazione interrotta.',
      userId: afterId,
    }
  }

  return {
    ok: true,
    code: 'email_sent',
    message:
      'Ti abbiamo inviato un’email di conferma. Apri il link per collegare l’account. L’ID utente resta lo stesso.',
    userId: afterId,
    identity: resolveIdentityStatus(data.user ?? null),
  }
}

/**
 * CHANGE EMAIL for a durable account (same auth.uid).
 * Uses updateUser({ email }) — never signInWithOtp / never creates a second user.
 *
 * Supabase default Secure Email Change: confirmation may be required on both
 * the current and the new address before the change is applied.
 */
export async function changeEmailForCurrentUser(newEmail: string): Promise<AccountActionResult> {
  const trimmed = newEmail.trim().toLowerCase()
  if (!trimmed || !trimmed.includes('@') || trimmed.startsWith('@') || trimmed.endsWith('@')) {
    return { ok: false, code: 'invalid_email', message: 'Inserisci un’email valida.' }
  }
  // Basic shape: local@domain.tld
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return { ok: false, code: 'invalid_email', message: 'Inserisci un’email valida.' }
  }
  if (!isSupabaseConfigured()) {
    return { ok: false, code: 'not_configured', message: 'Autenticazione non configurata.' }
  }

  await bootstrapLaifeAuth()
  const client = getSupabase()
  const before = await client.auth.getUser()
  const beforeUser = before.data.user
  const beforeId = beforeUser?.id ?? null
  if (!beforeId || !beforeUser) {
    return { ok: false, code: 'error', message: 'Sessione non valida. Ricarica e riprova.' }
  }

  const beforeStatus = resolveIdentityStatus(beforeUser)
  if (!beforeStatus.durable) {
    return {
      ok: false,
      code: 'not_durable',
      message: 'Collega prima un account, poi potrai cambiare email.',
      userId: beforeId,
      identity: beforeStatus,
    }
  }

  const currentEmail =
    typeof beforeUser.email === 'string' ? beforeUser.email.trim().toLowerCase() : ''
  if (currentEmail && currentEmail === trimmed) {
    return {
      ok: false,
      code: 'same_email',
      message: 'Questa è già l’email attuale.',
      userId: beforeId,
      identity: beforeStatus,
    }
  }

  const { data, error } = await client.auth.updateUser(
    { email: trimmed },
    { emailRedirectTo: `${redirectOrigin()}/` },
  )

  if (error) return mapAuthError(error)

  const afterUser = data.user ?? null
  const afterId = afterUser?.id ?? beforeId
  if (beforeId !== afterId) {
    return {
      ok: false,
      code: 'error',
      message: 'L’identità è cambiata in modo inatteso. Operazione interrotta.',
      userId: afterId,
    }
  }

  const identity = resolveIdentityStatus(afterUser)
  const pending = identity.emailChangePending || Boolean(afterUser && 'new_email' in afterUser)

  return {
    ok: true,
    code: pending ? 'email_change_pending' : 'email_sent',
    message: pending
      ? 'Ti abbiamo inviato un link di conferma al nuovo indirizzo. Se il progetto ha Secure Email Change attivo, conferma anche dalla email attuale. L’ID account non cambia.'
      : 'Richiesta di cambio email inviata. Controlla la casella di posta. L’ID account non cambia.',
    userId: afterId,
    identity,
  }
}

/**
 * SIGN IN to an existing durable account (may switch away from current anonymous UUID).
 * Does NOT merge anonymous data into the durable account.
 */
export async function signInExistingWithEmailOtp(email: string): Promise<AccountActionResult> {
  const trimmed = email.trim().toLowerCase()
  if (!trimmed || !trimmed.includes('@')) {
    return { ok: false, code: 'invalid_email', message: 'Inserisci un’email valida.' }
  }
  if (!isSupabaseConfigured()) {
    return { ok: false, code: 'not_configured', message: 'Autenticazione non configurata.' }
  }

  const client = getSupabase()
  const { error } = await client.auth.signInWithOtp({
    email: trimmed,
    options: {
      shouldCreateUser: false,
      emailRedirectTo: `${redirectOrigin()}/`,
    },
  })

  if (error) {
    const mapped = mapAuthError(error)
    if (mapped.code === 'identity_conflict') {
      return {
        ...mapped,
        message:
          'Questo account esiste già. Non uniamo automaticamente le identità. Resta sulla sessione attuale; i tuoi dati anonimi non sono stati cancellati.',
      }
    }
    return mapped
  }

  return {
    ok: true,
    code: 'email_sent',
    message:
      'Se l’account esiste, riceverai un link di accesso. I dati della sessione anonima corrente non verranno uniti automaticamente.',
  }
}

/**
 * LINK Google to current user (same UUID). Requires Manual Linking + Google provider.
 */
export async function linkGoogleToCurrentUser(): Promise<AccountActionResult> {
  if (!isGoogleLinkingEnabled()) {
    return {
      ok: false,
      code: 'provider_unavailable',
      message: 'Il collegamento Google non è ancora abilitato in questa Preview.',
    }
  }
  if (!isSupabaseConfigured()) {
    return { ok: false, code: 'not_configured', message: 'Autenticazione non configurata.' }
  }

  await bootstrapLaifeAuth()
  const client = getSupabase()
  const before = await client.auth.getUser()
  const beforeId = before.data.user?.id ?? null

  const { data, error } = await client.auth.linkIdentity({
    provider: 'google',
    options: {
      redirectTo: `${redirectOrigin()}/`,
      skipBrowserRedirect: false,
    },
  })

  if (error) return mapAuthError(error)

  return {
    ok: true,
    code: 'redirecting',
    message: 'Reindirizzamento a Google…',
    userId: beforeId,
    identity: resolveIdentityStatus(before.data.user ?? null),
    ...(data ? {} : {}),
  }
}

export async function signOutCurrentUser(): Promise<AccountActionResult> {
  if (!isSupabaseConfigured()) {
    return { ok: false, code: 'not_configured', message: 'Autenticazione non configurata.' }
  }
  const client = getSupabase()
  const { error } = await client.auth.signOut()
  if (error) return mapAuthError(error)
  return {
    ok: true,
    code: 'ok',
    message: 'Sessione chiusa. Puoi continuare anonimamente o accedere di nuovo.',
  }
}
