import { useState } from 'react'
import { Header } from './components/Header'
import { ChatThread } from './components/ChatThread'
import { Composer } from './components/Composer'
import { SettingsDrawer } from './components/SettingsDrawer'
import { MemoryWorkspace } from './pages/MemoryWorkspace'
import { Vision } from './pages/Vision'
import { ChatProvider } from './context/ChatContext'
import { ThemeProvider } from './context/ThemeContext'
import type { AppView } from './types'
import './App.css'

function AppShell() {
  const [view, setView] = useState<AppView>('chat')

  return (
    <div className="app-shell">
      <Header view={view} onNavigate={setView} />
      {view === 'chat' ? (
        <>
          <ChatThread />
          <Composer />
        </>
      ) : view === 'memory' ? (
        <MemoryWorkspace />
      ) : view === 'vision' ? (
        <Vision />
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
