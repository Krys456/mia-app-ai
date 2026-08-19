/**
 * #317 — Weather TypeScript declarations for ChatContext imports.
 */

export function detectWeatherIntent(
  raw: string,
  opts?: {
    languageHint?: 'it' | 'en'
    hasWeatherContext?: boolean
    stickyTimeHint?: string | null
  },
): {
  intent: 'weather' | 'none'
  operation?: string
  locationText?: string | null
  requiresCurrentLocation?: boolean
  timeHint?: string | null
  language?: 'it' | 'en'
  complexAdvice?: boolean
  followUp?: boolean
  followUpKind?: string
  failureCode?: string | null
}

export function detectWeatherLanguage(text: string, fallback?: 'it' | 'en'): 'it' | 'en'

export function applyWeatherFollowUp(input: {
  text: string
  languageHint?: 'it' | 'en'
  weatherContext?: unknown
  latitude?: number
  longitude?: number
}): {
  handled: boolean
  reply: string | null
  status?: string
  weatherUi?: import('../types').WeatherUiState | null
  weatherContext?: unknown
  needsProvider?: boolean
  intent?: ReturnType<typeof detectWeatherIntent>
  cacheHit?: boolean
  pendingSaved?: boolean
  diag: Record<string, unknown>
}

export function buildWeatherSuccessExchange(input: {
  weather: Record<string, unknown>
  language?: 'it' | 'en'
  operation?: string
  timeHint?: string | null
  locationText?: string | null
  latitude?: number
  longitude?: number
  locationSource?: 'explicit' | 'gps' | 'context'
  complexAdvice?: boolean
}): {
  reply: string
  status: string
  weather?: Record<string, unknown>
  weatherUi?: import('../types').WeatherUiState | null
  weatherContext?: unknown
  activeWeatherContextCreated?: boolean
}

export function geoFailureCopy(code: string, lang: 'it' | 'en'): string
export function weatherCopy(key: string, lang: 'it' | 'en', vars?: Record<string, unknown>): string
export function mapStatusToCopyKey(status: string | undefined): string

export function loadWeatherContext(storage?: Storage | null, nowMs?: number): unknown
export function saveWeatherContext(ctx: unknown, storage?: Storage | null): void
export function clearWeatherContext(storage?: Storage | null): void
export function loadPendingWeatherRequest(storage?: Storage | null): {
  operation?: string
  timeHint?: string | null
  language?: 'it' | 'en'
  complexAdvice?: boolean
} | null
export function clearPendingWeatherRequest(storage?: Storage | null): void
export function clearWeatherPending(): void

export function getBrowserPosition(opts?: {
  geolocation?: Geolocation | null
  options?: PositionOptions
}): Promise<
  | { ok: true; latitude: number; longitude: number; accuracy?: number }
  | { ok: false; code: string }
>

export function requestWeather(body: Record<string, unknown>): Promise<Record<string, unknown>>

export const WEATHER_DIAG_BUILD: string
export function isWeatherDiagEnabled(search?: string | null): boolean
export function buildWeatherDiag(partial?: Record<string, unknown>): Record<string, unknown>
export function rememberWeatherDiag(payload: unknown): void
export function logWeatherSafe(event: Record<string, unknown>): void

export const WEATHER_USE_LOCATION_TRIGGER: string
export const WEATHER_ENTER_AREA_TRIGGER: string
export const WEATHER_CONTEXT_TTL_MS: number
