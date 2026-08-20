import { useEffect, useRef, useState } from 'react'
import { Header } from './components/Header'
import { ChatContainer } from './components/chat'
import { SettingsDrawer } from './components/SettingsDrawer'
import { DueReminderHost } from './components/DueReminderHost'
import { MemoryManage } from './pages/MemoryManage'
import { PrivacyData } from './pages/PrivacyData'
import { ReminderManage } from './pages/ReminderManage'
import { Vision } from './pages/Vision'
import { Plans } from './pages/Plans'
import { ChatProvider, useChat } from './context/ChatContext'
import { ThemeProvider } from './context/ThemeContext'
import { useAuthBootstrap } from './hooks/useAuthBootstrap'
import { useVisualViewportHeight } from './hooks/useVisualViewportHeight'
import { setAppNavigateHandler } from './lib/appNavigation'
import { isMemoryManageUiEnabled } from './lib/memoryManageUi'
import { isRemindersUiEnabled } from './lib/remindersUi'
import { getCurrentPlanId } from './lib/entitlementsUi'
import type { AppView } from './types'
import './App.css'

function AppShell() {
  const [view, setView] = useState<AppView>('chat')
  const previousViewRef = useRef<AppView>('chat')
  /** When true, leaving Memory should reopen Settings (entry was the drawer). */
  const memoryReturnToSettingsRef = useRef(false)
  /** When true, leaving Privacy should reopen Settings. */
  const privacyReturnToSettingsRef = useRef(false)
  const remindersReturnToSettingsRef = useRef(false)
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
  const navigateRef = useRef(navigate)
  navigateRef.current = navigate

  // #315 — Phone Action "Apri fotocamera" → Vision
  useEffect(() => {
    setAppNavigateHandler((next: string) => {
      if (
        next === 'vision' ||
        next === 'chat' ||
        next === 'memory' ||
        next === 'privacy' ||
        next === 'reminders' ||
        next === 'plans'
      ) {
        navigateRef.current(next)
      }
    })
    return () => setAppNavigateHandler(null)
  }, [])

  const openMemoryManage = (fromSettings = true) => {
    if (!isMemoryManageUiEnabled()) return
    memoryReturnToSettingsRef.current = fromSettings
    navigate('memory')
  }

  const openPrivacy = (fromSettings = true) => {
    privacyReturnToSettingsRef.current = fromSettings
    navigate('privacy')
  }

  const openReminders = (fromSettings = true) => {
    if (!isRemindersUiEnabled()) return
    remindersReturnToSettingsRef.current = fromSettings
    navigate('reminders')
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

  const backFromReminders = () => {
    const reopenSettings = remindersReturnToSettingsRef.current
    remindersReturnToSettingsRef.current = false
    navigate('chat')
    if (reopenSettings) openSettings()
  }

  const backFromVision = () => {
    const previous = previousViewRef.current
    navigate(
      previous === 'vision' ||
        previous === 'privacy' ||
        previous === 'memory' ||
        previous === 'reminders' ||
        previous === 'plans'
        ? 'chat'
        : previous,
    )
  }

  const backFromPlans = () => {
    navigate('chat')
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

      {view === 'reminders' && isRemindersUiEnabled() ? (
        <div className="app-view" key="reminders">
          <ReminderManage onBack={backFromReminders} />
        </div>
      ) : null}

      {view === 'vision' ? (
        <div className="app-view app-view--vision" key="vision">
          <Vision onBack={backFromVision} onHandoffToChat={handoffVisionToChat} />
        </div>
      ) : null}

      {view === 'plans' ? (
        <div className="app-view" key="plans" data-view="plans">
          <Plans onBack={backFromPlans} currentPlanId={getCurrentPlanId()} />
        </div>
      ) : null}

      <SettingsDrawer
        onOpenMemory={() => openMemoryManage(true)}
        onOpenPrivacy={() => openPrivacy(true)}
        onOpenReminders={() => openReminders(true)}
      />

      {/* In-app / next-open reminder delivery (#303A) — no push. */}
      <DueReminderHost />
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
