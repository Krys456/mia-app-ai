import { Component, type ErrorInfo, type ReactNode } from 'react'
import { getClientBuildId } from '../lib/buildInfo'
import { buildBetaSupportMailto, isPrivacyContactConfigured } from '../lib/betaSupport'
import './AppErrorBoundary.css'

type Props = { children: ReactNode }
type State = { hasError: boolean }

/**
 * #298C — Catch render failures. Never show stack, chat, Memory, or tokens.
 */
export class AppErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: Error, _info: ErrorInfo): void {
    const name = error?.name && typeof error.name === 'string' ? error.name : 'Error'
    // Omit message — may contain user content from render paths.
    console.error(
      '[AppErrorBoundary]',
      JSON.stringify({ name, buildId: getClientBuildId() }),
    )
  }

  private reload = () => {
    window.location.reload()
  }

  render() {
    if (!this.state.hasError) return this.props.children

    const buildId = getClientBuildId()
    const mailto = buildBetaSupportMailto({ surface: 'error-boundary' })

    return (
      <main className="app-error-boundary" role="alert">
        <div className="app-error-boundary__inner">
          <p className="app-error-boundary__brand">ShinkAIdo</p>
          <h1 className="app-error-boundary__title">Qualcosa è andato storto.</h1>
          <p className="app-error-boundary__copy">Ricarica l&apos;app e riprova.</p>
          <div className="app-error-boundary__actions">
            <button type="button" className="app-error-boundary__reload" onClick={this.reload}>
              Ricarica
            </button>
            {mailto && isPrivacyContactConfigured() ? (
              <a className="app-error-boundary__support" href={mailto}>
                Segnala un problema
              </a>
            ) : null}
          </div>
          <p className="app-error-boundary__meta">Beta build: {buildId}</p>
        </div>
      </main>
    )
  }
}
