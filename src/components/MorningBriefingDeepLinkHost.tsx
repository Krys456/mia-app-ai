/**
 * #334D1 — Deep-link host for ?briefing=morning → existing #334C briefing path.
 */

import { useEffect, useRef } from 'react'
import { useChat } from '../context/ChatContext'
import { consumeMorningBriefingDeepLink } from '../lib/morningBriefingSchedule'

export function MorningBriefingDeepLinkHost() {
  const { sendMessage, isThinking, isStreaming } = useChat()
  const firedRef = useRef(false)

  useEffect(() => {
    if (firedRef.current) return
    if (isThinking || isStreaming) return
    if (typeof window === 'undefined') return
    if (!consumeMorningBriefingDeepLink(window.location.search)) return
    firedRef.current = true
    // Existing deterministic briefing intent — never routes through chat Core.
    sendMessage('Briefing')
  }, [sendMessage, isThinking, isStreaming])

  return null
}
