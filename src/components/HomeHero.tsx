import { BrandLogo } from './BrandLogo'
import './HomeHero.css'

export function HomeHero() {
  return (
    <section className="home-hero" aria-label="Benvenuto in LAIfe">
      <div className="home-hero__glow" aria-hidden="true" />
      <div className="home-hero__stage">
        <BrandLogo variant="full" className="home-hero__logo" priority />
        <p className="home-hero__lead">
          Pronto quando lo sei tu — un pensiero, un dubbio, o semplicemente compagnia.
        </p>
      </div>
    </section>
  )
}
