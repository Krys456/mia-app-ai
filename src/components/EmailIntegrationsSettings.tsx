import { useCallback, useEffect, useState } from 'react'
import {
  consumeEmailReturnQuery,
  disconnectGoogleGmail,
  fetchEmailConnectionStatus,
  startGoogleGmailOAuth,
  type EmailConnectionPublic,
} from '../lib/emailApi'
import {
  resolveEmailToggleModel,
  type EmailServiceState,
  type EmailToggleVisual,
  type EmailUiPhase,
} from '../lib/emailToggleModel'
import './MemoryToggle.css'

/** #311 — Settings → Integrazioni → Google Gmail (read-only). */
export function EmailIntegrationsSettings() {
  const [connection, setConnection] = useState<EmailConnectionPublic | null>(null)
  const [phase, setPhase] = useState<EmailUiPhase>('loading')
  const [service, setService] = useState<EmailServiceState>('unknown')
  const [note, setNote] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const result = await fetchEmailConnectionStatus()
    if (result.ok) {
      setConnection(result.connection)
      setService('available')
      return
    }
    if (result.code === 'email_disabled') {
      setConnection(null)
      setService('disabled')
      setNote(
        'Il collegamento Gmail non è attivato su questo ambiente. Memoria, promemoria e Calendar non sono interessati.',
      )
      return
    }
    if (result.code === 'auth_unavailable') {
      setService('auth_unavailable')
      return
    }
    setService('error')
    setNote('Impossibile verificare lo stato di Gmail. Riprova tra poco.')
  }, [])

  useEffect(() => {
    const returned = consumeEmailReturnQuery()
    void (async () => {
      setPhase('loading')
      await refresh()
      if (returned === 'connected') {
        setNote(
          'Gmail collegato in sola lettura. Puoi chiedere in chat: «Ci sono email non lette?»',
        )
      } else if (returned === 'reconnect_required') {
        setNote('Autorizzazione incompleta: manca il refresh token. Usa ON per riprovare.')
      } else if (returned === 'error') {
        setNote('Collegamento Gmail non riuscito. Il toggle resta OFF.')
      }
      setPhase('idle')
    })()
  }, [refresh])

  const model = resolveEmailToggleModel({
    connectionStatus: connection?.status,
    accountEmail: connection?.accountEmail,
    service,
    phase,
  })
  const visual: EmailToggleVisual = model.visual

  const setToggle = async (next: EmailToggleVisual) => {
    if (model.toggleDisabled) return
    if (next === visual) return

    setNote(null)

    if (next === 'on') {
      if (!model.canEnable) return
      if (connection?.status === 'connected') return

      setPhase('connecting')
      try {
        const result = await startGoogleGmailOAuth()
        if (!result.ok || !result.authorizeUrl) {
          if (result.code === 'email_disabled') {
            setService('disabled')
            setNote('Il collegamento Gmail non è attivato su questo ambiente (lato server).')
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

    if (!model.canDisable) return
    setPhase('busy')
    try {
      const result = await disconnectGoogleGmail()
      if (result.ok) {
        setConnection(result.connection)
        setService('available')
        setNote('Gmail scollegato. Memoria, promemoria e Calendar non sono stati modificati.')
      } else if (result.code === 'email_disabled') {
        setService('disabled')
        setNote('Il collegamento Gmail non è attivato su questo ambiente (lato server).')
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
    <div className="settings-integration-block">
      <div className="memory-toggle-row">
        <span className="field__label" id="google-gmail-toggle-label">
          Google Gmail
        </span>
        <div
          className="memory-toggle"
          role="group"
          aria-labelledby="google-gmail-toggle-label"
          aria-describedby="google-gmail-toggle-status"
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
          id="google-gmail-toggle-status"
          className="settings-note settings-note--tight"
          role="status"
        >
          {model.statusLabel}
          {model.accountEmail ? ` · ${model.accountEmail}` : ''}
        </p>
        <p className="settings-note settings-note--tight">
          Sola lettura: ShinkAIdo può cercare e riassumere email. Non invia, non elimina, non
          modifica messaggi.
        </p>
        {note ? (
          <p className="settings-note settings-note--tight" role="status">
            {note}
          </p>
        ) : null}
      </div>
    </div>
  )
}
