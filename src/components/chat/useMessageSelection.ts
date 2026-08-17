/**
 * #290 — detect native browser text selection inside assistant message prose.
 * Does NOT replace OS selection / long-press. Listens after Selection exists.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  requestSelectionInsight,
  type SelectionOperation,
} from '../../lib/selectionApi'

export const MAX_CLIENT_SELECTED_CHARS = 280

export interface MessageSelectionSnapshot {
  selectedText: string
  sourceMessageId: string
  sourceRole: 'assistant'
  sourcePlainText: string
  /** Viewport rect for the first selection range — used to place the action bar. */
  anchorRect: {
    top: number
    left: number
    right: number
    bottom: number
    width: number
    height: number
  }
}

export interface SelectionInsightState {
  selectedText: string
  sourceMessageId: string
  sourcePlainText: string
  operation: SelectionOperation
  loading: boolean
  result: string | null
  error: string | null
}

function isEditableTarget(node: Node | null): boolean {
  if (!node) return false
  const el =
    node.nodeType === Node.ELEMENT_NODE
      ? (node as Element)
      : node.parentElement
  if (!el) return false
  if (el.closest('textarea, input, [contenteditable="true"], .composer, .composer-shell')) {
    return true
  }
  return false
}

function findAssistantMessageRoot(node: Node | null): HTMLElement | null {
  if (!node) return null
  const el =
    node.nodeType === Node.ELEMENT_NODE
      ? (node as Element)
      : node.parentElement
  if (!el) return null
  const root = el.closest('[data-message-id][data-role="assistant"]') as HTMLElement | null
  if (!root) return null
  // Must be inside prose body — not avatar/meta/actions/images.
  const body = root.querySelector('.bubble__body')
  if (!body || !body.contains(el)) return null
  // Prefer md-body / paragraph; allow body itself for streaming plain text.
  return root
}

function rangeInCodeBlock(range: Range): boolean {
  const node = range.commonAncestorContainer
  const el =
    node.nodeType === Node.ELEMENT_NODE
      ? (node as Element)
      : node.parentElement
  if (!el) return false
  return Boolean(el.closest('pre, .code-block, .hljs'))
}

function readSelectionSnapshot(): MessageSelectionSnapshot | null {
  if (typeof window === 'undefined' || typeof document === 'undefined') return null
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed || sel.rangeCount < 1) return null

  const selectedText = sel.toString().replace(/\s+/g, ' ').trim()
  if (!selectedText || selectedText.length > MAX_CLIENT_SELECTED_CHARS) return null

  const range = sel.getRangeAt(0)
  if (isEditableTarget(range.commonAncestorContainer)) return null
  if (rangeInCodeBlock(range)) return null

  const startRoot = findAssistantMessageRoot(range.startContainer)
  const endRoot = findAssistantMessageRoot(range.endContainer)
  if (!startRoot || !endRoot || startRoot !== endRoot) return null

  const sourceMessageId = startRoot.getAttribute('data-message-id') || ''
  if (!sourceMessageId) return null
  const sourcePlainText = (startRoot.getAttribute('data-plain-text') || '').trim()
  const rect = range.getBoundingClientRect()
  if (!rect || (rect.width === 0 && rect.height === 0)) return null

  return {
    selectedText,
    sourceMessageId,
    sourceRole: 'assistant',
    sourcePlainText,
    anchorRect: {
      top: rect.top,
      left: rect.left,
      right: rect.right,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
    },
  }
}

function resolveReplyLanguage(): string {
  if (typeof navigator === 'undefined') return 'it'
  const raw = (navigator.language || 'it').toLowerCase()
  const primary = raw.split(/[-_]/)[0] || 'it'
  if (primary === 'en' || primary === 'es' || primary === 'fr' || primary === 'de') {
    return primary
  }
  return 'it'
}

