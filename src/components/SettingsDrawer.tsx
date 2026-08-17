import { useEffect, useId, useRef } from 'react'
import { useChat } from '../context/ChatContext'
import { useTheme } from '../context/ThemeContext'
import { isMemoryManageUiEnabled } from '../lib/memoryManageUi'
import {
  MEMORY_SETTINGS_COPY,
  PRIVACY_DISCLOSURE,
  buildBetaContactLine,
} from '../lib/privacyCopy'
import { getClientBuildId } from '../lib/buildInfo'
import type { AppearanceFontFamily, AppearanceFontSize, PersonalizationSettings } from '../types'
import { ThemeSettings } from './ThemeSettings'
import './SettingsDrawer.css'
import './MemoryToggle.css'

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

interface SettingsDrawerProps {
  onOpenMemory?: () => void
  onOpenPrivacy?: () => void
}

export function SettingsDrawer({ onOpenMemory, onOpenPrivacy }: SettingsDrawerProps) {
  const {
    settingsOpen,
    closeSettings,
    settings,
    updatePersonalization,
    updateAppearance,
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
  const appearance = settings.appearance

  const set = <K extends keyof PersonalizationSettings>(
    key: K,
    value: PersonalizationSettings[K],
  ) => updatePersonalization({ [key]: value })

  const setFontSize = (fontSize: AppearanceFontSize) => updateAppearance({ fontSize })
  const setFontFamily = (fontFamily: AppearanceFontFamily) => updateAppearance({ fontFamily })

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
            <p className="settings-kicker">ShinkAIdo</p>
            <h2 id={titleId}>Impostazioni ShinkAIdo</h2>
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

          <section className="settings-appearance" aria-labelledby="appearance-settings-title">
            <h3 id="appearance-settings-title" className="settings-section-title">
              Aspetto
            </h3>

            <div className="appearance-row">
              <span className="field__label" id="appearance-size-label">
                Dimensione testo
              </span>
              <div
                className="appearance-toggle"
                role="group"
                aria-labelledby="appearance-size-label"
              >
                {(
                  [
                    ['small', 'Piccolo'],
                    ['default', 'Predefinito'],
                    ['large', 'Grande'],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className={`appearance-toggle__opt${appearance.fontSize === value ? ' appearance-toggle__opt--active' : ''}`}
                    aria-pressed={appearance.fontSize === value}
                    onClick={() => setFontSize(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="appearance-row">
              <span className="field__label" id="appearance-font-label">
                Carattere
              </span>
              <div
                className="appearance-toggle"
                role="group"
                aria-labelledby="appearance-font-label"
              >
                {(
                  [
                    ['outfit', 'Outfit'],
                    ['system', 'Sistema'],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className={`appearance-toggle__opt${appearance.fontFamily === value ? ' appearance-toggle__opt--active' : ''}`}
                    aria-pressed={appearance.fontFamily === value}
                    onClick={() => setFontFamily(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <p className="settings-note settings-note--tight">
              Solo lettura in chat su questo dispositivo. Non viene inviato a Core né salvato come
              Memoria.
            </p>
          </section>

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
              {p.memoryEnabled !== false ? MEMORY_SETTINGS_COPY.on : MEMORY_SETTINGS_COPY.off}
            </p>

            <p className="settings-note settings-note--tight">{MEMORY_SETTINGS_COPY.delete}</p>

            <p className="settings-note settings-note--tight settings-note--warn" role="note">
              {PRIVACY_DISCLOSURE.sensitiveWarning}
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
            ) : null}
          </section>

          <div className="settings-divider" role="separator" />

          <section className="settings-privacy" aria-labelledby="privacy-settings-title">
            <h3 id="privacy-settings-title" className="settings-section-title">
              Privacy e dati
            </h3>
            <p className="settings-note settings-note--tight">
              Come funzionano chat, Memoria, elaborazione AI e la sessione su questo dispositivo
              nella Closed Beta.
            </p>
            <p className="settings-note settings-note--tight">
              Closed Beta · Build beta: {getClientBuildId()}
            </p>
            <button
              type="button"
              className="settings-link-btn"
              onClick={() => {
                closeSettings()
                onOpenPrivacy?.()
              }}
            >
              Informazioni su privacy e dati
            </button>
            {isMemoryManageUiEnabled() ? (
              <button
                type="button"
                className="settings-link-btn"
                onClick={() => {
                  closeSettings()
                  onOpenMemory?.()
                }}
              >
                Rivedi o elimina la Memoria
              </button>
            ) : null}
            <p className="settings-note settings-note--tight">{buildBetaContactLine()}</p>
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
                placeholder="Come dovrebbe chiamarti ShinkAIdo?"
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
              ShinkAIdo non usa una personalità fissa: seleziona il comportamento a ogni turno. Questa
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
                placeholder="Cose che ShinkAIdo dovrebbe sempre tenere a mente…"
              />
            </label>
          </section>

          <p className="settings-note">
            Tema e preferenze assistente si salvano su questo dispositivo. Memoria OFF interrompe
            l’apprendimento automatico e il richiamo quotidiano; i ricordi salvati restano finché
            non li elimini.
          </p>
        </div>
      </aside>
    </div>
  )
}
