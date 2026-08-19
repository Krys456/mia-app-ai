/**
 * #311 — Gmail Settings toggle model (mirrors Calendar pattern; Email-specific).
 */

export type EmailUiPhase = 'loading' | 'idle' | 'connecting' | 'busy'
export type EmailServiceState = 'unknown' | 'available' | 'disabled' | 'auth_unavailable' | 'error'
export type EmailToggleVisual = 'on' | 'off'

export function resolveEmailToggleModel(input: {
  connectionStatus?: string | null
  accountEmail?: string | null
  service: EmailServiceState
  phase: EmailUiPhase
}) {
  const status = String(input.connectionStatus || 'disconnected')
  const connected = status === 'connected'
  const reconnect = status === 'reconnect_required'
  const pending = status === 'pending'

  let visual: EmailToggleVisual = connected ? 'on' : 'off'
  if (input.phase === 'connecting') visual = 'on'

  const toggleDisabled =
    input.phase === 'loading' ||
    input.phase === 'busy' ||
    input.phase === 'connecting' ||
    input.service === 'disabled' ||
    input.service === 'auth_unavailable'

  const canEnable =
    !toggleDisabled &&
    input.service === 'available' &&
    !connected &&
    input.phase === 'idle'

  const canDisable = !toggleDisabled && connected && input.phase === 'idle'

  let statusLabel = 'Non collegato'
  if (input.service === 'disabled') statusLabel = 'Non disponibile su questo ambiente'
  else if (input.service === 'auth_unavailable') statusLabel = 'Sessione non disponibile'
  else if (input.service === 'error') statusLabel = 'Stato non verificabile'
  else if (input.phase === 'connecting' || pending) statusLabel = 'Collegamento in corso…'
  else if (reconnect) statusLabel = 'Ricollegamento richiesto'
  else if (connected) statusLabel = 'Collegato'
  else if (status === 'error') statusLabel = 'Errore di collegamento'
  else if (status === 'disconnected' || status === 'revoked') statusLabel = 'Non collegato'

  return {
    visual,
    toggleDisabled,
    canEnable,
    canDisable,
    statusLabel,
    accountEmail: input.accountEmail || null,
  }
}
