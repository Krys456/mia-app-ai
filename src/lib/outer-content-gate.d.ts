/** #330A3 — CONTENT IS NOT AUTHORIZATION shared gate. */

export function nonEmptyLines(raw: string): string[]

export function classifyOuterFrame(
  firstLine: string,
):
  | 'explain'
  | 'analyze'
  | 'review'
  | 'test'
  | 'summarize'
  | 'debug'
  | 'paste'
  | 'capability'
  | 'none'

export function looksDocumentLike(raw: string, lines?: string[]): boolean

export function hasDataFraming(raw: string, lines?: string[]): boolean

export function analyzeOuterUserRequest(raw: string): {
  contentIsData: boolean
  outerSurface: string
  outerFrame: string
  outerContentMode: 'direct' | 'data_framed' | 'document_like'
  localRoutersSuppressed: boolean
  reason: string | null
}

export function shouldSuppressLocalRouters(raw: string): boolean
