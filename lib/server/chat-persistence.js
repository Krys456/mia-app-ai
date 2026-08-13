/**
 * Server-side conversation / message persistence (Supabase).
 * Fail-soft helpers — callers should catch and log without breaking /api/chat.
 */

import { getServiceSupabase } from './supabase.js'
import { ensureDefaultUserId } from './brain-memory.js'

/**
 * @param {import('@vercel/node').VercelRequest | { headers?: Record<string, unknown> }} req
 * @returns {string}
 */
export function readBrowserUserId(req) {
  const headers = req?.headers || {}
  const raw =
    headers['x-laife-user-id'] ||
    headers['X-LAIfe-User-Id'] ||
    headers['x-LAIfe-user-id']
  const value = Array.isArray(raw) ? raw[0] : raw
  const id = typeof value === 'string' ? value.trim() : ''
  return id && /^[a-zA-Z0-9_-]+$/.test(id) ? id : 'anonymous'
}

/**
 * @param {string} browserUserId
 */
async function resolveDbUserId(browserUserId) {
  const supabase = await getServiceSupabase()
  // Prefer a dedicated row per browser when possible; fall back to default API user.
  const email = `browser+${browserUserId.slice(0, 64)}@laife.local`
  const { data: existing, error: lookupError } = await supabase
    .from('users')
    .select('id')
    .eq('email', email)
    .maybeSingle()

  if (!lookupError && existing?.id) return String(existing.id)

  if (!lookupError) {
    const { data: created, error: createError } = await supabase
      .from('users')
      .insert({
        email,
        display_name: `LAIfe ${browserUserId.slice(0, 8)}`,
      })
      .select('id')
      .single()
    if (!createError && created?.id) return String(created.id)
    console.error('[chat-persistence] create browser user failed', createError)
  } else {
    console.error('[chat-persistence] lookup browser user failed', lookupError)
  }

  return ensureDefaultUserId(supabase)
}

/**
 * @param {object} input
 */
export async function upsertConversationRecord(input) {
  const browserUserId = String(input.browserUserId || 'anonymous')
  const conversationId = String(input.id || '').trim()
  if (!conversationId) throw new Error('conversation id required')

  const supabase = await getServiceSupabase()
  const userId = await resolveDbUserId(browserUserId)
  const metadata = {
    ...(input.metadata && typeof input.metadata === 'object' ? input.metadata : {}),
    browser_user_id: browserUserId,
  }

  const row = {
    id: conversationId,
    user_id: userId,
    title: typeof input.title === 'string' ? input.title : 'Chat',
    browser_user_id: browserUserId,
    engine: typeof input.engine === 'string' ? input.engine : 'v1',
    metadata,
  }

  const { data, error } = await supabase
    .from('conversations')
    .upsert(row, { onConflict: 'id' })
    .select(
      'id, user_id, title, browser_user_id, engine, metadata, created_at, updated_at',
    )
    .single()

  if (error) {
    console.error('[chat-persistence] upsertConversation failed', error)
    throw new Error(error.message || 'upsert conversation failed')
  }
  return data
}

/**
 * @param {string} browserUserId
 * @param {string} conversationId
 */
