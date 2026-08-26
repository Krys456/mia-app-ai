/**
 * #386C — Account deletion panel (Privacy → Account).
 * Distinct from Clear Memory / Disconnect Calendar / Disconnect Gmail / Sign out.
 */

import { useCallback, useId, useState } from 'react'
import { signOutCurrentUser } from '../lib/accountLinking'
import {
  isAccountDeletionUiEnabled,
  isValidDeletionConfirmation,
  requestAccountDeletion,
} from '../lib/accountDeletionApi'
import { clearAccountLocalState } from '../lib/accountDeletionCleanup'
import { ACCOUNT_DELETION_COPY } from '../lib/privacyCopy'
import { disableWebPush } from '../lib/webPush'
import './AccountDeletionPanel.css'

type AccountDeletionPanelProps = {
  /** Optional: parent can clear in-memory chat before navigation. */
  onBeforeNavigate?: () => void
}

export function AccountDeletionPanel({ onBeforeNavigate }: AccountDeletionPanelProps) {
  const baseId = useId()
  const enabled = isAccountDeletionUiEnabled()
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const confirmOk = isValidDeletionConfirmation(typed)

  const runDeletion = useCallback(async () => {
    if (busy || !confirmOk) return
    setBusy(true)
    setError(null)

    const result = await requestAccountDeletion(typed.trim())
    if (!result.ok) {
      setBusy(false)
      setError(result.message)
      return
    }

    // Server critical path succeeded — local cleanup best-effort.
    try {
      await disableWebPush()
    } catch {
      /* soft */
    }
    try {
      onBeforeNavigate?.()
    } catch {
      /* soft */
    }
    clearAccountLocalState()
    try {
      await signOutCurrentUser()
    } catch {
      /* soft — auth user may already be gone */
    }

    // Hard navigate to a fresh app surface (new anonymous bootstrap on reload).
    try {
      window.location.assign('/')
    } catch {
      window.location.href = '/'
    }
  }, [busy, confirmOk, typed, onBeforeNavigate])

  if (!enabled) {
    return (
      <div className="account-deletion" role="region" aria-labelledby={`${baseId}-title`}>
        <h3 id={`${baseId}-title`} className="account-deletion__title">
          {ACCOUNT_DELETION_COPY.title}
        </h3>
        <p className="account-deletion__lead">{ACCOUNT_DELETION_COPY.disabled}</p>
      </div>
    )
  }

  return (
    <div className="account-deletion" role="region" aria-labelledby={`${baseId}-title`}>
      <h3 id={`${baseId}-title`} className="account-deletion__title">
        {ACCOUNT_DELETION_COPY.title}
      </h3>
      <p className="account-deletion__lead">{ACCOUNT_DELETION_COPY.lead}</p>
      <p className="account-deletion__distinguish">{ACCOUNT_DELETION_COPY.distinguish}</p>

      {!open ? (
        <button
          type="button"
          className="account-deletion__open"
          onClick={() => {
            setOpen(true)
            setError(null)
            setTyped('')
          }}
        >
          {ACCOUNT_DELETION_COPY.openButton}
        </button>
      ) : (
        <div className="account-deletion__confirm">
          <p className="account-deletion__warn" role="note">
            {ACCOUNT_DELETION_COPY.warning}
          </p>
          <p className="account-deletion__meta">{ACCOUNT_DELETION_COPY.logsNote}</p>
          <label className="account-deletion__label" htmlFor={`${baseId}-confirm`}>
            {ACCOUNT_DELETION_COPY.confirmLabel}
          </label>
          <input
            id={`${baseId}-confirm`}
            className="account-deletion__input"
            type="text"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            value={typed}
            disabled={busy}
            placeholder="ELIMINA"
            onChange={(e) => setTyped(e.target.value)}
            aria-describedby={`${baseId}-hint`}
          />
          <p id={`${baseId}-hint`} className="account-deletion__meta">
            {ACCOUNT_DELETION_COPY.confirmHint}
          </p>
          {error ? (
            <p className="account-deletion__error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="account-deletion__actions">
            <button
              type="button"
              className="account-deletion__cancel"
              disabled={busy}
              onClick={() => {
                setOpen(false)
                setTyped('')
                setError(null)
              }}
            >
              {ACCOUNT_DELETION_COPY.cancel}
            </button>
            <button
              type="button"
              className="account-deletion__destroy"
              disabled={busy || !confirmOk}
              aria-busy={busy || undefined}
              onClick={() => void runDeletion()}
            >
              {busy ? ACCOUNT_DELETION_COPY.processing : ACCOUNT_DELETION_COPY.destroy}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
