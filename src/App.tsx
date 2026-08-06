import { useState } from 'react'
import { Header } from './components/Header'
import { ChatThread } from './components/ChatThread'
import { Composer } from './components/Composer'
import { SettingsDrawer } from './components/SettingsDrawer'
import { MemoryPage } from './components/MemoryPage'
import { Home } from './pages/Home'
import { FeaturePlaceholder } from './pages/FeaturePlaceholder'
import { ChatProvider, useChat } from './context/ChatContext'
import { ThemeProvider } from './context/ThemeContext'
import type { AppView } from './types'
import './App.css'

const PLACEHOLDER_VIEWS: AppView[] = [
  'vision',
  'documents',
  'search',
  'voice',
  'calendar',
  'smart-home',
]

function AppShell() {
  const [view, setView] = useState<AppView>('home')
  const { openSettings } = useChat()

  return (
    <div className="app-shell">
      <Header view={view} onNavigate={setView} />
      {view === 'home' ? (
        <Home onNavigate={setView} onOpenSettings={openSettings} />
      ) : view === 'chat' ? (
        <>
          <ChatThread />
          <Composer />
        </>
      ) : view === 'memory' ? (
        <MemoryPage />
      ) : PLACEHOLDER_VIEWS.includes(view) ? (
        <FeaturePlaceholder view={view} onBack={() => setView('home')} />
      ) : null}
      <SettingsDrawer />
    </div>
  )
}

export default function App() {
  return (
    <ChatProvider>
      <ThemeProvider>
        <AppShell />
      </ThemeProvider>
    </ChatProvider>
  )
}
