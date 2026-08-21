/**
 * #335B — Home quick-action catalog.
 * Maps labels to existing verified capabilities only (no fake backends).
 */

export type HomeQuickActionId = 'meteo' | 'calendario' | 'briefing' | 'focus'

export type HomeQuickActionKind = 'sendMessage' | 'openSettings' | 'unavailable'

export type HomeQuickAction = {
  id: HomeQuickActionId
  label: string
  /** Accessible description of what actually happens */
  description: string
  kind: HomeQuickActionKind
  /** Message text when kind === 'sendMessage' */
  message?: string
}

/**
 * Meteo → existing weather chat path (natural language).
 * Calendario → Settings integrations (calendar chat historically incomplete; do not fake).
 * Briefing → sendMessage('Briefing') (#334C).
 * Focus → existing Timer via chat intent (no Focus backend); labeled honestly.
 */
export const HOME_QUICK_ACTIONS: readonly HomeQuickAction[] = [
  {
    id: 'meteo',
    label: 'Meteo',
    description: 'Chiede il meteo di oggi in chat',
    kind: 'sendMessage',
    message: 'Che tempo fa oggi?',
  },
  {
    id: 'calendario',
    label: 'Calendario',
    description: 'Apre Impostazioni per collegare o gestire il calendario',
    kind: 'openSettings',
  },
  {
    id: 'briefing',
    label: 'Briefing',
    description: 'Avvia il briefing giornaliero in chat',
    kind: 'sendMessage',
    message: 'Briefing',
  },
  {
    id: 'focus',
    label: 'Focus',
    description: 'Avvia un timer di 25 minuti (Focus usa il Timer esistente)',
    kind: 'sendMessage',
    message: 'Timer 25 minuti',
  },
]

export function homeQuickActionById(id: HomeQuickActionId): HomeQuickAction | undefined {
  return HOME_QUICK_ACTIONS.find((a) => a.id === id)
}
