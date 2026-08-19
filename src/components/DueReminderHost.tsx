import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ReminderApiError,
  completeReminder,
  formatReminderWhen,
  listDueReminders,
  markReminderDelivered,
} from '../lib/reminderApi'
import {
  mergeDueIntoQueue,
  pollDueRemindersAfterAuth,
  shouldMarkDeliveredOnFetch,
} from '../lib/dueReminderDelivery'
import type { Reminder } from '../lib/reminderTypes'
import { isRemindersUiEnabled } from '../lib/remindersUi'
import { useAuthBootstrap } from '../hooks/useAuthBootstrap'
import { resolveChatAuthForRequest } from '../lib/chatAuth'
import './DueReminderHost.css'

/**
 * #303A — Deterministic in-app / next-open delivery.
 * #303C — Still no delivered-on-fetch; Push may have set push_sent_at server-side.
 * Marks delivered only after the user acknowledges the sheet (never on fetch).
 */
export function DueReminderHost() {
  const [queue, setQueue] = useState<Reminder[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const deliveringRef = useRef<Set<string>>(new Set())
  const deepLinkHandled = useRef<string | null>(null)
  const enabled = isRemindersUiEnabled()
  const auth = useAuthBootstrap()

  const pollDue = useCallback(async () => {
    if (!enabled) return
    try {
      const result = await pollDueRemindersAfterAuth({
        ensureAuth: resolveChatAuthForRequest,
        listDue: listDueReminders,
      })
      if (result.authUnavailable) {
        // Auth still not ready — soft; bootstrap / next tick will retry.
        return
      }
      // Contract: fetch ≠ delivered.
      if (shouldMarkDeliveredOnFetch()) return
      setQueue((prev) => mergeDueIntoQueue(prev, result.reminders, deliveringRef.current))
      setError(null)

      // notificationclick deep-link: /?reminder=<id>
      try {
        const params = new URLSearchParams(window.location.search)
        const deepId = params.get('reminder')
        if (deepId && deepLinkHandled.current !== deepId) {
          deepLinkHandled.current = deepId
          setQueue((prev) => {
            const hit = prev.find((r) => r.id === deepId) || result.reminders.find((r) => r.id === deepId)
            if (!hit) return prev
            const rest = prev.filter((r) => r.id !== deepId)
            return [hit, ...rest]
          })
        }
      } catch {
        /* ignore */
      }
    } catch (err) {
      if (err instanceof ReminderApiError && err.status === 401) return
      setError(err instanceof ReminderApiError ? err.message : null)
    }
  }, [enabled])

  useEffect(() => {
    if (!enabled) return

    // Fresh mount: wait until silent auth is ready (or soft-failed), then poll.
    // Do not rely on focus/visibility — those do not fire on a cold open.
    const authSettled =
      auth.status === 'ready' || auth.status === 'error' || auth.status === 'skipped'
    if (authSettled) {
      void pollDue()
    }

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
  }, [enabled, pollDue, auth.status])

  const current = queue[0] ?? null

  const acknowledge = async (reminder: Reminder, complete: boolean) => {
    if (busy || deliveringRef.current.has(reminder.id)) return
    setBusy(true)
    deliveringRef.current.add(reminder.id)
    try {
      // Delivered only after the sheet was shown and the user acts.
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
            Questo promemoria è scaduto mentre ShinkAIdo era chiuso. Se le notifiche push non erano
            attive o non sono arrivate, lo rivedi qui al prossimo accesso.
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
