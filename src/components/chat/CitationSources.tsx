import { memo } from 'react'
import type { WebCitation } from '../../types'
import './CitationSources.css'

interface CitationSourcesProps {
  citations: WebCitation[]
  /** Compact styling for selection insight sheet. */
  compact?: boolean
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

function CitationSourcesComponent({ citations, compact = false }: CitationSourcesProps) {
  if (!citations.length) return null

  const count = citations.length
  const list = (
    <ol className="citation-sources__list">
      {citations.map((citation) => {
        const host = hostnameOf(citation.url)
        return (
          <li key={citation.url} className="citation-sources__item">
            <a
              className="citation-sources__link"
              href={citation.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              <span className="citation-sources__title">{citation.title}</span>
              {host ? <span className="citation-sources__host">{host}</span> : null}
            </a>
          </li>
        )
      })}
    </ol>
  )

  return (
    <aside
      className={`citation-sources${compact ? ' citation-sources--compact' : ''}`}
      aria-label={`Fonti · ${count}`}
    >
      {/*
        Chat: collapsed “Fonti · N” disclosure.
        Selection sheet (compact): open by default for immediate trust.
      */}
      <details className="citation-sources__details" open={compact || undefined}>
        <summary className="citation-sources__summary">
          <span className="citation-sources__summary-label">Fonti</span>
          <span className="citation-sources__summary-count" aria-hidden="true">
            · {count}
          </span>
        </summary>
        {list}
      </details>
    </aside>
  )
}

export const CitationSources = memo(CitationSourcesComponent)
