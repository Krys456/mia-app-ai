import { memo, useMemo } from 'react'
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
import { CopyableBlock } from './CopyableBlock'
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

const PROMPT_LANGS = new Set(['prompt', 'prompts', 'plaintext', 'text', 'txt'])

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

function isPromptLanguage(lang: string): boolean {
  return PROMPT_LANGS.has(lang.trim().toLowerCase())
}

function CodeBlockComponent({ code, language }: CodeBlockProps) {
  const { lang, html } = useMemo(() => detectLanguage(code, language), [code, language])
  const promptLike = isPromptLanguage(lang) || isPromptLanguage(language || '')
  const label = promptLike
    ? 'prompt'
    : lang && lang !== 'text'
      ? lang
      : 'code'

  return (
    <CopyableBlock
      text={code}
      variant={promptLike ? 'prompt' : 'code'}
      caption={label}
      className="code-block"
    >
      <pre className="code-block__pre scroll-surface">
        <code
          className={`hljs language-${lang}`}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </pre>
    </CopyableBlock>
  )
}

export const CodeBlock = memo(CodeBlockComponent)
