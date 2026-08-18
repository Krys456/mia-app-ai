import { useCallback, useEffect, useState } from 'react'
import {
  detectPushSupport,
  disableWebPush,
  enableWebPushFromUserGesture,
  getNotificationPermission,
  hasActiveLocalPushSubscription,
  isLikelyIosSafariTab,
  resolvePushToggleModel,
  syncExistingPushSubscription,
  type NotificationPermissionState,
  type PushSupportState,
  type PushToggleVisual,
} from '../lib/webPush'
import './MemoryToggle.css'

/** #303C — Settings → Notifications with persistent ON/OFF toggle. */
export function NotificationsSettings() {
  const [support, setSupport] = useState<PushSupportState>(() => detectPushSupport())
  const [permission, setPermission] = useState<NotificationPermissionState>(() =>
    getNotificationPermission(),
  )
  const [hasSubscription, setHasSubscription] = useState(false)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setSupport(detectPushSupport())
    setPermission(getNotificationPermission())
    setHasSubscription(await hasActiveLocalPushSubscription())
  }, [])

  useEffect(() => {
    void (async () => {
      await refresh()
      // Keep server row in sync only when a local subscription already exists (toggle ON).
      try {
        await syncExistingPushSubscription()
        await refresh()
      } catch {
        /* soft */
      }
    })()
  }, [refresh])

  const model = resolvePushToggleModel({ support, permission, hasSubscription })
  const visual: PushToggleVisual = model.visual

  const setToggle = async (next: PushToggleVisual) => {
    if (busy || model.toggleDisabled) return
    if (next === visual) return

    setBusy(true)
    setNote(null)
    try {
      if (next === 'on') {
        if (!model.canEnable) {
          if (model.statusCode === 'permission_denied') {
            setNote(
              'Permesso browser negato. Abilita le notifiche per questo sito nelle impostazioni del browser, poi riprova. I promemoria restano disponibili in app.',
            )
          }
          return
        }
        const result = await enableWebPushFromUserGesture()
        await refresh()
        if (result.ok) {
          setNote(null)
        } else if (result.code === 'permission_denied') {
          setNote(
            'Permesso browser negato. Le notifiche push restano disattivate. I promemoria in app e al prossimo accesso continuano a funzionare.',
          )
        } else {
          setNote('Attivazione non riuscita. Riprova tra poco.')
        }
        return
      }

      // next === 'off'
      await disableWebPush()
      await refresh()
      setNote(
        'Notifiche push disattivate su questo dispositivo. I promemoria in app continuano a funzionare.',
      )
    } catch {
      setNote(next === 'on' ? 'Attivazione non riuscita.' : 'Disattivazione non riuscita.')
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="settings-notifications" aria-labelledby="notifications-settings-title">
      <h3 id="notifications-settings-title" className="settings-section-title">
        Notifiche
      </h3>

      <div className="memory-toggle-row">
        <span className="field__label" id="notifications-toggle-label">
          Notifiche
        </span>
        <div
          className="memory-toggle"
          role="group"
          aria-labelledby="notifications-toggle-label"
          aria-describedby="notifications-toggle-status"
        >
          <button
            type="button"
            className={`memory-toggle__opt${visual === 'off' ? ' memory-toggle__opt--active' : ''}`}
            aria-pressed={visual === 'off'}
            disabled={busy || (model.toggleDisabled && visual === 'off')}
            onClick={() => void setToggle('off')}
          >
            OFF
          </button>
          <button
            type="button"
            className={`memory-toggle__opt${visual === 'on' ? ' memory-toggle__opt--active' : ''}`}
            aria-pressed={visual === 'on'}
            disabled={busy || model.toggleDisabled || (!model.canEnable && visual !== 'on')}
            onClick={() => void setToggle('on')}
          >
            ON
          </button>
        </div>
      </div>

      <p
        id="notifications-toggle-status"
        className="settings-note settings-note--tight"
        role="status"
      >
        {model.statusLabel}
      </p>

      {model.statusCode === 'permission_denied' ? (
        <p className="settings-note settings-note--tight settings-note--warn" role="note">
          Per riprovare, abilita le notifiche per questo sito nelle impostazioni del browser. ShinkAIdo
          non può revocare o ripristinare il permesso da solo.
        </p>
      ) : null}

      {isLikelyIosSafariTab() ? (
        <p className="settings-note settings-note--tight settings-note--warn" role="note">
          Su iOS le notifiche web richiedono l’app aggiunta alla Home (iOS 16.4+). La scheda Safari
          normale non è supportata.
        </p>
      ) : null}

      <p className="settings-note settings-note--tight">
        Anche senza push, i promemoria restano visibili in ShinkAIdo e al prossimo accesso.
      </p>

      {note ? (
        <p className="settings-note settings-note--tight" role="status">
          {note}
        </p>
      ) : null}
    </section>
  )
}
