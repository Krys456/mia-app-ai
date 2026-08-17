/**
 * POST /api/files — upload one supported document (PDF / TXT / DOCX) to OpenAI Files.
 * Returns { fileId, filename, size, expiresAt, mimeType } only. No second LLM.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { applyCors, sendCorsPreflight, sendJson } from '../lib/server/http.js'
import { requirePaidApiAccess } from '../lib/server/paid-api-guard.js'
import { parseSingleMultipartFile } from '../lib/server/multipart-file.js'
import {
  SERVER_DOCUMENT_EXPIRES_SECONDS,
  SERVER_MAX_PDF_BYTES,
  mapOpenAiFileError,
  summarizePdfForLog,
  uploadDocumentToOpenAiFiles,
  validateDocumentBuffer,
} from '../lib/server/chat-pdf-files.js'

export const config = {
  runtime: 'nodejs',
  maxDuration: 60,
  api: {
    bodyParser: false,
  },
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(res, req)

  if (req.method === 'OPTIONS') {
    return sendCorsPreflight(res, req)
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS')
    return sendJson(res, 405, { error: 'Method not allowed' }, req)
  }

  // #298A — auth + durable rate limit before OpenAI Files upload.
  const access = await requirePaidApiAccess(req, res, { bucket: 'files' })
  if (!access) return

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    return sendJson(res, 500, {
      error: 'Impossibile caricare il file. Riprova tra poco.',
      code: 'misconfigured',
    }, req)
  }

  let parsed: { buffer: Buffer; filename: string; mimeType: string }
  try {
    parsed = await parseSingleMultipartFile(req, {
      maxBytes: SERVER_MAX_PDF_BYTES,
      fieldName: 'file',
    })
  } catch (error) {
    const code =
      error && typeof error === 'object' && 'code' in error
        ? String((error as { code?: string }).code || 'upload_failed')
        : 'upload_failed'
    if (code === 'too_large') {
      return sendJson(res, 413, {
        error: 'File troppo grande per questo formato.',
        code: 'too_large',
      }, req)
    }
    if (code === 'invalid_content_type') {
      return sendJson(res, 400, {
        error: 'Richiesta non valida. Usa multipart/form-data.',
        code: 'invalid_content_type',
      }, req)
    }
    return sendJson(res, 400, {
      error: 'Impossibile leggere il file. Riprova.',
      code: code === 'empty' ? 'empty' : 'upload_failed',
    }, req)
  }

  const validated = validateDocumentBuffer(parsed.buffer, parsed.filename, parsed.mimeType)
  if (!validated.ok) {
    console.warn(
      '[api/files] document rejected',
      summarizePdfForLog({
        name: parsed.filename,
        size: parsed.buffer.length,
        mimeType: parsed.mimeType,
      }),
      validated.code,
    )
    return sendJson(res, validated.code === 'too_large' ? 413 : 400, {
      error: validated.error,
      code: validated.code,
    }, req)
  }

  // JS validators return a runtime success object; narrow for TS.
  const documentMeta = validated as {
    ok: true
    name: string
    size: number
    mimeType: string
  }

  try {
    const uploaded = await uploadDocumentToOpenAiFiles({
      apiKey,
      buffer: parsed.buffer,
      filename: documentMeta.name,
      mimeType: documentMeta.mimeType,
    })
    console.info(
      '[api/files] uploaded',
      summarizePdfForLog({
        name: uploaded.filename,
        size: uploaded.size,
        fileId: uploaded.fileId,
        mimeType: uploaded.mimeType,
      }),
      { expiresSeconds: SERVER_DOCUMENT_EXPIRES_SECONDS },
    )
    return sendJson(res, 200, {
      fileId: uploaded.fileId,
      filename: uploaded.filename,
      size: uploaded.size,
      expiresAt: uploaded.expiresAt,
      mimeType: uploaded.mimeType,
    }, req)
  } catch (error) {
    const mapped = mapOpenAiFileError(error, documentMeta.mimeType)
    console.warn(
      '[api/files] openai upload failed',
      mapped.code,
      summarizePdfForLog({
        name: documentMeta.name,
        size: documentMeta.size,
        mimeType: documentMeta.mimeType,
      }),
    )
    return sendJson(res, 400, { error: mapped.error, code: mapped.code }, req)
  }
}
