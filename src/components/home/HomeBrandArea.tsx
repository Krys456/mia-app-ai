/**
 * #335B — Compact brand area for Home (quieter than old centered logo stack).
 */

import { BrandWordmark } from '../BrandWordmark'
import { BRAND } from '../../lib/brand'

export function HomeBrandArea() {
  return (
    <div className="home-brand motion-paper-fade" data-home="brand">
      <BrandWordmark emphasizeAi showTagline={false} size="md" className="home-brand__wordmark" />
      <p className="home-brand__tag type-micro">{BRAND.tagline}</p>
    </div>
  )
}
