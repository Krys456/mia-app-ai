/**
 * #332E2 — Compact account identity panel (Plans gate + Privacy).
 * No billing. LINK current anonymous ≠ SIGN INTO existing account.
 */

import { useCallback, useEffect, useState } from 'react'
import {
  linkEmailToCurrentUser,
  linkGoogleToCurrentUser,
  loadIdentitySnapshot,
  signInExistingWithEmailOtp,
  signOutCurrentUser,
  type AccountActionResult,
} from '../lib/accountLinking'
import {
  isGoogleLinkingEnabled,
  type IdentityStatus,
} from '../lib/durableIdentity'
import './IdentityAccountPanel.css'

type Mode = 'status' | 'link' | 'signin'

type IdentityAccountPanelProps = {
  /** Compact copy for Plans Upgrade gate */
  variant?: 'plans' | 'privacy'
  onIdentityChange?: (status: IdentityStatus) => void
}

export function IdentityAccountPanel({
  variant = 'privacy',
  onIdentityChange,
}: IdentityAccountPanelProps) {
  const [status, setStatus] = useState<IdentityStatus | null>(null)
  const [mode, setMode] = useState<Mode>('status')
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const googleEnabled = isGoogleLinkingEnabled()

  const refresh = useCallback(async () => {
    const next = await loadIdentitySnapshot()
    setStatus(next)
    onIdentityChange?.(next)
    return next
  }, [onIdentityChange])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const applyResult = async (result: AccountActionResult) => {
    setNote(result.message)
    await refresh()
    if (result.ok && result.code === 'email_sent' && mode === 'link') {
      // Stay on panel; user must confirm email.
    }
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

  const durable = status?.durable === true
  const anonymous = status?.anonymous !== false && !durable

  return (
    <section
      className={`identity-panel identity-panel--${variant}`}
      aria-labelledby={`identity-panel-title-${variant}`}
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
        {durable
          ? `Account collegato${status?.emailMasked ? ` (${status.emailMasked})` : ''}`
          : 'Sessione anonima — non recuperabile su altri dispositivi'}
      </p>

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
    </section>
  )
}
