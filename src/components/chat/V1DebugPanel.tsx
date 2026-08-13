import { useMemo, useState } from 'react'
import './V2DebugPanel.css'

const TABS = [
  'Perception',
  'Mind',
  'Planner',
  'Writer',
  'Memory',
  'State',
  'Timing',
] as const

type Tab = (typeof TABS)[number]

interface V1DebugPanelProps {
  debug: Record<string, unknown>
}

function sectionPayload(debug: Record<string, unknown>, tab: Tab): unknown {
  switch (tab) {
    case 'Perception':
      return debug.perception ?? { unavailable: true }
    case 'Mind':
      return debug.mind ?? { unavailable: true }
    case 'Planner':
      return debug.planner ?? { unavailable: true }
    case 'Writer':
      return debug.writer ?? { unavailable: true }
    case 'Memory':
      return debug.memory ?? { unavailable: true }
    case 'State':
      return debug.state ?? { unavailable: true }
    case 'Timing':
      return debug.timing ?? { unavailable: true }
    default:
      return { unavailable: true }
  }
}

export function V1DebugPanel({ debug }: V1DebugPanelProps) {
  const [active, setActive] = useState<Tab | null>(null)
  const engine = typeof debug.engine === 'string' ? debug.engine : 'v1'
  const payload = useMemo(
    () => (active ? sectionPayload(debug, active) : null),
    [active, debug],
  )

  return (
    <aside className="v2-debug" aria-label="LAIfe V1 observability">
      <div className="v2-debug__head">
        <span className="v2-debug__badge">V1 Observability</span>
        <span className="v2-debug__served">engine {engine}</span>
        {typeof debug.error === 'string' ? (
          <span className="v2-debug__decision v2-debug__decision--rewrite">{debug.error}</span>
        ) : null}
      </div>

      <div className="v1-debug__tabs" role="tablist" aria-label="V1 debug sections">
        {TABS.map((tab) => {
          const available = sectionPayload(debug, tab)
          const missing =
            available &&
            typeof available === 'object' &&
            'unavailable' in (available as object)
          return (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={active === tab}
              className={`v1-debug__tab${active === tab ? ' v1-debug__tab--active' : ''}${
                missing ? ' v1-debug__tab--empty' : ''
              }`}
              onClick={() => setActive((cur) => (cur === tab ? null : tab))}
            >
              {tab}
            </button>
          )
        })}
      </div>

      {active ? (
        <details className="v2-debug__section" open>
          <summary className="v2-debug__summary">{active}</summary>
          <pre className="v2-debug__pre">
            {payload == null
              ? 'null'
              : typeof payload === 'string'
                ? payload
                : JSON.stringify(payload, null, 2)}
          </pre>
        </details>
      ) : (
        <p className="v1-debug__hint">Select a panel — observational only; does not change the reply.</p>
      )}
    </aside>
  )
}
