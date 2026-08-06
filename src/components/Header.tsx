import { BrandLogo } from './BrandLogo'
import { useChat } from '../context/ChatContext'
import type { AppView } from '../types'
import './Header.css'

function IconNewChat() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 5v14M5 12h14"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  )
}

function IconMemory() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M6.5 7.5h11v11a2 2 0 0 1-2 2h-7a2 2 0 0 1-2-2v-11Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path
        d="M9 7.5V5.8A1.8 1.8 0 0 1 10.8 4h2.4A1.8 1.8 0 0 1 15 5.8V7.5"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <path d="M9.5 12h5M9.5 15.5h5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  )
}

function IconVision() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="2.5" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  )
}

function IconSettings() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="3.1" stroke="currentColor" strokeWidth="1.7" />
      <path
        d="M12 3.5v1.6M12 18.9v1.6M20.5 12h-1.6M5.1 12H3.5M17.9 6.1l-1.1 1.1M7.2 16.8l-1.1 1.1M17.9 17.9l-1.1-1.1M7.2 7.2 6.1 6.1"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  )
}

interface HeaderProps {
  view: AppView
  onNavigate: (view: AppView) => void
}

export function Header({ view, onNavigate }: HeaderProps) {
  const { newChat, openSettings, settingsOpen } = useChat()

  const goHomeChat = () => {
    onNavigate('chat')
    newChat()
  }

  return (
    <header className="app-header" role="banner">
      <div className="app-header__inner">
        <button
          type="button"
          className="header-btn header-btn--brand"
          onClick={goHomeChat}
          aria-label="LAIfe home — start fresh chat"
          title="LAIfe"
        >
          <BrandLogo variant="mark" />
          <span className="brand-wordmark">
            <span className="brand-wordmark__name">LAIfe</span>
            <span className="brand-wordmark__tag">Your AI, Your Life.</span>
          </span>
        </button>

        <div className="app-header__actions">
          <button
            type="button"
            className="header-btn"
            onClick={() => {
              onNavigate('chat')
              newChat()
            }}
            aria-label="New chat"
            title="New chat"
          >
            <IconNewChat />
          </button>
          <button
            type="button"
            className={`header-btn${view === 'memory' ? ' header-btn--active' : ''}`}
            onClick={() => onNavigate('memory')}
            aria-label="Memory"
            title="Memory"
            aria-pressed={view === 'memory'}
          >
            <IconMemory />
          </button>
          <button
            type="button"
            className={`header-btn${view === 'vision' ? ' header-btn--active' : ''}`}
            onClick={() => onNavigate('vision')}
            aria-label="Vision"
            title="Vision"
            aria-pressed={view === 'vision'}
          >
            <IconVision />
          </button>
          <button
            type="button"
            className={`header-btn${settingsOpen ? ' header-btn--active' : ''}`}
            onClick={openSettings}
            aria-label="Settings and personalization"
            title="Settings"
            aria-pressed={settingsOpen}
          >
            <IconSettings />
          </button>
        </div>
      </div>
    </header>
  )
}
