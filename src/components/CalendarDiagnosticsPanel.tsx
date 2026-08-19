import { useCallback, useEffect, useState } from 'react'
import { getClientBuildId } from '../lib/buildInfo'
import {
  bootstrapCalendarDiagMode,
  CALENDAR_DIAG_CHAT_KEY,
  CALENDAR_DIAG_CLIENT_BUILD,
  CALENDAR_DIAG_CONNECTION_KEY,
  CALENDAR_DIAG_EVENT,
  CALENDAR_DIAG_OAUTH_KEY,
  ensureCalendarDiagInUrl,
  frontendSupabaseProjectRef,
  isCalendarDiagModeEnabled,
  readCalendarDiagCorrelationId,
  readCalendarDiagSnapshot,
} from '../lib/calendarDiagClient'
import {
  consumeCalendarReturnQuery,
  fetchCalendarLiveDiag,
  persistCalendarConnectionDiag,
} from '../lib/calendarApi'
import './CalendarDiagnosticsPanel.css'

type Row = { label: string; value: string }

function asText(v: unknown, fallback = '—'): string {
  if (v === null || v === undefined) return fallback
  if (typeof v === 'boolean') return v ? 'YES' : 'NO'
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  if (typeof v === 'string' && v.trim()) return v.trim()
  return fallback
}

/**
 * #310C3 — Temporary on-screen Calendar Diagnostics panel (safe fields only).
 * Visible whenever ?calendar_diag=1 / persisted diag mode is active.
 * Survives OAuth return and remains after chat.
 */
