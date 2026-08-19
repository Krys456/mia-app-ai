/**
 * #313 — Client active document context (metadata only).
 */

import type { ChatFileAttachment, ChatMessage } from '../types'

export type ActiveDocumentContext = {
  fileId: string
  filename: string
  mimeType: string
  size: number
  expiresAt?: number | null
  sourceTurnId?: string | null
}

export function isActiveDocumentExpired(
  doc: ActiveDocumentContext | null | undefined,
  nowMs = Date.now(),
): boolean {
  if (!doc || doc.expiresAt == null || !Number.isFinite(doc.expiresAt)) return false
  const expMs = doc.expiresAt > 1e12 ? doc.expiresAt : doc.expiresAt * 1000
  return expMs <= nowMs
}

/** Derive active document from the latest user file turn in chat history. */
export function deriveActiveDocumentFromMessages(
  messages: ChatMessage[],
): ActiveDocumentContext | null {
  if (!Array.isArray(messages)) return null
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i]
    if (m?.role !== 'user') continue
    const file = (m.attachments ?? []).find(
      (a): a is ChatFileAttachment => a.kind === 'file' && Boolean(a.fileId),
    )
    if (!file) continue
    return {
      fileId: file.fileId,
      filename: file.name,
      mimeType: file.mimeType,
      size: file.size,
      expiresAt: file.expiresAt ?? null,
      sourceTurnId: m.id,
    }
  }
  return null
}

export function truncateActiveDocumentName(name: string, max = 28): string {
  const n = String(name || 'document')
  if (n.length <= max) return n
  const ext = n.includes('.') ? n.slice(n.lastIndexOf('.')) : ''
  const keep = Math.max(8, max - ext.length - 1)
  return `${n.slice(0, keep)}…${ext}`
}
