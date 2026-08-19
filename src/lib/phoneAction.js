/** #315 / #315A / #315B — Phone Actions barrel. */
export { applyPhoneAction } from './phone-action/controller.js'
export {
  detectPhoneActionIntent,
  detectPhoneLanguage,
  extractSmsParts,
  extractWhatsAppCompose,
  looksWhatsAppIntent,
  looksWhatsAppCapabilityQuestion,
} from './phone-action/intent.js'
export {
  buildMapsDirectionsUrl,
  buildWhatsAppComposeUrl,
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
export {
  createMessagingContext,
  isMessagingContextFresh,
  loadMessagingContext,
  saveMessagingContext,
  clearMessagingContext,
  shouldClearMessagingOnUserText,
  MESSAGING_CONTEXT_TTL_MS,
  MESSAGING_CONTEXT_KEY,
} from './phone-action/messaging-context.js'
export { requestAppNavigate, setAppNavigateHandler } from './appNavigation.js'
