/**
 * #388D — Product-flag × entitlement precedence for Calendar / Gmail.
 *
 * Precedence (deterministic):
 * 1. Product flag OFF → unavailable (independent of plan)
 * 2. Product flag ON + enforcement OFF + shadow OFF → existing allow behavior
 * 3. Product flag ON + enforcement OFF + shadow ON → evaluate + shadow log + allow
 * 4. Product flag ON + enforcement ON → entitlement authoritative (Free deny)
 *
 * Shadow never overrides enforcement. Client plan claims are ignored.
 */

import { isCalendarEnabled } from './calendar-enabled.js'
import {
  isEntitlementEnforcementEnabled,
  isEntitlementShadowEnabled,
} from './entitlements.js'
import { decideRouteEntitlementAsync } from './entitlement-gates.js'

/**
 * @param {boolean} productEnabled
 * @param {'calendar' | 'gmail'} feature
 * @param {{
 *   userId: string
 *   requestId?: string | null
 *   route?: string | null
 *   env?: NodeJS.ProcessEnv
 *   enforcementEnabled?: boolean
 *   shadowEnabled?: boolean
 *   entitlements?: import('./entitlements.js').EntitlementSet
 *   planId?: import('./entitlements.js').PlanId
 *   resolveVerifiedPlanForUser?: Function
 * }} opts
 */
export async function decideIntegrationEntitlement(productEnabled, feature, opts) {
  const env = opts.env ?? process.env

  if (!productEnabled) {
    return {
      allowed: false,
      reason: /** @type {const} */ ('product_disabled'),
      code: feature === 'calendar' ? 'calendar_disabled' : 'email_disabled',
      body: {
        error: feature === 'calendar' ? 'Calendar unavailable' : 'Email unavailable',
        code: feature === 'calendar' ? 'calendar_disabled' : 'email_disabled',
      },
    }
  }

  const decision = await decideRouteEntitlementAsync({
    userId: opts.userId,
    entitlement: feature,
    requestId: opts.requestId,
    route: opts.route,
    env,
    enforcementEnabled: opts.enforcementEnabled,
    shadowEnabled: opts.shadowEnabled,
    entitlements: opts.entitlements,
    planId: opts.planId,
    resolveVerifiedPlanForUser: opts.resolveVerifiedPlanForUser,
  })

  return decision
}

/**
 * Calendar gate for Node routes (daily-briefing calendar_query / briefing pack).
 *
 * @param {{
 *   userId: string
 *   requestId?: string | null
 *   route?: string | null
 *   env?: NodeJS.ProcessEnv
 *   enforcementEnabled?: boolean
 *   shadowEnabled?: boolean
 *   entitlements?: import('./entitlements.js').EntitlementSet
 *   planId?: import('./entitlements.js').PlanId
 *   resolveVerifiedPlanForUser?: Function
 *   isCalendarEnabledFn?: typeof isCalendarEnabled
 * }} opts
 */
export async function decideCalendarIntegrationEntitlement(opts) {
  const env = opts.env ?? process.env
  const flagFn = opts.isCalendarEnabledFn ?? isCalendarEnabled
  return decideIntegrationEntitlement(flagFn(env), 'calendar', opts)
}

/**
 * Gmail gate for Node callers (tests / future Vercel proxies).
 * Edge functions use the Deno port in supabase/functions/_shared/entitlement-gate.ts.
 *
 * @param {{
 *   userId: string
 *   requestId?: string | null
 *   route?: string | null
 *   env?: NodeJS.ProcessEnv
 *   emailEnabled?: boolean
 *   enforcementEnabled?: boolean
 *   shadowEnabled?: boolean
 *   entitlements?: import('./entitlements.js').EntitlementSet
 *   planId?: import('./entitlements.js').PlanId
 *   resolveVerifiedPlanForUser?: Function
 * }} opts
 */
export async function decideGmailIntegrationEntitlement(opts) {
  const env = opts.env ?? process.env
  const emailEnabled =
    typeof opts.emailEnabled === 'boolean'
      ? opts.emailEnabled
      : (() => {
          const raw = env.EMAIL_ENABLED
          if (typeof raw !== 'string') return false
          const v = raw.trim().toLowerCase()
          return v === '1' || v === 'true' || v === 'yes'
        })()
  return decideIntegrationEntitlement(emailEnabled, 'gmail', opts)
}

/**
 * Convenience: enforcement/shadow flags for docs/tests.
 * @param {NodeJS.ProcessEnv} [env]
 */
export function describeIntegrationPrecedence(env = process.env) {
  return {
    enforcementEnabled: isEntitlementEnforcementEnabled(env),
    shadowEnabled: isEntitlementShadowEnabled(env),
  }
}
