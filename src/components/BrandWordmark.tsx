import { BRAND } from '../lib/brand'
import './BrandWordmark.css'

export type BrandWordmarkProps = {
  /** Show tagline under the name (typically desktop header). */
  showTagline?: boolean
  /** Emphasize the AI letters in vermilion. */
  emphasizeAi?: boolean
  className?: string
  /** Size variant. */
  size?: 'sm' | 'md' | 'lg'
}

/**
 * ShinkAIdo wordmark. Accessible name is always the full product string.
 * Visual AI emphasis is decorative (aria-hidden on split spans when emphasized).
 */
export function BrandWordmark({
  showTagline = false,
  emphasizeAi = true,
  className = '',
  size = 'md',
}: BrandWordmarkProps) {
  return (
    <span className={`brand-wordmark brand-wordmark--${size}${className ? ` ${className}` : ''}`}>
      <span className="brand-wordmark__name">
        {/* Single accessible text node for AT; visual split is aria-hidden when emphasized */}
        <span className="sr-only">{BRAND.accessibleProductName}</span>
        {emphasizeAi ? (
          <span className="brand-wordmark__visual" aria-hidden="true">
            <span className="brand-wordmark__plain">{BRAND.wordmark.beforeAi}</span>
            <span className="brand-wordmark__ai">{BRAND.wordmark.ai}</span>
            <span className="brand-wordmark__plain">{BRAND.wordmark.afterAi}</span>
          </span>
        ) : (
          <span aria-hidden="true">{BRAND.productName}</span>
        )}
      </span>
      {showTagline ? <span className="brand-wordmark__tag">{BRAND.tagline}</span> : null}
    </span>
  )
}
