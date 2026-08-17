import { BRAND } from '../lib/brand'
import { EnsoMark, type EnsoMarkSize } from './EnsoMark'
import './BrandLogo.css'

type BrandLogoProps = {
  variant?: 'full' | 'mark'
  className?: string
  priority?: boolean
  /** hero = full fire detail; compact = header-scale exaggeration. */
  size?: EnsoMarkSize
}

/**
 * ShinkAIdo brand mark. Renders the organic Ensō inline so Washi/Sumi ink
 * swaps via --enso-ink without stale cached raster assets.
 */
export function BrandLogo({
  variant = 'full',
  className = '',
  priority: _priority = false,
  size,
}: BrandLogoProps) {
  const label =
    variant === 'mark'
      ? BRAND.accessibleProductName
      : `${BRAND.accessibleProductName} — ${BRAND.tagline}`

  // Header mark defaults to compact so fire identity survives downscaling.
  const ensoSize: EnsoMarkSize = size ?? (variant === 'mark' ? 'compact' : 'hero')

  return (
    <span
      className={`brand-logo brand-logo--${variant}${className ? ` ${className}` : ''}`}
      role="img"
      aria-label={label}
    >
      <EnsoMark decorative size={ensoSize} className="brand-logo__enso" />
    </span>
  )
}
