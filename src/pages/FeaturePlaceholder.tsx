import type { AppView } from '../types'
import './FeaturePlaceholder.css'

const TITLES: Partial<Record<AppView, string>> = {
  vision: 'Vision',
  documents: 'Documents',
  search: 'Search',
  voice: 'Voice',
  calendar: 'Calendar',
  'smart-home': 'Smart Home',
}

type FeaturePlaceholderProps = {
  view: AppView
  onBack: () => void
}

export function FeaturePlaceholder({ view, onBack }: FeaturePlaceholderProps) {
  const title = TITLES[view] ?? 'Feature'

  return (
    <main className="feature-placeholder">
      <div className="feature-placeholder__inner">
        <button type="button" className="feature-placeholder__back" onClick={onBack}>
          ← Dashboard
        </button>
        <p className="feature-placeholder__kicker">BrAIn</p>
        <h1>{title}</h1>
        <p className="feature-placeholder__lead">
          This route is ready. Content for {title} will arrive in a later step.
        </p>
      </div>
    </main>
  )
}
