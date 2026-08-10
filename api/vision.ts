import type { VercelRequest, VercelResponse } from '@vercel/node'
import { applyCors, sendCorsPreflight, sendJson } from '../lib/server/http.js'

export const config = {
  runtime: 'nodejs',
  maxDuration: 15,
}

/**
 * BrAIn Vision infrastructure endpoint.
 * Phase 1: acknowledge receipt only — no AI analysis.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(res)

  if (req.method === 'OPTIONS') {
    return sendCorsPreflight(res)
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS')
    return sendJson(res, 405, {
      error: 'Method not allowed. Only POST is supported.',
    })
  }

  // Phase 1: accept the request body (JSON or raw) and acknowledge only.
  return sendJson(res, 200, { status: 'received' })
}
