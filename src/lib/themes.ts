export type ColorScheme = 'dark' | 'light'

/** Editable color stops that fully define a theme palette. */
export interface ThemeColors {
  bg: string
  surface: string
  surface2: string
  text: string
  textMuted: string
  accent: string
  accentSecondary: string
  accentTertiary: string
  accentQuaternary: string
}

export interface ThemeDefinition {
  id: string
  name: string
  description: string
  builtin: boolean
  official?: boolean
  colorScheme: ColorScheme
  colors: ThemeColors
}

export type BuiltinThemeId =
  | 'the-way-washi'
  | 'the-way-sumi'
  | 'laife'
  | 'dark'
  | 'light'
  | 'amoled'
  | 'ocean'
  | 'forest'
  | 'sunset'
  | 'royal'
  | 'cyber'
  | 'minimal'
  | 'midnight'

/** Official ShinkAIdo default for fresh installs / reset-to-official. */
export const DEFAULT_THEME_ID: BuiltinThemeId = 'the-way-washi'
export const OFFICIAL_THEME_ID: BuiltinThemeId = DEFAULT_THEME_ID

export function isTheWayThemeId(id: string): boolean {
  return id === 'the-way-washi' || id === 'the-way-sumi'
}

export const BUILTIN_THEMES: ThemeDefinition[] = [
  {
    id: 'the-way-washi',
    name: 'The Way — Washi',
    description: 'ShinkAIdo official — warm ivory, sumi text, vermilion accent',
    builtin: true,
    official: true,
    colorScheme: 'light',
    colors: {
      bg: '#F5F0E6',
      surface: '#FFFBF5',
      surface2: '#EDE6DA',
      text: '#1C1916',
      textMuted: '#6B645C',
      accent: '#C23B2A',
      accentSecondary: '#9E2F22',
      accentTertiary: '#D45A4A',
      accentQuaternary: '#A67C52',
    },
  },
  {
    id: 'the-way-sumi',
    name: 'The Way — Sumi',
    description: 'ShinkAIdo dark — warm ink surfaces with vermilion accent',
    builtin: true,
    colorScheme: 'dark',
    colors: {
      bg: '#100E0C',
      surface: '#1A1613',
      surface2: '#27221E',
      text: '#F5F0E8',
      textMuted: '#A3998E',
      accent: '#D94A3A',
      accentSecondary: '#C23B2A',
      accentTertiary: '#E07A6E',
      accentQuaternary: '#B8956A',
    },
  },
  {
    id: 'laife',
    name: 'LAIfe Theme',
    description: 'Classic neon — black with blue, cyan, purple & pink',
    builtin: true,
    colorScheme: 'dark',
    colors: {
      bg: '#000000',
      surface: '#111111',
      surface2: '#222222',
      text: '#ffffff',
      textMuted: '#a8a8b3',
      accent: '#2b98ff',
      accentSecondary: '#1c84e9',
      accentTertiary: '#e20dc4',
      accentQuaternary: '#ef08a1',
    },
  },
  {
    id: 'dark',
    name: 'Dark',
    description: 'Neutral charcoal with cool blue accents',
    builtin: true,
    colorScheme: 'dark',
    colors: {
      bg: '#0f1115',
      surface: '#171a21',
      surface2: '#232833',
      text: '#e8eaef',
      textMuted: '#9aa3b2',
      accent: '#5b8cff',
      accentSecondary: '#3d6ef0',
      accentTertiary: '#7aa2ff',
      accentQuaternary: '#a8c0ff',
    },
  },
  {
    id: 'light',
    name: 'Light',
    description: 'Clean daylight surfaces with soft blue accents',
    builtin: true,
    colorScheme: 'light',
    colors: {
      bg: '#f4f6fa',
      surface: '#ffffff',
      surface2: '#e8ecf3',
      text: '#141820',
      textMuted: '#5c6678',
      accent: '#2f6fed',
      accentSecondary: '#1f57c8',
      accentTertiary: '#5b8cff',
      accentQuaternary: '#8aafff',
    },
  },
  {
    id: 'amoled',
    name: 'AMOLED Black',
    description: 'True black with crisp white and electric accents',
    builtin: true,
    colorScheme: 'dark',
    colors: {
      bg: '#000000',
      surface: '#0a0a0a',
      surface2: '#161616',
      text: '#f5f5f5',
      textMuted: '#8e8e8e',
      accent: '#00e5ff',
      accentSecondary: '#00b8d4',
      accentTertiary: '#76ff03',
      accentQuaternary: '#ffffff',
    },
  },
  {
    id: 'ocean',
    name: 'Ocean Blue',
    description: 'Deep sea navy with turquoise highlights',
    builtin: true,
    colorScheme: 'dark',
    colors: {
      bg: '#04131f',
      surface: '#0a1e2e',
      surface2: '#12344a',
      text: '#e6f4ff',
      textMuted: '#7fa8c4',
      accent: '#22c1ee',
      accentSecondary: '#0ea5e9',
      accentTertiary: '#38bdf8',
      accentQuaternary: '#67e8f9',
    },
  },
  {
    id: 'forest',
    name: 'Forest Green',
    description: 'Mossy greens with soft emerald accents',
    builtin: true,
    colorScheme: 'dark',
    colors: {
      bg: '#07140d',
      surface: '#0d1f15',
      surface2: '#173524',
      text: '#e8f5ec',
      textMuted: '#8aab96',
      accent: '#34d399',
      accentSecondary: '#10b981',
      accentTertiary: '#6ee7b7',
      accentQuaternary: '#a7f3d0',
    },
  },
  {
    id: 'sunset',
    name: 'Sunset Orange',
    description: 'Warm dusk tones with amber and coral',
    builtin: true,
    colorScheme: 'dark',
    colors: {
      bg: '#160b08',
      surface: '#22110c',
      surface2: '#3a1c12',
      text: '#fff4ec',
      textMuted: '#c4a090',
      accent: '#ff8a3d',
      accentSecondary: '#f97316',
      accentTertiary: '#fb7185',
      accentQuaternary: '#fbbf24',
    },
  },
  {
    id: 'royal',
    name: 'Royal Purple',
    description: 'Regal violet with soft lavender accents',
    builtin: true,
    colorScheme: 'dark',
    colors: {
      bg: '#100816',
      surface: '#1a1024',
      surface2: '#2a1838',
      text: '#f4ecff',
      textMuted: '#b09bc8',
      accent: '#a855f7',
      accentSecondary: '#8b5cf6',
      accentTertiary: '#c084fc',
      accentQuaternary: '#e879f9',
    },
  },
  {
    id: 'cyber',
    name: 'Cyber Neon',
    description: 'High-contrast neon green and magenta energy',
    builtin: true,
    colorScheme: 'dark',
    colors: {
      bg: '#05050a',
      surface: '#0c0c14',
      surface2: '#1a1a28',
      text: '#f0fff8',
      textMuted: '#8e9aa8',
      accent: '#00ff9c',
      accentSecondary: '#00d4ff',
      accentTertiary: '#ff00e5',
      accentQuaternary: '#ffe600',
    },
  },
  {
    id: 'minimal',
    name: 'Minimal White',
    description: 'Airy white interface with restrained charcoal accents',
    builtin: true,
    colorScheme: 'light',
    colors: {
      bg: '#fafafa',
      surface: '#ffffff',
      surface2: '#efefef',
      text: '#111111',
      textMuted: '#6b6b6b',
      accent: '#111111',
      accentSecondary: '#333333',
      accentTertiary: '#555555',
      accentQuaternary: '#888888',
    },
  },
  {
    id: 'midnight',
    name: 'Midnight Blue',
    description: 'Late-night indigo with soft sky accents',
    builtin: true,
    colorScheme: 'dark',
    colors: {
      bg: '#070b18',
      surface: '#0d1426',
      surface2: '#18223d',
      text: '#e9efff',
      textMuted: '#8e9bb8',
      accent: '#60a5fa',
      accentSecondary: '#3b82f6',
      accentTertiary: '#818cf8',
      accentQuaternary: '#a5b4fc',
    },
  },
]

