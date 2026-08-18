/**
 * #303C — Browser Web Push client helpers (isolated from Core).
 */

import { resolveChatAuthForRequest } from './chatAuth'
import {
  resolvePushToggleModel,
  type NotificationPermissionState,
  type PushSupportState,
  type PushToggleStatusCode,
  type PushToggleVisual,
} from './pushToggleModel'

export type { NotificationPermissionState, PushSupportState, PushToggleStatusCode, PushToggleVisual }
export { resolvePushToggleModel }

function viteEnv(): Record<string, unknown> {
  try {
    return (import.meta as ImportMeta & { env?: Record<string, unknown> }).env ?? {}
  } catch {
    return {}
  }
}

export function getVapidPublicKey(): string {
  const env = viteEnv()
  return typeof env.VITE_VAPID_PUBLIC_KEY === 'string' ? env.VITE_VAPID_PUBLIC_KEY.trim() : ''
}

/**
 * Build/config feature gate (VITE_PUSH_ENABLED + public VAPID).
 * Separate from the user's per-device notification toggle / subscription.
 */
export function isClientPushFlagEnabled(): boolean {
  const env = viteEnv()
  const raw = typeof env.VITE_PUSH_ENABLED === 'string' ? env.VITE_PUSH_ENABLED.trim() : ''
  if (raw === '0' || raw.toLowerCase() === 'false') return false
  // Default on when public VAPID is present (delivery still server-gated by PUSH_ENABLED).
  return Boolean(getVapidPublicKey())
}

/** Heuristic: iOS Safari tab (not standalone) cannot subscribe. */
export function isLikelyIosSafariTab(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent || ''
  const iOS =
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  if (!iOS) return false
  const standalone =
    ('standalone' in navigator &&
      Boolean((navigator as Navigator & { standalone?: boolean }).standalone)) ||
    (typeof window !== 'undefined' && window.matchMedia('(display-mode: standalone)').matches)
  return !standalone
}

export function detectPushSupport(): PushSupportState {
  if (typeof window === 'undefined') return 'unsupported'
  if (!isClientPushFlagEnabled()) return 'disabled'
  if (!getVapidPublicKey()) return 'missing_vapid'
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return 'unsupported'
  }
  if (isLikelyIosSafariTab()) return 'unsupported_ios_safari_tab'
  return 'supported'
}

export function getNotificationPermission(): NotificationPermissionState {
  if (typeof Notification === 'undefined') return 'unsupported'
  return Notification.permission
}

/** urlBase64 → Uint8Array for applicationServerKey */
export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i)
  return out
}

export async function registerPushServiceWorker(): Promise<ServiceWorkerRegistration> {
  if (!('serviceWorker' in navigator)) {
    throw new Error('service_worker_unsupported')
  }
  return navigator.serviceWorker.register('/sw.js', { scope: '/' })
}

/** Current browser PushSubscription, if any (does not imply server row). */
export async function getLocalPushSubscription(): Promise<PushSubscription | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null
  try {
    const reg = await navigator.serviceWorker.getRegistration('/')
    const sub = await reg?.pushManager.getSubscription()
    return sub ?? null
  } catch {
    return null
  }
}

export async function hasActiveLocalPushSubscription(): Promise<boolean> {
  return Boolean(await getLocalPushSubscription())
}

async function remindersPushFetch(
  method: string,
  body?: Record<string, unknown>,
  query = '',
): Promise<Response> {
  const auth = await resolveChatAuthForRequest()
  if (!auth.authorization) {
    const err = new Error('unauthorized')
    ;(err as Error & { status?: number }).status = 401
    throw err
  }
  const headers: Record<string, string> = {
    Accept: 'application/json',
    Authorization: auth.authorization,
  }
  if (body) headers['Content-Type'] = 'application/json'
  return fetch(`/api/reminders${query}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })
}

async function persistSubscription(
  subscription: PushSubscription,
): Promise<{ ok: boolean; code: string }> {
  const json = subscription.toJSON()
  const endpoint = json.endpoint || ''
  const p256dh = json.keys?.p256dh || ''
  const auth = json.keys?.auth || ''
  if (!endpoint || !p256dh || !auth) {
    return { ok: false, code: 'subscription_incomplete' }
  }
  const res = await remindersPushFetch('POST', {
    action: 'push_subscribe',
    endpoint,
    keys: { p256dh, auth },
    user_agent: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 512) : null,
  })
  if (!res.ok) return { ok: false, code: `subscribe_api_${res.status}` }
  return { ok: true, code: 'subscribed' }
}

/**
 * Enable Push from an explicit user gesture (Settings toggle / opt-in).
 * Requests Notification.permission only when current state is "default".
 * If already "granted", subscribes without prompting again.
 */
export async function enableWebPushFromUserGesture(): Promise<{
  ok: boolean
  code: string
  permission?: NotificationPermissionState
}> {
  const support = detectPushSupport()
  if (support !== 'supported') {
    return { ok: false, code: support }
  }

  const current = getNotificationPermission()
  if (current === 'denied' || current === 'unsupported') {
    return { ok: false, code: 'permission_denied', permission: current }
  }

  let permission: NotificationPermissionState = current
  if (current === 'default') {
    permission = await Notification.requestPermission()
  }
  // If already "granted", do not call requestPermission again.

  if (permission !== 'granted') {
    return { ok: false, code: 'permission_denied', permission }
  }

  const reg = await registerPushServiceWorker()
  await navigator.serviceWorker.ready

  const existing = await reg.pushManager.getSubscription()
  const key = getVapidPublicKey()
  const subscription =
    existing ||
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(key) as BufferSource,
    }))

  const persisted = await persistSubscription(subscription)
  if (!persisted.ok) {
    return { ok: false, code: persisted.code, permission }
  }
  return { ok: true, code: 'subscribed', permission }
}

/**
 * Turn Push OFF for this browser/device:
 * unsubscribe locally + push_unsubscribe API.
 * Does not revoke browser Notification.permission.
 * Does not delete reminders or affect #303A next-open.
 */
export async function disableWebPush(): Promise<{ ok: boolean; code: string }> {
  if (!('serviceWorker' in navigator)) return { ok: true, code: 'no_sw' }
  const reg = await navigator.serviceWorker.getRegistration('/')
  const sub = await reg?.pushManager.getSubscription()
  if (!sub) return { ok: true, code: 'no_subscription' }

  const endpoint = sub.endpoint
  try {
    await remindersPushFetch('POST', {
      action: 'push_unsubscribe',
      endpoint,
      hard: true,
    })
  } catch {
    // Still attempt local unsubscribe.
  }
  try {
    await sub.unsubscribe()
  } catch {
    /* ignore */
  }
  return { ok: true, code: 'unsubscribed' }
}

export async function syncExistingPushSubscription(): Promise<void> {
  if (detectPushSupport() !== 'supported') return
  if (getNotificationPermission() !== 'granted') return
  const sub = await getLocalPushSubscription()
  if (!sub) return
  await persistSubscription(sub)
}

const OPT_IN_STORAGE_KEY = 'shinkaido.push.optin.dismissed'

export function wasPushOptInDismissed(): boolean {
  try {
    return localStorage.getItem(OPT_IN_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

export function markPushOptInDismissed(): void {
  try {
    localStorage.setItem(OPT_IN_STORAGE_KEY, '1')
  } catch {
    /* ignore */
  }
}

export function shouldOfferPushOptIn(): boolean {
  if (detectPushSupport() !== 'supported') return false
  if (getNotificationPermission() === 'granted') return false
  if (getNotificationPermission() === 'denied') return false
  if (wasPushOptInDismissed()) return false
  return true
}
