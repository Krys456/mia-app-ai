/**
 * #293A — centralized user-visible ShinkAIdo brand identity.
 * Behavior-free. Does not own storage keys, API headers, or Core prompt identity.
 */

export const BRAND = {
  /** Plain / accessible product name. */
  productName: 'ShinkAIdo',
  accessibleProductName: 'ShinkAIdo',
  tagline: 'The Way to Your True Self.',
  /** Calm empty-state prompt (Italian UI default). */
  emptyPromptIt: 'Dove vuoi andare oggi?',
  /** Document / meta description. */
  metaDescription:
    'ShinkAIdo — The Way to Your True Self. A calm, capable AI companion for conversation, work, study, and discovery.',
  /** Compact mark (header, favicon sizes). */
  markSrc: '/shinkaido-mark.svg',
  /** Full lockup for empty state / hero. */
  fullSrc: '/shinkaido-logo.svg',
  /** Favicon / apple-touch. */
  faviconSrc: '/shinkaido-mark.svg',
  appleTouchSrc: '/shinkaido-mark.svg',
  /**
   * Wordmark segments for visual “AI” emphasis only.
   * Screen readers should use accessibleProductName, not spelled segments.
   */
  wordmark: {
    beforeAi: 'Shink',
    ai: 'AI',
    afterAi: 'do',
  },
} as const

export type BrandConfig = typeof BRAND
