/**
 * #336B TEMPORARY — Preview-only Calendar crypto fingerprint UI.
 * REMOVE BEFORE MERGE.
 */

import { useState } from 'react'
import {
  formatCalendarCryptoDiagJson,
  isTempCalendarCryptoDiagUiEnabled,
  runEdgeCalendarCryptoDiag,
  runVercelCalendarCryptoDiag,
  type CalendarCryptoDiagSafe,
} from '../lib/calendarCryptoDiag'

function DiagBlock({ title, diag }: { title: string; diag: CalendarCryptoDiagSafe }) {
  return (
    <div className="settings-note settings-note--tight">
      <strong>{title}</strong>
      <ul style={{ margin: '0.35rem 0 0', paddingLeft: '1.1rem' }}>
        <li>exists: {String(diag.exists)}</li>
        <li>trimmedLength: {diag.trimmedLength}</li>
        <li>stringFingerprint12: {diag.stringFingerprint12 ?? 'null'}</li>
        <li>parseOk: {String(diag.parseOk)}</li>
        <li>effectiveByteLength: {diag.effectiveByteLength ?? 'null'}</li>
        <li>effectiveFingerprint12: {diag.effectiveFingerprint12 ?? 'null'}</li>
      </ul>
    </div>
  )
}

/** Temporary Preview/dev diagnostic panel — not for Production. */
export function CalendarCryptoDiagPanel() {
  const [busy, setBusy] = useState(false)
  const [vercel, setVercel] = useState<CalendarCryptoDiagSafe | null>(null)
  const [edge, setEdge] = useState<CalendarCryptoDiagSafe | null>(null)
  const [vercelError, setVercelError] = useState<string | null>(null)
  const [edgeError, setEdgeError] = useState<string | null>(null)
  const [copyNote, setCopyNote] = useState<string | null>(null)

  if (!isTempCalendarCryptoDiagUiEnabled()) return null

  const jsonText = formatCalendarCryptoDiagJson({
    vercelPreview: vercel,
    supabaseEdge: edge,
    vercelPreviewError: vercelError,
    supabaseEdgeError: edgeError,
  })

  const run = async () => {
    setBusy(true)
    setCopyNote(null)
    setVercel(null)
    setEdge(null)
    setVercelError(null)
    setEdgeError(null)
    try {
      const [v, e] = await Promise.all([
        runVercelCalendarCryptoDiag(),
        runEdgeCalendarCryptoDiag(),
      ])
      if (v.ok) setVercel(v.diag)
      else setVercelError(v.code)
      if (e.ok) setEdge(e.diag)
      else setEdgeError(e.code)
    } catch {
      setVercelError('diag_failed')
      setEdgeError('diag_failed')
    } finally {
      setBusy(false)
    }
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(jsonText)
      setCopyNote('Copied safe JSON.')
    } catch {
      setCopyNote('Copy failed — select the JSON manually.')
    }
  }

  return (
    <div
      className="settings-integration-block"
      style={{ marginTop: '0.75rem', borderTop: '1px solid rgba(0,0,0,0.08)', paddingTop: '0.75rem' }}
    >
      <p className="settings-note settings-note--tight" role="note">
        Calendar crypto diagnostic — temporary
      </p>
      <p className="settings-note settings-note--tight">
        Safe fingerprints only (no secrets). REMOVE BEFORE MERGE.
      </p>
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.35rem' }}>
        <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => void run()}>
          {busy ? 'Running…' : 'Run diagnostic'}
        </button>
        <button
          type="button"
          className="btn btn--ghost"
          disabled={busy || (!vercel && !edge && !vercelError && !edgeError)}
          onClick={() => void copy()}
        >
          Copy safe JSON
        </button>
      </div>
      {vercelError ? (
        <p className="settings-note settings-note--tight" role="status">
          Vercel Preview: {vercelError}
        </p>
      ) : null}
      {edgeError ? (
        <p className="settings-note settings-note--tight" role="status">
          Supabase Edge: {edgeError}
        </p>
      ) : null}
      {vercel ? <DiagBlock title="Vercel Preview" diag={vercel} /> : null}
      {edge ? <DiagBlock title="Supabase Edge" diag={edge} /> : null}
      {(vercel || edge || vercelError || edgeError) && (
        <pre
          className="settings-note settings-note--tight"
          style={{
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            maxHeight: '14rem',
            overflow: 'auto',
            marginTop: '0.5rem',
          }}
        >
          {jsonText}
        </pre>
      )}
      {copyNote ? (
        <p className="settings-note settings-note--tight" role="status">
          {copyNote}
        </p>
      ) : null}
    </div>
  )
}
