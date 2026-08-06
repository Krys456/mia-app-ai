import type { ReactNode } from 'react'
import type { AppView } from '../types'
import { DashboardCard } from '../components/dashboard/DashboardCard'
import './Home.css'

type HomeProps = {
  onNavigate: (view: AppView) => void
  onOpenSettings: () => void
}

function IconChat() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M5 6.5A2.5 2.5 0 0 1 7.5 4h9A2.5 2.5 0 0 1 19 6.5v6A2.5 2.5 0 0 1 16.5 15H10l-4 4v-4.2A2.5 2.5 0 0 1 5 12.5v-6Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
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

function IconDocuments() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M7 3.5h7l4 4V20a1.5 1.5 0 0 1-1.5 1.5h-9.5A1.5 1.5 0 0 1 5.5 20V5A1.5 1.5 0 0 1 7 3.5Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path d="M14 3.5V8h4.5M8.5 12h7M8.5 15.5h7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  )
}

function IconSearch() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.7" />
      <path d="m16 16 4 4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  )
}

function IconVoice() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="9" y="3.5" width="6" height="11" rx="3" stroke="currentColor" strokeWidth="1.7" />
      <path
        d="M6.5 11.5a5.5 5.5 0 0 0 11 0M12 17v3.5"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  )
}

function IconCalendar() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3.5" y="5" width="17" height="15.5" rx="2" stroke="currentColor" strokeWidth="1.7" />
      <path d="M3.5 9.5h17M8 3.5v3M16 3.5v3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  )
}

function IconSmartHome() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="m4 11 8-7 8 7v8.5a1.5 1.5 0 0 1-1.5 1.5H5.5A1.5 1.5 0 0 1 4 19.5V11Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path d="M10 20.5v-6h4v6" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
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

const DASHBOARD_ITEMS: Array<{
  id: AppView | 'settings-drawer'
  title: string
  description: string
  icon: ReactNode
}> = [
  {
    id: 'chat',
    title: 'Chat',
    description: 'Talk with LAIfe in a focused conversation.',
    icon: <IconChat />,
  },
  {
    id: 'memory',
    title: 'Memory',
    description: 'Browse and manage what BrAIn remembers.',
    icon: <IconMemory />,
  },
  {
    id: 'vision',
    title: 'Vision',
    description: 'See and understand images — coming soon.',
    icon: <IconVision />,
  },
  {
    id: 'documents',
    title: 'Documents',
    description: 'Work with files and notes — coming soon.',
    icon: <IconDocuments />,
  },
  {
    id: 'search',
    title: 'Search',
    description: 'Find across your world — coming soon.',
    icon: <IconSearch />,
  },
  {
    id: 'voice',
    title: 'Voice',
    description: 'Speak with LAIfe — coming soon.',
    icon: <IconVoice />,
  },
  {
    id: 'calendar',
    title: 'Calendar',
    description: 'Plans and schedules — coming soon.',
    icon: <IconCalendar />,
  },
  {
    id: 'smart-home',
    title: 'Smart Home',
    description: 'Control your space — coming soon.',
    icon: <IconSmartHome />,
  },
  {
    id: 'settings-drawer',
    title: 'Settings',
    description: 'Personalize tone, theme, and preferences.',
    icon: <IconSettings />,
  },
]

export function Home({ onNavigate, onOpenSettings }: HomeProps) {
  return (
    <main className="brain-home">
      <div className="brain-home__inner">
        <header className="brain-home__header">
          <p className="brain-home__kicker">BrAIn</p>
          <h1>Dashboard</h1>
          <p className="brain-home__lead">
            Your LAIfe hub — pick a destination to continue.
          </p>
        </header>

        <section className="brain-home__grid" aria-label="BrAIn destinations">
          {DASHBOARD_ITEMS.map((item, index) => (
            <div
              key={item.id}
              className="brain-home__card-wrap"
              style={{ animationDelay: `${index * 40}ms` }}
            >
              <DashboardCard
                icon={item.icon}
                title={item.title}
                description={item.description}
                onClick={() => {
                  if (item.id === 'settings-drawer') {
                    onOpenSettings()
                    return
                  }
                  onNavigate(item.id)
                }}
              />
            </div>
          ))}
        </section>
      </div>
    </main>
  )
}
