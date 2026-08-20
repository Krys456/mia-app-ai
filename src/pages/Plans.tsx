/**
 * #332A/#332D/#332E2/#332E2A — ShinkAIdo Plans page.
 * Catalog-driven. Current plan from verified /api/subscription when available;
 * display-only — never authorizes premium APIs.
 * Upgrade: anonymous → identity gate; durable → coming-soon (no billing yet).
 *
 * #332E2A: stable onIdentityChange + equality guard (no render loop).
 */

import { useCallback, useEffect, useId, useState } from 'react'
import { PageHeader } from '../components/PageHeader'
import { IdentityAccountPanel } from '../components/IdentityAccountPanel'
import {
  PLAN_CATALOG,
  UI_FOUNDATION_CURRENT_PLAN_ID,
  formatPlanPrice,
  type PlanId,
} from '../lib/planCatalog'
import { fetchVerifiedSubscription } from '../lib/subscriptionApi'
import { loadIdentitySnapshot } from '../lib/accountLinking'
import {
  identityStatusEquals,
  type IdentityStatus,
} from '../lib/durableIdentity'
import './Plans.css'

interface PlansProps {
  onBack: () => void
  /** Optional override; defaults to Free foundation until verified fetch returns. */
  currentPlanId?: PlanId
}

export function Plans({
  onBack,
  currentPlanId = UI_FOUNDATION_CURRENT_PLAN_ID,
}: PlansProps) {
  const titleId = useId()
  const [upgradeNote, setUpgradeNote] = useState<string | null>(null)
  const [verifiedPlanId, setVerifiedPlanId] = useState<PlanId>(currentPlanId)
  const [identity, setIdentity] = useState<IdentityStatus | null>(null)
  const [showIdentityGate, setShowIdentityGate] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const [state, idStatus] = await Promise.all([
        fetchVerifiedSubscription(),
        loadIdentitySnapshot(),
      ])
      if (!cancelled) {
        setVerifiedPlanId(state.planId)
        setIdentity(idStatus)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const activePlanId = verifiedPlanId
  // While identity is still loading (null), treat as non-durable so Upgrade opens the gate.
  const durable = identity?.durable === true

  const onIdentityChange = useCallback((next: IdentityStatus) => {
    setIdentity((prev) => (identityStatusEquals(prev, next) ? prev : next))
    if (next.durable) {
      setUpgradeNote(
        'Account collegato. I pagamenti saranno disponibili nella prossima fase.',
      )
      setShowIdentityGate(false)
    }
  }, [])

  const onUpgradeClick = (planId: PlanId) => {
    if (!durable) {
      setShowIdentityGate(true)
      setUpgradeNote(
        'Crea o collega un account per proteggere e ripristinare il tuo acquisto. Nessun pagamento in questa fase.',
      )
      return
    }

    setShowIdentityGate(false)
    setUpgradeNote(
      planId === 'base'
        ? 'Account collegato. I pagamenti Base saranno disponibili a breve. Nessun addebito ora.'
        : 'Account collegato. I pagamenti Pro saranno disponibili a breve. Nessun addebito ora.',
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

        {showIdentityGate ? (
          <IdentityAccountPanel
            variant="plans"
            autoFocus
            onIdentityChange={onIdentityChange}
          />
        ) : null}

        {durable && identity?.emailMasked ? (
          <p className="plans-page__footnote" role="status">
            Account: {identity.emailMasked}
          </p>
        ) : null}

        <div className="plans-grid" role="list">
          {PLAN_CATALOG.map((plan) => {
            const isCurrent = plan.planId === activePlanId
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
                      aria-label={
                        durable
                          ? `Upgrade a ${plan.displayName} — pagamenti a breve`
                          : `Upgrade a ${plan.displayName} — collega account`
                      }
                      title={durable ? 'Pagamenti a breve' : 'Collega account'}
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
