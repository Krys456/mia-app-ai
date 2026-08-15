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
import { isMemoryManageUiEnabled } from './lib/memoryManageUi'
import type { AppView } from './types'
import './App.css'

function AppShell() {
  const [view, setView] = useState<AppView>('chat')
  const previousViewRef = useRef<AppView>('chat')
  /** When true, leaving Memory should reopen Settings (entry was the drawer). */
  const memoryReturnToSettingsRef = useRef(false)
  const { openSettings, closeSettings } = useChat()
  useVisualViewportHeight()

  const navigate = (next: AppView) => {
    setView((current) => {
      if (current !== next) previousViewRef.current = current
      return next
    })
    // Leaving chat / opening another view must never leave Settings covering the page.
    if (next !== 'chat') closeSettings()
  }

  const openMemoryManage = (fromSettings = true) => {
    if (!isMemoryManageUiEnabled()) return
    memoryReturnToSettingsRef.current = fromSettings
    navigate('memory')
  }

  const openMemoryFromHeader = () => {
    if (!isMemoryManageUiEnabled()) return
    memoryReturnToSettingsRef.current = false
    navigate('memory')
  }

  const backFromMemory = () => {
    const reopenSettings = memoryReturnToSettingsRef.current
    memoryReturnToSettingsRef.current = false
    navigate('chat')
    if (reopenSettings) openSettings()
  }

  const backFromVision = () => {
    const previous = previousViewRef.current
    navigate(previous === 'vision' ? 'chat' : previous)
  }

  return (
    <div className="app-shell">
      {view === 'chat' ? (
        <Header onNavigate={navigate} onOpenMemory={openMemoryFromHeader} />
      ) : null}

      {/* Keep chat mounted so scroll position and composer state survive Memory/Vision. */}
      <div
        className="app-view app-view--chat"
        hidden={view !== 'chat'}
        inert={view !== 'chat' ? true : undefined}
      >
        <ChatContainer />
        <MemoryToast />
      </div>

      {view === 'memory' && isMemoryManageUiEnabled() ? (
        <div className="app-view" key="memory">
          <MemoryManage onBack={backFromMemory} />
        </div>
      ) : null}

      {view === 'vision' ? (
        <div className="app-view" key="vision">
          <Vision onBack={backFromVision} />
        </div>
      ) : null}

      <SettingsDrawer onOpenMemory={() => openMemoryManage(true)} />
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
