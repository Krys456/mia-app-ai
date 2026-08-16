/**
 * Minimal multipart/form-data parser for a single file field (#275).
 * Uses @fastify/busboy (already in the install tree via Vercel tooling).
 */

import Busboy from '@fastify/busboy'
import { Readable } from 'node:stream'

/**
 * @param {import('@vercel/node').VercelRequest} req
 * @param {{ maxBytes?: number, fieldName?: string }} [opts]
 * @returns {Promise<{ buffer: Buffer, filename: string, mimeType: string }>}
 */
export function parseSingleMultipartFile(req, opts = {}) {
  const maxBytes = typeof opts.maxBytes === 'number' ? opts.maxBytes : 10 * 1024 * 1024
  const fieldName = opts.fieldName || 'file'

  return new Promise((resolve, reject) => {
    const contentType = String(req.headers['content-type'] || '')
    if (!/multipart\/form-data/i.test(contentType)) {
      reject(Object.assign(new Error('Expected multipart/form-data'), { code: 'invalid_content_type' }))
      return
    }

    /** @type {Buffer[]} */
    const chunks = []
    let total = 0
    let filename = 'document.pdf'
    let mimeType = 'application/pdf'
    let sawFile = false
    let settled = false

    const fail = (err) => {
      if (settled) return
      settled = true
      reject(err)
    }

    const busboy = Busboy({
      headers: { 'content-type': contentType },
      limits: { files: 1, fields: 4, fileSize: maxBytes },
    })

    busboy.on('file', (name, stream, info) => {
      if (name !== fieldName) {
        stream.resume()
        return
      }
      sawFile = true
      filename = info?.filename || filename
      mimeType = info?.mimeType || info?.mime || mimeType
      stream.on('data', (chunk) => {
        total += chunk.length
        if (total > maxBytes) {
          stream.destroy()
          fail(Object.assign(new Error('File too large'), { code: 'too_large' }))
          return
        }
        chunks.push(Buffer.from(chunk))
      })
      stream.on('limit', () => {
        fail(Object.assign(new Error('File too large'), { code: 'too_large' }))
      })
      stream.on('error', (err) => fail(err))
    })

    busboy.on('error', (err) => fail(err))
    busboy.on('finish', () => {
      if (settled) return
      settled = true
      if (!sawFile || chunks.length === 0) {
        reject(Object.assign(new Error('Missing file'), { code: 'empty' }))
        return
      }
      resolve({
        buffer: Buffer.concat(chunks),
        filename,
        mimeType,
      })
    })

    // Vercel may already have buffered the body.
    const body = req.body
    if (Buffer.isBuffer(body)) {
      busboy.end(body)
      return
    }
    if (typeof body === 'string') {
      busboy.end(Buffer.from(body))
      return
    }
    if (body && typeof body === 'object' && !Readable.toWeb) {
      // Unexpected pre-parsed body — reject rather than guess.
      fail(Object.assign(new Error('Expected raw multipart body'), { code: 'invalid_content_type' }))
      return
    }

    req.pipe(busboy)
  })
}
