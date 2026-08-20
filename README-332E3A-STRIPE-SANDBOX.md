# #332E3A — Stripe Web Sandbox (TEST MODE)

Draft implementation: environment isolation + Checkout + webhook.

## Safety

- `ENTITLEMENT_ENFORCEMENT_ENABLED` remains **OFF**
- Stripe **TEST MODE** / `BILLING_ENVIRONMENT=sandbox` for Preview
- No live products/keys in this phase
- No Google Play / StoreKit
- Success URL never grants plan — only polls `GET /api/subscription`

## Function budget

Single new route: `api/billing.ts` → **12 / 12** Hobby functions.

- `POST` + `Stripe-Signature` → webhook (raw body)
- `POST` + `Authorization` → `{ "action": "create_checkout", "targetPlan": "base"|"pro" }`

## Env (server-only, never `VITE_*`)

```
BILLING_ENVIRONMENT=sandbox
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_BASE_MONTHLY=price_...
STRIPE_PRICE_PRO_MONTHLY=price_...
BILLING_APP_ORIGIN=https://<preview-host>   # optional; defaults to https://$VERCEL_URL
```

Config is loaded **lazily** when `/api/billing` is invoked. Core chat deploys without Stripe vars.

## Manual Stripe provisioning

1. Stripe Dashboard → **Test mode**
2. Create Products: ShinkAIdo Base, ShinkAIdo Pro
3. Create monthly Prices (EUR) matching UI labels if possible
4. Developers → Webhooks → Add endpoint:
   - URL: `https://<preview>/api/billing`
   - Events: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`
5. Copy webhook signing secret → `STRIPE_WEBHOOK_SECRET`
6. Set Vercel Preview env vars (above)
7. If Vercel Deployment Protection / SSO blocks Stripe webhooks, allowlist `/api/billing` or use a protection bypass for webhook POSTs only

## Deferred to #332E3B

- Customer Portal
- Base↔Pro upgrade/downgrade management
- Live mode / Production billing
