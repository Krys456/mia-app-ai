/**
 * Client helper — upload one supported document to /api/files (#275/#276).
 * Returns OpenAI file metadata only (no bytes).
 */

import {
  DocumentValidationError,
  assertValidDocumentFile,
  summarizeDocumentForLog,
  type SupportedDocumentMime,
} from './documentAttachment'
import { resolveChatAuthForRequest } from './chatAuth'
import { parseApiErrorResponse, withErrorReference } from './apiError'

export interface UploadedDocumentMeta {
  fileId: string
  filename: string
  size: number
  mimeType: SupportedDocumentMime
  expiresAt: number | null
}

export class DocumentUploadError extends Error {
  readonly code: string
  readonly status: number
  readonly requestId?: string

  constructor(
    message: string,
    code = 'upload_failed',
    status = 0,
    opts?: { requestId?: string },
  ) {
    super(message)
    this.name = 'DocumentUploadError'
    this.code = code
    this.status = status
    this.requestId = opts?.requestId
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
export async function uploadDocumentAttachment(
  file: File,
  init?: { signal?: AbortSignal; existingFileId?: string; existingMime?: SupportedDocumentMime },
): Promise<UploadedDocumentMeta> {
  const validated = await assertValidDocumentFile(file)

  if (init?.existingFileId && /^file-[A-Za-z0-9]+$/.test(init.existingFileId)) {
    return {
      fileId: init.existingFileId,
      filename: validated.name,
      size: validated.size,
      mimeType: init.existingMime && init.existingMime === validated.mimeType
        ? init.existingMime
        : validated.mimeType,
      expiresAt: null,
    }
  }

  const endpoint = resolveFilesEndpoint()
  const form = new FormData()
  form.append('file', file, validated.name)

  const headers: Record<string, string> = {
    Accept: 'application/json',
  }
  const auth = await resolveChatAuthForRequest()
  if (!auth.authorization) {
    throw new DocumentUploadError(
      'Sessione non pronta. Ricarica la pagina e riprova.',
      'unauthorized',
      401,
    )
  }
  headers.Authorization = auth.authorization

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
    if (import.meta.env.DEV) {
      console.warn(
        '[files] upload network error',
        error instanceof Error ? error.name : 'unknown',
      )
    }
    throw new DocumentUploadError(
      'Invio del documento non riuscito. Controlla la connessione e riprova.',
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
    const parsed = parseApiErrorResponse(
      response,
      {
        error: typeof data.error === 'string' ? data.error : undefined,
        code: typeof data.code === 'string' ? data.code : undefined,
        requestId: typeof data.requestId === 'string' ? data.requestId : undefined,
      },
      mapUploadStatus(response.status, typeof data.code === 'string' ? data.code : 'upload_failed'),
    )
    if (import.meta.env.DEV) {
      console.warn(
        '[files] upload rejected',
        summarizeDocumentForLog({ ...validated, fileId: '' }),
        parsed.code,
      )
    }
    throw new DocumentUploadError(
      withErrorReference(parsed.message, parsed.requestId),
      parsed.code || 'upload_failed',
      parsed.status,
      { requestId: parsed.requestId },
    )
  }

  const fileId = typeof data.fileId === 'string' ? data.fileId.trim() : ''
  if (!/^file-[A-Za-z0-9]+$/.test(fileId)) {
    throw new DocumentUploadError(
      'Risposta upload non valida. Riprova.',
      'invalid_response',
      response.status,
    )
  }

  const returnedMime =
    typeof data.mimeType === 'string' && data.mimeType.trim()
      ? data.mimeType.trim()
      : validated.mimeType

  const meta: UploadedDocumentMeta = {
    fileId,
    filename:
      typeof data.filename === 'string' && data.filename.trim()
        ? data.filename.trim()
        : validated.name,
    size: typeof data.size === 'number' ? data.size : validated.size,
    mimeType: (returnedMime as SupportedDocumentMime) || validated.mimeType,
    expiresAt: typeof data.expiresAt === 'number' ? data.expiresAt : null,
  }
  console.info('[files] upload ok', summarizeDocumentForLog(meta))
  return meta
}

function mapUploadStatus(status: number, code: string): string {
  if (code === 'encrypted_pdf' || code === 'password_pdf' || code === 'encrypted_docx') {
    return 'Questo documento è protetto da password. Rimuovi la protezione e riprova.'
  }
  if (code === 'too_large' || status === 413) {
    return 'File troppo grande per questo formato.'
  }
  if (code === 'binary_txt') return 'Il file sembra contenere dati binari.'
  if (code === 'bad_encoding') return 'Codifica del file di testo non supportata.'
  if (code === 'unsupported_word') return 'I file .doc / .docm non sono supportati. Usa .docx.'
  if (code === 'invalid_docx') return 'Documento DOCX non valido.'
  if (code === 'invalid_pdf' || code === 'unsupported_type' || code === 'invalid_txt') {
    return 'Documento non valido o formato non supportato.'
  }
  if (status >= 500) {
    return 'Caricamento documento non riuscito. Riprova tra un momento.'
  }
  return 'Impossibile caricare il documento. Riprova.'
}

/** @deprecated use uploadDocumentAttachment — kept for #275 call-site compatibility during migration */
export async function uploadPdfAttachment(
  file: File,
  init?: { signal?: AbortSignal; existingFileId?: string },
) {
  return uploadDocumentAttachment(file, init)
}

export { DocumentValidationError }
// Back-compat aliases used by older Composer error handling
export { DocumentUploadError as PdfUploadError }
