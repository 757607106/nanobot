export type DesignMode = 'light' | 'dark'

/**
 * Canonical design tokens — the single source of truth for all visual values.
 *
 * Rules:
 * 1. Antd theme (`theme.ts`) derives from these values — never hardcodes.
 * 2. CSS custom properties (`theme.css`) are for layout/surface values CSS needs directly.
 * 3. No other file may declare color, spacing, radius, or shadow values independently.
 */
export const designTokens = {
  /* ──────────────────── Typography ──────────────────── */
  font: {
    body: '"Noto Sans SC Variable", "Noto Sans SC", -apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", system-ui, sans-serif',
    display:
      '"Noto Sans SC Variable", "Noto Sans SC", -apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Segoe UI", "PingFang SC", system-ui, sans-serif',
    mono: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
  },
  fontSize: {
    '2xs': 12, // 0.75rem — captions, footnotes
    xs: 13, // 0.8125rem — secondary labels
    sm: 14, // 0.875rem — body default
    md: 15, // 0.9375rem — emphasized body
    lg: 16, // 1rem — subheadings
    titleXs: 18, // 1.125rem — card titles
    titleSm: 20, // 1.25rem — section titles
    titleMd: 22, // 1.375rem — page titles
    titleLg: 26, // 1.625rem — hero titles (rare)
  },
  fontWeight: {
    regular: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
    heavy: 800,
  },
  lineHeight: {
    tight: 1.15,
    snug: 1.3,
    body: 1.5,
    relaxed: 1.6,
    loose: 1.75,
  },

  /* ──────────────────── Spacing (4pt scale) ──────────────────── */
  space: {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 24,
    '2xl': 32,
    '3xl': 48,
    '4xl': 64,
    '5xl': 96,
  },

  /* ──────────────────── Border Radius ──────────────────── */
  radius: {
    xs: 6,
    sm: 8,
    md: 10,
    lg: 12,
    xl: 16,
    '2xl': 22,
    full: 999,
  },

  /* ──────────────────── Layout ──────────────────── */
  layout: {
    siderWidth: 240,
    headerHeight: 56,
    contentMaxWidth: 1600,
    gutter: 24,
    gutterMobile: 16,
    sectionGap: 16,
    panelPadding: 16,
    cardPadding: 16,
  },

  /* ──────────────────── Control Sizes ──────────────────── */
  control: {
    height: 40,
    heightSm: 34,
    heightLg: 48,
    tagHeight: 28,
  },

  /* ──────────────────── Colors ──────────────────── */
  color: {
    light: {
      // Brand
      accent: '#355fe6',
      accentSoft: 'rgba(53, 95, 230, 0.12)',
      // Semantic
      success: '#1f8f5f',
      warning: '#c9831b',
      error: '#d14343',
      // Text
      ink: '#151821',
      muted: '#5f6778',
      quaternary: '#95a3b5',
      // Surfaces
      bodyBg: '#F5F7FA',
      surfacePanel: 'rgba(255, 255, 255, 0.85)',
      surfacePanelBorder: 'rgba(0, 0, 0, 0.04)',
      surfaceSoft: 'rgba(255, 255, 255, 0.8)',
      surfaceSubtle: 'rgba(248, 250, 252, 0.94)',
      surfaceSubtleBorder: 'rgba(24, 36, 51, 0.06)',
      surfaceElevated: 'rgba(255, 255, 255, 0.99)',
      cardBg: '#ffffff',
      // Borders
      border: 'color-mix(in srgb, #101828 10%, #ffffff 90%)',
      borderStrong: 'color-mix(in srgb, #101828 18%, #ffffff 82%)',
      cardBorder: 'color-mix(in srgb, #101828 8%, #ffffff 92%)',
      cardSubtleBorder: 'color-mix(in srgb, #101828 6%, #ffffff 94%)',
      // Interaction
      hoverBg: 'rgba(0, 0, 0, 0.04)',
      selectedBg: 'rgba(53, 95, 230, 0.08)',
      // Scroll
      scrollThumb: 'rgba(53, 95, 230, 0.18)',
      scrollThumbHover: 'rgba(53, 95, 230, 0.30)',
    },
    dark: {
      // Brand
      accent: '#8ea6ff',
      accentSoft: 'rgba(142, 166, 255, 0.16)',
      // Semantic
      success: '#53c98d',
      warning: '#e2a24d',
      error: '#ff8e8e',
      // Text
      ink: '#eef2fb',
      muted: '#9aa3b5',
      quaternary: '#71839a',
      // Surfaces
      bodyBg: '#0A0A0A',
      surfacePanel: 'rgba(255, 255, 255, 0.03)',
      surfacePanelBorder: 'rgba(255, 255, 255, 0.06)',
      surfaceSoft: 'rgba(20, 31, 48, 0.8)',
      surfaceSubtle: 'rgba(20, 33, 49, 0.88)',
      surfaceSubtleBorder: 'rgba(230, 237, 247, 0.06)',
      surfaceElevated: 'rgba(18, 30, 48, 0.99)',
      cardBg: '#141f30',
      // Borders
      border: 'color-mix(in srgb, #ffffff 10%, #0f1320 90%)',
      borderStrong: 'color-mix(in srgb, #ffffff 18%, #0f1320 82%)',
      cardBorder: 'color-mix(in srgb, #ffffff 10%, #0f1320 90%)',
      cardSubtleBorder: 'color-mix(in srgb, #ffffff 7%, #0f1320 93%)',
      // Interaction
      hoverBg: 'rgba(255, 255, 255, 0.06)',
      selectedBg: 'rgba(142, 166, 255, 0.14)',
      // Scroll
      scrollThumb: 'rgba(142, 166, 255, 0.22)',
      scrollThumbHover: 'rgba(142, 166, 255, 0.34)',
    },
  },

  /* ──────────────────── Shadows ──────────────────── */
  shadow: {
    light: {
      xs: '0 1px 2px rgba(0, 0, 0, 0.04)',
      sm: '0 4px 16px rgba(0, 0, 0, 0.02), 0 1px 2px rgba(0, 0, 0, 0.04)',
      md: '0 8px 24px rgba(0, 0, 0, 0.04), 0 2px 6px rgba(0, 0, 0, 0.03)',
      lg: '0 18px 40px rgba(15, 23, 42, 0.06), 0 8px 20px rgba(15, 23, 42, 0.03)',
    },
    dark: {
      xs: '0 1px 2px rgba(0, 0, 0, 0.3)',
      sm: '0 8px 32px rgba(0, 0, 0, 0.4)',
      md: '0 16px 40px rgba(0, 0, 0, 0.3), 0 4px 12px rgba(0, 0, 0, 0.2)',
      lg: '0 22px 48px rgba(0, 0, 0, 0.38), 0 10px 22px rgba(0, 0, 0, 0.18)',
    },
  },

  /* ──────────────────── Motion ──────────────────── */
  motion: {
    duration: {
      instant: '80ms',
      fast: '140ms',
      normal: '220ms',
      slow: '360ms',
    },
    easing: {
      standard: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
      emphasized: 'cubic-bezier(0.16, 1, 0.3, 1)',
      decelerate: 'cubic-bezier(0.22, 1, 0.36, 1)', // ease-out-quart
    },
  },
} as const

/* ──────────────────── Framer Motion Presets ──────────────────── */
export const framerMotion = {
  spring: {
    type: 'spring' as const,
    stiffness: 300,
    damping: 30,
    mass: 0.8,
  },
  panelReveal: {
    hidden: { opacity: 0, y: 20, scale: 0.992 },
    visible: {
      opacity: 1,
      y: 0,
      scale: 1,
      transition: { type: 'spring' as const, stiffness: 175, damping: 24, mass: 0.88 },
    },
  },
  staggerChildren: {
    hidden: { opacity: 1 },
    visible: {
      opacity: 1,
      transition: { staggerChildren: 0.06, delayChildren: 0.03 },
    },
  },
  interactiveLift: { y: -7, scale: 1.012 },
  interactiveTap: { y: -2, scale: 0.994 },
} as const

export function resolveDesignMode(mode: string): DesignMode {
  return mode === 'dark' ? 'dark' : 'light'
}
