import { useRef, useState } from 'react'
import { Header } from './components/Header'
import { ChatContainer } from './components/chat'
import { SettingsDrawer } from './components/SettingsDrawer'
import { MemoryManage } from './pages/MemoryManage'
import { PrivacyData } from './pages/PrivacyData'
import { Vision } from './pages/Vision'
import { ChatProvider, useChat } from './context/ChatContext'
import { ThemeProvider } from './context/ThemeContext'
import { useAuthBootstrap } from './hooks/useAuthBootstrap'
import { useVisualViewportHeight } from './hooks/useVisualViewportHeight'
import { isMemoryManageUiEnabled } from './lib/memoryManageUi'
import type { AppView } from './types'
import './App.css'

function AppShell() {
  const [view, setView] = useState<AppView>('chat')
  const previousViewRef = useRef<AppView>('chat')
  /** When true, leaving Memory should reopen Settings (entry was the drawer). */
  const memoryReturnToSettingsRef = useRef(false)
  /** When true, leaving Privacy should reopen Settings. */
  const privacyReturnToSettingsRef = useRef(false)
  const { openSettings, closeSettings } = useChat()
  useVisualViewportHeight()
  // Phase 1A step 1 — silent anonymous session; does not gate chat.
  useAuthBootstrap()

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

  const openPrivacy = (fromSettings = true) => {
    privacyReturnToSettingsRef.current = fromSettings
    navigate('privacy')
  }

  const backFromMemory = () => {
    const reopenSettings = memoryReturnToSettingsRef.current
    memoryReturnToSettingsRef.current = false
    navigate('chat')
    if (reopenSettings) openSettings()
  }

  const backFromPrivacy = () => {
    const reopenSettings = privacyReturnToSettingsRef.current
    privacyReturnToSettingsRef.current = false
    navigate('chat')
    if (reopenSettings) openSettings()
  }

  const backFromVision = () => {
    const previous = previousViewRef.current
    navigate(previous === 'vision' || previous === 'privacy' || previous === 'memory' ? 'chat' : previous)
  }

  const handoffVisionToChat = () => {
    navigate('chat')
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
      </div>

      {view === 'memory' && isMemoryManageUiEnabled() ? (
        <div className="app-view" key="memory">
          <MemoryManage onBack={backFromMemory} />
        </div>
      ) : null}

      {view === 'privacy' ? (
        <div className="app-view" key="privacy">
          <PrivacyData onBack={backFromPrivacy} />
        </div>
      ) : null}

      {view === 'vision' ? (
        <div className="app-view app-view--vision" key="vision">
          <Vision onBack={backFromVision} onHandoffToChat={handoffVisionToChat} />
        </div>
      ) : null}

      <SettingsDrawer
        onOpenMemory={() => openMemoryManage(true)}
        onOpenPrivacy={() => openPrivacy(true)}
      />
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
