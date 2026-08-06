import { useEffect, useId, useMemo, useState } from 'react'
import {
  cloneColors,
  isValidHex,
  normalizeHex,
  THEME_COLOR_FIELDS,
  type ThemeColors,
  type ThemeDefinition,
} from '../lib/themes'
import { useTheme } from '../context/ThemeContext'
import './ThemeSettings.css'

function ThemeSwatch({ colors }: { colors: ThemeColors }) {
  return (
    <span className="theme-swatch" aria-hidden="true">
      <span style={{ background: colors.bg }} />
      <span style={{ background: colors.accent }} />
      <span style={{ background: colors.accentTertiary }} />
      <span style={{ background: colors.accentQuaternary }} />
    </span>
  )
}

function ThemeCard({
  theme,
  active,
  onSelect,
  onEdit,
  onDelete,
}: {
  theme: ThemeDefinition
  active: boolean
  onSelect: () => void
  onEdit?: () => void
  onDelete?: () => void
}) {
  return (
    <div className={`theme-card${active ? ' theme-card--active' : ''}`}>
      <button type="button" className="theme-card__select" onClick={onSelect}>
        <ThemeSwatch colors={theme.colors} />
        <span className="theme-card__meta">
          <span className="theme-card__name">
            {theme.name}
            {theme.official ? <span className="theme-badge">Official</span> : null}
            {active ? <span className="theme-badge theme-badge--active">Active</span> : null}
          </span>
          <span className="theme-card__desc">{theme.description}</span>
        </span>
      </button>
      {!theme.builtin && (onEdit || onDelete) ? (
        <div className="theme-card__actions">
          {onEdit ? (
            <button type="button" className="theme-mini-btn" onClick={onEdit}>
              Edit
            </button>
          ) : null}
          {onDelete ? (
            <button type="button" className="theme-mini-btn theme-mini-btn--danger" onClick={onDelete}>
              Delete
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function CustomThemeEditor({
  initial,
  mode,
  onCancel,
  onSave,
  onPreview,
}: {
  initial: ThemeDefinition
  mode: 'create' | 'edit'
  onCancel: () => void
  onSave: (theme: ThemeDefinition) => void
  onPreview: (theme: ThemeDefinition) => void
}) {
  const nameId = useId()
  const [draft, setDraft] = useState<ThemeDefinition>(() => ({
    ...initial,
    colors: cloneColors(initial.colors),
  }))
  const [hexDrafts, setHexDrafts] = useState<Record<keyof ThemeColors, string>>(() =>
    Object.fromEntries(
      THEME_COLOR_FIELDS.map(({ key }) => [key, initial.colors[key]]),
    ) as Record<keyof ThemeColors, string>,
  )

  useEffect(() => {
    onPreview(draft)
  }, [draft, onPreview])

  const setColor = (key: keyof ThemeColors, value: string) => {
    setHexDrafts((prev) => ({ ...prev, [key]: value }))
    if (!isValidHex(value)) return
    const normalized = normalizeHex(value)
    setDraft((prev) => ({
      ...prev,
      colors: { ...prev.colors, [key]: normalized },
    }))
  }

  const inferredScheme: ThemeDefinition['colorScheme'] = useMemo(() => {
    const bg = draft.colors.bg.replace('#', '')
    const full =
      bg.length === 3
        ? bg
            .split('')
            .map((c) => c + c)
            .join('')
        : bg
    if (!/^[0-9a-fA-F]{6}$/.test(full)) return draft.colorScheme
    const r = parseInt(full.slice(0, 2), 16)
    const g = parseInt(full.slice(2, 4), 16)
    const b = parseInt(full.slice(4, 6), 16)
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
    return luminance > 0.62 ? 'light' : 'dark'
  }, [draft.colors.bg, draft.colorScheme])

  const canSave = draft.name.trim().length > 0 && THEME_COLOR_FIELDS.every(({ key }) => isValidHex(hexDrafts[key]))

  return (
    <div className="theme-creator">
      <div className="theme-creator__head">
        <h3>{mode === 'edit' ? 'Edit custom theme' : 'Create custom theme'}</h3>
        <p>Pick your colors — changes preview live across the app.</p>
      </div>

      <label className="field" htmlFor={nameId}>
        <span className="field__label">Theme name</span>
        <input
          id={nameId}
          type="text"
          value={draft.name}
          onChange={(e) => setDraft((prev) => ({ ...prev, name: e.target.value }))}
          placeholder="My neon night"
          maxLength={40}
        />
      </label>

      <label className="field">
        <span className="field__label">Appearance mode</span>
        <select
          value={draft.colorScheme}
          onChange={(e) =>
            setDraft((prev) => ({
              ...prev,
              colorScheme: e.target.value as ThemeDefinition['colorScheme'],
            }))
          }
        >
          <option value="dark">Dark</option>
          <option value="light">Light</option>
        </select>
        <span className="field__hint">Suggested from background: {inferredScheme}</span>
      </label>

      <div className="theme-color-grid">
        {THEME_COLOR_FIELDS.map(({ key, label }) => (
          <label key={key} className="theme-color-field">
            <span className="field__label">{label}</span>
            <span className="theme-color-field__row">
              <input
                type="color"
                value={isValidHex(hexDrafts[key]) ? normalizeHex(hexDrafts[key]) : draft.colors[key]}
                onChange={(e) => setColor(key, e.target.value)}
                aria-label={`${label} color picker`}
              />
              <input
                type="text"
                value={hexDrafts[key]}
                onChange={(e) => setColor(key, e.target.value)}
                spellCheck={false}
                aria-label={`${label} hex value`}
              />
            </span>
          </label>
        ))}
      </div>

      <div className="theme-creator__preview">
        <ThemeSwatch colors={draft.colors} />
        <span
          className="theme-creator__gradient"
          style={{
            background: `linear-gradient(115deg, ${draft.colors.accent}, ${draft.colors.accentSecondary}, ${draft.colors.accentTertiary}, ${draft.colors.accentQuaternary})`,
          }}
        />
      </div>

      <div className="theme-creator__actions">
        <button type="button" className="theme-btn theme-btn--ghost" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="theme-btn theme-btn--primary"
          disabled={!canSave}
          onClick={() =>
            onSave({
              ...draft,
              name: draft.name.trim(),
              colorScheme: draft.colorScheme,
              builtin: false,
              official: false,
            })
          }
        >
          Save theme
        </button>
      </div>
    </div>
  )
}

export function ThemeSettings() {
  const {
    activeTheme,
    builtinThemes,
    customThemes,
    setActiveTheme,
    saveCustomTheme,
    deleteCustomTheme,
    createCustomThemeFromActive,
    previewTheme,
    clearPreview,
    resetToOfficial,
  } = useTheme()

  const [editing, setEditing] = useState<{
    theme: ThemeDefinition
    mode: 'create' | 'edit'
  } | null>(null)

  const openCreator = () => {
    setEditing({ theme: createCustomThemeFromActive(), mode: 'create' })
  }

  const openEditor = (theme: ThemeDefinition) => {
    setEditing({
      theme: { ...theme, colors: cloneColors(theme.colors) },
      mode: 'edit',
    })
  }

  const closeEditor = () => {
    setEditing(null)
    clearPreview()
  }

  if (editing) {
    return (
      <CustomThemeEditor
        initial={editing.theme}
        mode={editing.mode}
        onCancel={closeEditor}
        onPreview={previewTheme}
        onSave={(theme) => {
          saveCustomTheme(theme)
          setEditing(null)
        }}
      />
    )
  }

  return (
    <section className="theme-settings" aria-labelledby="theme-settings-title">
      <div className="theme-settings__intro">
        <h3 id="theme-settings-title">Theme</h3>
        <p>
          Default is the official <strong>LAIfe Theme</strong>. Choose a built-in look or create your
          own palette.
        </p>
      </div>

      <div className="theme-settings__toolbar">
        <button type="button" className="theme-btn theme-btn--primary" onClick={openCreator}>
          Create custom theme
        </button>
        {activeTheme.id !== 'laife' ? (
          <button type="button" className="theme-btn theme-btn--ghost" onClick={resetToOfficial}>
            Reset to LAIfe
          </button>
        ) : null}
      </div>

      <div className="theme-section">
        <h4 className="theme-section__title">Built-in themes</h4>
        <div className="theme-list">
          {builtinThemes.map((theme) => (
            <ThemeCard
              key={theme.id}
              theme={theme}
              active={activeTheme.id === theme.id}
              onSelect={() => setActiveTheme(theme.id)}
            />
          ))}
        </div>
      </div>

      <div className="theme-section">
        <h4 className="theme-section__title">Your custom themes</h4>
        {customThemes.length === 0 ? (
          <p className="theme-empty">
            No custom themes yet. Start from the active palette and personalize every color.
          </p>
        ) : (
          <div className="theme-list">
            {customThemes.map((theme) => (
              <ThemeCard
                key={theme.id}
                theme={theme}
                active={activeTheme.id === theme.id}
                onSelect={() => setActiveTheme(theme.id)}
                onEdit={() => openEditor(theme)}
                onDelete={() => {
                  if (window.confirm(`Delete “${theme.name}”?`)) deleteCustomTheme(theme.id)
                }}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
