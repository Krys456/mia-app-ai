/**
 * #312 — client-side Vision × Search diag (Preview). Safe fields only.
 */

import { isVisionSearchDiagClientEnabled } from './visionSearchActions'

export type VisionSearchDiagPayload = {
  route?: string
  diagBuild?: string
  buildId?: string
  requestId?: string | null
  visionContextFound?: boolean
  sourceVisionTurnId?: string | null
  visualEntityAvailable?: boolean
  visualSearchIntent?: string | null
  generatedSearchQueryPreview?: string
  existingSearchInvoked?: boolean
  searchResultCount?: number | null
  searchContextSentToModel?: boolean
  finalResponseReceived?: boolean
  failureCode?: string | null
  webSearchUsed?: boolean | null
}

let lastDiag: VisionSearchDiagPayload | null = null

export function visionSearchDiagRequested(): boolean {
  return isVisionSearchDiagClientEnabled()
}

export function rememberVisionSearchDiag(payload: unknown): void {
  if (!payload || typeof payload !== 'object') return
  const p = payload as VisionSearchDiagPayload
  if (p.route !== 'vision-search') return
  lastDiag = {
    route: 'vision-search',
    diagBuild: typeof p.diagBuild === 'string' ? p.diagBuild.slice(0, 16) : undefined,
    buildId: typeof p.buildId === 'string' ? p.buildId.slice(0, 16) : undefined,
    requestId: typeof p.requestId === 'string' ? p.requestId.slice(0, 64) : null,
    visionContextFound: Boolean(p.visionContextFound),
    sourceVisionTurnId:
      typeof p.sourceVisionTurnId === 'string' ? p.sourceVisionTurnId.slice(0, 64) : null,
    visualEntityAvailable: Boolean(p.visualEntityAvailable),
    visualSearchIntent:
      typeof p.visualSearchIntent === 'string' ? p.visualSearchIntent.slice(0, 40) : null,
    generatedSearchQueryPreview:
      typeof p.generatedSearchQueryPreview === 'string'
        ? p.generatedSearchQueryPreview.slice(0, 80)
        : undefined,
    existingSearchInvoked: Boolean(p.existingSearchInvoked),
    searchResultCount:
      typeof p.searchResultCount === 'number' ? p.searchResultCount : null,
    searchContextSentToModel: Boolean(p.searchContextSentToModel),
    finalResponseReceived: Boolean(p.finalResponseReceived),
    failureCode: typeof p.failureCode === 'string' ? p.failureCode.slice(0, 64) : null,
    webSearchUsed: p.webSearchUsed == null ? null : Boolean(p.webSearchUsed),
  }
  try {
    if (typeof console !== 'undefined' && console.info) {
      console.info('[vision-search-diag]', lastDiag)
    }
  } catch {
    /* ignore */
  }
}

export function getLastVisionSearchDiag(): VisionSearchDiagPayload | null {
  return lastDiag
}
