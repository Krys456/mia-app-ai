import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import hljs from 'highlight.js/lib/core'
import javascript from 'highlight.js/lib/languages/javascript'
import typescript from 'highlight.js/lib/languages/typescript'
import json from 'highlight.js/lib/languages/json'
import xml from 'highlight.js/lib/languages/xml'
import css from 'highlight.js/lib/languages/css'
import python from 'highlight.js/lib/languages/python'
import bash from 'highlight.js/lib/languages/bash'
import sql from 'highlight.js/lib/languages/sql'
import markdown from 'highlight.js/lib/languages/markdown'
import java from 'highlight.js/lib/languages/java'
import go from 'highlight.js/lib/languages/go'
import rust from 'highlight.js/lib/languages/rust'
import csharp from 'highlight.js/lib/languages/csharp'
import php from 'highlight.js/lib/languages/php'
import ruby from 'highlight.js/lib/languages/ruby'
import yaml from 'highlight.js/lib/languages/yaml'
import { copyText } from '../../lib/clipboard'
import './CodeBlock.css'

hljs.registerLanguage('javascript', javascript)
hljs.registerLanguage('js', javascript)
hljs.registerLanguage('typescript', typescript)
hljs.registerLanguage('ts', typescript)
hljs.registerLanguage('tsx', typescript)
hljs.registerLanguage('jsx', javascript)
hljs.registerLanguage('json', json)
hljs.registerLanguage('html', xml)
hljs.registerLanguage('xml', xml)
hljs.registerLanguage('css', css)
hljs.registerLanguage('python', python)
hljs.registerLanguage('py', python)
hljs.registerLanguage('bash', bash)
hljs.registerLanguage('shell', bash)
hljs.registerLanguage('sh', bash)
hljs.registerLanguage('sql', sql)
hljs.registerLanguage('markdown', markdown)
hljs.registerLanguage('md', markdown)
hljs.registerLanguage('java', java)
hljs.registerLanguage('go', go)
hljs.registerLanguage('rust', rust)
hljs.registerLanguage('csharp', csharp)
hljs.registerLanguage('cs', csharp)
hljs.registerLanguage('php', php)
hljs.registerLanguage('ruby', ruby)
hljs.registerLanguage('yaml', yaml)
hljs.registerLanguage('yml', yaml)

interface CodeBlockProps {
  code: string
  language?: string
}

function detectLanguage(code: string, hinted?: string): { lang: string; html: string } {
  const hint = hinted?.trim().toLowerCase()
  if (hint && hljs.getLanguage(hint)) {
    try {
      return { lang: hint, html: hljs.highlight(code, { language: hint }).value }
    } catch {
      /* fall through */
    }
  }

  try {
    const result = hljs.highlightAuto(code)
    return {
      lang: result.language ?? hint ?? 'text',
      html: result.value,
    }
  } catch {
    return {
      lang: hint || 'text',
      html: escapeHtml(code),
    }
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function CodeBlockComponent({ code, language }: CodeBlockProps) {
  const [copied, setCopied] = useState(false)
  const copiedTimerRef = useRef<number | null>(null)
  const { lang, html } = useMemo(() => detectLanguage(code, language), [code, language])
  const label = lang && lang !== 'text' ? lang : 'code'

  useEffect(
    () => () => {
      if (copiedTimerRef.current != null) window.clearTimeout(copiedTimerRef.current)
    },
    [],
  )

  const onCopy = useCallback(async () => {
    const ok = await copyText(code)
    if (!ok) return
    setCopied(true)
    if (copiedTimerRef.current != null) window.clearTimeout(copiedTimerRef.current)
    copiedTimerRef.current = window.setTimeout(() => {
      copiedTimerRef.current = null
      setCopied(false)
    }, 1600)
  }, [code])

  return (
    <div className="code-block">
      <div className="code-block__bar">
        <span className="code-block__lang">{label}</span>
        <button
          type="button"
          className={`code-block__copy${copied ? ' code-block__copy--done' : ''}`}
          onClick={() => void onCopy()}
          aria-label={copied ? 'Copiato' : 'Copia codice'}
        >
          {copied ? 'Copiato' : 'Copia'}
        </button>
      </div>
      <pre className="code-block__pre scroll-surface">
        <code
          className={`hljs language-${lang}`}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </pre>
    </div>
  )
}

export const CodeBlock = memo(CodeBlockComponent)
