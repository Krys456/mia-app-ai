/**
 * #332B — Client entitlement UX + apiError contracts
 * Run: node --test src/lib/entitlements-ui-332b.test.mjs
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')

const ui = read('src/lib/entitlementsUi.ts')
const apiError = read('src/lib/apiError.ts')
const app = read('src/App.tsx')
const plans = read('src/pages/Plans.tsx')
const catalog = read('src/lib/planCatalog.ts')
const header = read('src/components/Header.tsx')

assert.match(ui, /export function getCurrentPlanId/)
assert.match(ui, /UI_FOUNDATION_CURRENT_PLAN_ID/)
assert.match(ui, /PLANS_APP_VIEW\s*=\s*'plans'/)
assert.match(ui, /userFacingEntitlementMessage/)
assert.match(ui, /isEntitlementRequiredCode/)

assert.match(apiError, /entitlement_required/)
assert.match(apiError, /requiredPlan/)
assert.match(apiError, /entitlement\?:/)

assert.match(app, /getCurrentPlanId\(\)/)
assert.match(app, /view === 'plans'/)
assert.match(header, /onNavigate\('plans'\)/)
assert.match(plans, /currentPlanId/)
assert.match(catalog, /Authorization lives/)

// Local free tools must not be gated by entitlement keys in client routers
for (const file of [
  'src/lib/calculator/controller.js',
  'src/lib/unit-conversion/controller.js',
  'src/lib/energy-math/controller.js',
  'src/lib/timer/controller.js',
  'src/lib/phone-action/controller.js',
]) {
  if (fs.existsSync(path.join(root, file))) {
    const src = read(file)
    assert.doesNotMatch(src, /canUse\(|ENTITLEMENT_MATRIX|entitlement_required/)
  }
}

console.log('entitlements-ui-332b: ok')
