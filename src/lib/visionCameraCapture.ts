/**
 * Vision live-camera capture helpers (#274).
 * Pure/DOM-light utilities — no base64 logging.
 */

export interface VideoFrameReadiness {
  ready: boolean
  reason?: string
  videoWidth: number
  videoHeight: number
  readyState: number
  streamActive: boolean
}

/** HAVE_CURRENT_DATA = 2 — enough for a non-black frame in practice. */
const MIN_READY_STATE = 2

export function isVideoFrameReady(
  video: Pick<HTMLVideoElement, 'videoWidth' | 'videoHeight' | 'readyState'> | null | undefined,
  stream?: MediaStream | null,
): VideoFrameReadiness {
  const videoWidth = video?.videoWidth ?? 0
  const videoHeight = video?.videoHeight ?? 0
  const readyState = video?.readyState ?? 0
  const streamActive = stream == null ? true : Boolean(stream.active)
  if (!video) {
    return { ready: false, reason: 'no_video', videoWidth, videoHeight, readyState, streamActive }
  }
  if (stream && !stream.active) {
    return { ready: false, reason: 'stream_inactive', videoWidth, videoHeight, readyState, streamActive }
  }
  if (stream) {
    const videoTracks = stream.getVideoTracks?.() || []
    if (videoTracks.length === 0) {
      return { ready: false, reason: 'no_video_track', videoWidth, videoHeight, readyState, streamActive }
    }
    if (videoTracks.some((t) => t.readyState !== 'live')) {
      return { ready: false, reason: 'track_not_live', videoWidth, videoHeight, readyState, streamActive }
    }
  }
  if (!(videoWidth > 0 && videoHeight > 0)) {
    return { ready: false, reason: 'no_dimensions', videoWidth, videoHeight, readyState, streamActive }
  }
  if (readyState < MIN_READY_STATE) {
    return { ready: false, reason: 'not_ready', videoWidth, videoHeight, readyState, streamActive }
  }
  return { ready: true, videoWidth, videoHeight, readyState, streamActive }
}

/**
 * Draw the current video frame to canvas and return a JPEG Blob.
 * Keeps the stream alive until after toBlob resolves — caller stops tracks.
 */
export async function captureVideoFrameToJpegBlob(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  stream?: MediaStream | null,
): Promise<{ blob: Blob; width: number; height: number }> {
  const readiness = isVideoFrameReady(video, stream)
  if (!readiness.ready) {
    throw new Error(readiness.reason || 'video_not_ready')
  }

  // One animation frame after readiness so a real painted frame is present.
  await new Promise<void>((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => resolve())
    } else {
      resolve()
    }
  })

  const post = isVideoFrameReady(video, stream)
  if (!post.ready) {
    throw new Error(post.reason || 'video_not_ready_after_frame')
  }
  // Stream must still be alive through drawImage + toBlob (caller stops after).
  if (stream && !stream.active) {
    throw new Error('stream_stopped_before_draw')
  }

  const width = post.videoWidth
  const height = post.videoHeight
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('no_2d_context')

  try {
    ctx.drawImage(video, 0, 0, width, height)
  } catch {
    throw new Error('drawImage_failed')
  }

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((result) => resolve(result), 'image/jpeg', 0.92),
  )
  if (!blob || blob.size <= 0) throw new Error('empty_blob')
  if (stream && !stream.active) {
    throw new Error('stream_stopped_before_blob')
  }
  return { blob, width, height }
}

/** Safe metadata for logs — never image bytes. */
export function summarizeCaptureForLog(input: {
  videoWidth?: number
  videoHeight?: number
  readyState?: number
  blobSize?: number
  blobType?: string
  preparedWidth?: number
  preparedHeight?: number
}): Record<string, string | number | boolean> {
  return {
    videoWidth: input.videoWidth ?? 0,
    videoHeight: input.videoHeight ?? 0,
    readyState: input.readyState ?? 0,
    blobSize: input.blobSize ?? 0,
    blobType: input.blobType ?? '',
    preparedWidth: input.preparedWidth ?? 0,
    preparedHeight: input.preparedHeight ?? 0,
    hasBlob: (input.blobSize ?? 0) > 0,
  }
}