export const THEME_COLOR_FIELDS: {
  key: keyof ThemeColors
  label: string
}[] = [
  { key: 'bg', label: 'Background' },
  { key: 'surface', label: 'Surface' },
  { key: 'surface2', label: 'Surface elevated' },
  { key: 'text', label: 'Text' },
  { key: 'textMuted', label: 'Muted text' },
  { key: 'accent', label: 'Primary accent' },
  { key: 'accentSecondary', label: 'Secondary accent' },
  { key: 'accentTertiary', label: 'Tertiary accent' },
  { key: 'accentQuaternary', label: 'Quaternary accent' },
]

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const cleaned = hex.replace('#', '').trim()
  const full =
    cleaned.length === 3
      ? cleaned
          .split('')
          .map((c) => c + c)
          .join('')
      : cleaned
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  }
}

export function rgba(hex: string, alpha: number): string {
  const rgb = hexToRgb(hex)
  if (!rgb) return hex
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`
}

export function isValidHex(value: string): boolean {
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value.trim())
}

export function normalizeHex(value: string): string {
  const trimmed = value.trim()
  if (!isValidHex(trimmed)) return trimmed
  const cleaned = trimmed.replace('#', '')
  if (cleaned.length === 3) {
    return `#${cleaned
      .split('')
      .map((c) => c + c)
      .join('')
      .toLowerCase()}`
  }
  return `#${cleaned.toLowerCase()}`
}

