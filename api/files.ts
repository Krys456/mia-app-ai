/**
 * POST /api/files — thin PDF upload → OpenAI Files API (#275).
 * Returns { fileId, filename, size, expiresAt } only. No second LLM.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { applyCors, sendCorsPreflight, sendJson } from '../lib/server/http.js'
import { parseSingleMultipartFile } from '../lib/server/multipart-file.js'
import {
  SERVER_MAX_PDF_BYTES,
  SERVER_PDF_EXPIRES_SECONDS,
  mapOpenAiFileError,
  summarizePdfForLog,
  uploadPdfToOpenAiFiles,
  validatePdfBuffer,
} from '../lib/server/chat-pdf-files.js'

export const config = {
  runtime: 'nodejs',
  maxDuration: 60,
  api: {
    bodyParser: false,
  },
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(res)

  if (req.method === 'OPTIONS') {
    return sendCorsPreflight(res)
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS')
    return sendJson(res, 405, { error: 'Method not allowed' })
  }

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    return sendJson(res, 500, {
      error: 'Server misconfigured: OPENAI_API_KEY is not set',
    })
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
        error: 'PDF troppo grande. Massimo 10 MB.',
        code: 'too_large',
      })
    }
    if (code === 'invalid_content_type') {
      return sendJson(res, 400, {
        error: 'Richiesta non valida. Usa multipart/form-data.',
        code: 'invalid_content_type',
      })
    }
    return sendJson(res, 400, {
      error: 'Impossibile leggere il file. Riprova.',
      code: code === 'empty' ? 'empty' : 'upload_failed',
    })
  }

  const validated = validatePdfBuffer(parsed.buffer, parsed.filename, parsed.mimeType)
  if (!validated.ok) {
    console.warn('[api/files] pdf rejected', summarizePdfForLog({
      name: parsed.filename,
      size: parsed.buffer.length,
      mimeType: parsed.mimeType,
    }), validated.code)
    return sendJson(res, 400, { error: validated.error, code: validated.code })
  }

  try {
    const uploaded = await uploadPdfToOpenAiFiles({
      apiKey,
      buffer: parsed.buffer,
      filename: validated.name,
    })
    console.info(
      '[api/files] uploaded',
      summarizePdfForLog({
        name: uploaded.filename,
        size: uploaded.size,
        fileId: uploaded.fileId,
      }),
      { expiresSeconds: SERVER_PDF_EXPIRES_SECONDS },
    )
    return sendJson(res, 200, {
      fileId: uploaded.fileId,
      filename: uploaded.filename,
      size: uploaded.size,
      expiresAt: uploaded.expiresAt,
      mimeType: 'application/pdf',
    })
  } catch (error) {
    const mapped = mapOpenAiFileError(error)
    console.warn(
      '[api/files] openai upload failed',
      mapped.code,
      summarizePdfForLog({ name: validated.name, size: validated.size }),
    )
    return sendJson(res, 400, { error: mapped.error, code: mapped.code })
  }
}
