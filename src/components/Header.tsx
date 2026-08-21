import { BrandLogo } from './BrandLogo'
import { BrandWordmark } from './BrandWordmark'
import { BRAND } from '../lib/brand'
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

function IconVision() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="2.5" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  )
}

function IconPlans() {
  // Subtle sparkle / ✦ — Plans entry (#332A). Not crown, card, or badge.
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 3.2 13.35 9.1 19 10.5 13.35 11.9 12 17.8 10.65 11.9 5 10.5 10.65 9.1 12 3.2Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M18.2 4.4v2.2M17.1 5.5h2.2"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  )
}

function IconSettings() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="3.1" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M12 3.5v1.6M12 18.9v1.6M20.5 12h-1.6M5.1 12H3.5M17.9 6.1l-1.1 1.1M7.2 16.8l-1.1 1.1M17.9 17.9l-1.1-1.1M7.2 7.2 6.1 6.1"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  )
}

interface HeaderProps {
  onNavigate: (view: AppView) => void
}

export function Header({ onNavigate }: HeaderProps) {
  const { newChat, toggleSettings, settingsOpen, messages } = useChat()
  /** #335B — quieter chrome on empty Home; keep all actions (de-emphasized in CSS). */
  const isHome = messages.length === 0

  const goHomeChat = () => {
    onNavigate('chat')
    if (messages.length > 0) {
      const ok = window.confirm(
        'Avviare una nuova chat? La conversazione corrente verrà chiusa. La Memoria salvata non verrà cancellata.',
      )
      if (!ok) return
    }
    newChat()
  }

  return (
    <header className={`app-header${isHome ? ' app-header--home' : ''}`} role="banner">
      <div className="app-header__inner">
        <button
          type="button"
          className="header-btn header-btn--brand"
          onClick={goHomeChat}
          aria-label={`${BRAND.accessibleProductName} — nuova chat`}
          title={BRAND.accessibleProductName}
        >
          <BrandLogo variant="mark" />
          <BrandWordmark showTagline={!isHome} emphasizeAi size="md" />
        </button>

        <div className="app-header__actions">
          <button
            type="button"
            className="header-btn header-btn--secondary"
            onClick={() => {
              onNavigate('chat')
              if (messages.length > 0) {
                const ok = window.confirm(
                  'Avviare una nuova chat? La conversazione corrente verrà chiusa. La Memoria salvata non verrà cancellata.',
                )
                if (!ok) return
              }
              newChat()
            }}
            aria-label="Nuova chat"
            title="Nuova chat"
          >
            <IconNewChat />
          </button>
          <button
            type="button"
            className="header-btn header-btn--secondary"
            onClick={() => onNavigate('vision')}
            aria-label="Vision AI"
            title="Vision AI"
          >
            <IconVision />
          </button>
          <button
            type="button"
            className="header-btn header-btn--plans header-btn--secondary"
            onClick={() => onNavigate('plans')}
            aria-label="Piani ShinkAIdo"
            title="Piani ShinkAIdo"
            data-testid="header-plans"
          >
            <IconPlans />
          </button>
          <button
            type="button"
            className={`header-btn${settingsOpen ? ' header-btn--active' : ''}`}
            onClick={toggleSettings}
            aria-label="Impostazioni"
            title="Impostazioni"
            aria-pressed={settingsOpen}
          >
            <IconSettings />
          </button>
        </div>
      </div>
    </header>
  )
}
