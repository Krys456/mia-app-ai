import { useCallback, useEffect, useState } from 'react'
import {
  consumeCalendarReturnQuery,
  disconnectGoogleCalendar,
  fetchCalendarConnectionStatus,
  startGoogleCalendarOAuth,
  type CalendarConnectionPublic,
} from '../lib/calendarApi'
import {
  resolveCalendarToggleModel,
  type CalendarServiceState,
  type CalendarToggleVisual,
  type CalendarUiPhase,
} from '../lib/calendarToggleModel'
import './MemoryToggle.css'

/** #304A1 — Settings → Integrazioni → Google Calendar with persistent ON/OFF toggle. */
export function CalendarIntegrationsSettings() {
  const [connection, setConnection] = useState<CalendarConnectionPublic | null>(null)
  const [phase, setPhase] = useState<CalendarUiPhase>('loading')
  const [service, setService] = useState<CalendarServiceState>('unknown')
  const [note, setNote] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const result = await fetchCalendarConnectionStatus()
    if (result.ok) {
      setConnection(result.connection)
      setService('available')
      return
    }
    if (result.code === 'calendar_disabled') {
      setConnection(null)
      setService('disabled')
      setNote(
        'Il collegamento Google non è attivato su questo ambiente. Memoria, promemoria e notifiche non sono interessati.',
      )
      return
    }
    if (result.code === 'auth_unavailable') {
      setService('auth_unavailable')
      return
    }
    setService('error')
    setNote('Impossibile verificare lo stato del Calendar. Riprova tra poco.')
  }, [])

  useEffect(() => {
    const returned = consumeCalendarReturnQuery()
    void (async () => {
      setPhase('loading')
      await refresh()
      if (returned === 'connected') {
        setNote(
          'Google Calendar collegato. In questa versione ShinkAIdo non legge ancora gli eventi in chat.',
        )
      } else if (returned === 'reconnect_required') {
        setNote('Autorizzazione incompleta: manca il refresh token. Usa ON per riprovare.')
      } else if (returned === 'error') {
        setNote('Collegamento non riuscito. Il toggle resta OFF.')
      }
      setPhase('idle')
    })()
  }, [refresh])

  const model = resolveCalendarToggleModel({
    connectionStatus: connection?.status,
    accountEmail: connection?.accountEmail,
    service,
    phase,
  })
  const visual: CalendarToggleVisual = model.visual

  const setToggle = async (next: CalendarToggleVisual) => {
    if (model.toggleDisabled) return
    if (next === visual) return

    setNote(null)

    if (next === 'on') {
      if (!model.canEnable) return
      // Already connected → stay ON (no OAuth re-run).
      if (connection?.status === 'connected') return

      setPhase('connecting')
      try {
        const result = await startGoogleCalendarOAuth()
        if (!result.ok || !result.authorizeUrl) {
          if (result.code === 'calendar_disabled') {
            setService('disabled')
            setNote('Il collegamento Google non è attivato su questo ambiente (lato server).')
          } else {
            setNote('Collegamento non riuscito. Il toggle resta OFF.')
          }
          setPhase('idle')
          await refresh()
          return
        }
        window.location.assign(result.authorizeUrl)
      } catch {
        setNote('Collegamento non riuscito. Il toggle resta OFF.')
        setPhase('idle')
      }
      return
    }

    // next === 'off'
    if (!model.canDisable) {
      // Already OFF for reconnect_required / disconnected — no-op.
      return
    }
    setPhase('busy')
    try {
      const result = await disconnectGoogleCalendar()
      if (result.ok) {
        setConnection(result.connection)
        setService('available')
        setNote(
          'Google Calendar scollegato. Memoria, promemoria e notifiche non sono stati modificati.',
        )
      } else if (result.code === 'calendar_disabled') {
        setService('disabled')
        setNote('Il collegamento Google non è attivato su questo ambiente (lato server).')
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

  return (
    <section className="settings-integrations" aria-labelledby="integrations-settings-title">
      <h3 id="integrations-settings-title" className="settings-section-title">
        Integrazioni
      </h3>

      <div className="settings-integration-block">
        <div className="memory-toggle-row">
          <span className="field__label" id="google-calendar-toggle-label">
            Google Calendar
          </span>
          <div
            className="memory-toggle"
            role="group"
            aria-labelledby="google-calendar-toggle-label"
            aria-describedby="google-calendar-toggle-status"
          >
            <button
              type="button"
              className={`memory-toggle__opt${visual === 'off' ? ' memory-toggle__opt--active' : ''}`}
              aria-pressed={visual === 'off'}
              disabled={model.toggleDisabled && visual === 'off'}
              onClick={() => void setToggle('off')}
            >
              OFF
            </button>
            <button
              type="button"
              className={`memory-toggle__opt${visual === 'on' ? ' memory-toggle__opt--active' : ''}`}
              aria-pressed={visual === 'on'}
              disabled={model.toggleDisabled || (!model.canEnable && visual !== 'on')}
              onClick={() => void setToggle('on')}
            >
              ON
            </button>
          </div>
        </div>

        <div className="settings-integration-head">
          <p
            id="google-calendar-toggle-status"
            className="settings-note settings-note--tight"
            role="status"
          >
            {model.statusLabel}
            {model.accountEmail ? ` · ${model.accountEmail}` : ''}
          </p>
          {model.showReadOnlyBadge ? (
            <span className="settings-badge" title="Permesso sola lettura">
              Sola lettura
            </span>
          ) : service === 'disabled' ? (
            <span className="settings-badge" title="Disattivata lato server">
              Non disponibile
            </span>
          ) : null}
        </div>

        <p className="settings-note settings-note--tight">
          ShinkAIdo può leggere il Calendar solo dopo il consenso. In #304A1 non può creare,
          modificare o eliminare eventi, e non usa ancora il Calendar in chat. ON avvia Google
          OAuth; OFF scollega e revoca i token lato server.
        </p>

        {note ? (
          <p className="settings-note settings-note--tight" role="status">
            {note}
          </p>
        ) : null}
      </div>
    </section>
  )
}
