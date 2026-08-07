import { useRef, useState } from 'react'
import { Header } from './components/Header'
import { ChatContainer } from './components/chat'
import { SettingsDrawer } from './components/SettingsDrawer'
import { MemoryToast } from './components/MemoryToast'
import { MemoryManage } from './pages/MemoryManage'
import { Vision } from './pages/Vision'
import { ChatProvider, useChat } from './context/ChatContext'
import { ThemeProvider } from './context/ThemeContext'
import { useVisualViewportHeight } from './hooks/useVisualViewportHeight'
import type { AppView } from './types'
import './App.css'

function AppShell() {
  const [view, setView] = useState<AppView>('chat')
  const previousViewRef = useRef<AppView>('chat')
  const { openSettings } = useChat()
  useVisualViewportHeight()

  const navigate = (next: AppView) => {
    setView((current) => {
      if (current !== next) previousViewRef.current = current
      return next
    })
  }

  const openMemoryManage = () => {
    navigate('memory')
  }

  const backFromMemory = () => {
    navigate('chat')
    openSettings()
  }

  const backFromVision = () => {
    const previous = previousViewRef.current
    navigate(previous === 'vision' ? 'chat' : previous)
  }

  return (
    <div className="app-shell">
      {view === 'chat' ? <Header onNavigate={navigate} /> : null}

      <div className="app-view" key={view}>
        {view === 'chat' ? (
          <>
            <ChatContainer />
            <MemoryToast />
          </>
        ) : view === 'memory' ? (
          <MemoryManage onBack={backFromMemory} />
        ) : (
          <Vision onBack={backFromVision} />
        )}
      </div>

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
