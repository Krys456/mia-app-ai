import { useState, type ReactNode } from 'react'
import { Header } from './Header'
import { ChatThread } from './ChatThread'
import { Composer } from './Composer'
import { SettingsDrawer } from './SettingsDrawer'
import { MemoryPage } from './MemoryPage'
import { Home } from '../pages/Home'
import { FeaturePlaceholder } from '../pages/FeaturePlaceholder'
import { useChat } from '../context/ChatContext'
import type { AppView } from '../types'

const PLACEHOLDER_VIEWS: readonly AppView[] = [
  'vision',
  'documents',
  'search',
  'voice',
  'calendar',
  'smart-home',
]

function isPlaceholderView(view: AppView): boolean {
  return (PLACEHOLDER_VIEWS as readonly string[]).includes(view)
}

/**
 * Owns BrAIn dashboard navigation / view switching.
 * Keeps App.tsx limited to providers.
 */
export function AppRouter() {
  const [view, setView] = useState<AppView>('home')
  const { openSettings } = useChat()

  let content: ReactNode = null
  if (view === 'home') {
    content = <Home onNavigate={setView} onOpenSettings={openSettings} />
  } else if (view === 'chat') {
    content = (
      <>
        <ChatThread />
        <Composer />
      </>
    )
  } else if (view === 'memory') {
    content = <MemoryPage />
  } else if (isPlaceholderView(view)) {
    content = <FeaturePlaceholder view={view} onBack={() => setView('home')} />
  }

  return (
    <div className="app-shell">
      <Header view={view} onNavigate={setView} />
      {content}
      <SettingsDrawer />
    </div>
  )
}
