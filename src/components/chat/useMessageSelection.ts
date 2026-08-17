/**
 * #290 — detect native browser text selection inside assistant message prose.
 * Does NOT replace OS selection / long-press. Listens after Selection exists.
 * Never rewrites the browser Range (no Selection mutation APIs).
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  requestSelectionInsight,
  type SelectionOperation,
} from '../../lib/selectionApi'
import {
  DESKTOP_SELECTION_SETTLE_MS,
  MOBILE_SELECTION_SETTLE_MS,
  isCoarsePointerMobile,
  sameAssistantMessageId,
} from './selectionToolbarLayout'

export const MAX_CLIENT_SELECTED_CHARS = 280

/** Nodes/controls that must never author a LAIfe selection. */
const EXCLUDED_SELECTION_ANCESTOR =
  [
    'textarea',
    'input',
    '[contenteditable="true"]',
    '.composer',
    '.composer-dock',
    '.composer-shell',
    '.composer-form',
    '.message-actions',
    '.selection-action-bar',
    '.selection-insight',
    '.app-header',
    '.bubble__attachment-open',
    '.bubble__attachment-download',
    '.bubble__attachment-figure',
    'pre',
    '.code-block',
    '.hljs',
  ].join(', ')

export interface MessageSelectionSnapshot {
  selectedText: string
  sourceMessageId: string
  sourceRole: 'assistant'
  sourcePlainText: string
  /** Viewport rect for the settled selection range — used to place the action bar. */
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

function nodeToElement(node: Node | null): Element | null {
  if (!node) return null
  return node.nodeType === Node.ELEMENT_NODE
    ? (node as Element)
    : node.parentElement
}

function isExcludedSelectionNode(node: Node | null): boolean {
  const el = nodeToElement(node)
  if (!el) return true
  return Boolean(el.closest(EXCLUDED_SELECTION_ANCESTOR))
}

/**
 * Resolve a Range endpoint to the assistant `.bubble__body` that owns it.
 * Returns null when the endpoint is outside a single assistant message body.
 */
function resolveAssistantBubbleBody(node: Node | null): HTMLElement | null {
  if (!node || isExcludedSelectionNode(node)) return null
  const el = nodeToElement(node)
  if (!el) return null

  const root = el.closest(
    '[data-message-id][data-role="assistant"]',
  ) as HTMLElement | null
  if (!root) return null

  const body = root.querySelector('.bubble__body') as HTMLElement | null
  if (!body || !body.contains(el)) return null
  // Endpoint must live in the prose body — not avatar/meta/actions/images.
  if (isExcludedSelectionNode(el)) return null
  return body
}

function rangeTouchesExcluded(range: Range): boolean {
  if (isExcludedSelectionNode(range.commonAncestorContainer)) return true
  if (isExcludedSelectionNode(range.startContainer)) return true
  if (isExcludedSelectionNode(range.endContainer)) return true
  return false
}

/**
 * A LAIfe selection is valid ONLY when BOTH Range endpoints belong to the
 * SAME assistant message `.bubble__body`. Invalid → null (toolbar hidden).
 * Does not mutate the native Selection.
 */
function readSelectionSnapshot(): MessageSelectionSnapshot | null {
  if (typeof window === 'undefined' || typeof document === 'undefined') return null
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed || sel.rangeCount < 1) return null

  const selectedText = sel.toString().replace(/\s+/g, ' ').trim()
  if (!selectedText || selectedText.length > MAX_CLIENT_SELECTED_CHARS) return null

  const range = sel.getRangeAt(0)
  if (rangeTouchesExcluded(range)) return null

  const startBody = resolveAssistantBubbleBody(range.startContainer)
  const endBody = resolveAssistantBubbleBody(range.endContainer)
  if (!startBody || !endBody || startBody !== endBody) return null

  const messageRoot = startBody.closest(
    '[data-message-id][data-role="assistant"]',
  ) as HTMLElement | null
  if (!messageRoot) return null

  const sourceMessageId = messageRoot.getAttribute('data-message-id') || ''
  if (!sourceMessageId) return null
  // Defense in depth — message id must match for both endpoints (same body ⇒ same root).
  const endRoot = endBody.closest('[data-message-id]') as HTMLElement | null
  if (
    !sameAssistantMessageId(
      sourceMessageId,
      endRoot?.getAttribute('data-message-id'),
    )
  ) {
    return null
  }

