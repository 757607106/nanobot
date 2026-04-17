import { theme as antdTheme, type ThemeConfig } from 'antd'
import type { ResolvedTheme } from '../../themeMode'
import { designTokens } from '../design/tokens'

export function buildAntdThemeConfig(mode: ResolvedTheme): ThemeConfig {
  const isDark = mode === 'dark'
  const palette = isDark ? designTokens.color.dark : designTokens.color.light
  const shadows = isDark ? designTokens.shadow.dark : designTokens.shadow.light

  return {
    algorithm: isDark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
    token: {
      // === Brand ===
      colorPrimary: palette.accent,
      colorInfo: palette.accent,
      colorSuccess: isDark ? designTokens.color.dark.success : designTokens.color.light.success,
      colorWarning: isDark ? designTokens.color.dark.warning : designTokens.color.light.warning,
      colorError: isDark ? designTokens.color.dark.error : designTokens.color.light.error,

      // === Background ===
      colorBgLayout: palette.bodyBg,
      colorBgContainer: palette.cardBg,
      colorBgElevated: palette.surfaceElevated,

      // === Text ===
      colorTextBase: palette.ink,
      colorText: palette.ink,
      colorTextSecondary: palette.muted,
      colorTextTertiary: isDark ? 'rgba(238, 242, 251, 0.58)' : 'rgba(21, 24, 33, 0.58)',
      colorTextQuaternary: palette.quaternary,
      colorTextDescription: palette.muted,
      colorTextPlaceholder: isDark ? 'rgba(238, 242, 251, 0.50)' : 'rgba(21, 24, 33, 0.50)',
      colorTextDisabled: isDark ? 'rgba(238, 242, 251, 0.34)' : 'rgba(21, 24, 33, 0.34)',
      colorTextLightSolid: '#ffffff',

      // === Border ===
      colorBorderSecondary: palette.surfacePanelBorder,

      // === Radius ===
      borderRadius: designTokens.radius.md,
      borderRadiusLG: designTokens.radius.lg,
      borderRadiusSM: designTokens.radius.sm,
      borderRadiusXS: designTokens.radius.xs,

      // === Typography ===
      fontSize: designTokens.fontSize.sm,
      fontSizeSM: designTokens.fontSize['2xs'],
      fontSizeLG: designTokens.fontSize.md,
      fontSizeXL: designTokens.fontSize.titleSm,
      fontSizeHeading1: designTokens.fontSize.titleLg,
      fontSizeHeading2: designTokens.fontSize.titleMd,
      fontSizeHeading3: designTokens.fontSize.titleXs,
      fontSizeHeading4: designTokens.fontSize.lg,
      fontSizeHeading5: designTokens.fontSize.lg,
      fontWeightStrong: designTokens.fontWeight.semibold,
      lineHeight: designTokens.lineHeight.body,
      fontFamily: designTokens.font.body,
      fontFamilyCode: designTokens.font.mono,

      // === Spacing ===
      paddingXS: designTokens.space.xs,
      paddingSM: designTokens.space.sm,
      padding: designTokens.space.md,
      paddingLG: designTokens.space.lg,
      paddingXL: designTokens.space.xl,

      // === Controls ===
      controlHeight: designTokens.control.height,
      controlHeightSM: designTokens.control.heightSm,
      controlHeightLG: designTokens.control.heightLg,

      // === Shadows ===
      boxShadow: shadows.sm,
      boxShadowSecondary: shadows.md,
    },
    components: {
      Card: {
        borderRadiusLG: designTokens.radius.lg,
        bodyPadding: designTokens.space.xl,
        bodyPaddingSM: designTokens.space.lg,
        headerHeight: 52,
        headerHeightSM: 44,
        headerFontSize: designTokens.fontSize.lg,
        headerPadding: designTokens.space.lg,
      },
      Layout: {
        headerBg: 'transparent',
        siderBg: 'transparent',
        bodyBg: 'transparent',
      },
      Menu: {
        itemBorderRadius: designTokens.radius.md,
        itemMarginInline: designTokens.space.xs,
        itemMarginBlock: designTokens.space.xs,
        itemSelectedBg: palette.selectedBg,
        itemSelectedColor: palette.ink,
        itemHoverBg: palette.hoverBg,
        itemHoverColor: palette.ink,
        itemColor: palette.muted,
        itemHeight: 44,
        iconSize: 18,
        iconMarginInlineEnd: designTokens.space.sm,
        darkItemBg: 'transparent',
        darkItemSelectedBg: palette.selectedBg,
        darkItemSelectedColor: palette.ink,
        darkItemHoverBg: palette.hoverBg,
        darkItemHoverColor: palette.ink,
        darkItemColor: palette.muted,
      },
      Button: {
        borderRadius: designTokens.radius.md,
        controlHeight: designTokens.control.height,
        controlHeightSM: designTokens.control.heightSm,
        controlHeightLG: designTokens.control.heightLg,
        fontWeight: designTokens.fontWeight.semibold,
        paddingInline: designTokens.space.lg,
        paddingInlineSM: designTokens.space.md,
        paddingInlineLG: designTokens.space.xl,
        primaryColor: '#ffffff',
        defaultBg: palette.cardBg,
        defaultBorderColor: palette.surfacePanelBorder,
        defaultColor: palette.ink,
      },
      Input: {
        borderRadius: designTokens.radius.md,
        paddingInline: designTokens.space.lg,
        paddingBlock: 10,
        activeShadow: `0 0 0 2px ${isDark ? 'rgba(142, 166, 255, 0.22)' : 'rgba(63, 108, 255, 0.18)'}`,
      },
      InputNumber: {
        borderRadius: designTokens.radius.md,
      },
      Select: {
        borderRadius: designTokens.radius.md,
      },
      Segmented: {
        itemActiveBg: palette.hoverBg,
        itemSelectedBg: palette.selectedBg,
        trackBg: palette.bodyBg,
      },
      Tabs: {
        itemSelectedColor: palette.accent,
        itemHoverColor: palette.accent,
        inkBarColor: palette.accent,
        itemColor: palette.muted,
        titleFontSize: designTokens.fontSize.sm,
        titleFontSizeLG: designTokens.fontSize.lg,
        titleFontSizeSM: designTokens.fontSize['2xs'],
        horizontalItemPadding: '12px 0',
      },
      Tag: {
        borderRadiusSM: designTokens.radius.full,
        defaultBg: palette.selectedBg,
        defaultColor: palette.accent,
      },
      Drawer: {
        colorBgElevated: palette.cardBg,
        paddingLG: designTokens.space.xl,
      },
      Modal: {
        contentBg: palette.cardBg,
        headerBg: palette.cardBg,
        footerBg: palette.cardBg,
        titleColor: palette.ink,
        titleFontSize: designTokens.fontSize.titleXs,
        titleLineHeight: designTokens.lineHeight.snug,
        borderRadiusLG: designTokens.radius.lg,
      },
      Table: {
        headerBg: palette.bodyBg,
        headerColor: palette.ink,
        rowHoverBg: palette.hoverBg,
        rowSelectedBg: palette.selectedBg,
        borderRadiusLG: designTokens.radius.md,
        cellPaddingBlock: designTokens.space.md,
        cellPaddingInline: designTokens.space.lg,
      },
      Form: {
        labelColor: palette.muted,
        labelFontSize: designTokens.fontSize.sm,
        labelHeight: designTokens.control.heightSm,
        itemMarginBottom: designTokens.space.xl,
      },
      Tooltip: {
        colorBgSpotlight: palette.surfaceElevated,
        colorTextLightSolid: '#ffffff',
      },
      Dropdown: {
        colorBgElevated: palette.surfaceElevated,
        controlItemBgHover: palette.hoverBg,
        controlItemBgActive: palette.selectedBg,
      },
      Popover: {
        colorBgElevated: palette.surfaceElevated,
      },
      Message: {
        contentBg: palette.surfaceElevated,
      },
      Notification: {
        colorBgElevated: palette.surfaceElevated,
      },
    },
  }
}
