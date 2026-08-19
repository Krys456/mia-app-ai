/**
 * #303C — Pure Push Settings toggle model (no DOM / no auth imports).
 *
 * VITE_PUSH_ENABLED / VAPID presence = build/config gate (support state).
 * Toggle ON/OFF = user's per-device subscription preference.
 */

export type PushSupportState =
  | 'unsupported'
  | 'unsupported_ios_safari_tab'
  | 'missing_vapid'
  | 'disabled'
  | 'supported'

export type NotificationPermissionState = NotificationPermission | 'unsupported'

/** User-facing toggle: ON only when an active local PushSubscription exists. */
export type PushToggleVisual = 'on' | 'off'

export type PushToggleStatusCode =
  | 'active'
  | 'inactive'
  | 'permission_denied'
  | 'unsupported'
  | 'config_disabled'
  | 'missing_vapid'
  | 'ios_home_screen_required'

/**
 * Resolve Settings toggle from real subscription state (not permission alone).
 *
 * - granted + active subscription → ON / Attive
 * - granted + no subscription → OFF / Disattivate
 * - default → OFF
 * - denied → OFF / Permesso browser negato
 */
export function resolvePushToggleModel(input: {
  support: PushSupportState
  permission: NotificationPermissionState
  hasSubscription: boolean
}): {
  visual: PushToggleVisual
  statusCode: PushToggleStatusCode
  statusLabel: string
  /** User may attempt to turn ON (subject to permission / support). */
  canEnable: boolean
  /** User may turn OFF (unsubscribe). */
  canDisable: boolean
  toggleDisabled: boolean
} {
  const { support, permission, hasSubscription } = input

  if (support === 'disabled') {
    return {
      visual: 'off',
      statusCode: 'config_disabled',
      statusLabel: 'Disabilitate dalla configurazione',
      canEnable: false,
      canDisable: false,
      toggleDisabled: true,
    }
  }
  if (support === 'missing_vapid') {
    return {
      visual: 'off',
      statusCode: 'missing_vapid',
      statusLabel: 'Disabilitate dalla configurazione',
      canEnable: false,
      canDisable: false,
      toggleDisabled: true,
    }
  }
  if (support === 'unsupported_ios_safari_tab') {
    return {
      visual: 'off',
      statusCode: 'ios_home_screen_required',
      statusLabel: 'Non supportate da questo browser',
      canEnable: false,
      canDisable: hasSubscription,
      toggleDisabled: !hasSubscription,
    }
  }
  if (support === 'unsupported') {
    return {
      visual: 'off',
      statusCode: 'unsupported',
      statusLabel: 'Non supportate da questo browser',
      canEnable: false,
      canDisable: hasSubscription,
      toggleDisabled: !hasSubscription,
    }
  }

  // support === 'supported'
  if (permission === 'denied') {
    return {
      visual: 'off',
      statusCode: 'permission_denied',
      statusLabel: 'Permesso browser negato',
      canEnable: false,
      canDisable: hasSubscription,
      toggleDisabled: !hasSubscription,
    }
  }

  if (hasSubscription) {
    return {
      visual: 'on',
      statusCode: 'active',
      statusLabel: 'Attive',
      canEnable: false,
      canDisable: true,
      toggleDisabled: false,
    }
  }

  return {
    visual: 'off',
    statusCode: 'inactive',
    statusLabel: 'Disattivate',
    canEnable: permission === 'default' || permission === 'granted',
    canDisable: false,
    toggleDisabled: false,
  }
}
