/**
 * #332E2 / #332E2A — Compact account identity panel (Plans gate + Privacy).
 * No billing. LINK current anonymous ≠ SIGN INTO existing account.
 *
 * #332E2A: parent notify only on material identity change; mount effect is
 * one-shot (callback held in ref) to avoid Maximum update depth loops.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  changeEmailForCurrentUser,
  linkEmailToCurrentUser,
  linkGoogleToCurrentUser,
  loadIdentitySnapshot,
  signInExistingWithEmailOtp,
  signOutCurrentUser,
  type AccountActionResult,
} from '../lib/accountLinking'
import {
  identityStatusEquals,
  isGoogleLinkingEnabled,
  type IdentityStatus,
} from '../lib/durableIdentity'
import './IdentityAccountPanel.css'

type Mode = 'status' | 'link' | 'signin' | 'change-email'

type IdentityAccountPanelProps = {
  /** Compact copy for Plans Upgrade gate */
  variant?: 'plans' | 'privacy'
  onIdentityChange?: (status: IdentityStatus) => void
  /** When true (Plans gate), scroll panel into view after mount. */
  autoFocus?: boolean
}

export function IdentityAccountPanel({
  variant = 'privacy',
  onIdentityChange,
  autoFocus = false,
}: IdentityAccountPanelProps) {
  const [status, setStatus] = useState<IdentityStatus | null>(null)
  const [mode, setMode] = useState<Mode>('status')
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const googleEnabled = isGoogleLinkingEnabled()

  const onIdentityChangeRef = useRef(onIdentityChange)
  onIdentityChangeRef.current = onIdentityChange

  const lastReportedRef = useRef<IdentityStatus | null>(null)
  const panelRef = useRef<HTMLElement | null>(null)

  const reportIfChanged = useCallback((next: IdentityStatus) => {
    if (identityStatusEquals(lastReportedRef.current, next)) return
    lastReportedRef.current = next
    onIdentityChangeRef.current?.(next)
  }, [])

  const refresh = useCallback(async () => {
    try {
      const next = await loadIdentitySnapshot()
      setStatus(next)
      setLoadError(null)
      reportIfChanged(next)
      return next
    } catch {
      setLoadError('Impossibile aggiornare lo stato account. Riprova.')
      return null
    }
  }, [reportIfChanged])

  // One-shot mount load — must NOT depend on parent callback identity.
  useEffect(() => {
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional mount-only
  }, [])

  useEffect(() => {
    if (!autoFocus) return
    const node = panelRef.current
    if (!node) return
    node.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [autoFocus])

  const applyResult = async (result: AccountActionResult) => {
    setNote(result.message)
    await refresh()
  }

  const onLinkEmail = async () => {
    setBusy(true)
    try {
      await applyResult(await linkEmailToCurrentUser(email))
    } finally {
      setBusy(false)
    }
  }

  const onSignInEmail = async () => {
    setBusy(true)
    try {
      await applyResult(await signInExistingWithEmailOtp(email))
    } finally {
      setBusy(false)
    }
  }

  const onLinkGoogle = async () => {
    setBusy(true)
    try {
      await applyResult(await linkGoogleToCurrentUser())
    } finally {
      setBusy(false)
    }
  }

  const onSignOut = async () => {
    setBusy(true)
    try {
      await applyResult(await signOutCurrentUser())
      setMode('status')
    } finally {
      setBusy(false)
    }
  }

  const onChangeEmail = async () => {
    setBusy(true)
    try {
      await applyResult(await changeEmailForCurrentUser(email))
      // Stay on change-email form so pending copy remains visible; clear input.
      setEmail('')
    } finally {
      setBusy(false)
    }
  }

  const durable = status?.durable === true
  const anonymous = status?.anonymous !== false && !durable
  const emailLinked =
    durable &&
    (status?.providers?.includes('email') === true || Boolean(status?.emailMasked))

  return (
    <section
      ref={panelRef}
      id={variant === 'plans' ? 'plans-identity-gate' : undefined}
      className={`identity-panel identity-panel--${variant}`}
      aria-labelledby={`identity-panel-title-${variant}`}
      tabIndex={-1}
    >
      <h2 id={`identity-panel-title-${variant}`} className="identity-panel__title">
        Account
      </h2>

      {variant === 'plans' && anonymous ? (
        <p className="identity-panel__lead">
          Crea o collega un account per proteggere e ripristinare il tuo acquisto.
        </p>
      ) : null}

      <p className="identity-panel__state" role="status">
        {status == null && !loadError
          ? 'Caricamento stato account…'
          : durable
            ? `Account collegato${status?.emailMasked ? ` (${status.emailMasked})` : ''}`
            : 'Sessione anonima — non recuperabile su altri dispositivi'}
      </p>

      {durable && status?.emailChangePending && status.pendingEmailMasked ? (
        <p className="identity-panel__note" role="status">
          Cambio email in corso verso {status.pendingEmailMasked}. Controlla la posta (e, se
          richiesto, conferma anche l’indirizzo attuale).
        </p>
      ) : null}

      {loadError ? (
        <p className="identity-panel__note" role="alert">
          {loadError}{' '}
          <button
            type="button"
            className="identity-panel__btn"
            onClick={() => void refresh()}
            disabled={busy}
          >
            Riprova
          </button>
        </p>
      ) : null}

      {note ? (
        <p className="identity-panel__note" role="status" aria-live="polite">
          {note}
        </p>
      ) : null}

      {mode === 'status' ? (
        <div className="identity-panel__actions">
          {!durable ? (
            <button
              type="button"
              className="identity-panel__btn identity-panel__btn--primary"
              onClick={() => {
                setMode('link')
                setNote(null)
              }}
              disabled={busy}
            >
              Collega account
            </button>
          ) : null}
          {emailLinked ? (
            <button
              type="button"
              className="identity-panel__btn"
              onClick={() => {
                setMode('change-email')
                setEmail('')
                setNote(null)
              }}
              disabled={busy}
            >
              Cambia email
            </button>
          ) : null}
          <button
            type="button"
            className="identity-panel__btn"
            onClick={() => {
              setMode('signin')
              setNote(
                'Accedere a un account esistente non unisce i dati della sessione anonima corrente.',
              )
            }}
            disabled={busy}
          >
            Accedi a un account esistente
          </button>
          {durable ? (
            <button
              type="button"
              className="identity-panel__btn"
              onClick={() => void onSignOut()}
              disabled={busy}
            >
              Esci
            </button>
          ) : null}
        </div>
      ) : null}

      {mode === 'link' ? (
        <div className="identity-panel__form">
          <p className="identity-panel__hint">
            Colleghiamo l’email a questa sessione (stesso ID utente). Nessun addebito.
          </p>
          <label className="identity-panel__label" htmlFor={`identity-email-link-${variant}`}>
            Email
          </label>
          <input
            id={`identity-email-link-${variant}`}
            className="identity-panel__input"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={busy}
            placeholder="tu@email.com"
          />
          <div className="identity-panel__actions">
            <button
              type="button"
              className="identity-panel__btn identity-panel__btn--primary"
              onClick={() => void onLinkEmail()}
              disabled={busy}
            >
              Invia link di conferma
            </button>
            {googleEnabled ? (
              <button
                type="button"
                className="identity-panel__btn"
                onClick={() => void onLinkGoogle()}
                disabled={busy}
              >
                Collega Google
              </button>
            ) : (
              <p className="identity-panel__meta">Google / Apple: disponibili dopo provisioning.</p>
            )}
            <button
              type="button"
              className="identity-panel__btn"
              onClick={() => {
                setMode('status')
                setNote(null)
              }}
              disabled={busy}
            >
              Annulla
            </button>
          </div>
        </div>
      ) : null}

      {mode === 'signin' ? (
        <div className="identity-panel__form">
          <p className="identity-panel__hint identity-panel__hint--warn">
            Attenzione: passerai a un altro account. I dati di questa sessione anonima non vengono
            uniti automaticamente.
          </p>
          <label className="identity-panel__label" htmlFor={`identity-email-signin-${variant}`}>
            Email account esistente
          </label>
          <input
            id={`identity-email-signin-${variant}`}
            className="identity-panel__input"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={busy}
            placeholder="tu@email.com"
          />
          <div className="identity-panel__actions">
            <button
              type="button"
              className="identity-panel__btn identity-panel__btn--primary"
              onClick={() => void onSignInEmail()}
              disabled={busy}
            >
              Invia link di accesso
            </button>
            <button
              type="button"
              className="identity-panel__btn"
              onClick={() => {
                setMode('status')
                setNote(null)
              }}
              disabled={busy}
            >
              Annulla
            </button>
          </div>
        </div>
      ) : null}

      {mode === 'change-email' ? (
        <div className="identity-panel__form">
          <p className="identity-panel__hint">
            Email attuale: {status?.emailMasked || '—'}. Il cambio mantiene lo stesso account (stesso
            ID). Nessun addebito. Nessuna unione con altri account.
          </p>
          <p className="identity-panel__meta">
            Supabase invia un link di conferma al nuovo indirizzo. Se Secure Email Change è attivo,
            conferma anche dalla email attuale prima che il cambio sia definitivo.
          </p>
          <label className="identity-panel__label" htmlFor={`identity-email-change-${variant}`}>
            Nuova email
          </label>
          <input
            id={`identity-email-change-${variant}`}
            className="identity-panel__input"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={busy}
            placeholder="nuova@email.com"
          />
          <div className="identity-panel__actions">
            <button
              type="button"
              className="identity-panel__btn identity-panel__btn--primary"
              onClick={() => void onChangeEmail()}
              disabled={busy}
            >
              Invia conferma
            </button>
            <button
              type="button"
              className="identity-panel__btn"
              onClick={() => {
                setMode('status')
                setEmail('')
                setNote(null)
              }}
              disabled={busy}
            >
              Annulla
            </button>
          </div>
        </div>
      ) : null}
    </section>
  )
}
