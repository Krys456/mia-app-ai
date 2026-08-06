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
  const src = variant === 'mark' ? '/laife-mark.jpg' : '/laife-logo.jpg'
  const alt =
    variant === 'mark'
      ? 'LAIfe'
      : 'LAIfe — Your AI, Your Life.'

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