export function CalendarDiagnosticsPanel() {
  const [visible, setVisible] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [rows, setRows] = useState<Row[]>([])
  const [tick, setTick] = useState(0)

  const refresh = useCallback(() => {
    const on = isCalendarDiagModeEnabled()
    setVisible(on)
    if (!on) return

    ensureCalendarDiagInUrl()
    const oauth = readCalendarDiagSnapshot(CALENDAR_DIAG_OAUTH_KEY)
    const connection = readCalendarDiagSnapshot(CALENDAR_DIAG_CONNECTION_KEY)
    const chat = readCalendarDiagSnapshot(CALENDAR_DIAG_CHAT_KEY)
    const cid = readCalendarDiagCorrelationId()

    const next: Row[] = [
      { label: 'diagBuild', value: CALENDAR_DIAG_CLIENT_BUILD },
      { label: 'buildId', value: asText(chat?.buildId || getClientBuildId()) },
      {
        label: 'frontend Supabase project',
        value: asText(frontendSupabaseProjectRef() || oauth?.supabaseProject),
      },
      {
        label: 'OAuth owner uid',
        value: asText(oauth?.authUid || connection?.authUid),
      },
      {
        label: 'chat uid',
        value: asText(chat?.authUid || chat?.lookupOwnerUid),
      },
      {
        label: 'CALENDAR_ENABLED',
        value: asText(chat?.runtimeCalendarEnabled),
      },
      { label: 'chat intent', value: asText(chat?.intent) },
      { label: 'chat used', value: asText(chat?.used) },
      {
        label: 'visible UI last-user len',
        value: asText(
          chat?.visibleUiLastUserLen ?? chat?.clientOutboundLastUserLen,
        ),
      },
      {
        label: 'visible UI last-user preview',
        value: asText(
          chat?.visibleUiLastUserPreview ?? chat?.clientOutboundLastUserPreview,
        ),
      },
      {
        label: 'frontend outbound len',
        value: asText(chat?.clientOutboundLastUserLen),
      },
      {
        label: 'frontend outbound preview',
        value: asText(chat?.clientOutboundLastUserPreview),
      },
      {
        label: 'api parsed last-user len',
        value: asText(chat?.apiParsedLastUserLen),
      },
      {
        label: 'api parsed last-user preview',
        value: asText(chat?.apiParsedLastUserPreview),
      },
      {
        label: 'enrichment selected len',
        value: asText(chat?.enrichmentSelectedLen),
      },
      {
        label: 'enrichment selected preview',
        value: asText(chat?.enrichmentSelectedPreview),
      },
      { label: 'detectorInput', value: asText(chat?.detectorInput) },
      { label: 'detectorNormalized', value: asText(chat?.detectorNormalized) },
      { label: 'detectorResult', value: asText(chat?.detectorResult || chat?.intent) },
      {
        label: 'messageSource',
        value: asText(chat?.messageSource),
      },
      {
        label: 'selectedMessageRole',
        value: asText(chat?.selectedMessageRole),
      },
      {
        label: 'connection row found (chat)',
        value: asText(chat?.rowFound),
      },
      {
        label: 'connection status (chat)',
        value: asText(chat?.connectionStatus),
      },
      {
        label: 'connection row found (settings)',
        value: asText(connection?.rowFound),
      },
      {
        label: 'connection status (settings)',
        value: asText(connection?.connectionStatus || connection?.status),
      },
      { label: 'tokenDecrypt', value: asText(chat?.tokenDecrypt) },
      {
        label: 'preGoogleFailureCode',
        value: asText(chat?.preGoogleFailureCode || chat?.code),
      },
      {
        label: 'Google request reached',
        value: asText(chat?.googleRequestReached),
      },
      {
        label: 'Google HTTP status',
        value: asText(chat?.googleHttpResult),
      },
      { label: 'eventCount', value: asText(chat?.eventCount) },
      {
        label: 'Calendar pack status',
        value: asText(chat?.packStatus || chat?.note),
      },
      {
        label: 'Calendar context sent to model',
        value: asText(chat?.calendarContextPresent ?? chat?.packAppended),
      },
      {
        label: 'requestId',
        value: asText(chat?.requestId || chat?.correlationId || cid),
      },
      {
        label: 'correlationId',
        value: asText(cid || oauth?.correlationId || chat?.correlationId),
      },
      {
        label: 'oauthStart',
        value: oauth ? asText(oauth.phase, 'captured') : 'missing',
      },
      {
        label: 'connectionDiag',
        value: connection ? asText(connection.phase, 'captured') : 'missing',
      },
      {
        label: 'chatDiag',
        value: chat ? asText(chat.phase, 'captured') : 'missing',
      },
    ]
    setRows(next)
  }, [])

  useEffect(() => {
    bootstrapCalendarDiagMode()
    const returned = consumeCalendarReturnQuery()
    void (async () => {
      if (!isCalendarDiagModeEnabled()) {
        setVisible(false)
        return
      }
      if (returned === 'connected' || returned === 'reconnect_required' || returned === 'error') {
        const diag = await fetchCalendarLiveDiag()
        if (diag.ok && diag.diag) persistCalendarConnectionDiag(diag.diag)
      } else {
        // Still try a live connection snapshot so the panel is useful before chat.
        const diag = await fetchCalendarLiveDiag()
        if (diag.ok && diag.diag) persistCalendarConnectionDiag(diag.diag)
      }
      refresh()
    })()
  }, [refresh])

  useEffect(() => {
    const onUpdate = () => refresh()
    window.addEventListener(CALENDAR_DIAG_EVENT, onUpdate)
    const id = window.setInterval(() => {
      setTick((n) => n + 1)
      refresh()
    }, 2000)
    return () => {
      window.removeEventListener(CALENDAR_DIAG_EVENT, onUpdate)
      window.clearInterval(id)
    }
  }, [refresh])

  useEffect(() => {
    // tick forces periodic re-render without extra logic
    void tick
  }, [tick])

  if (!visible) return null

  return (
    <aside
      className={`calendar-diag-panel${collapsed ? ' calendar-diag-panel--collapsed' : ''}`}
      aria-label="Calendar Diagnostics"
      data-calendar-diag="1"
    >
      <div className="calendar-diag-panel__head">
        <strong className="calendar-diag-panel__title">Calendar Diagnostics</strong>
        <button
          type="button"
          className="calendar-diag-panel__toggle"
          onClick={() => setCollapsed((c) => !c)}
          aria-expanded={!collapsed}
        >
          {collapsed ? 'Show' : 'Hide'}
        </button>
      </div>
      {!collapsed ? (
        <dl className="calendar-diag-panel__list">
          {rows.map((row) => (
            <div key={row.label} className="calendar-diag-panel__row">
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="calendar-diag-panel__hint">Diag mode on · {asText(rows[1]?.value)}</p>
      )}
    </aside>
  )
}
