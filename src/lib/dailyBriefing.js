/** #321 — Daily Briefing barrel. */
export {
  detectDailyBriefingIntent,
  detectBriefingLanguage,
  looksQuotedOrInjectedBriefing,
  extractBriefingCity,
} from './daily-briefing/intent.js'
export {
  createBriefingContext,
  loadBriefingContext,
  saveBriefingContext,
  clearBriefingContext,
  isBriefingContextFresh,
  BRIEFING_CONTEXT_TTL_MS,
} from './daily-briefing/active-context.js'
export { applyDailyBriefingIntent } from './daily-briefing/controller.js'
export { renderDailyBriefing, buildBriefingUi, safeTitle } from './daily-briefing/render.js'
export {
  DAILY_BRIEFING_DIAG_BUILD,
  isDailyBriefingDiagEnabled,
  buildDailyBriefingDiag,
  rememberDailyBriefingDiag,
  logDailyBriefingSafe,
} from './daily-briefing/diag.js'
export { requestDailyBriefingPack } from './daily-briefing/api.js'
export { resolveBriefingWeather, compactWeatherSnapshot } from './daily-briefing/weather-source.js'