export function cloneColors(colors: ThemeColors): ThemeColors {
  return { ...colors }
}

export function getBuiltinTheme(id: string): ThemeDefinition | undefined {
  return BUILTIN_THEMES.find((t) => t.id === id)
}

export function resolveTheme(
  activeThemeId: string,
  customThemes: ThemeDefinition[],
): ThemeDefinition {
  const custom = customThemes.find((t) => t.id === activeThemeId)
  if (custom) return custom
  return (
    getBuiltinTheme(activeThemeId) ??
    getBuiltinTheme(DEFAULT_THEME_ID) ??
    BUILTIN_THEMES[0]
  )
}

/** Apply a theme palette as CSS custom properties on :root / documentElement. */
export function applyThemeToDocument(theme: ThemeDefinition) {
  const root = document.documentElement
  const { colors, colorScheme } = theme
  const { bg, surface, surface2, text, textMuted, accent, accentSecondary, accentTertiary, accentQuaternary } =
    colors
  const theWay = isTheWayThemeId(theme.id)

  root.style.setProperty('--theme-bg', bg)
  root.style.setProperty('--theme-surface', surface)
  root.style.setProperty('--theme-surface-2', surface2)
  root.style.setProperty('--theme-text', text)
  root.style.setProperty('--theme-text-muted', textMuted)
  root.style.setProperty('--theme-accent', accent)
  root.style.setProperty('--theme-accent-2', accentSecondary)
  root.style.setProperty('--theme-accent-3', accentTertiary)
  root.style.setProperty('--theme-accent-4', accentQuaternary)

  root.style.setProperty('--bg', bg)
  root.style.setProperty('--surface-solid', surface)
  root.style.setProperty('--surface', rgba(surface, 0.82))
  root.style.setProperty('--surface-2', surface2)
  root.style.setProperty('--surface-elevated', surface2)
  root.style.setProperty('--text', text)
  root.style.setProperty('--text-muted', textMuted)
  root.style.setProperty('--accent', accent)
  root.style.setProperty('--accent-hover', accentSecondary)
  root.style.setProperty('--brand-ai', accent)
  root.style.setProperty('--accent-pink', theWay ? accentTertiary : accentQuaternary)
  root.style.setProperty('--accent-soft', rgba(accent, 0.7))

  const borderAlpha = colorScheme === 'light' ? 0.12 : 0.08
  const borderColor =
    colorScheme === 'light' ? rgba('#000000', borderAlpha) : rgba('#ffffff', borderAlpha)
  root.style.setProperty('--border', borderColor)
  root.style.setProperty('--border-glow', rgba(accent, theWay ? 0.16 : 0.28))

  if (theWay) {
    // Restrained vermilion family — no neon multi-stop glow.
    root.style.setProperty(
      '--gradient-brand',
      `linear-gradient(115deg, ${accent} 0%, ${accentSecondary} 55%, ${accentTertiary} 100%)`,
    )
    root.style.setProperty(
      '--gradient-brand-soft',
      `linear-gradient(135deg, ${rgba(accent, 0.14)}, ${rgba(accentSecondary, 0.08)})`,
    )
    root.style.setProperty('--glow-cyan', `0 0 14px ${rgba(accent, 0.14)}`)
    root.style.setProperty('--glow-pink', `0 0 14px ${rgba(accentTertiary, 0.1)}`)
    root.style.setProperty('--glow-brand', `0 0 12px ${rgba(accent, 0.08)}`)
    root.style.setProperty(
      '--bubble-user-bg',
      `linear-gradient(135deg, ${rgba(accent, 0.09)}, ${rgba(accentSecondary, 0.05)})`,
    )
    root.style.setProperty('--atmosphere-1', rgba(accent, colorScheme === 'light' ? 0.05 : 0.09))
    root.style.setProperty('--atmosphere-2', rgba(accentQuaternary, colorScheme === 'light' ? 0.04 : 0.07))
    root.style.setProperty('--atmosphere-3', rgba(accentTertiary, colorScheme === 'light' ? 0.03 : 0.06))
    // Ensō ink parity: Washi = sumi black, Sumi = warm ivory. Same geometry.
    if (theme.id === 'the-way-washi') {
      root.style.setProperty('--enso-ink', '#141210')
      root.style.setProperty('--enso-sun', accent)
      root.style.removeProperty('--enso-fire-ambient')
      root.style.setProperty('--enso-container-bg', '#FFFAF3')
      root.style.setProperty(
        '--enso-container-shadow',
        `0 1px 3px ${rgba('#1C1916', 0.06)}, 0 4px 14px ${rgba('#1C1916', 0.05)}`,
      )
      root.style.setProperty(
        '--the-way-page-atmosphere',
        `radial-gradient(ellipse 80% 55% at 50% 28%, ${rgba(accent, 0.045)}, transparent 62%), radial-gradient(ellipse 70% 50% at 72% 78%, ${rgba(accentQuaternary, 0.04)}, transparent 55%)`,
      )
    } else {
      root.style.setProperty('--enso-ink', '#F5F0E8')
      root.style.setProperty('--enso-sun', accent)
      root.style.removeProperty('--enso-fire-ambient')
      root.style.setProperty('--enso-container-bg', '#1A1613')
      root.style.setProperty(
        '--enso-container-shadow',
        `0 0 0 1px ${rgba('#F5F0E8', 0.06)}, 0 2px 10px ${rgba('#000000', 0.35)}`,
      )
      root.style.setProperty(
        '--the-way-page-atmosphere',
        `radial-gradient(ellipse 75% 50% at 48% 26%, ${rgba(accent, 0.08)}, transparent 60%), radial-gradient(ellipse 65% 45% at 70% 80%, ${rgba(accentQuaternary, 0.05)}, transparent 55%)`,
      )
    }
  } else {
    root.style.setProperty(
      '--gradient-brand',
      `linear-gradient(115deg, ${accent} 0%, ${accentSecondary} 26%, ${accentTertiary} 62%, ${accentQuaternary} 100%)`,
    )
    root.style.setProperty(
      '--gradient-brand-soft',
      `linear-gradient(135deg, ${rgba(accent, 0.2)}, ${rgba(accentTertiary, 0.12)}, ${rgba(accentQuaternary, 0.16)})`,
    )
    root.style.setProperty('--glow-cyan', `0 0 24px ${rgba(accent, 0.32)}`)
    root.style.setProperty('--glow-pink', `0 0 24px ${rgba(accentQuaternary, 0.26)}`)
    root.style.setProperty(
      '--glow-brand',
      `0 0 28px ${rgba(accent, 0.24)}, 0 0 48px ${rgba(accentQuaternary, 0.14)}`,
    )
    root.style.setProperty(
      '--bubble-user-bg',
      `linear-gradient(135deg, ${rgba(accent, 0.16)}, ${rgba(accentTertiary, 0.14)} 45%, ${rgba(accentQuaternary, 0.16)})`,
    )
    root.style.setProperty('--atmosphere-1', rgba(accent, colorScheme === 'light' ? 0.1 : 0.18))
    root.style.setProperty('--atmosphere-2', rgba(accentQuaternary, colorScheme === 'light' ? 0.08 : 0.15))
    root.style.setProperty('--atmosphere-3', rgba(accentTertiary, colorScheme === 'light' ? 0.06 : 0.11))
    // Classic / custom themes: Ensō follows strong text so the mark stays readable.
    root.style.setProperty('--enso-ink', colorScheme === 'light' ? '#141210' : '#F5F0E8')
    root.style.setProperty('--enso-sun', accent)
    root.style.removeProperty('--enso-fire-ambient')
    root.style.removeProperty('--enso-container-bg')
    root.style.removeProperty('--enso-container-shadow')
    root.style.removeProperty('--the-way-page-atmosphere')
  }

  root.style.setProperty('--scrim', colorScheme === 'light' ? 'rgba(20, 24, 32, 0.35)' : 'rgba(0, 0, 0, 0.55)')
  root.style.setProperty('--on-accent', colorScheme === 'light' ? '#ffffff' : '#000000')
  root.style.setProperty('--strong-text', colorScheme === 'light' ? (theWay ? text : '#0a0a0a') : (theWay ? text : '#ffffff'))
  root.style.setProperty('--code-bg', colorScheme === 'light' ? 'rgba(0, 0, 0, 0.06)' : 'rgba(255, 255, 255, 0.06)')
  root.style.setProperty('--shadow-lift', colorScheme === 'light' ? 'rgba(15, 23, 42, 0.12)' : 'rgba(0, 0, 0, 0.45)')

  // Keep legacy aliases in sync so any remaining --laife-* refs stay coherent.
  root.style.setProperty('--laife-black', bg)
  root.style.setProperty('--laife-dark', surface)
  root.style.setProperty('--laife-soft', surface2)
  root.style.setProperty('--laife-cyan', accent)
  root.style.setProperty('--laife-blue', accentSecondary)
  root.style.setProperty('--laife-purple', accentTertiary)
  root.style.setProperty('--laife-pink', accentQuaternary)
  root.style.setProperty('--laife-magenta', accentQuaternary)

  root.style.colorScheme = colorScheme
  root.dataset.theme = theme.id
  root.dataset.colorScheme = colorScheme

  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', bg)
}

export function createCustomThemeId(): string {
  return `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

export function createBlankCustomTheme(base?: ThemeDefinition): ThemeDefinition {
  const source = base ?? BUILTIN_THEMES[0]
  return {
    id: createCustomThemeId(),
    name: 'My custom theme',
    description: 'Custom palette',
    builtin: false,
    colorScheme: source.colorScheme,
    colors: cloneColors(source.colors),
  }
}
