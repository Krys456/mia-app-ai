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
    | 'redirecting'
    | 'already_linked'
    | 'identity_conflict'
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
  if (/already|registered|exists|identity.*linked|conflict/i.test(lower)) {
    return {
      ok: false,
      code: 'identity_conflict',
      message:
        'Questo account esiste già. Non uniamo automaticamente le identità. Resta sulla sessione attuale; i tuoi dati anonimi non sono stati cancellati.',
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

  if (error) return mapAuthError(error)

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

  if (error) return mapAuthError(error)

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
