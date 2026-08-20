import { memo, type ReactNode } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { CodeBlock } from './CodeBlock'
import {
  CopyableBlock,
  LONG_QUOTE_COPY_CHARS,
  plainTextFromNode,
  plainTextLength,
} from './CopyableBlock'
import './StreamingRenderer.css'

interface StreamingRendererProps {
  content: string
  /** Show a soft caret while text is still revealing. */
  isStreaming?: boolean
}

function getText(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(getText).join('')
  if (node && typeof node === 'object' && 'props' in node) {
    const props = (node as { props?: { children?: ReactNode } }).props
    return getText(props?.children)
  }
  return ''
}

const markdownComponents: Components = {
  pre({ children }) {
    return <>{children}</>
  },
  code({ className, children }) {
    const text = getText(children).replace(/\n$/, '')
    const match = /language-([\w+-]+)/.exec(className || '')
    const looksBlock = Boolean(match) || text.includes('\n')

    if (!looksBlock) {
      return <code className="md-inline-code">{text}</code>
    }

    return <CodeBlock code={text} language={match?.[1]} />
  },
  blockquote({ children }) {
    const text = plainTextFromNode(children).replace(/\n{3,}/g, '\n\n').trim()
    const len = plainTextLength(children)
    // #331 — long quoted / prompt-like blockquotes get a dedicated copy control
    if (text.length >= LONG_QUOTE_COPY_CHARS || len >= LONG_QUOTE_COPY_CHARS) {
      return (
        <CopyableBlock text={text} variant="quote" caption="quote">
          <blockquote className="md-blockquote md-blockquote--copyable">{children}</blockquote>
        </CopyableBlock>
      )
    }
    return <blockquote className="md-blockquote">{children}</blockquote>
  },
  a({ href, children }) {
    return (
      <a href={href} target="_blank" rel="noreferrer noopener">
        {children}
      </a>
    )
  },
  input({ type, checked, disabled, ...rest }) {
    if (type === 'checkbox') {
      return (
        <input
          {...rest}
          type="checkbox"
          className="md-checkbox"
          checked={Boolean(checked)}
          disabled={disabled ?? true}
          readOnly
          aria-hidden="true"
          tabIndex={-1}
        />
      )
    }
    return <input type={type} checked={checked} disabled={disabled} {...rest} />
  },
}

function StreamingRendererComponent({
  content,
  isStreaming = false,
}: StreamingRendererProps) {
  // During reveal, skip full markdown/highlight to keep scroll + input smooth.
  if (isStreaming) {
    return (
      <div className="md-body md-body--streaming md-body--plain">
        <p className="md-plain">{content}</p>
        <span className="md-caret" aria-hidden="true" />
      </div>
    )
  }

  return (
    <div className="md-body md-body--settle">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {content}
      </ReactMarkdown>
    </div>
  )
}

export const StreamingRenderer = memo(StreamingRendererComponent)
