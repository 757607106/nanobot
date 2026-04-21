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
    body: '"Geist Sans", "Manrope Variable", "Manrope", "Noto Sans SC Variable", "Noto Sans SC", -apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", system-ui, sans-serif',
    display:
      '"Geist Sans", "Manrope Variable", "Manrope", "Noto Sans SC Variable", "Noto Sans SC", -apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Segoe UI", "PingFang SC", system-ui, sans-serif',
    mono: '"Geist Mono", "JetBrains Mono", ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
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
    '3xs': 2,
    '2xs': 4,
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
    siderWidth: 208,
    headerHeight: 56,
    contentMaxWidth: 1600,
    gutter: 16,
    gutterMobile: 12,
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
      accent: '#2563EB', // Enterprise Blue
      accentSoft: '#EFF6FF',
      // Semantic
      success: '#16A34A',
      warning: '#D97706',
      error: '#DC2626',
      // Text
      ink: '#0F172A',
      muted: '#475569',
      quaternary: '#94A3B8',
      // Surfaces
      bodyBg: '#F1F5F9',
      surfacePanel: '#FFFFFF',
      surfacePanelBorder: 'transparent',
      surfaceSoft: '#F1F5F9',
      surfaceSubtle: '#F8FAFC',
      surfaceSubtleBorder: 'transparent',
      surfaceElevated: '#FFFFFF',
      cardBg: '#FFFFFF',
      // Borders — 极度克制，仅用于输入框 focus 等场景
      border: 'rgba(203, 213, 225, 0.45)',
      borderStrong: '#94A3B8',
      cardBorder: 'transparent',
      cardSubtleBorder: 'transparent',
      // Interaction
      hoverBg: '#F1F5F9',
      selectedBg: '#EFF6FF',
      // Scroll
      scrollThumb: '#CBD5E1',
      scrollThumbHover: '#94A3B8',
    },
    dark: {
      // Brand
      accent: '#3B82F6',
      accentSoft: '#1E3A8A',
      // Semantic
      success: '#22C55E',
      warning: '#F59E0B',
      error: '#EF4444',
      // Text
      ink: '#F8FAFC',
      muted: '#94A3B8',
      quaternary: '#64748B',
      // Surfaces
      bodyBg: '#020617',
      surfacePanel: '#0F172A',
      surfacePanelBorder: 'transparent',
      surfaceSoft: '#1E293B',
      surfaceSubtle: '#0F172A',
      surfaceSubtleBorder: 'transparent',
      surfaceElevated: '#1E293B',
      cardBg: '#0F172A',
      // Borders
      border: 'rgba(51, 65, 85, 0.5)',
      borderStrong: '#475569',
      cardBorder: 'transparent',
      cardSubtleBorder: 'transparent',
      // Interaction
      hoverBg: '#1E293B',
      selectedBg: '#1E3A8A',
      // Scroll
      scrollThumb: '#334155',
      scrollThumbHover: '#475569',
    },
  },

  /* ──────────────────── Shadows ──────────────────── */
  shadow: {
    light: {
      xs: '0 1px 3px rgba(15, 23, 42, 0.04), 0 1px 2px rgba(15, 23, 42, 0.02)',
      sm: '0 2px 8px rgba(15, 23, 42, 0.05), 0 1px 3px rgba(15, 23, 42, 0.03)',
      md: '0 6px 20px rgba(15, 23, 42, 0.06), 0 2px 6px rgba(15, 23, 42, 0.03)',
      lg: '0 16px 40px rgba(15, 23, 42, 0.08), 0 6px 16px rgba(15, 23, 42, 0.04)',
    },
    dark: {
      xs: '0 1px 3px rgba(0, 0, 0, 0.25), 0 1px 2px rgba(0, 0, 0, 0.15)',
      sm: '0 4px 16px rgba(0, 0, 0, 0.32), 0 2px 4px rgba(0, 0, 0, 0.16)',
      md: '0 12px 32px rgba(0, 0, 0, 0.28), 0 4px 10px rgba(0, 0, 0, 0.18)',
      lg: '0 20px 44px rgba(0, 0, 0, 0.36), 0 8px 20px rgba(0, 0, 0, 0.16)',
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
