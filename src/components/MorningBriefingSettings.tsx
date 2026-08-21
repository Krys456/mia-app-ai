/**
 * #334D1 — Morning briefing schedule controls (server-authoritative).
 */

import { useCallback, useEffect, useId, useState } from 'react'
import {
  detectPushSupport,
  enableWebPushFromUserGesture,
  getNotificationPermission,
} from '../lib/webPush'
import {
  disableMorningBriefingScheduleClient,
  fetchMorningBriefingSchedule,
  MORNING_DAY_LABELS,
  type MorningBriefingSchedule,
  upsertMorningBriefingScheduleClient,
  guessBrowserTimeZone,
} from '../lib/morningBriefingSchedule'
import './MorningBriefingSettings.css'

const DEFAULT: MorningBriefingSchedule = {
  enabled: false,
  localTime: '08:00',
  daysOfWeek: [1, 2, 3, 4, 5],
  timezone: 'UTC',
  lastDeliveredLocalDate: null,
  exists: false,
}

export function MorningBriefingSettings() {
  const baseId = useId()
  const [schedule, setSchedule] = useState<MorningBriefingSchedule>(DEFAULT)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const next = await fetchMorningBriefingSchedule()
      setSchedule(next)
    } catch {
      setError('Impossibile caricare il briefing mattutino. Riprova tra poco.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const persist = async (next: {
    enabled: boolean
    localTime: string
    daysOfWeek: number[]
  }) => {
    setSaving(true)
    setError(null)
    setStatus(null)
    try {
      const timezone = guessBrowserTimeZone()
      const saved = await upsertMorningBriefingScheduleClient({
        ...next,
        timezone,
      })
      setSchedule(saved)
      setStatus(
        saved.enabled
          ? `Programmato alle ${saved.localTime} (${saved.timezone}).`
          : 'Briefing mattutino disattivato.',
      )
    } catch {
      setError('Salvataggio non riuscito. Controlla i campi e riprova.')
    } finally {
      setSaving(false)
    }
  }

  const onToggleEnable = async (wantOn: boolean) => {
    if (!wantOn) {
      setSaving(true)
      setError(null)
      try {
        const saved = await disableMorningBriefingScheduleClient()
        setSchedule(saved)
        setStatus('Briefing mattutino disattivato. Le notifiche dei promemoria non cambiano.')
      } catch {
        setError('Impossibile disattivare. Riprova.')
      } finally {
        setSaving(false)
      }
      return
    }

    const support = detectPushSupport()
    if (support === 'unsupported_ios_safari_tab') {
      setError(
        'Su iPhone/iPad le notifiche richiedono ShinkAIdo installato sulla Home (PWA). Safari in scheda non è supportato.',
      )
      return
    }
    if (support !== 'supported') {
      setError(
        'Le notifiche push non sono disponibili su questo dispositivo. Puoi salvare l’orario, ma la consegna in background non funzionerà.',
      )
    }

    const permission = getNotificationPermission()
    if (permission === 'denied') {
      setError(
        'Permesso notifiche negato. Abilitalo nelle impostazioni del browser, poi riprova.',
      )
      return
    }

    if (support === 'supported') {
      const push = await enableWebPushFromUserGesture()
      if (!push.ok) {
        if (push.code === 'permission_denied') {
          setError('Serve il permesso notifiche per il briefing mattutino.')
          return
        }
        setError(
          'Non riesco ad attivare le notifiche su questo dispositivo. Riprova o controlla le impostazioni del browser.',
        )
        // Still allow saving schedule so ops/other devices can deliver — report partial.
        setStatus('Orario salvabile, ma la sottoscrizione push non è completa su questo dispositivo.')
      }
    }

    await persist({
      enabled: true,
      localTime: schedule.localTime || '08:00',
      daysOfWeek: schedule.daysOfWeek?.length ? schedule.daysOfWeek : [1, 2, 3, 4, 5],
    })
  }

  const toggleDay = (day: number) => {
    const set = new Set(schedule.daysOfWeek || [])
    if (set.has(day)) {
      if (set.size <= 1) return
      set.delete(day)
    } else {
      set.add(day)
    }
    const daysOfWeek = [...set].sort((a, b) => a - b)
    setSchedule((s) => ({ ...s, daysOfWeek }))
    if (schedule.enabled) {
      void persist({
        enabled: true,
        localTime: schedule.localTime,
        daysOfWeek,
      })
    }
  }

  const onTimeChange = (localTime: string) => {
    setSchedule((s) => ({ ...s, localTime }))
  }

  const onTimeBlur = () => {
    if (!schedule.enabled) return
    void persist({
      enabled: true,
      localTime: schedule.localTime,
      daysOfWeek: schedule.daysOfWeek,
    })
  }

  return (
    <div className="morning-briefing" aria-labelledby={`${baseId}-title`}>
      <h4 id={`${baseId}-title`} className="morning-briefing__title">
        Briefing mattutino
      </h4>
      <p className="settings-note settings-note--tight" id={`${baseId}-help`}>
        Opzionale. Alle ore scelte ricevi una notifica riservata: “Il tuo briefing mattutino è
        pronto.” Il contenuto si genera solo quando apri ShinkAIdo.
      </p>

      <div className="memory-toggle-row">
        <span className="field__label" id={`${baseId}-toggle-label`}>
          Attiva
        </span>
        <div
          className="memory-toggle"
          role="group"
          aria-labelledby={`${baseId}-toggle-label`}
          aria-describedby={`${baseId}-help`}
        >
          <button
            type="button"
            className={`memory-toggle__opt${!schedule.enabled ? ' memory-toggle__opt--active' : ''}`}
            aria-pressed={!schedule.enabled}
            disabled={loading || saving}
            onClick={() => void onToggleEnable(false)}
          >
            OFF
          </button>
          <button
            type="button"
            className={`memory-toggle__opt${schedule.enabled ? ' memory-toggle__opt--active' : ''}`}
            aria-pressed={schedule.enabled}
            disabled={loading || saving}
            onClick={() => void onToggleEnable(true)}
          >
            ON
          </button>
        </div>
      </div>

      <div className="field">
        <label className="field__label" htmlFor={`${baseId}-time`}>
          Ora
        </label>
        <input
          id={`${baseId}-time`}
          type="time"
          value={schedule.localTime || '08:00'}
          disabled={loading || saving}
          onChange={(e) => onTimeChange(e.target.value)}
          onBlur={onTimeBlur}
        />
        <p className="settings-note settings-note--tight">
          Ora locale del dispositivo
          {schedule.timezone ? ` (${schedule.timezone})` : ''}. Rispetta l’ora legale.
        </p>
      </div>

      <fieldset className="morning-briefing__days" disabled={loading || saving}>
        <legend className="field__label">Giorni</legend>
        <div className="morning-briefing__day-row" role="group" aria-label="Giorni della settimana">
          {MORNING_DAY_LABELS.map((d) => {
            const active = (schedule.daysOfWeek || []).includes(d.value)
            return (
              <button
                key={d.value}
                type="button"
                className={`morning-briefing__day${active ? ' morning-briefing__day--active' : ''}`}
                aria-pressed={active}
                aria-label={d.aria}
                onClick={() => toggleDay(d.value)}
              >
                <span aria-hidden="true">{d.short}</span>
              </button>
            )
          })}
        </div>
      </fieldset>

      {status ? (
        <p className="settings-note settings-note--tight" role="status">
          {status}
        </p>
      ) : null}
      {error ? (
        <p className="settings-note settings-note--tight settings-note--warn" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
