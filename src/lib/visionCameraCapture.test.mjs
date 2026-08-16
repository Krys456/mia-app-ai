/**
 * #274 follow-up — camera capture readiness / no black-frame gates.
 * Run: node --test src/lib/visionCameraCapture.test.mjs
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

async function loadCapture() {
  const esbuild = await import('esbuild')
  const outfile = path.join(os.tmpdir(), `vision-cap-${Date.now()}.mjs`)
  await esbuild.build({
    entryPoints: [path.resolve('src/lib/visionCameraCapture.ts')],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    target: 'es2022',
    packages: 'external',
  })
  return import(pathToFileURL(outfile).href)
}

const {
  isVideoFrameReady,
  captureVideoFrameToJpegBlob,
  summarizeCaptureForLog,
} = await loadCapture()

function fakeStream({ active = true, trackReadyState = 'live' } = {}) {
  return {
    active,
    getVideoTracks() {
      return [{ readyState: trackReadyState, getSettings: () => ({ width: 640, height: 480 }) }]
    },
  }
}

describe('visionCameraCapture readiness (#274 follow-up)', () => {
  it('blocks capture until metadata + nonzero dimensions + readyState + live stream', () => {
    assert.equal(
      isVideoFrameReady(
        { readyState: 0, videoWidth: 0, videoHeight: 0 },
        fakeStream(),
      ).ready,
      false,
    )
    assert.equal(
      isVideoFrameReady(
        { readyState: 2, videoWidth: 1280, videoHeight: 0 },
        fakeStream(),
      ).ready,
      false,
    )
    assert.equal(
      isVideoFrameReady(
        { readyState: 2, videoWidth: 1280, videoHeight: 720 },
        fakeStream({ active: false }),
      ).ready,
      false,
    )
    assert.equal(
      isVideoFrameReady(
        { readyState: 2, videoWidth: 1280, videoHeight: 720 },
        fakeStream({ trackReadyState: 'ended' }),
      ).ready,
      false,
    )
    assert.equal(
      isVideoFrameReady(
        { readyState: 2, videoWidth: 1280, videoHeight: 720 },
        fakeStream(),
      ).ready,
      true,
    )
  })

  it('capture uses nonzero videoWidth/videoHeight (no 1280 fallback)', async () => {
    const src = fs.readFileSync(path.resolve('src/lib/visionCameraCapture.ts'), 'utf8')
    assert.equal(src.includes('|| 1280'), false)
    assert.equal(src.includes('|| 720'), false)

    await assert.rejects(
      () =>
        captureVideoFrameToJpegBlob(
          { readyState: 2, videoWidth: 0, videoHeight: 0 },
          { width: 0, height: 0, getContext: () => ({ drawImage() {} }) },
          fakeStream(),
        ),
      /no_dimensions|video_not_ready/,
    )
  })

  it('stream must remain alive through drawImage/toBlob', async () => {
    const stream = fakeStream()
    let drawCalled = false
    const video = {
      readyState: 4,
      videoWidth: 32,
      videoHeight: 24,
    }
    const canvas = {
      width: 0,
      height: 0,
      getContext() {
        return {
          drawImage() {
            drawCalled = true
            assert.equal(stream.active, true, 'stream must be alive during drawImage')
          },
        }
      },
      toBlob(cb) {
        assert.equal(stream.active, true, 'stream must be alive during toBlob')
        // Minimal valid-ish blob
        cb(new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' }))
      },
    }

    const result = await captureVideoFrameToJpegBlob(video, canvas, stream)
    assert.equal(drawCalled, true)
    assert.ok(result.blob.size > 0)
    assert.equal(result.width, 32)
    assert.equal(result.height, 24)
    assert.equal(stream.active, true)
  })

  it('produced Blob nonempty; summarizeCapture never logs base64', () => {
    const summary = summarizeCaptureForLog({
      videoWidth: 640,
      videoHeight: 480,
      readyState: 4,
      blobSize: 12000,
      blobType: 'image/jpeg',
      preparedWidth: 640,
      preparedHeight: 480,
    })
    const encoded = JSON.stringify(summary)
    assert.equal(encoded.includes('base64'), false)
    assert.equal(encoded.includes('data:image'), false)
    assert.ok(summary.videoWidth > 0)
    assert.ok(summary.hasBlob)
  })

  it('Vision page gates Scatta until videoReady and attaches after mount', () => {
    const vision = fs.readFileSync(path.resolve('src/pages/Vision.tsx'), 'utf8')
    assert.match(vision, /captureVideoFrameToJpegBlob/)
    assert.match(vision, /isVideoFrameReady/)
    assert.match(vision, /canCapture = phase === 'camera' && videoReady/)
    assert.match(vision, /setCameraSession/)
    assert.match(vision, /setPhase\('camera'\)/)
    assert.match(vision, /video\.srcObject = stream/)
    assert.match(vision, /Keep stream alive until drawImage/)
    assert.doesNotMatch(vision, /console\.(log|info|warn|error)\([^)]*dataUrl|base64/)
    assert.match(vision, /prepared\.width > 0 && prepared\.height > 0/)
    assert.match(vision, /setPreparedAttachment\(att, prepared\.previewUrl\)/)
  })
})