export function useMessageSelection() {
  const [snapshot, setSnapshot] = useState<MessageSelectionSnapshot | null>(null)
  const [insight, setInsight] = useState<SelectionInsightState | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const inFlightRef = useRef(false)
  const snapshotRef = useRef<MessageSelectionSnapshot | null>(null)
  snapshotRef.current = snapshot

  const clearSelectionUi = useCallback(() => {
    setSnapshot(null)
  }, [])

  const dismissInsight = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    inFlightRef.current = false
    setInsight(null)
  }, [])

  const dismissAll = useCallback(() => {
    dismissInsight()
    clearSelectionUi()
  }, [clearSelectionUi, dismissInsight])

  const refreshFromNativeSelection = useCallback(() => {
    // While an insight sheet is open, keep the selection metadata stable.
    if (insight && (insight.loading || insight.result || insight.error)) return
    const next = readSelectionSnapshot()
    setSnapshot(next)
  }, [insight])

  useEffect(() => {
    const onSelectionChange = () => {
      // Defer one frame so native selection UI settles (esp. mobile).
      window.requestAnimationFrame(() => refreshFromNativeSelection())
    }
    const onScroll = () => {
      // Avoid orphaned floating bars — clear action bar on scroll; keep sheet if open.
      if (insight?.loading || insight?.result || insight?.error) {
        setSnapshot(null)
        return
      }
      setSnapshot(null)
    }
    document.addEventListener('selectionchange', onSelectionChange)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('selectionchange', onSelectionChange)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [insight, refreshFromNativeSelection])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        dismissAll()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [dismissAll])

  const runOperation = useCallback(
    async (operation: SelectionOperation, fromInsight = false) => {
      const current = fromInsight
        ? insight
          ? {
              selectedText: insight.selectedText,
              sourceMessageId: insight.sourceMessageId,
              sourcePlainText: insight.sourcePlainText,
            }
          : null
        : snapshotRef.current
      if (!current?.selectedText || inFlightRef.current) return
      if (operation === 'explain' && !current.sourcePlainText.trim()) return

      inFlightRef.current = true
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller

      setInsight({
        selectedText: current.selectedText,
        sourceMessageId: current.sourceMessageId,
        sourcePlainText: current.sourcePlainText,
        operation,
        loading: true,
        result: null,
        error: null,
      })
      // Hide floating bar while sheet shows.
      setSnapshot(null)

      try {
        const replyLanguage = resolveReplyLanguage()
        const data = await requestSelectionInsight(
          {
            operation,
            selectedText: current.selectedText,
            ...(operation === 'explain'
              ? { sourceText: current.sourcePlainText }
              : current.sourcePlainText
                ? { sourceText: current.sourcePlainText }
                : {}),
            replyLanguage,
            browserLocale: typeof navigator !== 'undefined' ? navigator.language : 'it',
            conversationLanguage: replyLanguage,
          },
          { signal: controller.signal },
        )
        if (controller.signal.aborted) return
        setInsight({
          selectedText: current.selectedText,
          sourceMessageId: current.sourceMessageId,
          sourcePlainText: current.sourcePlainText,
          operation,
          loading: false,
          result: data.result,
          error: null,
        })
      } catch (error) {
        if (controller.signal.aborted) return
        const message = error instanceof Error ? error.message : String(error)
        setInsight({
          selectedText: current.selectedText,
          sourceMessageId: current.sourceMessageId,
          sourcePlainText: current.sourcePlainText,
          operation,
          loading: false,
          result: null,
          error: message || 'Richiesta non riuscita',
        })
      } finally {
        if (abortRef.current === controller) abortRef.current = null
        inFlightRef.current = false
      }
    },
    [insight],
  )

  const hasActiveSelection = Boolean(snapshot?.selectedText)

  return {
    snapshot,
    insight,
    hasActiveSelection,
    runDefine: () => void runOperation('define', false),
    runExplain: () => void runOperation('explain', false),
    retryInsight: () => {
      if (!insight) return
      void runOperation(insight.operation, true)
    },
    dismissInsight,
    dismissAll,
    clearSelectionUi,
  }
}

/** Exported for unit tests — pure selection reader. */
export const __selectionTestUtils = {
  readSelectionSnapshot,
  findAssistantMessageRoot,
  MAX_CLIENT_SELECTED_CHARS,
}
