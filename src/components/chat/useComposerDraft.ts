import { useCallback, useState } from 'react'
import {
  createEmptyComposerDraft,
  MAX_COMPOSER_ATTACHMENTS,
  revokeComposerAttachment,
  revokeComposerAttachments,
  type ComposerAttachment,
  type ComposerDraft,
} from './composerTypes'

export interface ComposerDraftApi {
  draft: ComposerDraft
  setText: (text: string) => void
  /** Replace the single attachment (image or PDF). Revokes prior image preview. */
  setImageAttachment: (attachment: ComposerAttachment) => void
  /** Alias — replace single attachment (image XOR PDF). */
  setAttachment: (attachment: ComposerAttachment) => void
  removeAttachment: (id: string) => void
  /** Wipe text + attachments (new chat / successful send). */
  clear: () => void
  /** Restore text + attachments after a rejected send. */
  restore: (next: { text: string; attachments?: ComposerAttachment[] }) => void
  /** @deprecated use restore — kept for call-site clarity during migration */
  restoreText: (text: string) => void
}

/**
 * Local composer draft — kept out of chat context / settings / Memory.
 */
export function useComposerDraft(
  initial: ComposerDraft = createEmptyComposerDraft(),
): ComposerDraftApi {
  const [draft, setDraft] = useState<ComposerDraft>(initial)

  const setText = useCallback((text: string) => {
    setDraft((prev) => (prev.text === text ? prev : { ...prev, text }))
  }, [])

  const setImageAttachment = useCallback((attachment: ComposerAttachment) => {
    setDraft((prev) => {
      revokeComposerAttachments(prev.attachments)
      return {
        ...prev,
        attachments: [attachment].slice(0, MAX_COMPOSER_ATTACHMENTS),
      }
    })
  }, [])

  const setAttachment = setImageAttachment

  const removeAttachment = useCallback((id: string) => {
    setDraft((prev) => {
      const doomed = prev.attachments.find((a) => a.id === id)
      revokeComposerAttachment(doomed)
      return {
        ...prev,
        attachments: prev.attachments.filter((a) => a.id !== id),
      }
    })
  }, [])

  const clear = useCallback(() => {
    setDraft((prev) => {
      revokeComposerAttachments(prev.attachments)
      return createEmptyComposerDraft()
    })
  }, [])

  const restore = useCallback(
    (next: { text: string; attachments?: ComposerAttachment[] }) => {
      setDraft((prev) => {
        // Do not revoke next.attachments — they are being restored into the draft.
        const keepIds = new Set((next.attachments ?? []).map((a) => a.id))
        for (const att of prev.attachments) {
          if (!keepIds.has(att.id)) revokeComposerAttachment(att)
        }
        return {
          text: next.text,
          attachments: (next.attachments ?? []).slice(0, MAX_COMPOSER_ATTACHMENTS),
        }
      })
    },
    [],
  )

  const restoreText = useCallback((text: string) => {
    setDraft((prev) => ({ ...prev, text }))
  }, [])

  return {
    draft,
    setText,
    setImageAttachment,
    setAttachment,
    removeAttachment,
    clear,
    restore,
    restoreText,
  }
}
