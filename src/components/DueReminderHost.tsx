import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ReminderApiError,
  completeReminder,
  formatReminderWhen,
  listDueReminders,
  markReminderDelivered,
} from '../lib/reminderApi'
import type { Reminder } from '../lib/reminderTypes'
import { isRemindersUiEnabled } from '../lib/remindersUi'
import './DueReminderHost.css'

/**
 * #303A — Deterministic in-app / next-open delivery.
 * No OpenAI. No Web Push. Marks delivered once shown.
 */
export function DueReminderHost() {
  const [queue, setQueue] = useState<Reminder[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const deliveringRef = useRef<Set<string>>(new Set())
  const enabled = isRemindersUiEnabled()

  const pollDue = useCallback(async () => {
    if (!enabled) return
    try {
      const due = await listDueReminders()
      setQueue((prev) => {
        const seen = new Set(prev.map((r) => r.id))
        const merged = [...prev]
        for (const item of due) {
          if (!seen.has(item.id) && !deliveringRef.current.has(item.id)) {
            merged.push(item)
            seen.add(item.id)
          }
        }
        return merged
      })
      setError(null)
    } catch (err) {
      // Soft: auth not ready or network — do not spam.
      if (err instanceof ReminderApiError && err.status === 401) return
      setError(err instanceof ReminderApiError ? err.message : null)
    }
  }, [enabled])

  useEffect(() => {
    if (!enabled) return
    void pollDue()
    const interval = window.setInterval(() => {
      void pollDue()
    }, 45_000)
    const onFocus = () => {
      void pollDue()
    }
    const onVis = () => {
      if (document.visibilityState === 'visible') void pollDue()
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVis)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [enabled, pollDue])

  const current = queue[0] ?? null

  const acknowledge = async (reminder: Reminder, complete: boolean) => {
    if (busy || deliveringRef.current.has(reminder.id)) return
    setBusy(true)
    deliveringRef.current.add(reminder.id)
    try {
      await markReminderDelivered(reminder.id)
      if (complete) {
        await completeReminder(reminder.id)
      }
      setQueue((prev) => prev.filter((r) => r.id !== reminder.id))
    } catch (err) {
      setError(err instanceof ReminderApiError ? err.message : 'Consegna non riuscita.')
      deliveringRef.current.delete(reminder.id)
    } finally {
      setBusy(false)
    }
  }

  if (!enabled || !current) {
    return error ? (
      <div className="due-reminder due-reminder--toast" role="status">
        {error}
      </div>
    ) : null
  }

  const wasMissed = new Date(current.fireAt).getTime() < Date.now() - 60_000

  return (
    <div className="due-reminder" role="dialog" aria-modal="true" aria-labelledby="due-reminder-title">
      <div className="due-reminder__panel">
        <p className="due-reminder__eyebrow">{wasMissed ? 'Promemoria in ritardo' : 'Promemoria'}</p>
        <h2 id="due-reminder-title" className="due-reminder__title">
          {current.title}
        </h2>
        <p className="due-reminder__when">{formatReminderWhen(current)}</p>
        {current.body ? <p className="due-reminder__body">{current.body}</p> : null}
        {wasMissed ? (
          <p className="due-reminder__note">
            Questo promemoria è scaduto mentre ShinkAIdo era chiuso. Nessuna notifica push è stata
            inviata in questa fase.
          </p>
        ) : null}
        {error ? (
          <p className="due-reminder__error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="due-reminder__actions">
          <button
            type="button"
            className="due-reminder__primary"
            disabled={busy}
            onClick={() => void acknowledge(current, true)}
          >
            Segnato
          </button>
          <button
            type="button"
            className="due-reminder__ghost"
            disabled={busy}
            onClick={() => void acknowledge(current, false)}
          >
            Chiudi
          </button>
        </div>
      </div>
    </div>
  )
}