  const sourcePlainText = (messageRoot.getAttribute('data-plain-text') || '').trim()
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

function settleDelayMs(): number {
  return isCoarsePointerMobile()
    ? MOBILE_SELECTION_SETTLE_MS
    : DESKTOP_SELECTION_SETTLE_MS
}

export function useMessageSelection() {
  const [snapshot, setSnapshot] = useState<MessageSelectionSnapshot | null>(null)
  const [insight, setInsight] = useState<SelectionInsightState | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const inFlightRef = useRef(false)
  const snapshotRef = useRef<MessageSelectionSnapshot | null>(null)
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const insightOpenRef = useRef(false)
  snapshotRef.current = snapshot
  insightOpenRef.current = Boolean(
    insight && (insight.loading || insight.result || insight.error),
  )

  const clearSettleTimer = useCallback(() => {
    if (settleTimerRef.current != null) {
      clearTimeout(settleTimerRef.current)
      settleTimerRef.current = null
    }
  }, [])

  const clearSelectionUi = useCallback(() => {
    clearSettleTimer()
    setSnapshot(null)
  }, [clearSettleTimer])

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

  const commitSettledSnapshot = useCallback(() => {
    // While an insight sheet is open, keep selection metadata stable.
    if (insightOpenRef.current) return
    const next = readSelectionSnapshot()
    setSnapshot(next)
  }, [])

  const scheduleSelectionRefresh = useCallback(() => {
    if (insightOpenRef.current) return

    clearSettleTimer()

    const delay = settleDelayMs()
    if (delay <= 0) {
      // Desktop: respond on the next frame — no mobile settle delay.
      window.requestAnimationFrame(() => commitSettledSnapshot())
      return
    }

    // Mobile: while handles are moving, hide LAIfe chrome immediately so it
    // never competes with native selection UI. Do not touch the browser Range.
    setSnapshot(null)
    settleTimerRef.current = setTimeout(() => {
      settleTimerRef.current = null
      commitSettledSnapshot()
    }, delay)
  }, [clearSettleTimer, commitSettledSnapshot])

  useEffect(() => {
    const onSelectionChange = () => {
      scheduleSelectionRefresh()
    }
    const onScroll = () => {
      // Avoid orphaned floating bars — clear action bar on scroll; keep sheet if open.
      clearSettleTimer()
      setSnapshot(null)
    }
    document.addEventListener('selectionchange', onSelectionChange)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('selectionchange', onSelectionChange)
      window.removeEventListener('scroll', onScroll, true)
      clearSettleTimer()
    }
  }, [clearSettleTimer, scheduleSelectionRefresh])

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
      // Capture text from the settled snapshot BEFORE any UI change can
      // disturb the native Selection (toolbar must not become the Range).
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

      const capturedText = current.selectedText
      const capturedMessageId = current.sourceMessageId
      const capturedPlain = current.sourcePlainText

      inFlightRef.current = true
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller

      setInsight({
        selectedText: capturedText,
        sourceMessageId: capturedMessageId,
        sourcePlainText: capturedPlain,
        operation,
        loading: true,
        result: null,
        error: null,
      })
      // Hide floating bar while sheet shows.
      clearSettleTimer()
      setSnapshot(null)

      try {
        const replyLanguage = resolveReplyLanguage()
        const data = await requestSelectionInsight(
          {
            operation,
            selectedText: capturedText,
            ...(operation === 'explain'
              ? { sourceText: capturedPlain }
              : capturedPlain
                ? { sourceText: capturedPlain }
                : {}),
            replyLanguage,
            browserLocale: typeof navigator !== 'undefined' ? navigator.language : 'it',
            conversationLanguage: replyLanguage,
          },
          { signal: controller.signal },
        )
        if (controller.signal.aborted) return
        setInsight({
          selectedText: capturedText,
          sourceMessageId: capturedMessageId,
          sourcePlainText: capturedPlain,
          operation,
          loading: false,
          result: data.result,
          error: null,
        })
      } catch (error) {
        if (controller.signal.aborted) return
        const message = error instanceof Error ? error.message : String(error)
        setInsight({
          selectedText: capturedText,
          sourceMessageId: capturedMessageId,
          sourcePlainText: capturedPlain,
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
    [clearSettleTimer, insight],
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

/** Exported for unit tests — pure selection reader / validators. */
export const __selectionTestUtils = {
  readSelectionSnapshot,
  resolveAssistantBubbleBody,
  isExcludedSelectionNode,
  rangeTouchesExcluded,
  MAX_CLIENT_SELECTED_CHARS,
  EXCLUDED_SELECTION_ANCESTOR,
  settleDelayMs,
}
