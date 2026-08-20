import { memo, useEffect, useRef, useState } from 'react'
import { COPY_TOAST_DEFAULT, subscribeCopyToast } from '../../lib/copyFeedback'
import './CopyToast.css'

const TOAST_MS = 1800

function CopyToastComponent() {
  const [message, setMessage] = useState<string | null>(null)
  const [visible, setVisible] = useState(false)
  const hideTimer = useRef<number | null>(null)
  const clearTimer = useRef<number | null>(null)

  useEffect(() => {
    return subscribeCopyToast((next: string) => {
      if (hideTimer.current != null) window.clearTimeout(hideTimer.current)
      if (clearTimer.current != null) window.clearTimeout(clearTimer.current)
      setMessage(next || COPY_TOAST_DEFAULT)
      setVisible(true)
      hideTimer.current = window.setTimeout(() => {
        hideTimer.current = null
        setVisible(false)
        clearTimer.current = window.setTimeout(() => {
          clearTimer.current = null
          setMessage(null)
        }, 220)
      }, TOAST_MS)
    })
  }, [])

  useEffect(
    () => () => {
      if (hideTimer.current != null) window.clearTimeout(hideTimer.current)
      if (clearTimer.current != null) window.clearTimeout(clearTimer.current)
    },
    [],
  )

  if (!message) return null

  return (
    <div className="copy-toast-host" aria-live="polite" aria-atomic="true">
      <div
        className={`copy-toast${visible ? ' copy-toast--visible' : ''}`}
        role="status"
      >
        {message}
      </div>
    </div>
  )
}

export const CopyToast = memo(CopyToastComponent)
