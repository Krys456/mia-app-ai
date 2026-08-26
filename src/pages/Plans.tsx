/**
 * #332A/#332D/#332E2/#332E2A/#388B — ShinkAIdo Plans page.
 * Catalog-driven. Current plan from verified /api/subscription when available;
 * display-only — never authorizes premium APIs.
 * Upgrade: anonymous → identity gate; durable → Stripe Test Mode checkout when
 * server billing capabilities are enabled (Preview only; Production blocked).
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
import {
  fetchVerifiedSubscription,
  startBillingPortal,
  startPlanCheckout,
  type PublicSubscriptionState,
} from '../lib/subscriptionApi'
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
  const [subscription, setSubscription] = useState<PublicSubscriptionState | null>(null)
  const [identity, setIdentity] = useState<IdentityStatus | null>(null)
  const [showIdentityGate, setShowIdentityGate] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const [state, idStatus] = await Promise.all([
        fetchVerifiedSubscription(),
        loadIdentitySnapshot(),
      ])
      if (!cancelled) {
        setVerifiedPlanId(state.planId)
        setSubscription(state)
        setIdentity(idStatus)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // Checkout return hint (success does NOT grant entitlements — webhook does).
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search)
      const checkout = params.get('checkout')
      if (checkout === 'success') {
        setUpgradeNote(
          'Pagamento in elaborazione. Il piano si aggiorna dopo la conferma del provider.',
        )
      } else if (checkout === 'cancel') {
        setUpgradeNote('Checkout annullato. Nessun addebito.')
      }
    } catch {
      /* soft */
    }
  }, [])

  const activePlanId = verifiedPlanId
  const durable = identity?.durable === true
  const billingEnabled = subscription?.billing?.checkoutEnabled === true
  const portalEnabled =
    subscription?.billing?.portalEnabled === true &&
    subscription?.provider === 'stripe' &&
    activePlanId !== 'free'

  const onIdentityChange = useCallback((next: IdentityStatus) => {
    setIdentity((prev) => (identityStatusEquals(prev, next) ? prev : next))
    if (next.durable) {
      setUpgradeNote(
        billingEnabled
          ? 'Account collegato. Puoi procedere con l’upgrade.'
          : 'Account collegato. I pagamenti saranno disponibili nella prossima fase.',
      )
      setShowIdentityGate(false)
    }
  }, [billingEnabled])

  const onUpgradeClick = async (planId: PlanId) => {
    if (!durable) {
      setShowIdentityGate(true)
      setUpgradeNote(
        'Crea o collega un account per proteggere e ripristinare il tuo acquisto.',
      )
      return
    }

    setShowIdentityGate(false)

    if (!billingEnabled || (planId !== 'base' && planId !== 'pro')) {
      setUpgradeNote(
        planId === 'base'
          ? 'Account collegato. I pagamenti Base saranno disponibili a breve. Nessun addebito ora.'
          : 'Account collegato. I pagamenti Pro saranno disponibili a breve. Nessun addebito ora.',
      )
      return
    }

    setBusy(true)
    setUpgradeNote('Apertura Checkout sicuro…')
    const result = await startPlanCheckout(planId)
    setBusy(false)
    if (!result.ok) {
      setUpgradeNote(result.error || 'Checkout non disponibile.')
      return
    }
    window.location.assign(result.url)
  }

  const onManageSubscription = async () => {
    if (!portalEnabled || busy) return
    setBusy(true)
    setUpgradeNote('Apertura portale abbonamento…')
    const result = await startBillingPortal()
    setBusy(false)
    if (!result.ok) {
      setUpgradeNote(result.error || 'Portale non disponibile.')
      return
    }
    window.location.assign(result.url)
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

        {portalEnabled ? (
          <div className="plans-page__manage">
            <button
              type="button"
              className="plan-card__btn plan-card__btn--upgrade"
              onClick={() => void onManageSubscription()}
              disabled={busy}
            >
              Gestisci abbonamento
            </button>
          </div>
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
                      onClick={() => void onUpgradeClick(plan.planId)}
                      disabled={busy}
                      aria-label={
                        !durable
                          ? `Upgrade a ${plan.displayName} — collega account`
                          : billingEnabled
                            ? `Upgrade a ${plan.displayName}`
                            : `Upgrade a ${plan.displayName} — pagamenti a breve`
                      }
                      title={
                        !durable
                          ? 'Collega account'
                          : billingEnabled
                            ? 'Checkout sicuro (Test Mode)'
                            : 'Pagamenti a breve'
                      }
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
          {billingEnabled
            ? 'Checkout Test Mode via Stripe. Nessuna carta gestita da ShinkAIdo. Prezzi provvisori.'
            : 'Prezzi provvisori per valutazione prodotto. Non configurati su store o pagamenti.'}
        </p>
      </div>
    </main>
  )
}
