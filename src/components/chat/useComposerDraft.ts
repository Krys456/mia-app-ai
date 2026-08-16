import { useCallback, useState } from 'react'
import {
  createEmptyComposerDraft,
  type ComposerDraft,
} from './composerTypes'

export interface ComposerDraftApi {
  draft: ComposerDraft
  setText: (text: string) => void
  /** Wipe text + attachments (new chat / successful send). */
  clear: () => void
  /** Restore text after a rejected send without touching attachments. */
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

  const clear = useCallback(() => {
    setDraft(createEmptyComposerDraft())
  }, [])

  const restoreText = useCallback((text: string) => {
    setDraft((prev) => ({ ...prev, text }))
  }, [])

  return { draft, setText, clear, restoreText }
}
