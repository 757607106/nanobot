import { useMemo } from 'react'
import { theme } from 'antd'

/** Palette used across all dashboard charts. */
export interface ChartThemeTokens {
  colorPrimary: string
  colorSuccess: string
  colorWarning: string
  colorError: string
  colorTextBase: string
  colorTextSecondary: string
  colorBgContainer: string
  colorBorderSecondary: string
  fontFamily: string
  /** Categorical palette for multi-series charts */
  palette10: string[]
}

/**
 * Returns a token bag derived from Ant Design's current theme so every chart
 * shares the same palette, typography, and dark-mode awareness.
 */
export function useChartTheme(): ChartThemeTokens {
  const { token } = theme.useToken()

  return useMemo<ChartThemeTokens>(
    () => ({
      colorPrimary: token.colorPrimary,
      colorSuccess: token.colorSuccess,
      colorWarning: token.colorWarning,
      colorError: token.colorError,
      colorTextBase: token.colorText,
      colorTextSecondary: token.colorTextSecondary,
      colorBgContainer: token.colorBgContainer,
      colorBorderSecondary: token.colorBorderSecondary,
      fontFamily: token.fontFamily,
      palette10: [
        token.colorPrimary,
        token.colorSuccess,
        token.colorWarning,
        token.colorError,
        token.colorInfo,
        token.colorPrimaryBorderHover,
        token.colorSuccessBorder,
        token.colorWarningBorder,
        token.colorErrorBorder,
        token.colorPrimaryTextHover,
      ],
    }),
    [
      token.colorPrimary,
      token.colorSuccess,
      token.colorWarning,
      token.colorError,
      token.colorText,
      token.colorTextSecondary,
      token.colorBgContainer,
      token.colorBorderSecondary,
      token.fontFamily,
      token.colorInfo,
      token.colorPrimaryBorderHover,
      token.colorSuccessBorder,
      token.colorWarningBorder,
      token.colorErrorBorder,
      token.colorPrimaryTextHover,
    ],
  )
}
