import { useCallback, useEffect, useState } from 'react'
import { PageHeader } from '../components/PageHeader'
import {
  ReminderApiError,
  buildManualReminderProposal,
  cancelReminder,
  completeReminder,
  createReminderFromProposal,
  formatReminderWhen,
  guessBrowserTimeZone,
  listUpcomingReminders,
  updateReminder,
} from '../lib/reminderApi'
import type { Reminder, ReminderProposal } from '../lib/reminderTypes'
import { REMINDER_BODY_MAX, REMINDER_TITLE_MAX } from '../lib/reminderTypes'
import './ReminderManage.css'

interface ReminderManageProps {
  onBack: () => void
}

type FormMode = 'idle' | 'create' | 'confirm' | 'edit'

export function ReminderManage({ onBack }: ReminderManageProps) {
  const [reminders, setReminders] = useState<Reminder[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<FormMode>('idle')
  const [proposal, setProposal] = useState<ReminderProposal | null>(null)
  const [editing, setEditing] = useState<Reminder | null>(null)
  const [busy, setBusy] = useState(false)

  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [timezone, setTimezone] = useState(guessBrowserTimeZone())

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const rows = await listUpcomingReminders()
      setReminders(rows)
    } catch (err) {
      setError(err instanceof ReminderApiError ? err.message : 'Impossibile caricare i promemoria.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const resetForm = () => {
    setTitle('')
    setBody('')
    setDate('')
    setTime('')
    setTimezone(guessBrowserTimeZone())
    setProposal(null)
    setEditing(null)
    setMode('idle')
  }

  const openCreate = () => {
    resetForm()
    const now = new Date()
    now.setMinutes(now.getMinutes() + 60)
    const pad = (n: number) => String(n).padStart(2, '0')
    // Local date/time fields for the form (browser local).
    setDate(`${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`)
    setTime(`${pad(now.getHours())}:${pad(now.getMinutes())}`)
    setMode('create')
  }

  const goConfirmFromCreate = () => {
    setError(null)
    const built = buildManualReminderProposal({ title, body, date, time, timezone })
    if ('error' in built) {
      setError(built.error)
      return
    }
    setProposal(built)
    setMode('confirm')
  }

  const confirmCreate = async () => {
    if (!proposal) return
    setBusy(true)
    setError(null)
    try {
      await createReminderFromProposal(proposal)
      resetForm()
      await refresh()
    } catch (err) {
      setError(err instanceof ReminderApiError ? err.message : 'Creazione non riuscita.')
    } finally {
      setBusy(false)
    }
  }

  const openEdit = (reminder: Reminder) => {
    setEditing(reminder)
    setTitle(reminder.title)
    setBody(reminder.body || '')
    setTimezone(reminder.timezone || guessBrowserTimeZone())
    try {
      const fmt = new Intl.DateTimeFormat('en-CA', {
        timeZone: reminder.timezone || undefined,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      })
      const parts = fmt.formatToParts(new Date(reminder.fireAt))
      const get = (t: string) => parts.find((p) => p.type === t)?.value || ''
      setDate(`${get('year')}-${get('month')}-${get('day')}`)
      setTime(`${get('hour')}:${get('minute')}`)
    } catch {
      setDate('')
      setTime('')
    }
    setMode('edit')
  }

  const saveEdit = async () => {
    if (!editing) return
    setBusy(true)
    setError(null)
    const built = buildManualReminderProposal({ title, body, date, time, timezone })
    if ('error' in built) {
      setError(built.error)
      setBusy(false)
      return
    }
    try {
      await updateReminder(editing.id, {
        title: built.title,
        body: built.body ?? null,
        fire_at: built.fireAt,
        timezone: built.timezone,
      })
      resetForm()
      await refresh()
    } catch (err) {
      setError(err instanceof ReminderApiError ? err.message : 'Modifica non riuscita.')
    } finally {
      setBusy(false)
    }
  }

  const onCancelReminder = async (reminder: Reminder) => {
    if (!window.confirm(`Annullare il promemoria «${reminder.title}»?`)) return
    setBusy(true)
    setError(null)
    try {
      await cancelReminder(reminder.id)
      await refresh()
    } catch (err) {
      setError(err instanceof ReminderApiError ? err.message : 'Annullamento non riuscito.')
    } finally {
      setBusy(false)
    }
  }

  const onComplete = async (reminder: Reminder) => {
    setBusy(true)
    setError(null)
    try {
      await completeReminder(reminder.id)
      await refresh()
    } catch (err) {
      setError(err instanceof ReminderApiError ? err.message : 'Completamento non riuscito.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="reminder-manage">
      <PageHeader title="Promemoria" onBack={onBack} />
      <div className="reminder-manage__body scroll-surface">
        <p className="reminder-manage__lead">
          Crea e gestisci promemoria espliciti. Vengono consegnati in app o al prossimo
          accesso — non come notifiche push in questa fase.
        </p>

        {error ? (
          <p className="reminder-manage__error" role="alert">
            {error}
          </p>
        ) : null}

        {mode === 'idle' ? (
          <div className="reminder-manage__actions">
            <button type="button" className="reminder-manage__primary" onClick={openCreate}>
              Nuovo promemoria
            </button>
          </div>
        ) : null}

        {mode === 'create' || mode === 'edit' ? (
          <section className="reminder-manage__form" aria-label={mode === 'edit' ? 'Modifica promemoria' : 'Nuovo promemoria'}>
            <label className="reminder-manage__field">
              <span>Titolo</span>
              <input
                value={title}
                maxLength={REMINDER_TITLE_MAX}
                onChange={(e) => setTitle(e.target.value)}
                disabled={busy}
              />
            </label>
            <label className="reminder-manage__field">
              <span>Dettaglio (opzionale)</span>
              <textarea
                value={body}
                maxLength={REMINDER_BODY_MAX}
                rows={3}
                onChange={(e) => setBody(e.target.value)}
                disabled={busy}
              />
            </label>
            <div className="reminder-manage__row">
              <label className="reminder-manage__field">
                <span>Data</span>
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} disabled={busy} />
              </label>
              <label className="reminder-manage__field">
                <span>Ora</span>
                <input type="time" value={time} onChange={(e) => setTime(e.target.value)} disabled={busy} />
              </label>
            </div>
            <label className="reminder-manage__field">
              <span>Fuso orario</span>
              <input value={timezone} onChange={(e) => setTimezone(e.target.value)} disabled={busy} />
            </label>
            <div className="reminder-manage__actions">
              {mode === 'create' ? (
                <button type="button" className="reminder-manage__primary" onClick={goConfirmFromCreate} disabled={busy}>
                  Continua
                </button>
              ) : (
                <button type="button" className="reminder-manage__primary" onClick={() => void saveEdit()} disabled={busy}>
                  Salva
                </button>
              )}
              <button type="button" className="reminder-manage__ghost" onClick={resetForm} disabled={busy}>
                Annulla
              </button>
            </div>
          </section>
        ) : null}

        {mode === 'confirm' && proposal ? (
          <section className="reminder-manage__confirm" aria-label="Conferma promemoria">
            <h2 className="reminder-manage__confirm-title">Promemoria</h2>
            <p className="reminder-manage__confirm-what">{proposal.title}</p>
            <p className="reminder-manage__confirm-when">
              {proposal.localDateLabel} · {proposal.localTimeLabel}
              <span className="reminder-manage__confirm-tz"> ({proposal.timezone})</span>
            </p>
            {proposal.body ? <p className="reminder-manage__confirm-body">{proposal.body}</p> : null}
            <div className="reminder-manage__actions">
              <button
                type="button"
                className="reminder-manage__primary"
                onClick={() => void confirmCreate()}
                disabled={busy}
              >
                Conferma
              </button>
              <button
                type="button"
                className="reminder-manage__ghost"
                onClick={() => setMode('create')}
                disabled={busy}
              >
                Modifica
              </button>
              <button type="button" className="reminder-manage__ghost" onClick={resetForm} disabled={busy}>
                Annulla
              </button>
            </div>
          </section>
        ) : null}

        <section className="reminder-manage__list" aria-label="Promemoria in arrivo">
          <h2 className="reminder-manage__list-title">In arrivo</h2>
          {loading ? <p className="reminder-manage__muted">Caricamento…</p> : null}
          {!loading && reminders.length === 0 ? (
            <p className="reminder-manage__muted">Nessun promemoria in arrivo.</p>
          ) : null}
          <ul className="reminder-manage__items">
            {reminders.map((reminder) => (
              <li key={reminder.id} className="reminder-manage__item">
                <div className="reminder-manage__item-main">
                  <p className="reminder-manage__item-title">{reminder.title}</p>
                  <p className="reminder-manage__item-when">{formatReminderWhen(reminder)}</p>
                  <p className="reminder-manage__item-status">{statusLabel(reminder.status)}</p>
                </div>
                <div className="reminder-manage__item-actions">
                  <button type="button" className="reminder-manage__ghost" onClick={() => openEdit(reminder)} disabled={busy}>
                    Modifica
                  </button>
                  <button
                    type="button"
                    className="reminder-manage__ghost"
                    onClick={() => void onComplete(reminder)}
                    disabled={busy}
                  >
                    Completa
                  </button>
                  <button
                    type="button"
                    className="reminder-manage__ghost"
                    onClick={() => void onCancelReminder(reminder)}
                    disabled={busy}
                  >
                    Annulla
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  )
}

function statusLabel(status: string): string {
  switch (status) {
    case 'pending':
      return 'In attesa'
    case 'snoozed':
      return 'Posticipato'
    case 'delivered':
      return 'Consegnato'
    case 'completed':
      return 'Completato'
    case 'cancelled':
      return 'Annullato'
    default:
      return status
  }
}
