/**
 * Client helper — upload one PDF to /api/files (#275).
 * Returns OpenAI file metadata only (no bytes).
 */

import {
  PdfValidationError,
  assertValidPdfFile,
  summarizePdfForLog,
} from './pdfAttachment'
import { resolveChatAuthForRequest } from './chatAuth'

export interface UploadedPdfMeta {
  fileId: string
  filename: string
  size: number
  mimeType: 'application/pdf'
  expiresAt: number | null
}

export class PdfUploadError extends Error {
  readonly code: string
  readonly status: number

  constructor(message: string, code = 'upload_failed', status = 0) {
    super(message)
    this.name = 'PdfUploadError'
    this.code = code
    this.status = status
  }
}

function resolveFilesEndpoint(): string {
  const base = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() ?? ''
  if (!base) return '/api/files'
  return `${base.replace(/\/$/, '')}/api/files`
}

/**
 * Validate locally, then multipart upload. Reuses fileId if already present.
 */
export async function uploadPdfAttachment(
  file: File,
  init?: { signal?: AbortSignal; existingFileId?: string },
): Promise<UploadedPdfMeta> {
  if (init?.existingFileId && /^file-[A-Za-z0-9]+$/.test(init.existingFileId)) {
    const validated = await assertValidPdfFile(file)
    return {
      fileId: init.existingFileId,
      filename: validated.name,
      size: validated.size,
      mimeType: 'application/pdf',
      expiresAt: null,
    }
  }

  const validated = await assertValidPdfFile(file)
  const endpoint = resolveFilesEndpoint()
  const form = new FormData()
  // Re-wrap with sanitized filename for the multipart part.
  form.append('file', file, validated.name)

  const headers: Record<string, string> = {
    Accept: 'application/json',
  }
  try {
    const auth = await resolveChatAuthForRequest({ memoryEnabled: false })
    if (auth.authorization) headers.Authorization = auth.authorization
  } catch {
    /* upload does not require memory auth */
  }

  let response: Response
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers,
      credentials: 'include',
      body: form,
      signal: init?.signal,
    })
  } catch (error) {
    console.warn('[files] upload network error', error instanceof Error ? error.message.slice(0, 80) : 'unknown')
    throw new PdfUploadError(
      'Invio del PDF non riuscito. Controlla la connessione e riprova.',
      'network',
      0,
    )
  }

  let data: Record<string, unknown> = {}
  try {
    const text = await response.text()
    if (text.trim()) data = JSON.parse(text) as Record<string, unknown>
  } catch {
    data = {}
  }

  if (!response.ok) {
    const code = typeof data.code === 'string' ? data.code : 'upload_failed'
    const msg =
      typeof data.error === 'string' && data.error.trim()
        ? data.error.trim()
        : mapUploadStatus(response.status, code)
    console.warn('[files] upload rejected', summarizePdfForLog({ ...validated, fileId: '' }), code)
    throw new PdfUploadError(msg, code, response.status)
  }

  const fileId = typeof data.fileId === 'string' ? data.fileId.trim() : ''
  if (!/^file-[A-Za-z0-9]+$/.test(fileId)) {
    throw new PdfUploadError('Risposta upload non valida. Riprova.', 'invalid_response', response.status)
  }

  const meta: UploadedPdfMeta = {
    fileId,
    filename:
      typeof data.filename === 'string' && data.filename.trim()
        ? data.filename.trim()
        : validated.name,
    size: typeof data.size === 'number' ? data.size : validated.size,
    mimeType: 'application/pdf',
    expiresAt: typeof data.expiresAt === 'number' ? data.expiresAt : null,
  }
  console.info('[files] upload ok', summarizePdfForLog(meta))
  return meta
}

function mapUploadStatus(status: number, code: string): string {
  if (code === 'encrypted_pdf' || code === 'password_pdf') {
    return 'Questo PDF è protetto da password. Rimuovi la protezione e riprova.'
  }
  if (code === 'too_large' || status === 413) {
    return 'PDF troppo grande. Massimo 10 MB.'
  }
  if (code === 'unsupported_type' || code === 'invalid_pdf') {
    return 'PDF non valido o formato non supportato.'
  }
  if (status >= 500) {
    return 'Caricamento PDF non riuscito. Riprova tra un momento.'
  }
  return 'Impossibile caricare il PDF. Riprova.'
}

// Re-export validation error for callers
export { PdfValidationError }
