/**
 * #335A/#335B — Decorative Home atmosphere (washi fiber + quiet wash).
 * Scenic artwork lives in SumiHero; slots remain for optional layering.
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
    </div>
  )
}
