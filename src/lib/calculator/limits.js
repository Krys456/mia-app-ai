/**
 * #318 — Safety limits for deterministic Calculator (DoS / abuse).
 * No eval / Function — parser-enforced caps only.
 */

export const CALC_LIMITS = Object.freeze({
  maxRawLength: 200,
  maxTokens: 80,
  maxParenDepth: 24,
  maxParseDepth: 48,
  /** Integer exponent magnitude cap for ^ / ** */
  maxExponentAbs: 100,
  /** Reject results with abs above this (finite but absurd). */
  maxResultAbs: 1e15,
  /** Reject intermediate power bases that explode. */
  maxPowerBaseAbs: 1e8,
})

export const CALC_ERROR = Object.freeze({
  empty: 'empty_expression',
  too_long: 'expression_too_long',
  too_many_tokens: 'too_many_tokens',
  depth: 'excessive_nesting',
  paren: 'malformed_parentheses',
  invalid_char: 'invalid_characters',
  malformed: 'malformed_expression',
  div_zero: 'divide_by_zero',
  domain: 'domain_error',
  overflow: 'overflow',
  exponent: 'exponent_too_large',
  unsupported: 'unsupported',
  security: 'security_rejected',
})
