/**
 * #335B — ShinkAIdo Home Experience (empty-conversation state).
 * Atmospheric editorial Home — not the legacy centered logo stack.
 */

import { BRAND } from '../../lib/brand'
import { HomeAtmosphere } from '../HomeAtmosphere'
import { ContextGreeting } from './ContextGreeting'
import { DailyThought } from './DailyThought'
import { HomeBrandArea } from './HomeBrandArea'
import { QuickActions } from './QuickActions'
import { SumiHero } from './SumiHero'
import './HomeExperience.css'

export function HomeExperience() {
  return (
    <section
      className="home-experience motion-paper-fade"
      aria-label={`Benvenuto in ${BRAND.accessibleProductName}`}
      data-home="experience"
    >
      <HomeAtmosphere />
      <div className="home-experience__layout">
        <HomeBrandArea />
        <div className="home-experience__ma" aria-hidden="true" />
        <SumiHero />
        <div className="home-experience__copy">
          <ContextGreeting />
          <DailyThought />
        </div>
        <QuickActions />
      </div>
    </section>
  )
}
