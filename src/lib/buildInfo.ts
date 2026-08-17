/**
 * #298C — Short client build identifier (first ~7 of commit SHA).
 * Injected at Vite build time from VERCEL_GIT_COMMIT_SHA when available.
 */

declare const __SHINKAIDO_BUILD_ID__: string | undefined

export function getClientBuildId(): string {
  try {
    if (typeof __SHINKAIDO_BUILD_ID__ === 'string' && __SHINKAIDO_BUILD_ID__.trim()) {
      return __SHINKAIDO_BUILD_ID__.replace(/[^a-fA-F0-9]/g, '').slice(0, 7) || 'dev'
    }
  } catch {
    /* ignore */
  }
  return 'dev'
}
