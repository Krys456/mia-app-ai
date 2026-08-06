import { useChat } from '../context/ChatContext'
import './Header.css'

function LogoMark() {
  return (
    <svg
      className="logo-mark"
      viewBox="0 0 48 48"
      width="28"
      height="28"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id="laifeGrad" x1="8" y1="8" x2="40" y2="40">
          <stop stopColor="#00F0FF" />
          <stop offset="1" stopColor="#FF6B9D" />
        </linearGradient>
      </defs>
      <rect width="48" height="48" rx="10" fill="#121214" />
      <path
        d="M24 9 V24 M24 24 L12 39 M24 24 L36 39"
        stroke="url(#laifeGrad)"
        strokeWidth="5"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  )
}

function IconNewChat() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 5v14M5 12h14"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  )
}

function IconSettings() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M19.4 13.5a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V19.5a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.1-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1H4.5a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.55-1.1 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34H10a1.7 1.7 0 0 0 1-1.55V4.5a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V10c.1.66.6 1.2 1.55 1.3h.09a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1.2Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function Header() {
  const { newChat, openSettings } = useChat()

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
          <LogoMark />
          <span className="brand-name">LAIfe</span>
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
            className="header-btn"
            onClick={openSettings}
            aria-label="Settings and personalization"
            title="Settings"
          >
            <IconSettings />
          </button>
        </div>
      </div>
    </header>
  )
}
