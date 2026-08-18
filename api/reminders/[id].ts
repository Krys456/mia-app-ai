import type { VercelRequest, VercelResponse } from '@vercel/node'
import { sendJson, applyCors, sendCorsPreflight } from '../../lib/server/http.js'

export const config = {
  runtime: 'nodejs',
  maxDuration: 15,
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(res, req)
  if (req.method === 'OPTIONS') return sendCorsPreflight(res, req)
  return sendJson(res, 501, { error: 'not implemented', code: 'stub' }, req)
}
