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

  return (
    <aside
      className={`citation-sources${compact ? ' citation-sources--compact' : ''}`}
      aria-label="Fonti"
    >
      <h3 className="citation-sources__heading">Fonti</h3>
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
    </aside>
  )
}

export const CitationSources = memo(CitationSourcesComponent)
