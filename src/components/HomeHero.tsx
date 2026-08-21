/**
 * #333A Kami — calm empty state.
 * #335A — Washi Dojo atmosphere slot (texture + wash; scenery assets later).
 * Hierarchy: Ensō → ShinkAIdo → tagline → conversational prompt.
 */

import { BrandLogo } from './BrandLogo'
import { BrandWordmark } from './BrandWordmark'
import { HomeAtmosphere } from './HomeAtmosphere'
import { BRAND } from '../lib/brand'
import './HomeHero.css'

export function HomeHero() {
  return (
    <section className="home-hero" aria-label={`Benvenuto in ${BRAND.accessibleProductName}`}>
      <HomeAtmosphere />
      <div className="home-hero__stage">
        <BrandLogo variant="mark" size="hero" className="home-hero__mark motion-enso-reveal" priority />
        <BrandWordmark emphasizeAi showTagline size="lg" className="home-hero__wordmark" />
        <p className="home-hero__lead ink-secondary">{BRAND.emptyPromptIt}</p>
      </div>
    </section>
  )
}
