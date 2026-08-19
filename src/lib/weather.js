/** #317 — Weather / Meteo barrel. */
export {
  detectWeatherIntent,
  detectWeatherFollowUp,
  detectWeatherLanguage,
  looksQuotedOrInjectedWeather,
  extractWeatherLocationText,
  extractTimeHint,
  WEATHER_USE_LOCATION_TRIGGER,
  WEATHER_ENTER_AREA_TRIGGER,
} from './weather/intent.js'
export {
  createWeatherContext,
  loadWeatherContext,
  saveWeatherContext,
  clearWeatherContext,
  loadPendingWeatherRequest,
  savePendingWeatherRequest,
  clearPendingWeatherRequest,
  isWeatherContextFresh,
  WEATHER_CONTEXT_TTL_MS,
} from './weather/active-context.js'
export {
  applyWeatherFollowUp,
  buildWeatherSuccessExchange,
  geoFailureCopy,
  mapStatusToCopyKey,
  clearWeatherPending,
} from './weather/controller.js'
export { weatherCopy, formatHourLabel } from './weather/copy.js'
export {
  buildDeterministicWeatherReply,
  buildWeatherCardModel,
  buildWeatherContextBlock,
} from './weather/answers.js'
export { buildRainEvidence, analyzeRainInHourly, RAIN_LIKELY_PROB_THRESHOLD } from './weather/rain.js'
export {
  buildUmbrellaEvidence,
  decideUmbrella,
  hourNeedsUmbrella,
  UMBRELLA_PROB_THRESHOLD,
} from './weather/umbrella.js'
export {
  DAYPART_HOURS,
  resolveTimeWindow,
  resolveWeekendDates,
  filterHourlyInWindow,
  pickClosestHourly,
  localPartsInZone,
  addIsoDays,
} from './weather/time-windows.js'
export { describeWmoCode, isWetWeatherCode, WMO_CODE_MAP } from './weather/wmo.js'
export { getBrowserPosition, GEO_OPTIONS } from './geolocation.js'
export {
  WEATHER_DIAG_BUILD,
  isWeatherDiagEnabled,
  buildWeatherDiag,
  rememberWeatherDiag,
  logWeatherSafe,
} from './weather/diag.js'
export { requestWeather } from './weather/weatherApi.js'
export {
  getCachedWeather,
  getCachedWeatherForOperation,
  saveWeatherCacheEntry,
  CURRENT_TTL_MS,
  FORECAST_TTL_MS,
} from './weather/cache.js'
