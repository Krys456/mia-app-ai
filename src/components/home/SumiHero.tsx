/**
 * #335B — Composed sumi-e hero scene: Ensō + mountains + vermilion sun.
 * Decorative only (aria-hidden). Mask layers so --enso-ink themes correctly.
 */

import './SumiHero.css'

const ENSO_SRC = '/brand/shinkaido-enso-hero.svg'
const MOUNTAINS_SRC = '/brand/shinkaido-sumi-mountains.svg'
const SUN_SRC = '/brand/shinkaido-vermilion-sun.svg'

export function SumiHero() {
  return (
    <div className="sumi-hero motion-enso-reveal" aria-hidden="true" data-home="sumi-hero">
      <div
        className="sumi-hero__mountains"
        style={{ WebkitMaskImage: `url(${MOUNTAINS_SRC})`, maskImage: `url(${MOUNTAINS_SRC})` }}
      />
      <div
        className="sumi-hero__enso"
        style={{ WebkitMaskImage: `url(${ENSO_SRC})`, maskImage: `url(${ENSO_SRC})` }}
      />
      <img
        className="sumi-hero__sun"
        src={SUN_SRC}
        alt=""
        width={48}
        height={48}
        decoding="async"
        draggable={false}
      />
    </div>
  )
}
