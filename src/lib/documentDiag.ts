/**
 * #313 — client document-chat diag (?document_diag=1).
 */

export function isDocumentDiagClientEnabled(
  search: string | null | undefined = typeof window !== 'undefined' ? window.location.search : '',
): boolean {
  try {
    const q = String(search || '')
    if (!q) return false
    const params = new URLSearchParams(q.startsWith('?') ? q.slice(1) : q)
    const v = params.get('document_diag')
    return v === '1' || v === 'true'
  } catch {
    return false
  }
}

export function rememberDocumentDiag(payload: unknown): void {
  if (!payload || typeof payload !== 'object') return
  const p = payload as { route?: string }
  if (p.route !== 'document-chat') return
  try {
    if (typeof console !== 'undefined' && console.info) {
      console.info('[document-diag]', payload)
    }
  } catch {
    /* ignore */
  }
}
