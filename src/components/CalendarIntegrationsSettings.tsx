import { useCallback, useEffect, useState } from 'react'
import { isCalendarUiEnabled } from '../lib/calendarUi'
import {
  consumeCalendarReturnQuery,
  disconnectGoogleCalendar,
  fetchCalendarConnectionStatus,
  startGoogleCalendarOAuth,
  type CalendarConnectionPublic,
} from '../lib/calendarApi'
import './MemoryToggle.css'

type UiPhase = 'idle' | 'loading' | 'connecting' | 'busy'

function statusLabel(connection: CalendarConnectionPublic | null, phase: UiPhase): string {
  if (phase === 'connecting') return 'Connessione a Google in corso…'
  if (phase === 'loading') return 'Controllo stato connessione…'
  if (!connection || connection.status === 'disconnected') {
    return 'Non collegato. ShinkAIdo può leggere il Calendar solo dopo il consenso Google.'
  }
  if (connection.status === 'pending') return 'Autorizzazione in sospeso. Completa il consenso Google.'
  if (connection.status === 'connected') {
    return connection.accountEmail
      ? `Collegato come ${connection.accountEmail}.`
      : 'Google Calendar collegato (sola lettura).'
  }
  if (connection.status === 'reconnect_required') {
    return 'Riconnessione richiesta. Tocca Collega di nuovo per rinnovare l’autorizzazione.'
  }
  if (connection.status === 'error' || connection.status === 'revoked') {
    return 'Connessione non disponibile. Puoi riprovare o scollegare.'
  }
  return 'Stato sconosciuto.'
}

/** #304A1 — Settings → Integrazioni → Google Calendar (connection only). */
export function CalendarIntegrationsSettings() {
  const enabled = isCalendarUiEnabled()
  const [connection, setConnection] = useState<CalendarConnectionPublic | null>(null)
  const [phase, setPhase] = useState<UiPhase>('loading')
  const [note, setNote] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!enabled) return
    const result = await fetchCalendarConnectionStatus()
    if (result.ok) setConnection(result.connection)
    else if (result.code === 'calendar_disabled') {
      setNote('Integrazione Calendar non attiva su questo ambiente.')
    }
  }, [enabled])

  useEffect(() => {
    if (!enabled) return
    const returned = consumeCalendarReturnQuery()
    void (async () => {
      setPhase('loading')
      await refresh()
      if (returned === 'connected') {
        setNote(
          'Google Calendar collegato. In questa versione ShinkAIdo non legge ancora gli eventi in chat.',
        )
      } else if (returned === 'reconnect_required') {
        setNote('Autorizzazione incompleta: manca il refresh token. Tocca Collega di nuovo.')
      } else if (returned === 'error') {
        setNote('Collegamento non riuscito. Riprova.')
      }
      setPhase('idle')
    })()
  }, [enabled, refresh])

  if (!enabled) return null

  const onConnect = async () => {
    if (phase === 'connecting' || phase === 'busy') return
    setPhase('connecting')
    setNote(null)
    try {
      const result = await startGoogleCalendarOAuth()
      if (!result.ok || !result.authorizeUrl) {
        setNote('Impossibile avviare Google OAuth. Riprova tra poco.')
        setPhase('idle')
        return
      }
      window.location.assign(result.authorizeUrl)
    } catch {
      setNote('Impossibile avviare Google OAuth.')
      setPhase('idle')
    }
  }

  const onDisconnect = async () => {
    if (phase === 'busy' || phase === 'connecting') return
    setPhase('busy')
    setNote(null)
    try {
      const result = await disconnectGoogleCalendar()
      if (result.ok) {
        setConnection(result.connection)
        setNote(
          'Google Calendar scollegato. Memoria, promemoria e notifiche non sono stati modificati.',
        )
      } else {
        setNote('Scollegamento non riuscito. Riprova.')
      }
    } catch {
      setNote('Scollegamento non riuscito.')
    } finally {
      setPhase('idle')
      await refresh()
    }
  }

  const connected = connection?.status === 'connected'
  const needsReconnect =
    connection?.status === 'reconnect_required' || connection?.status === 'error'

  return (
    <section className="settings-integrations" aria-labelledby="integrations-settings-title">
      <h3 id="integrations-settings-title" className="settings-section-title">
        Integrazioni
      </h3>

      <div className="settings-integration-block">
        <div className="settings-integration-head">
          <span className="field__label" id="google-calendar-label">
            Google Calendar
          </span>
          {connected ? (
            <span className="settings-badge" title="Permesso sola lettura">
              Sola lettura
            </span>
          ) : null}
        </div>

        <p className="settings-note settings-note--tight" role="status">
          {statusLabel(connection, phase)}
        </p>

        <p className="settings-note settings-note--tight">
          ShinkAIdo può leggere il Calendar solo dopo il consenso. In #304A1 non può creare,
          modificare o eliminare eventi, e non usa ancora il Calendar in chat.
        </p>

        <div className="settings-integration-actions">
          {connected ? (
            <button
              type="button"
              className="settings-link-btn"
              disabled={phase !== 'idle'}
              onClick={() => void onDisconnect()}
            >
              Scollega
            </button>
          ) : (
            <button
              type="button"
              className="settings-link-btn"
              disabled={phase === 'connecting' || phase === 'busy' || phase === 'loading'}
              onClick={() => void onConnect()}
            >
              {needsReconnect ? 'Collega di nuovo' : 'Collega Google Calendar'}
            </button>
          )}
        </div>

        {note ? (
          <p className="settings-note settings-note--tight" role="status">
            {note}
          </p>
        ) : null}
      </div>
    </section>
  )
}
