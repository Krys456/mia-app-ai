import { useState } from 'react'
import { Header } from './components/Header'
import { ChatContainer } from './components/chat'
import { SettingsDrawer } from './components/SettingsDrawer'
import { MemoryToast } from './components/MemoryToast'
import { MemoryManage } from './pages/MemoryManage'
import { Vision } from './pages/Vision'
import { ChatProvider, useChat } from './context/ChatContext'
import { ThemeProvider } from './context/ThemeContext'
import type { AppView } from './types'
import './App.css'

function AppShell() {
  const [view, setView] = useState<AppView>('chat')
  const { openSettings } = useChat()

  const openMemoryManage = () => {
    setView('memory')
  }

  const backFromMemory = () => {
    setView('chat')
    openSettings()
  }

  return (
    <div className="app-shell">
      <Header view={view} onNavigate={setView} />
      {view === 'chat' ? (
        <>
          <ChatContainer />
          <MemoryToast />
        </>
      ) : view === 'memory' ? (
        <MemoryManage onBack={backFromMemory} />
      ) : view === 'vision' ? (
        <Vision />
      ) : null}
      <SettingsDrawer onOpenMemory={openMemoryManage} />
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
