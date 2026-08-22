/**
 * #304A1 — calendar-connection
 *
 * GET  → connection status (metadata only; no tokens)
 * POST → disconnect (revoke Google token if practical, wipe enc material)
 *
 * Ownership: verified ShinkAIdo JWT auth.uid() only.
 * Does not delete ShinkAIdo user. Does not touch Memory / reminders / push.
 */

import {
  corsHeaders,
  ensureAuthUserRow,
  env,
  extractBearer,
  isCalendarEnabled,
  json,
  logSafe,
  serviceClient,
  toPublicConnection,
  verifyUserJwt,
} from '../_shared/calendar-edge.ts'
import { decryptToken } from '../_shared/calendar-token-crypto.ts'

async function revokeGoogleToken(token: string) {
  try {
    await fetch('https://oauth2.googleapis.com/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }),
    })
  } catch {
    /* best-effort */
  }
}

Deno.serve(async (req) => {
  const runId = crypto.randomUUID()
  const cors = corsHeaders(req)

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors })
  }

  if (!isCalendarEnabled()) {
    return json(404, { error: 'Calendar unavailable', code: 'calendar_disabled', runId }, cors)
  }

  const accessToken = extractBearer(req)
  if (!accessToken) {
    return json(401, { error: 'unauthorized', code: 'missing_bearer', runId }, cors)
  }

  const verified = await verifyUserJwt(accessToken)
  if (!verified.ok) {
    return json(401, { error: 'unauthorized', code: verified.code, runId }, cors)
  }

  try {
    const supabase = serviceClient()
    const userId = await ensureAuthUserRow(supabase, verified.userId)

    if (req.method === 'GET') {
      // Ignore spoofed query user_id.
      const url = new URL(req.url)
      if (url.searchParams.has('user_id') || url.searchParams.has('userId')) {
        return json(400, { error: 'user_id_not_accepted', code: 'user_id_spoof_rejected', runId }, cors)
      }

      const { data, error } = await supabase
        .from('calendar_connections')
        .select(
          'status, provider, account_email, scopes, last_error_code, disconnected_at, updated_at',
        )
        .eq('user_id', userId)
        .eq('provider', 'google')
        .maybeSingle()

      if (error) {
        logSafe('calendar-connection', { runId, code: 'status_lookup_failed', ok: false })
        return json(500, { error: 'status_failed', code: 'status_lookup_failed', runId }, cors)
      }

      return json(200, { ok: true, connection: toPublicConnection(data), runId }, cors)
    }

    if (req.method === 'POST') {
      let body: Record<string, unknown> = {}
      try {
        const text = await req.text()
        if (text) body = JSON.parse(text)
      } catch {
        return json(400, { error: 'invalid_json', runId }, cors)
      }

      if (body.user_id || body.userId) {
        return json(400, { error: 'user_id_not_accepted', code: 'user_id_spoof_rejected', runId }, cors)
      }
      if (body.access_token || body.refresh_token || body.client_secret) {
        return json(400, { error: 'forbidden_fields', code: 'secret_relay_forbidden', runId }, cors)
      }

      const action = typeof body.action === 'string' ? body.action.trim() : 'disconnect'

      if (action !== 'disconnect') {
        return json(400, { error: 'unknown_action', code: 'unknown_action', runId }, cors)
      }

      const { data: row, error: lookupError } = await supabase
        .from('calendar_connections')
        .select('id, user_id, access_token_enc, refresh_token_enc, status')
        .eq('user_id', userId)
        .eq('provider', 'google')
        .maybeSingle()

      if (lookupError) {
        return json(500, { error: 'disconnect_failed', code: 'lookup_failed', runId }, cors)
      }

      if (!row) {
        return json(
          200,
          {
            ok: true,
            connection: toPublicConnection(null),
            runId,
          },
          cors,
        )
      }

      // Best-effort revoke (prefer refresh, else access). Never log tokens.
      const encKey = env('SHINKAIDO_CALENDAR_ENCRYPTION_KEY')
      if (encKey) {
        const enc =
          (typeof row.refresh_token_enc === 'string' && row.refresh_token_enc) ||
          (typeof row.access_token_enc === 'string' && row.access_token_enc) ||
          null
        if (enc) {
          const dec = await decryptToken(enc, encKey)
          if (dec.ok) await revokeGoogleToken(dec.plaintext)
        }
      }

      const { data: updated, error: updateError } = await supabase
        .from('calendar_connections')
        .update({
          access_token_enc: null,
          refresh_token_enc: null,
          token_expires_at: null,
          google_sub: null,
          account_email: null,
          scopes: [],
          status: 'disconnected',
          last_error_code: null,
          oauth_pending_nonce: null,
          oauth_pending_expires_at: null,
          disconnected_at: new Date().toISOString(),
          selected_calendar_ids: null,
        })
        .eq('user_id', userId)
        .eq('provider', 'google')
        .select(
          'status, provider, account_email, scopes, last_error_code, disconnected_at, updated_at',
        )
        .maybeSingle()

      if (updateError) {
        logSafe('calendar-connection', { runId, code: 'disconnect_update_failed', ok: false })
        return json(500, { error: 'disconnect_failed', code: 'disconnect_update_failed', runId }, cors)
      }

      logSafe('calendar-connection', { runId, ok: true, action: 'disconnect', userId })
      return json(200, { ok: true, connection: toPublicConnection(updated), runId }, cors)
    }

    return json(405, { error: 'method_not_allowed', runId }, cors)
  } catch (err) {
    const code =
      err instanceof Error && err.message === 'supabase_service_misconfigured'
        ? 'supabase_service_misconfigured'
        : 'calendar_connection_failed'
    logSafe('calendar-connection', { runId, code, ok: false })
    return json(500, { error: 'calendar_connection_failed', code, runId }, cors)
  }
})
