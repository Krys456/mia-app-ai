import { useEffect } from 'react'
import { useChat } from '../context/ChatContext'
import './MemoryToast.css'

export function MemoryToast() {
  const { memoryNotice, clearMemoryNotice } = useChat()

  useEffect(() => {
    if (!memoryNotice) return
    const timer = window.setTimeout(() => clearMemoryNotice(), 3200)
    return () => window.clearTimeout(timer)
  }, [memoryNotice, clearMemoryNotice])

  if (!memoryNotice) return null

  const text =
    memoryNotice === 'updated'
      ? 'Ho aggiornato una memoria.'
      : 'Ho salvato una nuova memoria.'

  return (
    <div className="memory-toast" role="status" aria-live="polite">
      <span className="memory-toast__icon" aria-hidden="true">
        🧠
      </span>
      <span>{text}</span>
    </div>
  )
}
