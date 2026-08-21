/**
 * #334D1/#334D1A — Deep-link host for morning briefing → existing #334C path.
 *
 * Intent sources (any one is enough):
 * - URL ?briefing=morning
 * - SW postMessage
 * - durable Cache API marker (PWA-safe when openWindow drops the query)
 *
 * Waits for auth + chat idle, hands off once via sendMessage('Briefing'),
 * then clears durable marker + URL only after successful accept.
 */

import { useEffect, useState } from 'react'
import { useChat } from '../context/ChatContext'
import { useAuthBootstrap } from '../hooks/useAuthBootstrap'
import { readMorningBriefingDurableIntent } from '../lib/morningBriefingDurableIntent'
import {
  MORNING_BRIEFING_SW_MESSAGE_TYPE,
  captureMorningBriefingIntent,
  claimMorningBriefingHandoff,
  completeMorningBriefingHandoff,
  hasPendingMorningBriefingIntent,
  releaseMorningBriefingHandoffClaim,
} from '../lib/morningBriefingSchedule'

function isMorningBriefingSwMessage(data: unknown): boolean {
  if (!data || typeof data !== 'object') return false
  const msg = data as { type?: unknown; intent?: unknown }
  return msg.type === MORNING_BRIEFING_SW_MESSAGE_TYPE && msg.intent === 'morning'
}

export function MorningBriefingDeepLinkHost() {
  const { sendMessage, isThinking, isStreaming } = useChat()
  const auth = useAuthBootstrap()
  const [intentEpoch, setIntentEpoch] = useState(0)

  // Capture URL / SW message / durable Cache marker → pending (do not clear yet).
  useEffect(() => {
    let cancelled = false
    const bump = () => {
      if (!cancelled) setIntentEpoch((n) => n + 1)
    }

    const captureAll = () => {
      if (captureMorningBriefingIntent()) bump()
      void readMorningBriefingDurableIntent().then((marker) => {
        if (cancelled || !marker) return
        if (captureMorningBriefingIntent({ fromDurable: true })) bump()
      })
    }

    captureAll()

    const onMessage = (event: MessageEvent) => {
      if (!isMorningBriefingSwMessage(event.data)) return
      if (captureMorningBriefingIntent({ fromMessage: true })) bump()
    }

    const onSwMessage = (event: MessageEvent) => {
      if (!isMorningBriefingSwMessage(event.data)) return
      if (captureMorningBriefingIntent({ fromMessage: true })) bump()
    }

    window.addEventListener('message', onMessage)
    let sw: ServiceWorkerContainer | null = null
    try {
      sw = navigator.serviceWorker ?? null
      sw?.addEventListener('message', onSwMessage)
    } catch {
      sw = null
    }

    const onVis = () => {
      if (document.visibilityState !== 'visible') return
      captureAll()
    }
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('focus', onVis)

    return () => {
      cancelled = true
      window.removeEventListener('message', onMessage)
      sw?.removeEventListener('message', onSwMessage)
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('focus', onVis)
    }
  }, [])

  // Handoff once auth + chat are ready; consume only after sendMessage accepts.
  useEffect(() => {
    const authSettled =
      auth.status === 'ready' || auth.status === 'error' || auth.status === 'skipped'
    if (!authSettled) return
    if (isThinking || isStreaming) return
    if (!hasPendingMorningBriefingIntent()) return
    if (!claimMorningBriefingHandoff()) return

    const accepted = sendMessage('Briefing')
    if (!accepted) {
      releaseMorningBriefingHandoffClaim()
      return
    }
    // Clears session done + URL + durable Cache marker.
    completeMorningBriefingHandoff()
  }, [auth.status, sendMessage, isThinking, isStreaming, intentEpoch])

  return null
}
