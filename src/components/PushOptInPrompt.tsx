import { useState } from 'react'
import {
  enableWebPushFromUserGesture,
  markPushOptInDismissed,
  shouldOfferPushOptIn,
} from '../lib/webPush'
import './PushOptInPrompt.css'

interface PushOptInPromptProps {
  open: boolean
  onClose: () => void
}

/**
 * #303C — Intentional Push opt-in after reminder confirmation.
 * Never shown on cold launch; only "Attiva notifiche" may call requestPermission.
 */
export function PushOptInPrompt({ open, onClose }: PushOptInPromptProps) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  if (!open) return null

  const dismiss = () => {
    markPushOptInDismissed()
    onClose()
  }

  const activate = async () => {
    setBusy(true)
    setMessage(null)
    try {
      const result = await enableWebPushFromUserGesture()
      if (result.ok) {
        onClose()
        return
      }
      if (result.code === 'permission_denied') {
        markPushOptInDismissed()
        setMessage('Permesso notifiche non concesso. Puoi riprovare dalle Impostazioni.')
        return
      }
      setMessage('Non è stato possibile attivare le notifiche su questo dispositivo.')
    } catch {
      setMessage('Attivazione non riuscita. Riprova dalle Impostazioni.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="push-optin" role="dialog" aria-modal="true" aria-labelledby="push-optin-title">
      <div className="push-optin__panel">
        <h2 id="push-optin-title" className="push-optin__title">
          Notifiche
        </h2>
        <p className="push-optin__body">
          Vuoi ricevere una notifica anche quando ShinkAIdo è chiuso?
        </p>
        {message ? (
          <p className="push-optin__error" role="status">
            {message}
          </p>
        ) : null}
        <div className="push-optin__actions">
          <button
            type="button"
            className="push-optin__primary"
            disabled={busy}
            onClick={() => void activate()}
          >
            Attiva notifiche
          </button>
          <button type="button" className="push-optin__ghost" disabled={busy} onClick={dismiss}>
            Non ora
          </button>
        </div>
      </div>
    </div>
  )
}

export { shouldOfferPushOptIn }
