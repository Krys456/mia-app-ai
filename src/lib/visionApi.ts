export class VisionApiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'VisionApiError'
    this.status = status
  }
}

function resolveBase(): string {
  const base = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() ?? ''
  return base.replace(/\/$/, '')
}

function visionUrl(): string {
  return new URL(`${resolveBase()}/api/vision`, window.location.origin).toString()
}

/** Sends an image to POST /api/vision (phase 1: receive-only). */
export async function sendVisionImage(file: Blob, fileName = 'capture.jpg'): Promise<void> {
  const form = new FormData()
  form.append('image', file, fileName)

  const response = await fetch(visionUrl(), {
    method: 'POST',
    body: form,
  })

  let data: { status?: string; error?: string } = {}
  try {
    data = (await response.json()) as { status?: string; error?: string }
  } catch {
    throw new VisionApiError('Invalid JSON from vision API', response.status)
  }

  if (!response.ok) {
    throw new VisionApiError(data.error?.trim() || `Vision API failed (${response.status})`, response.status)
  }

  if (data.status !== 'received') {
    throw new VisionApiError('Unexpected vision API response', response.status)
  }
}