export async function getConversationWithMessages(browserUserId, conversationId) {
  const supabase = await getServiceSupabase()
  const { data: conversation, error } = await supabase
    .from('conversations')
    .select('id, user_id, title, browser_user_id, engine, metadata, created_at, updated_at')
    .eq('id', conversationId)
    .maybeSingle()

  if (error) {
    console.error('[chat-persistence] getConversation failed', error)
    throw new Error(error.message || 'get conversation failed')
  }
  if (!conversation) return null

  // Soft ownership check — allow default-user legacy rows without browser_user_id.
  if (
    conversation.browser_user_id &&
    conversation.browser_user_id !== browserUserId &&
    browserUserId !== 'anonymous'
  ) {
    return null
  }

  const { data: messages, error: msgError } = await supabase
    .from('messages')
    .select('id, conversation_id, role, content, client_id, kind, metadata, created_at, updated_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })

  if (msgError) {
    console.error('[chat-persistence] list messages failed', msgError)
    throw new Error(msgError.message || 'list messages failed')
  }

  return { ...conversation, messages: messages || [] }
}

/**
 * @param {string} browserUserId
 */
export async function listConversationsForBrowserUser(browserUserId) {
  const supabase = await getServiceSupabase()
  const { data, error } = await supabase
    .from('conversations')
    .select('id, user_id, title, browser_user_id, engine, metadata, created_at, updated_at')
    .eq('browser_user_id', browserUserId)
    .order('updated_at', { ascending: false })
    .limit(50)

  if (error) {
    console.error('[chat-persistence] listConversations failed', error)
    throw new Error(error.message || 'list conversations failed')
  }
  return data || []
}

/**
 * Upsert messages by (conversation_id, client_id).
 * @param {object} input
 */
export async function upsertMessagesForConversation(input) {
  const browserUserId = String(input.browserUserId || 'anonymous')
  const conversationId = String(input.conversationId || '').trim()
  const messages = Array.isArray(input.messages) ? input.messages : []
  if (!conversationId) throw new Error('conversation id required')
  if (messages.length === 0) return { syncedIds: [] }

  const supabase = await getServiceSupabase()
  const userId = await resolveDbUserId(browserUserId)

  // Ensure conversation exists (create shell if needed).
  await upsertConversationRecord({
    id: conversationId,
    browserUserId,
    title: input.title || 'Chat',
    engine: input.engine || 'v1',
    metadata: input.metadata || {},
  })

  const syncedIds = []
  for (const msg of messages) {
    const clientId = String(msg.clientId || msg.client_id || msg.id || '').trim()
    const role = String(msg.role || '').trim()
    const content = typeof msg.content === 'string' ? msg.content : ''
    if (!clientId || !['user', 'assistant', 'system'].includes(role)) continue

    const { data: existing } = await supabase
      .from('messages')
      .select('id')
      .eq('conversation_id', conversationId)
      .eq('client_id', clientId)
      .maybeSingle()

    if (existing?.id) {
      const { error: updateError } = await supabase
        .from('messages')
        .update({
          content,
          role,
          kind: msg.kind || null,
          metadata: msg.metadata && typeof msg.metadata === 'object' ? msg.metadata : {},
        })
        .eq('id', existing.id)
      if (updateError) {
        console.error('[chat-persistence] update message failed', updateError)
        throw new Error(updateError.message || 'update message failed')
      }
      syncedIds.push(clientId)
      continue
    }

    const insertRow = {
      conversation_id: conversationId,
      user_id: userId,
      role,
      content,
      client_id: clientId,
      kind: msg.kind || null,
      metadata: msg.metadata && typeof msg.metadata === 'object' ? msg.metadata : {},
    }
    if (msg.createdAt) {
      const ts =
        typeof msg.createdAt === 'number'
          ? new Date(msg.createdAt).toISOString()
          : String(msg.createdAt)
      insertRow.created_at = ts
    }

    const { error: insertError } = await supabase.from('messages').insert(insertRow)
    if (insertError) {
      console.error('[chat-persistence] insert message failed', insertError)
      throw new Error(insertError.message || 'insert message failed')
    }
    syncedIds.push(clientId)
  }

  // Touch conversation updated_at
  await supabase
    .from('conversations')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', conversationId)

  return { syncedIds }
}

/**
 * @param {string} browserUserId
 * @param {string} conversationId
 */
export async function deleteConversationRecord(browserUserId, conversationId) {
  const supabase = await getServiceSupabase()
  const { data: existing } = await supabase
    .from('conversations')
    .select('id, browser_user_id')
    .eq('id', conversationId)
    .maybeSingle()

  if (!existing) return { deleted: false }
  if (
    existing.browser_user_id &&
    existing.browser_user_id !== browserUserId &&
    browserUserId !== 'anonymous'
  ) {
    throw new Error('forbidden')
  }

  const { error } = await supabase.from('conversations').delete().eq('id', conversationId)
  if (error) {
    console.error('[chat-persistence] delete conversation failed', error)
    throw new Error(error.message || 'delete failed')
  }
  return { deleted: true }
}
