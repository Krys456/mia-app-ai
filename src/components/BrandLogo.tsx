import { BRAND } from '../lib/brand'
import './BrandLogo.css'

type BrandLogoProps = {
  variant?: 'full' | 'mark'
  className?: string
  priority?: boolean
}

export function BrandLogo({
  variant = 'full',
  className = '',
  priority = false,
}: BrandLogoProps) {
  const src = variant === 'mark' ? BRAND.markSrc : BRAND.fullSrc
  const alt =
    variant === 'mark'
      ? BRAND.accessibleProductName
      : `${BRAND.accessibleProductName} — ${BRAND.tagline}`

  return (
    <img
      className={`brand-logo brand-logo--${variant}${className ? ` ${className}` : ''}`}
      src={src}
      alt={alt}
      decoding="async"
      loading={priority ? 'eager' : 'lazy'}
      draggable={false}
    />
  )
}
