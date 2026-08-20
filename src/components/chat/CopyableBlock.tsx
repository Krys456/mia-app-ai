import { memo, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { copyText } from '../../lib/clipboard'
import { showCopyToast } from '../../lib/copyFeedback'
import './CopyableBlock.css'

export { LONG_QUOTE_COPY_CHARS } from '../../lib/copyFeedback'

interface CopyableBlockProps {
  /** Plain text copied to the clipboard (formatting preserved as plain text). */
  text: string
  /** Visual variant for styling. */
  variant?: 'code' | 'quote' | 'prompt'
  /** Optional language / caption shown opposite the copy control. */
  caption?: string | null
  children: ReactNode
  className?: string
}

function IconCopy() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="1.7" />
      <path
        d="M5 15V5a2 2 0 0 1 2-2h10"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  )
}

function IconCheck() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="m5 12 4.5 4.5L19 7"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/**
 * #331 — Copyable content shell: code / prompt / long quote blocks.
 * Copy control sits top-right with a ≥44×44 touch target.
 */
function CopyableBlockComponent({
  text,
  variant = 'code',
  caption = null,
  children,
  className = '',
}: CopyableBlockProps) {
  const [copied, setCopied] = useState(false)
  const copiedTimerRef = useRef<number | null>(null)

  useEffect(
    () => () => {
      if (copiedTimerRef.current != null) window.clearTimeout(copiedTimerRef.current)
    },
    [],
  )

  const onCopy = useCallback(async () => {
    const ok = await copyText(text)
    if (!ok) return
    showCopyToast('Copied to clipboard')
    setCopied(true)
    if (copiedTimerRef.current != null) window.clearTimeout(copiedTimerRef.current)
    copiedTimerRef.current = window.setTimeout(() => {
      copiedTimerRef.current = null
      setCopied(false)
    }, 1600)
  }, [text])

  return (
    <div
      className={`copyable-block copyable-block--${variant}${className ? ` ${className}` : ''}`}
    >
      <div className="copyable-block__bar">
        <span className="copyable-block__caption">{caption || '\u00a0'}</span>
        <button
          type="button"
          className={`copyable-block__copy${copied ? ' copyable-block__copy--done' : ''}`}
          onClick={() => void onCopy()}
          aria-label="Copy content"
          title={copied ? 'Copied' : 'Copy'}
        >
          <span className="copyable-block__copy-icon" aria-hidden="true">
            {copied ? <IconCheck /> : <IconCopy />}
          </span>
        </button>
      </div>
      <div className="copyable-block__body">{children}</div>
    </div>
  )
}

export const CopyableBlock = memo(CopyableBlockComponent)

/** Plain-text length of React children (for quote threshold). */
export function plainTextLength(node: ReactNode): number {
  if (typeof node === 'string' || typeof node === 'number') return String(node).length
  if (Array.isArray(node)) return node.reduce<number>((n, child) => n + plainTextLength(child), 0)
  if (node && typeof node === 'object' && 'props' in node) {
    const props = (node as { props?: { children?: ReactNode } }).props
    return plainTextLength(props?.children)
  }
  return 0
}

export function plainTextFromNode(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(plainTextFromNode).join('')
  if (node && typeof node === 'object' && 'props' in node) {
    const props = (node as { props?: { children?: ReactNode } }).props
    return plainTextFromNode(props?.children)
  }
  return ''
}
