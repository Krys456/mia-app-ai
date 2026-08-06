import { Header } from './components/Header'
import { ChatThread } from './components/ChatThread'
import { Composer } from './components/Composer'
import { SettingsDrawer } from './components/SettingsDrawer'
import { ChatProvider } from './context/ChatContext'
import './App.css'

function AppShell() {
  return (
    <div className="app-shell">
      <Header />
      <ChatThread />
      <Composer />
      <SettingsDrawer />
    </div>
  )
}

export default function App() {
  return (
    <ChatProvider>
      <AppShell />
    </ChatProvider>
  )
}
