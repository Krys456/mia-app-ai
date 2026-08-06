import { BrandLogo } from './BrandLogo'
import './HomeHero.css'

export function HomeHero() {
  return (
    <section className="home-hero" aria-label="LAIfe home">
      <div className="home-hero__glow" aria-hidden="true" />
      <div className="home-hero__stage">
        <BrandLogo variant="full" className="home-hero__logo" priority />
        <p className="home-hero__lead">
          A premium AI companion — warm, sharp, and present for your life.
        </p>
      </div>
    </section>
  )
}
