import { AppRouter } from './components/AppRouter'
import { ChatProvider } from './context/ChatContext'
import { ThemeProvider } from './context/ThemeContext'
import './App.css'

export default function App() {
  return (
    <ChatProvider>
      <ThemeProvider>
        <AppRouter />
      </ThemeProvider>
    </ChatProvider>
  )
}
