import { useCallback, useEffect, useState } from 'react'
import {
  detectPushSupport,
  disableWebPush,
  enableWebPushFromUserGesture,
  getNotificationPermission,
  isLikelyIosSafariTab,
  syncExistingPushSubscription,
  type NotificationPermissionState,
  type PushSupportState,
} from '../lib/webPush'

function supportLabel(state: PushSupportState): string {
  switch (state) {
    case 'supported':
      return 'Supportate su questo browser'
    case 'disabled':
      return 'Disabilitate dalla configurazione'
    case 'missing_vapid':
      return 'Non configurate (chiave pubblica assente)'
    case 'unsupported_ios_safari_tab':
      return 'Su iPhone/iPad serve «Aggiungi a Home» (iOS 16.4+), non la scheda Safari'
    default:
      return 'Non supportate su questo browser'
  }
}

function permissionLabel(state: NotificationPermissionState): string {
  switch (state) {
    case 'granted':
      return 'Concesse'
    case 'denied':
      return 'Negate (modifica dalle impostazioni del browser)'
    case 'default':
      return 'Non ancora richieste'
    default:
      return 'Non disponibili'
  }
}

/** #303C — Settings → Notifications */
export function NotificationsSettings() {
  const [support, setSupport] = useState<PushSupportState>(() => detectPushSupport())
  const [permission, setPermission] = useState<NotificationPermissionState>(() =>
    getNotificationPermission(),
  )
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  const refresh = useCallback(() => {
    setSupport(detectPushSupport())
    setPermission(getNotificationPermission())
  }, [])

  useEffect(() => {
    refresh()
    void syncExistingPushSubscription().catch(() => {
      /* soft */
    })
  }, [refresh])

  const enable = async () => {
    setBusy(true)
    setNote(null)
    try {
      const result = await enableWebPushFromUserGesture()
      refresh()
      if (result.ok) {
        setNote('Notifiche attivate su questo dispositivo.')
      } else if (result.code === 'permission_denied') {
        setNote('Permesso negato. I promemoria restano disponibili in app al prossimo accesso.')
      } else {
        setNote('Attivazione non riuscita.')
      }
    } catch {
      setNote('Attivazione non riuscita.')
    } finally {
      setBusy(false)
    }
  }

  const disable = async () => {
    setBusy(true)
    setNote(null)
    try {
      await disableWebPush()
      refresh()
      setNote(
        'Notifiche push disattivate su questo dispositivo. I promemoria in app continuano a funzionare.',
      )
    } catch {
      setNote('Disattivazione non riuscita.')
    } finally {
      setBusy(false)
    }
  }

  const canEnable =
    support === 'supported' && permission !== 'granted' && permission !== 'denied'
  const canRetryDenied = support === 'supported' && permission === 'denied'
  const canDisable = permission === 'granted'

  return (
    <section className="settings-notifications" aria-labelledby="notifications-settings-title">
      <h3 id="notifications-settings-title" className="settings-section-title">
        Notifiche
      </h3>
      <p className="settings-note settings-note--tight">
        Stato supporto: {supportLabel(support)}
      </p>
      <p className="settings-note settings-note--tight">
        Permesso browser: {permissionLabel(permission)}
      </p>
      {isLikelyIosSafariTab() ? (
        <p className="settings-note settings-note--tight settings-note--warn" role="note">
          Su iOS le notifiche web richiedono l’app aggiunta alla Home (iOS 16.4+). La scheda Safari
          normale non è supportata.
        </p>
      ) : null}
      <p className="settings-note settings-note--tight">
        Anche senza push, i promemoria restano visibili in ShinkAIdo e al prossimo accesso.
      </p>
      <div className="settings-notifications__actions">
        {canEnable ? (
          <button
            type="button"
            className="settings-link-btn"
            disabled={busy}
            onClick={() => void enable()}
          >
            Attiva notifiche
          </button>
        ) : null}
        {canRetryDenied ? (
          <p className="settings-note settings-note--tight">
            Per riprovare, abilita le notifiche per questo sito nelle impostazioni del browser, poi
            torna qui.
          </p>
        ) : null}
        {canDisable ? (
          <button
            type="button"
            className="settings-link-btn"
            disabled={busy}
            onClick={() => void disable()}
          >
            Disattiva notifiche push
          </button>
        ) : null}
      </div>
      {note ? (
        <p className="settings-note settings-note--tight" role="status">
          {note}
        </p>
      ) : null}
    </section>
  )
}
