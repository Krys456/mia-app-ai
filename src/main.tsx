import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { AppErrorBoundary } from './components/AppErrorBoundary'
import { bootstrapDocumentThemeFromStorage } from './lib/themePersistence'
import './index.css'

// #358D — reinforce early boot (inline index.html script is primary anti-FOUC).
bootstrapDocumentThemeFromStorage()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>,
)
