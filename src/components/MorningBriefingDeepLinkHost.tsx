/**
 * #334D1 — Deep-link host for ?briefing=morning → existing #334C briefing path.
 *
 * Waits for auth bootstrap + chat idle, then hands off exactly once via
 * sendMessage('Briefing'). Consumes the intent only after successful handoff.
 * Also accepts SW postMessage when an existing window is focused without a
 * full navigation (notificationclick existing-client path).
 */

import { useEffect, useState } from 'react'
import { useChat } from '../context/ChatContext'
import { useAuthBootstrap } from '../hooks/useAuthBootstrap'
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

  // Capture URL marker / SW message → pending (do not strip URL yet).
  useEffect(() => {
    const bump = () => setIntentEpoch((n) => n + 1)

    if (captureMorningBriefingIntent()) bump()

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
      if (captureMorningBriefingIntent()) bump()
    }
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('focus', onVis)

    return () => {
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
    completeMorningBriefingHandoff()
  }, [auth.status, sendMessage, isThinking, isStreaming, intentEpoch])

  return null
}
