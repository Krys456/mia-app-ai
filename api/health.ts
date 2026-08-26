/**
 * #387B GET /api/health — public minimal liveness.
 *
 * Safe for unauthenticated access. No worker details, no Supabase refs,
 * no secrets, no stack traces. Preserves #298C request-ID via sendJson.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { applyCors, sendCorsPreflight, sendJson } from '../lib/server/http.js'
import { ensureRequestContext } from '../lib/server/request-id.js'
import { logApiEvent } from '../lib/server/safe-log.js'
import { buildPublicHealthPayload } from '../lib/server/worker-health.js'

export const config = {
  runtime: 'nodejs',
  maxDuration: 10,
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(res, req)
  const obs = ensureRequestContext(req as any, res)

  if (req.method === 'OPTIONS') {
    return sendCorsPreflight(res, req)
  }

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET, OPTIONS')
    return sendJson(
      res,
      405,
      { error: 'Method not allowed', code: 'method_not_allowed' },
      req,
    )
  }

  res.setHeader('Cache-Control', 'no-store')

  const body = buildPublicHealthPayload(process.env)
  logApiEvent({
    route: '/api/health',
    code: 'health_ok',
    ok: true,
    requestId: obs.requestId,
    environment: body.environment,
    buildId: body.buildId,
  })

  return sendJson(res, 200, body, req)
}
