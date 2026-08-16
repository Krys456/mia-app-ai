/**
 * Minimal composer draft model (#271).
 * Attachments are typed for #272 but unused / unrendered here.
 */

export type ComposerAttachmentKind = 'image' | 'file'

/** Future attachment stub — no pickers/previews/storage in #271. */
export interface ComposerAttachment {
  id: string
  kind: ComposerAttachmentKind
  /** Display name once attachments ship. */
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

export function createEmptyComposerDraft(): ComposerDraft {
  return { text: '', attachments: [] }
}

export function composerDraftHasText(draft: ComposerDraft): boolean {
  return draft.text.trim().length > 0
}
