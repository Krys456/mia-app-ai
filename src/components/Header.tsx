import { BrandLogo } from './BrandLogo'
import { useChat } from '../context/ChatContext'
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

export function Header() {
  const { newChat, openSettings, settingsOpen } = useChat()

  return (
    <header className="app-header" role="banner">
      <div className="app-header__inner">
        <button
          type="button"
          className="header-btn header-btn--brand"
          onClick={newChat}
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
            onClick={newChat}
            aria-label="New chat"
            title="New chat"
          >
            <IconNewChat />
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
