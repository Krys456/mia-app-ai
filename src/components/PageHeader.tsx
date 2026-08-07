import type { ReactNode } from 'react'
import { PageBackButton } from './PageBackButton'
import './PageHeader.css'

interface PageHeaderProps {
  title: string
  onBack: () => void
  backLabel?: string
  /** Optional controls aligned to the right (same row as back + title). */
  actions?: ReactNode
}

/**
 * Shared chrome for secondary screens:
 * [← Indietro]  [Title]  [actions?]
 */
export function PageHeader({
  title,
  onBack,
  backLabel = 'Indietro',
  actions,
}: PageHeaderProps) {
  return (
    <header className="page-header" role="banner">
      <div className="page-header__inner">
        <div className="page-header__start">
          <PageBackButton label={backLabel} onClick={onBack} />
        </div>
        <h1 className="page-header__title">{title}</h1>
        <div className="page-header__actions">{actions ?? null}</div>
      </div>
    </header>
  )
}
