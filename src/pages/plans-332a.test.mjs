/**
 * #332A — ShinkAIdo Plans UI Foundation contracts
 * Run: node --test src/pages/plans-332a.test.mjs
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')

const types = read('src/types.ts')
const appTsx = read('src/App.tsx')
const headerTsx = read('src/components/Header.tsx')
const headerCss = read('src/components/Header.css')
const plansTsx = read('src/pages/Plans.tsx')
const plansCss = read('src/pages/Plans.css')
const catalog = read('src/lib/planCatalog.ts')
const chatApi = read('api/chat.ts')
const coreParams = read('lib/server/core-responses-params.js')

// —— AppView + navigation architecture ——
assert.match(types, /AppView[\s\S]*'plans'/)
assert.match(appTsx, /from '\.\/pages\/Plans'/)
assert.match(appTsx, /view === 'plans'/)
assert.match(appTsx, /data-view="plans"/)
assert.match(appTsx, /backFromPlans/)
assert.match(appTsx, /getCurrentPlanId|UI_FOUNDATION_CURRENT_PLAN_ID/)
assert.match(appTsx, /hidden=\{view !== 'chat'\}/)
assert.match(appTsx, /inert=\{view !== 'chat' \? true : undefined\}/)
assert.match(appTsx, /next === 'plans'/)
assert.doesNotMatch(appTsx, /role="dialog"[\s\S]*Plans|Plans[\s\S]*role="dialog"/)

// —— Header ✦ entry (order: New Chat → Vision → Plans → Settings) ——
assert.match(headerTsx, /aria-label="Piani ShinkAIdo"/)
assert.match(headerTsx, /title="Piani ShinkAIdo"/)
assert.match(headerTsx, /onNavigate\('plans'\)/)
assert.match(headerTsx, /header-btn--plans|data-testid="header-plans"/)
assert.match(headerTsx, /function IconPlans/)
const actionsBlock = headerTsx.slice(
  headerTsx.indexOf('app-header__actions'),
  headerTsx.indexOf('</div>', headerTsx.indexOf('app-header__actions') + 1) + 200,
)
const iNew = actionsBlock.indexOf('Nuova chat')
const iVision = actionsBlock.indexOf('Vision AI')
const iPlans = actionsBlock.indexOf('Piani ShinkAIdo')
const iSettings = actionsBlock.indexOf('Impostazioni')
assert.ok(iNew >= 0 && iVision > iNew && iPlans > iVision && iSettings > iPlans)

// No dark-pattern Plans chrome in the control itself
assert.doesNotMatch(headerTsx, /aria-label="[^"]*(?:credit-card|crown|SALE|BEST VALUE)/i)
assert.doesNotMatch(headerTsx, /title="[^"]*(?:credit-card|crown|SALE|BEST VALUE)/i)
assert.doesNotMatch(headerCss, /header-btn--plans[\s\S]{0,200}animation/)

// Touch targets preserved
assert.match(headerCss, /min-width:\s*max\(var\(--btn-icon\),\s*var\(--touch-min\)\)/)
assert.match(headerCss, /min-height:\s*max\(var\(--btn-icon\),\s*var\(--touch-min\)\)/)
assert.match(headerCss, /:focus-visible/)
assert.match(headerCss, /@media \(max-width:\s*380px\)/)

// —— Catalog (single source of provisional prices) ——
assert.match(catalog, /UI_FOUNDATION_CURRENT_PLAN_ID:\s*PlanId\s*=\s*'free'/)
assert.match(catalog, /PLAN_CATALOG/)
assert.match(catalog, /priceLabel:\s*'€0'/)
assert.match(catalog, /priceLabel:\s*'€1,99'/)
assert.match(catalog, /priceLabel:\s*'€7,99'/)
assert.match(catalog, /provider-derived|replace these static|billing is integrated/i)
assert.doesNotMatch(catalog, /localStorage/)
assert.doesNotMatch(catalog, /from ['"]@?stripe|RevenueCat|StoreKit|play-billing/i)

// Prices must not be duplicated as literals in Plans UI
assert.doesNotMatch(plansTsx, /€1[,.]99|€7[,.]99|€0/)
assert.match(plansTsx, /PLAN_CATALOG/)
assert.match(plansTsx, /formatPlanPrice|priceLabel/)
assert.match(plansTsx, /currentPlanId/)

// —— Plans page structure ——
assert.match(plansTsx, /ShinkAIdo Plans/)
assert.match(plansTsx, /Scegli l’esperienza|Scegli l'esperienza/)
assert.match(plansTsx, /Piano attuale/)
assert.match(plansTsx, /Upgrade/)
assert.match(plansTsx, /disponibile a breve|disponibili a breve|pagamenti.*breve/i)
assert.match(plansTsx, /IdentityAccountPanel|showIdentityGate/)
assert.match(plansTsx, /role="status"/)
assert.doesNotMatch(plansTsx, /stripe\.com|\/checkout|RevenueCat|Play Billing|StoreKit|createCheckout/i)
assert.match(plansCss, /grid-template-columns:\s*1fr/)
assert.match(plansCss, /@media \(min-width:\s*768px\)[\s\S]*repeat\(3/)
assert.match(plansCss, /min-height:\s*max\(2\.75rem,\s*var\(--touch-min\)\)/)
assert.match(plansCss, /\.plan-card__btn:focus-visible/)

// Free is current; upgrade is non-purchase
assert.match(plansTsx, /isCurrent[\s\S]*Piano attuale|Piano attuale[\s\S]*disabled/)
assert.match(plansTsx, /setUpgradeNote|onUpgradeClick/)
assert.doesNotMatch(plansTsx, /window\.location|fetch\(|\/api\/billing|\/api\/checkout/)

// —— No monetization / Core impact ——
assert.doesNotMatch(chatApi, /planId|PLAN_CATALOG|UI_FOUNDATION_CURRENT_PLAN/)
assert.match(chatApi, /maxDuration:\s*120/)
assert.ok((chatApi.match(/responses\.create\(/g) || []).length >= 1)
assert.match(coreParams, /stream:\s*false/)
assert.equal(fs.existsSync(path.join(root, 'supabase/migrations')), true)
const forbiddenMigrations = fs
  .readdirSync(path.join(root, 'supabase/migrations'))
  .filter((n) => /entitlement_enforcement|billing_provider|stripe/i.test(n))
assert.equal(forbiddenMigrations.length, 0, 'no billing-provider schema migrations in #332A surface')

console.log('plans-332a: ok')
