/**
 * Temporary Preview-only panel: surfaces sanitized /api/chat memoryDiag on-screen
 * so mobile can inspect without desktop DevTools. No tokens or memory content.
 */
import { useChat } from '../context/ChatContext'
import './MemoryDiagPanel.css'

export function MemoryDiagPanel() {
  const { memoryDiag, clearMemoryDiag } = useChat()

  if (!memoryDiag) return null

  return (
    <aside className="memory-diag-panel" aria-label="Temporary memory diagnostics">
      <div className="memory-diag-panel__bar">
        <span className="memory-diag-panel__title">memoryDiag (temp Preview)</span>
        <button
          type="button"
          className="memory-diag-panel__close"
          onClick={clearMemoryDiag}
          aria-label="Dismiss memory diagnostics"
        >
          Close
        </button>
      </div>
      <pre className="memory-diag-panel__body">{JSON.stringify(memoryDiag, null, 2)}</pre>
    </aside>
  )
}
