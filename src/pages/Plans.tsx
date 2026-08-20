/**
 * #332A/#332D/#332E2/#332E2A/#332E3A — ShinkAIdo Plans page.
 * Catalog-driven. Current plan from verified /api/subscription when available;
 * display-only — never authorizes premium APIs.
 *
 * Upgrade:
 * - anonymous → #332E2 identity gate
 * - durable Free → Stripe TEST Checkout (#332E3A)
 * - success URL → poll verified subscription (never local grant)
 */

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { PageHeader } from '../components/PageHeader'
import { IdentityAccountPanel } from '../components/IdentityAccountPanel'
import {
  PLAN_CATALOG,
  UI_FOUNDATION_CURRENT_PLAN_ID,
  formatPlanPrice,
  type PlanId,
} from '../lib/planCatalog'
import { fetchVerifiedSubscription } from '../lib/subscriptionApi'
import {
  clearCheckoutReturnQuery,
  createCheckoutSession,
  readCheckoutReturnMarker,
} from '../lib/billingApi'
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

const ACTIVATION_POLL_MS = 2000
const ACTIVATION_MAX_ATTEMPTS = 15

export function Plans({
  onBack,
  currentPlanId = UI_FOUNDATION_CURRENT_PLAN_ID,
}: PlansProps) {
  const titleId = useId()
  const [upgradeNote, setUpgradeNote] = useState<string | null>(null)
  const [verifiedPlanId, setVerifiedPlanId] = useState<PlanId>(currentPlanId)
  const [identity, setIdentity] = useState<IdentityStatus | null>(null)
  const [showIdentityGate, setShowIdentityGate] = useState(false)
  const [checkoutBusy, setCheckoutBusy] = useState(false)
  const [activating, setActivating] = useState(false)
  const pollCancelRef = useRef(false)

  const refreshVerifiedPlan = useCallback(async () => {
    const state = await fetchVerifiedSubscription()
    setVerifiedPlanId(state.planId)
    return state
  }, [])

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

  // Stripe return: UX only — poll verified subscription; never grant from query.
  useEffect(() => {
    const marker = readCheckoutReturnMarker()
    if (!marker) return

    clearCheckoutReturnQuery()

    if (marker === 'canceled') {
      setUpgradeNote('Checkout annullato. Il piano attuale non è cambiato.')
      return
    }

    setActivating(true)
    setUpgradeNote('Attivazione del piano in corso…')
    pollCancelRef.current = false

    void (async () => {
      for (let attempt = 0; attempt < ACTIVATION_MAX_ATTEMPTS; attempt += 1) {
        if (pollCancelRef.current) return
        const state = await fetchVerifiedSubscription()
        setVerifiedPlanId(state.planId)
        if (state.planId === 'base' || state.planId === 'pro') {
          setActivating(false)
          setUpgradeNote(
            state.planId === 'base'
              ? 'Piano Base attivo.'
              : 'Piano Pro attivo.',
          )
          return
        }
        await new Promise((r) => setTimeout(r, ACTIVATION_POLL_MS))
      }
      if (pollCancelRef.current) return
      setActivating(false)
      setUpgradeNote(
        'Attivazione ancora in corso. Riprova tra poco o aggiorna la pagina Plans.',
      )
    })()

    return () => {
      pollCancelRef.current = true
    }
  }, [])

  const activePlanId = verifiedPlanId
  // While identity is still loading (null), treat as non-durable so Upgrade opens the gate.
  const durable = identity?.durable === true

  const onIdentityChange = useCallback((next: IdentityStatus) => {
    setIdentity((prev) => (identityStatusEquals(prev, next) ? prev : next))
    if (next.durable) {
      setUpgradeNote(
        'Account collegato. Puoi procedere con l’upgrade.',
      )
      setShowIdentityGate(false)
    }
  }, [])

  const onUpgradeClick = async (planId: PlanId) => {
    if (planId !== 'base' && planId !== 'pro') return

    if (!durable) {
      setShowIdentityGate(true)
      setUpgradeNote(
        'Crea o collega un account per proteggere e ripristinare il tuo acquisto.',
      )
      return
    }

    setShowIdentityGate(false)
    setCheckoutBusy(true)
    setUpgradeNote('Apertura Checkout sicuro…')

    try {
      const result = await createCheckoutSession(planId)
      if (!result.ok) {
        if (result.code === 'durable_identity_required') {
          setShowIdentityGate(true)
          setUpgradeNote(
            'Crea o collega un account per proteggere e ripristinare il tuo acquisto.',
          )
          return
        }
        if (result.code === 'subscription_already_active') {
          setUpgradeNote('Questo piano è già attivo.')
          await refreshVerifiedPlan()
          return
        }
        if (result.code === 'billing_management_required') {
          setUpgradeNote(
            'La gestione del piano (upgrade/cambio) sarà disponibile a breve.',
          )
          return
        }
        if (result.code === 'billing_unavailable' || result.code === 'billing_configuration_error') {
          setUpgradeNote(
            'Pagamenti non configurati in questo ambiente. Riprova più tardi.',
          )
          return
        }
        setUpgradeNote(result.error || 'Impossibile avviare il checkout.')
        return
      }

      window.location.assign(result.checkoutUrl)
    } finally {
      setCheckoutBusy(false)
    }
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
                      onClick={() => void onUpgradeClick(plan.planId)}
                      disabled={checkoutBusy || activating}
                      aria-label={
                        durable
                          ? `Upgrade a ${plan.displayName}`
                          : `Upgrade a ${plan.displayName} — collega account`
                      }
                      title={durable ? 'Checkout sicuro' : 'Collega account'}
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
          Prezzi provvisori per valutazione prodotto. Checkout in modalità test.
        </p>
      </div>
    </main>
  )
}
