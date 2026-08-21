/**
 * #335B — Contextual greeting (displayName + local daypart).
 */

import { useChat } from '../../context/ChatContext'
import { formatHomeGreeting } from '../../lib/homeGreeting'

export function ContextGreeting() {
  const { settings } = useChat()
  const displayName = settings.personalization.displayName
  const { base, name } = formatHomeGreeting(displayName)

  return (
    <h1 className="home-greeting type-hero-greeting motion-ink-reveal" data-home="greeting">
      {name ? (
        <>
          {base}, <span className="home-greeting__name">{name}</span>.
        </>
      ) : (
        <>{base}.</>
      )}
    </h1>
  )
}
