/**
 * #335B2 — Reference-locked Home hero art.
 * Decorative raster scene (Ensō + fire + sun + sumi mountains) painted into the page.
 * UI chrome remains real React elsewhere — this component is aria-hidden artwork only.
 */

import './SumiHero.css'

const HERO_WASHI = '/brand/shinkaido-home-hero.webp'
const HERO_SUMI = '/brand/shinkaido-home-hero-sumi.webp'

export function SumiHero() {
  return (
    <div className="sumi-hero motion-enso-reveal" aria-hidden="true" data-home="sumi-hero">
      <img
        className="sumi-hero__art sumi-hero__art--washi"
        src={HERO_WASHI}
        alt=""
        width={680}
        height={663}
        decoding="async"
        fetchPriority="low"
        draggable={false}
      />
      <img
        className="sumi-hero__art sumi-hero__art--sumi"
        src={HERO_SUMI}
        alt=""
        width={680}
        height={663}
        decoding="async"
        fetchPriority="low"
        draggable={false}
      />
    </div>
  )
}
