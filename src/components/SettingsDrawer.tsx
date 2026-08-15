import { useEffect, useId, useRef } from 'react'
import { useChat } from '../context/ChatContext'
import { useTheme } from '../context/ThemeContext'
import { isMemoryManageUiEnabled } from '../lib/memoryManageUi'
import type { PersonalizationSettings } from '../types'
import { ThemeSettings } from './ThemeSettings'
import './SettingsDrawer.css'
import './MemoryToggle.css'

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

interface SettingsDrawerProps {
  onOpenMemory?: () => void
}

export function SettingsDrawer({ onOpenMemory }: SettingsDrawerProps) {
  const {
    settingsOpen,
    closeSettings,
    settings,
    updatePersonalization,
    updateDeveloper,
  } = useChat()
  const { clearPreview } = useTheme()
  const titleId = useId()
  const panelRef = useRef<HTMLElement>(null)
  const wasOpenRef = useRef(false)

  useEffect(() => {
    if (!settingsOpen) {
      // Closing via Escape/scrim/X must drop live theme preview + editor state.
      if (wasOpenRef.current) clearPreview()
      wasOpenRef.current = false
      return
    }

    wasOpenRef.current = true

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        closeSettings()
        return
      }

      if (e.key !== 'Tab' || !panelRef.current) return
      const nodes = [...panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (el) => !el.hasAttribute('disabled') && el.offsetParent !== null,
      )
      if (nodes.length === 0) return
      const first = nodes[0]
      const last = nodes[nodes.length - 1]
      const active = document.activeElement as HTMLElement | null
      if (e.shiftKey && active === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKey)

    const previouslyFocused = document.activeElement as HTMLElement | null
    panelRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus()

    return () => {
      window.removeEventListener('keydown', onKey)
      previouslyFocused?.focus?.()
    }
  }, [settingsOpen, closeSettings, clearPreview])

  const p = settings.personalization
  const developer = settings.developer
  const v2Experimental = developer?.v2Experimental === true

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
        aria-label="Chiudi impostazioni"
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
            <p className="settings-kicker">Personalizzazione</p>
            <h2 id={titleId}>Impostazioni</h2>
          </div>
          <button
            type="button"
            className="settings-close"
            onClick={closeSettings}
            aria-label="Chiudi impostazioni"
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
          <ThemeSettings active={settingsOpen} />

          <div className="settings-divider" role="separator" />

          <section className="settings-memory" aria-labelledby="memory-settings-title">
            <h3 id="memory-settings-title" className="settings-section-title">
              Memoria
            </h3>

            <div className="memory-toggle-row">
              <span className="field__label" id="memory-toggle-label">
                Memoria
              </span>
              <div
                className="memory-toggle"
                role="group"
                aria-labelledby="memory-toggle-label"
              >
                <button
                  type="button"
                  className={`memory-toggle__opt${p.memoryEnabled === false ? ' memory-toggle__opt--active' : ''}`}
                  aria-pressed={p.memoryEnabled === false}
                  onClick={() => set('memoryEnabled', false)}
                >
                  OFF
                </button>
                <button
                  type="button"
                  className={`memory-toggle__opt${p.memoryEnabled !== false ? ' memory-toggle__opt--active' : ''}`}
                  aria-pressed={p.memoryEnabled !== false}
                  onClick={() => set('memoryEnabled', true)}
                >
                  ON
                </button>
              </div>
            </div>

            <p className="settings-note settings-note--tight">
              Se attiva, LAIfe impara in automatico fatti utili a lungo termine. Nessun pulsante in
              chat: tutto avviene in background.
            </p>

            {isMemoryManageUiEnabled() ? (
              <button
                type="button"
                className="settings-link-btn"
                onClick={() => {
                  closeSettings()
                  onOpenMemory?.()
                }}
              >
                Gestisci Memoria
              </button>
            ) : (
              <p className="settings-note settings-note--tight">
                Gestione memorie temporaneamente nascosta in Production (Phase 0). Tornerà con la
                memoria autenticata per utente (Phase 1A).
              </p>
            )}
          </section>

          <div className="settings-divider" role="separator" />

          <section className="settings-developer" aria-labelledby="developer-settings-title">
            <h3 id="developer-settings-title" className="settings-section-title">
              Developer
            </h3>

            <div className="memory-toggle-row">
              <span className="field__label" id="v2-toggle-label">
                LAIfe V2 Experimental
              </span>
              <div
                className="memory-toggle"
                role="group"
                aria-labelledby="v2-toggle-label"
              >
                <button
                  type="button"
                  className={`memory-toggle__opt${!v2Experimental ? ' memory-toggle__opt--active' : ''}`}
                  aria-pressed={!v2Experimental}
                  onClick={() => updateDeveloper({ v2Experimental: false })}
                >
                  OFF
                </button>
                <button
                  type="button"
                  className={`memory-toggle__opt${v2Experimental ? ' memory-toggle__opt--active' : ''}`}
                  aria-pressed={v2Experimental}
                  onClick={() => updateDeveloper({ v2Experimental: true })}
                >
                  ON
                </button>
              </div>
            </div>

            <p className="settings-note settings-note--tight">
              ON seleziona il runtime V2 (<code>engine=v2</code>) e mostra il pannello debug se
              disponibile. OFF seleziona V1. Richiede Developer Mode nel request (
              <code>developerMode: true</code>). Senza Developer Mode, il server usa{' '}
              <code>LAIFE_CONVERSATION_RUNTIME</code> (default V1).
            </p>
          </section>

          <div className="settings-divider" role="separator" />

          <section className="settings-personality" aria-labelledby="personality-title">
            <h3 id="personality-title" className="settings-section-title">
              Assistente
            </h3>

            <label className="field">
              <span className="field__label">Il tuo nome</span>
              <input
                type="text"
                value={p.displayName}
                onChange={(e) => set('displayName', e.target.value)}
                placeholder="Come dovrebbe chiamarti LAIfe?"
                autoComplete="nickname"
              />
            </label>

            <label className="field">
              <span className="field__label">Stile (bias leggero)</span>
              <select
                value={p.personality}
                onChange={(e) =>
                  set('personality', e.target.value as PersonalizationSettings['personality'])
                }
              >
                <option value="automatic">Adattivo — Dynamic Behavior (consigliato)</option>
                <option value="friendly">Lean: calore</option>
                <option value="professional">Lean: sobrietà</option>
                <option value="teacher">Lean: didattica</option>
                <option value="analytical">Lean: analitico</option>
                <option value="motivational">Lean: slancio</option>
              </select>
            </label>
            <p className="settings-note" style={{ marginTop: '-0.35rem' }}>
              LAIfe non usa una personalità fissa: seleziona il comportamento a ogni turno. Questa
              scelta è solo un bias leggero.
            </p>

            <label className="field">
              <span className="field__label">Lunghezza risposte</span>
              <select
                value={p.replyLength}
                onChange={(e) =>
                  set('replyLength', e.target.value as PersonalizationSettings['replyLength'])
                }
              >
                <option value="concise">Concisa</option>
                <option value="balanced">Bilanciata</option>
                <option value="detailed">Dettagliata</option>
              </select>
            </label>

            <label className="field field--row">
              <span className="field__label">Emoji</span>
              <input
                type="checkbox"
                checked={p.useEmojis}
                onChange={(e) => set('useEmojis', e.target.checked)}
              />
            </label>

            <label className="field">
              <span className="field__label">Istruzioni personalizzate</span>
              <textarea
                rows={4}
                value={p.customInstructions}
                onChange={(e) => set('customInstructions', e.target.value)}
                placeholder="Cose che LAIfe dovrebbe sempre tenere a mente…"
              />
            </label>
          </section>

          <p className="settings-note">
            Tema e preferenze assistente si salvano su questo dispositivo. La memoria si può
            spegnere in qualsiasi momento; se è OFF, LAIfe non legge né scrive memorie in chat.
          </p>
        </div>
      </aside>
    </div>
  )
}
