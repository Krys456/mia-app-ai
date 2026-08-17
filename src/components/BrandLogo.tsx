import { BRAND } from '../lib/brand'
import { EnsoMark } from './EnsoMark'
import './BrandLogo.css'

type BrandLogoProps = {
  variant?: 'full' | 'mark'
  className?: string
  priority?: boolean
}

/**
 * ShinkAIdo brand mark. Renders the organic Ensō inline so Washi/Sumi ink
 * swaps via --enso-ink without stale cached raster assets.
 */
export function BrandLogo({
  variant = 'full',
  className = '',
  priority: _priority = false,
}: BrandLogoProps) {
  const label =
    variant === 'mark'
      ? BRAND.accessibleProductName
      : `${BRAND.accessibleProductName} — ${BRAND.tagline}`

  return (
    <span
      className={`brand-logo brand-logo--${variant}${className ? ` ${className}` : ''}`}
      role="img"
      aria-label={label}
    >
      <EnsoMark decorative className="brand-logo__enso" />
    </span>
  )
}
