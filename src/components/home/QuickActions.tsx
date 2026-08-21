/**
 * #335B — Home quick actions (paper annotations, existing capabilities only).
 */

import { useChat } from '../../context/ChatContext'
import { HOME_QUICK_ACTIONS, type HomeQuickAction } from '../../lib/homeQuickActions'
import './QuickActions.css'

function IconMeteo() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="3.2" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M12 4.2v1.6M12 18.2v1.6M4.2 12H5.8M18.2 12h1.6M6.6 6.6l1.1 1.1M16.3 16.3l1.1 1.1M17.4 6.6l-1.1 1.1M7.7 16.3l-1.1 1.1"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  )
}

function IconCalendario() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="4" y="5.5" width="16" height="14" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M8 3.8v3M16 3.8v3M4 10h16" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

function IconBriefing() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M7 5.5h10a1.5 1.5 0 0 1 1.5 1.5v11l-3-1.8-3 1.8-3-1.8-3 1.8V7A1.5 1.5 0 0 1 7 5.5Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M9 10h6M9 13h4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

function IconFocus() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="13" r="6.2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M12 9.8v3.4l2.2 1.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M9 4.2h6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

function iconFor(id: HomeQuickAction['id']) {
  switch (id) {
    case 'meteo':
      return <IconMeteo />
    case 'calendario':
      return <IconCalendario />
    case 'briefing':
      return <IconBriefing />
    case 'focus':
      return <IconFocus />
  }
}

export function QuickActions() {
  const { sendMessage, openSettings } = useChat()

  const onActivate = (action: HomeQuickAction) => {
    if (action.kind === 'openSettings') {
      openSettings()
      return
    }
    if (action.kind === 'sendMessage' && action.message) {
      sendMessage(action.message)
    }
  }

  return (
    <nav className="home-actions motion-ink-reveal" aria-label="Azioni rapide" data-home="quick-actions">
      <ul className="home-actions__list">
        {HOME_QUICK_ACTIONS.map((action) => (
          <li key={action.id}>
            <button
              type="button"
              className="home-action"
              data-action={action.id}
              aria-label={`${action.label}: ${action.description}`}
              title={action.description}
              disabled={action.kind === 'unavailable'}
              onClick={() => onActivate(action)}
            >
              <span className="home-action__mark" aria-hidden="true">
                {iconFor(action.id)}
              </span>
              <span className="home-action__label type-nav">{action.label}</span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  )
}
