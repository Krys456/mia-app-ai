import { useEffect, useId, useRef } from 'react'
import { useChat } from '../context/ChatContext'
import type { PersonalizationSettings } from '../types'
import { ThemeSettings } from './ThemeSettings'
import './SettingsDrawer.css'

export function SettingsDrawer() {
  const {
    settingsOpen,
    closeSettings,
    settings,
    updatePersonalization,
  } = useChat()
  const titleId = useId()
  const panelRef = useRef<HTMLElement>(null)

  useEffect(() => {
    if (!settingsOpen) return

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeSettings()
    }
    window.addEventListener('keydown', onKey)

    const previouslyFocused = document.activeElement as HTMLElement | null
    panelRef.current?.querySelector<HTMLElement>('button, input, select, textarea')?.focus()

    return () => {
      window.removeEventListener('keydown', onKey)
      previouslyFocused?.focus?.()
    }
  }, [settingsOpen, closeSettings])

  const p = settings.personalization

  const set = <K extends keyof PersonalizationSettings>(
    key: K,
    value: PersonalizationSettings[K],
  ) => updatePersonalization({ [key]: value })

  return (
    <div
      className={`settings-root${settingsOpen ? ' settings-root--open' : ''}`}
      aria-hidden={!settingsOpen}
    >
      <button
        type="button"
        className="settings-scrim"
        tabIndex={settingsOpen ? 0 : -1}
        aria-label="Close settings"
        onClick={closeSettings}
      />

      <aside
        ref={panelRef}
        className="settings-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        inert={!settingsOpen ? true : undefined}
      >
        <div className="settings-drawer__head">
          <div>
            <p className="settings-kicker">Personalization</p>
            <h2 id={titleId}>Settings</h2>
          </div>
          <button
            type="button"
            className="settings-close"
            onClick={closeSettings}
            aria-label="Close settings"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M6 6l12 12M18 6L6 18"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        <div className="settings-drawer__body">
          <ThemeSettings />

          <div className="settings-divider" role="separator" />

          <section className="settings-personality" aria-labelledby="personality-title">
            <h3 id="personality-title" className="settings-section-title">
              Assistant
            </h3>

            <label className="field">
              <span className="field__label">Your name</span>
              <input
                type="text"
                value={p.displayName}
                onChange={(e) => set('displayName', e.target.value)}
                placeholder="How should LAIfe call you?"
                autoComplete="nickname"
              />
            </label>

            <label className="field">
              <span className="field__label">Tone</span>
              <select
                value={p.tone}
                onChange={(e) => set('tone', e.target.value as PersonalizationSettings['tone'])}
              >
                <option value="warm">Warm &amp; encouraging</option>
                <option value="playful">Playful</option>
                <option value="calm">Calm</option>
                <option value="professional">Professional</option>
              </select>
            </label>

            <label className="field">
              <span className="field__label">Reply length</span>
              <select
                value={p.replyLength}
                onChange={(e) =>
                  set('replyLength', e.target.value as PersonalizationSettings['replyLength'])
                }
              >
                <option value="concise">Concise</option>
                <option value="balanced">Balanced</option>
                <option value="detailed">Detailed</option>
              </select>
            </label>

            <label className="field field--row">
              <span className="field__label">Use emojis</span>
              <input
                type="checkbox"
                checked={p.useEmojis}
                onChange={(e) => set('useEmojis', e.target.checked)}
              />
            </label>

            <label className="field">
              <span className="field__label">Custom instructions</span>
              <textarea
                rows={4}
                value={p.customInstructions}
                onChange={(e) => set('customInstructions', e.target.value)}
                placeholder="Anything LAIfe should always keep in mind…"
              />
            </label>
          </section>

          <p className="settings-note">
            Theme and assistant preferences save on this device. Themes reshape the whole interface;
            personality settings shape LAIfe’s system prompt for future replies.
          </p>
        </div>
      </aside>
    </div>
  )
}
