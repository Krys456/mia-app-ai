/**
 * Minimal composer draft model (#271 / #272).
 */

import type { SupportedImageMime } from '../../types'

export type ComposerAttachmentKind = 'image' | 'file'

/** Draft attachment — images in #272; `file` reserved for later. */
export interface ComposerAttachment {
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
  if (!att) return
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
