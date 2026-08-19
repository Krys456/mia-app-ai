/** #315 — Phone Actions barrel. */
export { applyPhoneAction } from './phone-action/controller.js'
export { detectPhoneActionIntent, detectPhoneLanguage } from './phone-action/intent.js'
export {
  buildMapsDirectionsUrl,
  getOpenAppTarget,
  isAllowedHttpsUrl,
  OPEN_APP_TARGETS,
} from './phone-action/destinations.js'
export {
  buildMailtoUri,
  buildSmsUri,
  buildTelUri,
  extractEmail,
  extractPhoneNumber,
  isValidEmail,
  isValidPhone,
  maskEmail,
  maskPhone,
} from './phone-action/parse.js'
export { SAFETY, safetyForAction } from './phone-action/safety.js'
export {
  PHONE_ACTION_DIAG_BUILD,
  buildPhoneActionDiag,
  isPhoneActionDiagEnabled,
  logPhoneActionSafe,
  rememberPhoneActionDiag,
} from './phone-action/diag.js'
export { requestAppNavigate, setAppNavigateHandler } from './appNavigation.js'
