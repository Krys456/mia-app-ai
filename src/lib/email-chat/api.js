/**
 * #337B — Thin wrapper: email-chat controller calls requestEmailQuery from emailApi.
 * Lazy import so Node unit tests can load the controller without Vite TS resolution.
 */

/**
 * @param {{
 *   queryType: string
 *   sender?: string | null
 *   timeWindow?: string | null
 *   timeZone?: string | null
 *   messageId?: string | null
 *   includeBody?: boolean
 *   maxResults?: number
 * }} payload
 */
export async function requestEmailQuery(payload) {
  const { requestEmailQuery: request } = await import('../emailApi.ts')
  return request(payload)
}
