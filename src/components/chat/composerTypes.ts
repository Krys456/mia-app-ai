/**
 * Minimal composer draft model (#271 / #272 / #275 / #276).
 */

import type { SupportedDocumentMime, SupportedImageMime } from '../../types'

export type ComposerAttachmentKind = 'image' | 'file'

export interface ComposerImageAttachment {
  id: string
  kind: 'image'
  mimeType: SupportedImageMime
  dataUrl: string
  previewUrl: string
  width?: number
  height?: number
  /** When true, previewUrl is a blob: URL that must be revoked on clear/remove. */
  previewIsObjectUrl?: boolean
  name?: string
}

export interface ComposerFileAttachment {
  id: string
  kind: 'file'
  name: string
  mimeType: SupportedDocumentMime
  size: number
  /** Local File held until Send / upload — never placed in ChatMessage history. */
  localFile?: File
  /** Set after successful /api/files upload — reused on chat retry. */
  fileId?: string
  expiresAt?: number
}

export type ComposerAttachment = ComposerImageAttachment | ComposerFileAttachment

export interface ComposerDraft {
  text: string
  attachments: ComposerAttachment[]
}

export const EMPTY_COMPOSER_DRAFT: ComposerDraft = {
  text: '',
  attachments: [],
}

export const MAX_COMPOSER_ATTACHMENTS = 1

export function createEmptyComposerDraft(): ComposerDraft {
  return { text: '', attachments: [] }
}

export function composerDraftHasText(draft: ComposerDraft): boolean {
  return draft.text.trim().length > 0
}

export function composerDraftCanSend(draft: ComposerDraft): boolean {
  return composerDraftHasText(draft) || draft.attachments.length > 0
}

export function revokeComposerAttachment(att: ComposerAttachment | undefined | null): void {
  if (!att || att.kind !== 'image') return
  if (att.previewIsObjectUrl && att.previewUrl.startsWith('blob:')) {
    try {
      URL.revokeObjectURL(att.previewUrl)
    } catch {
      /* ignore */
    }
  }
}

export function revokeComposerAttachments(attachments: ComposerAttachment[]): void {
  for (const att of attachments) revokeComposerAttachment(att)
}
