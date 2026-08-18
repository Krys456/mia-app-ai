/**
 * #303C — Browser Web Push client helpers (isolated from Core).
 */

import { resolveChatAuthForRequest } from './chatAuth'

export type PushSupportState =
  | 'unsupported'
  | 'unsupported_ios_safari_tab'
  | 'missing_vapid'
  | 'disabled'
  | 'supported'

export type NotificationPermissionState = NotificationPermission | 'unsupported'

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
  const iOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  if (!iOS) return false
  const standalone =
    ('standalone' in navigator && Boolean((navigator as Navigator & { standalone?: boolean }).standalone)) ||
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

/**
 * Request permission only after explicit user action, then subscribe + persist.
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

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    return { ok: false, code: 'permission_denied', permission }
  }

  const reg = await registerPushServiceWorker()
  await navigator.serviceWorker.ready

  const key = getVapidPublicKey()
  const subscription = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(key) as BufferSource,
  })

  const json = subscription.toJSON()
  const endpoint = json.endpoint || ''
  const p256dh = json.keys?.p256dh || ''
  const auth = json.keys?.auth || ''
  if (!endpoint || !p256dh || !auth) {
    return { ok: false, code: 'subscription_incomplete', permission }
  }

  const res = await remindersPushFetch('POST', {
    action: 'push_subscribe',
    endpoint,
    keys: { p256dh, auth },
    user_agent: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 512) : null,
  })
  if (!res.ok) {
    return { ok: false, code: `subscribe_api_${res.status}`, permission }
  }
  return { ok: true, code: 'subscribed', permission }
}

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
  const reg = await navigator.serviceWorker.getRegistration('/')
  const sub = await reg?.pushManager.getSubscription()
  if (!sub) return
  const json = sub.toJSON()
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return
  await remindersPushFetch('POST', {
    action: 'push_subscribe',
    endpoint: json.endpoint,
    keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
    user_agent: navigator.userAgent.slice(0, 512),
  })
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
