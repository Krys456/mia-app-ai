/**
 * #304A1 — Google Calendar Settings toggle model (pure).
 *
 * Visual ON/OFF reflects server connection status only (not a local preference).
 * Toggle is UX — CALENDAR_ENABLED / Edge auth remain the security gates.
 */

export type CalendarToggleVisual = 'on' | 'off'

export type CalendarServiceState =
  | 'unknown'
  | 'available'
  | 'disabled'
  | 'auth_unavailable'
  | 'error'

export type CalendarUiPhase = 'idle' | 'loading' | 'connecting' | 'busy'

export type CalendarToggleModel = {
  visual: CalendarToggleVisual
  statusCode:
    | 'connected'
    | 'disconnected'
    | 'connecting'
    | 'reconnect_required'
    | 'unavailable'
    | 'error'
  statusLabel: string
  toggleDisabled: boolean
  canEnable: boolean
  canDisable: boolean
  showReadOnlyBadge: boolean
  accountEmail: string | null
}

export function resolveCalendarToggleModel(input: {
  connectionStatus: string | null | undefined
  accountEmail?: string | null
  service: CalendarServiceState
  phase: CalendarUiPhase
}): CalendarToggleModel {
  const status =
    typeof input.connectionStatus === 'string' ? input.connectionStatus.trim() : ''
  const email =
    typeof input.accountEmail === 'string' && input.accountEmail.trim()
      ? input.accountEmail.trim()
      : null
  const { service, phase } = input

  const busy = phase === 'loading' || phase === 'connecting' || phase === 'busy'
  const unavailable = service === 'disabled' || service === 'auth_unavailable'

  if (unavailable) {
    return {
      visual: 'off',
      statusCode: 'unavailable',
      statusLabel: 'Non disponibile',
      toggleDisabled: true,
      canEnable: false,
      canDisable: false,
      showReadOnlyBadge: false,
      accountEmail: null,
    }
  }

  if (phase === 'connecting' || status === 'pending') {
    return {
      visual: 'off',
      statusCode: 'connecting',
      statusLabel: 'Connessione in corso…',
      toggleDisabled: true,
      canEnable: false,
      canDisable: false,
      showReadOnlyBadge: false,
      accountEmail: null,
    }
  }

  if (status === 'connected') {
    return {
      visual: 'on',
      statusCode: 'connected',
      statusLabel: 'Connesso',
      toggleDisabled: busy,
      canEnable: false,
      canDisable: !busy && service === 'available',
      showReadOnlyBadge: true,
      accountEmail: email,
    }
  }

  if (status === 'reconnect_required') {
    return {
      visual: 'off',
      statusCode: 'reconnect_required',
      statusLabel: 'Riconnessione richiesta',
      toggleDisabled: busy || service === 'error',
      canEnable: !busy && service === 'available',
      canDisable: false,
      showReadOnlyBadge: false,
      accountEmail: null,
    }
  }

  if (status === 'error' || status === 'revoked' || service === 'error') {
    return {
      visual: 'off',
      statusCode: 'error',
      statusLabel: 'Non connesso',
      toggleDisabled: busy,
      canEnable: !busy && service === 'available',
      canDisable: false,
      showReadOnlyBadge: false,
      accountEmail: null,
    }
  }

  // disconnected / unknown / null
  return {
    visual: 'off',
    statusCode: 'disconnected',
    statusLabel: 'Non connesso',
    toggleDisabled: busy || service === 'unknown',
    canEnable: !busy && service === 'available',
    canDisable: false,
    showReadOnlyBadge: false,
    accountEmail: null,
  }
}
