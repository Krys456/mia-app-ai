/**
 * #335A — Decorative Home atmosphere slot layer.
 * Washi fiber + sumi wash only. Mountains / hero Ensō / sun slots reserved
 * for authored assets in later phases (no placeholder artwork).
 */

import './HomeAtmosphere.css'

type HomeAtmosphereProps = {
  className?: string
  /** When false, omit wash (e.g. chat thread). Default true for empty Home. */
  showWash?: boolean
}

export function HomeAtmosphere({ className = '', showWash = true }: HomeAtmosphereProps) {
  return (
    <div
      className={`home-atmosphere${className ? ` ${className}` : ''}`}
      aria-hidden="true"
      data-washi-dojo="atmosphere"
    >
      {showWash ? <div className="home-atmosphere__wash" /> : null}
      <div className="washi-texture home-atmosphere__fiber" />
      {/* Authored asset slots — empty until #335B assets */}
      <div className="home-atmosphere__mountains" data-empty="true" data-slot="sumi-mountains" />
      <div className="home-atmosphere__enso" data-empty="true" data-slot="enso-hero" />
      <div className="home-atmosphere__sun" data-empty="true" data-slot="vermilion-sun" />
    </div>
  )
}
