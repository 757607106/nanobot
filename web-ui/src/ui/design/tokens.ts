export type DesignMode = 'light' | 'dark'

export const designTokens = {
  font: {
    family:
      '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", system-ui, sans-serif',
    mono: 'ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, monospace',
  },
  radius: {
    xs: 8,
    sm: 10,
    md: 12,
    lg: 16,
    xl: 20,
  },
  space: {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 24,
    '2xl': 32,
    '3xl': 48,
  },
  layout: {
    siderWidth: 240,
    headerHeight: 56,
    contentMaxWidth: 1600,
    gutter: 24,
    gutterMobile: 16,
  },
  motion: {
    duration: {
      fast: '140ms',
      normal: '220ms',
      slow: '360ms',
    },
    easing: {
      standard: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
      emphasized: 'cubic-bezier(0.16, 1, 0.3, 1)',
    },
  },
  color: {
    light: {
      accent: '#007AFF',
      success: '#34C759',
      warning: '#FF9500',
      error: '#FF3B30',
      bgLayout: '#F5F5F7',
      bgContainer: '#FFFFFF',
      bgElevated: '#FFFFFF',
      text: '#111827',
      textSecondary: 'rgba(17, 24, 39, 0.72)',
      border: 'rgba(17, 24, 39, 0.10)',
      hoverBg: 'rgba(17, 24, 39, 0.04)',
      selectedBg: 'rgba(0, 122, 255, 0.12)',
    },
    dark: {
      accent: '#0A84FF',
      success: '#30D158',
      warning: '#FFD60A',
      error: '#FF453A',
      bgLayout: '#0B0B0C',
      bgContainer: '#141416',
      bgElevated: '#1C1C1E',
      text: '#F2F2F7',
      textSecondary: 'rgba(242, 242, 247, 0.72)',
      border: 'rgba(255, 255, 255, 0.10)',
      hoverBg: 'rgba(255, 255, 255, 0.06)',
      selectedBg: 'rgba(10, 132, 255, 0.18)',
    },
  },
  shadow: {
    light: {
      sm: '0 1px 0 rgba(17, 24, 39, 0.04), 0 8px 24px rgba(17, 24, 39, 0.06)',
      md: '0 1px 0 rgba(17, 24, 39, 0.06), 0 20px 60px rgba(17, 24, 39, 0.12)',
    },
    dark: {
      sm: '0 1px 0 rgba(0, 0, 0, 0.30), 0 12px 30px rgba(0, 0, 0, 0.55)',
      md: '0 1px 0 rgba(0, 0, 0, 0.36), 0 30px 80px rgba(0, 0, 0, 0.70)',
    },
  },
} as const

export function resolveDesignMode(mode: string): DesignMode {
  return mode === 'dark' ? 'dark' : 'light'
}
