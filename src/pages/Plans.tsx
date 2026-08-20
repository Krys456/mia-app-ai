/**
 * #332A — ShinkAIdo Plans page (UI foundation).
 * Catalog-driven. No purchases. Current plan is Free placeholder.
 */

import { useId, useState } from 'react'
import { PageHeader } from '../components/PageHeader'
import {
  PLAN_CATALOG,
  UI_FOUNDATION_CURRENT_PLAN_ID,
  formatPlanPrice,
  type PlanId,
} from '../lib/planCatalog'
import './Plans.css'

interface PlansProps {
  onBack: () => void
  /** Optional override for future paid state; defaults to Free foundation. */
  currentPlanId?: PlanId
}

export function Plans({
  onBack,
  currentPlanId = UI_FOUNDATION_CURRENT_PLAN_ID,
}: PlansProps) {
  const titleId = useId()
  const [upgradeNote, setUpgradeNote] = useState<string | null>(null)

  const onUpgradeClick = (planId: PlanId) => {
    // Non-transactional foundation behavior — no checkout, no billing.
    setUpgradeNote(
      planId === 'base'
        ? 'Gli upgrade saranno disponibili a breve. Nessun addebito in questa Preview.'
        : 'Gli upgrade Pro saranno disponibili a breve. Nessun addebito in questa Preview.',
    )
  }

  return (
    <main className="plans-page" aria-labelledby={titleId}>
      <PageHeader title="ShinkAIdo Plans" titleId={titleId} onBack={onBack} />

      <div className="plans-page__body scroll-surface">
        <p className="plans-page__lead">Scegli l’esperienza che fa per te.</p>

        {upgradeNote ? (
          <p className="plans-page__note" role="status" aria-live="polite">
            {upgradeNote}
          </p>
        ) : null}

        <div className="plans-grid" role="list">
          {PLAN_CATALOG.map((plan) => {
            const isCurrent = plan.planId === currentPlanId
            return (
              <article
                key={plan.planId}
                className={`plan-card${plan.featured ? ' plan-card--featured' : ''}${isCurrent ? ' plan-card--current' : ''}`}
                role="listitem"
                aria-labelledby={`plan-title-${plan.planId}`}
              >
                <header className="plan-card__head">
                  <h2 id={`plan-title-${plan.planId}`} className="plan-card__name">
                    {plan.displayName}
                  </h2>
                  {isCurrent ? (
                    <p className="plan-card__badge" aria-label="Piano attuale">
                      Piano attuale
                    </p>
                  ) : null}
                </header>

                <p className="plan-card__price">
                  <span className="plan-card__price-value">{formatPlanPrice(plan)}</span>
                </p>
                <p className="plan-card__desc">{plan.description}</p>

                <ul className="plan-card__features">
                  {plan.features.map((feature) => (
                    <li key={feature}>{feature}</li>
                  ))}
                </ul>

                <div className="plan-card__cta">
                  {isCurrent ? (
                    <button
                      type="button"
                      className="plan-card__btn plan-card__btn--current"
                      disabled
                      aria-label={`${plan.displayName}: piano attuale`}
                    >
                      Piano attuale
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="plan-card__btn plan-card__btn--upgrade"
                      onClick={() => onUpgradeClick(plan.planId)}
                      aria-label={`Upgrade a ${plan.displayName} — disponibile a breve`}
                      title="Disponibile a breve"
                    >
                      Upgrade
                    </button>
                  )}
                </div>
              </article>
            )
          })}
        </div>

        <p className="plans-page__footnote">
          Prezzi provvisori per valutazione prodotto. Non configurati su store o pagamenti.
        </p>
      </div>
    </main>
  )
}
