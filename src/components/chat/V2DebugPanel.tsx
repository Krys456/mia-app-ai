import type { V2DebugInfo } from '../../types'
import './V2DebugPanel.css'

interface V2DebugPanelProps {
  debug: V2DebugInfo
}

function Section({ title, value }: { title: string; value: unknown }) {
  if (value == null) return null
  const text =
    typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  return (
    <details className="v2-debug__section" open={title === 'Score' || title === 'PASS / REWRITE'}>
      <summary className="v2-debug__summary">{title}</summary>
      <pre className="v2-debug__pre">{text}</pre>
    </details>
  )
}

export function V2DebugPanel({ debug }: V2DebugPanelProps) {
  const decision = debug.reviewDecision || debug.reviewer?.decision
  const score =
    typeof debug.score === 'number'
      ? debug.score
      : typeof debug.reviewer?.score === 'object' &&
          debug.reviewer.score &&
          typeof (debug.reviewer.score as { overall?: unknown }).overall === 'number'
        ? (debug.reviewer.score as { overall: number }).overall
        : undefined

  return (
    <aside className="v2-debug" aria-label="LAIfe V2 debug">
      <div className="v2-debug__head">
        <span className="v2-debug__badge">V2 Experimental</span>
        <span
          className={`v2-debug__served${
            debug.servedBy === 'v1-fallback' ? ' v2-debug__served--fallback' : ''
          }`}
        >
          {debug.servedBy === 'v2' ? 'served by V2' : 'fallback → V1'}
        </span>
        {typeof decision === 'string' ? (
          <span
            className={`v2-debug__decision${
              decision === 'REWRITE' ? ' v2-debug__decision--rewrite' : ''
            }`}
          >
            {decision}
          </span>
        ) : null}
        {typeof score === 'number' ? (
          <span className="v2-debug__score">score {score.toFixed(2)}</span>
        ) : null}
      </div>

      {debug.error ? (
        <p className="v2-debug__error">Fallback error: {debug.error}</p>
      ) : null}

      <Section title="Perception" value={debug.perception} />
      <Section title="Mind" value={debug.decision} />
      <Section title="Planner" value={debug.plan} />
      <Section title="Writer" value={debug.writer} />
      <Section title="Reviewer" value={debug.reviewer} />
      <Section title="Timing" value={debug.timing} />
      <Section
        title="Score"
        value={typeof score === 'number' ? { overall: score } : undefined}
      />
      <Section
        title="PASS / REWRITE"
        value={typeof decision === 'string' ? decision : undefined}
      />
    </aside>
  )
}
