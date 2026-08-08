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

      {/* Keep chat mounted so scroll position and composer state survive Memory/Vision. */}
      <div
        className="app-view app-view--chat"
        hidden={view !== 'chat'}
        inert={view !== 'chat' ? true : undefined}
      >
        <ChatContainer />
        <MemoryToast />
      </div>

      {view === 'memory' ? (
        <div className="app-view" key="memory">
          <MemoryManage onBack={backFromMemory} />
        </div>
      ) : null}

      {view === 'vision' ? (
        <div className="app-view" key="vision">
          <Vision onBack={backFromVision} />
        </div>
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
