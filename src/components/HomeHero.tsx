import { BrandLogo } from './BrandLogo'
import { BrandWordmark } from './BrandWordmark'
import { BRAND } from '../lib/brand'
import './HomeHero.css'

export function HomeHero() {
  return (
    <section className="home-hero" aria-label={`Benvenuto in ${BRAND.accessibleProductName}`}>
      <div className="home-hero__glow" aria-hidden="true" />
      <div className="home-hero__stage">
        <BrandLogo variant="mark" size="hero" className="home-hero__mark" priority />
        <BrandWordmark emphasizeAi showTagline size="lg" className="home-hero__wordmark" />
        <p className="home-hero__lead">{BRAND.emptyPromptIt}</p>
      </div>
    </section>
  )
}
