/**
 * #319 — Safety limits for deterministic Unit Conversion.
 */

export const UNIT_LIMITS = Object.freeze({
  maxRawLength: 220,
  /** Reject |value| above this before conversion. */
  maxValueAbs: 1e15,
  /** Reject |result| above this after conversion. */
  maxResultAbs: 1e18,
  /** Display decimal places (trailing zeros stripped). */
  displayMaxDecimals: 4,
})

export const UNIT_ERROR = Object.freeze({
  empty: 'empty_conversion',
  too_long: 'input_too_long',
  malformed: 'malformed_conversion',
  invalid_number: 'invalid_number',
  unknown_unit: 'unknown_unit',
  incompatible: 'incompatible_dimensions',
  absolute_zero: 'below_absolute_zero',
  overflow: 'overflow',
  ambiguous_storage: 'ambiguous_storage',
  no_context: 'no_context',
  security: 'security_rejected',
  unsupported: 'unsupported',
  power_energy: 'power_vs_energy',
})
