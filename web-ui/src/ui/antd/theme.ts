import { theme as antdTheme, type ThemeConfig } from 'antd'
import type { ResolvedTheme } from '../../themeMode'
import { designTokens } from '../design/tokens'

export function buildAntdThemeConfig(mode: ResolvedTheme): ThemeConfig {
  const isDark = mode === 'dark'
  const palette = isDark ? designTokens.color.dark : designTokens.color.light

  return {
    algorithm: isDark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
    token: {
      // === 品牌色 ===
      colorPrimary: palette.accent,
      colorInfo: palette.accent,
      colorSuccess: palette.success,
      colorWarning: palette.warning,
      colorError: palette.error,

      // === 背景色 ===
      colorBgLayout: palette.bgLayout,
      colorBgContainer: palette.bgContainer,
      colorBgElevated: palette.bgElevated,

      // === 文字色 ===
      colorTextBase: palette.text,
      colorText: palette.text,
      colorTextSecondary: palette.textSecondary,
      colorTextTertiary: isDark ? 'rgba(242, 242, 247, 0.58)' : 'rgba(17, 24, 39, 0.58)',
      colorTextQuaternary: isDark ? 'rgba(242, 242, 247, 0.44)' : 'rgba(17, 24, 39, 0.44)',
      colorTextDescription: palette.textSecondary,
      colorTextPlaceholder: isDark ? 'rgba(242, 242, 247, 0.50)' : 'rgba(17, 24, 39, 0.50)',
      colorTextDisabled: isDark ? 'rgba(242, 242, 247, 0.34)' : 'rgba(17, 24, 39, 0.34)',
      colorTextLightSolid: '#ffffff',

      // === 边框与分割线 ===
      colorBorderSecondary: palette.border,

      borderRadius: designTokens.radius.md,
      borderRadiusLG: designTokens.radius.lg,
      borderRadiusSM: designTokens.radius.sm,
      borderRadiusXS: designTokens.radius.xs,

      // === 字体体系 ===
      fontSize: 14,
      fontSizeSM: 12,
      fontSizeLG: 16,
      fontSizeXL: 24,
      fontSizeHeading1: 30,
      fontSizeHeading2: 26,
      fontSizeHeading3: 18,
      fontSizeHeading4: 16,
      fontSizeHeading5: 16,
      fontWeightStrong: 600,
      lineHeight: 1.5,
      fontFamily: designTokens.font.family,

      // === 间距体系 ===
      paddingXS: designTokens.space.xs,
      paddingSM: designTokens.space.sm,
      padding: designTokens.space.md,
      paddingLG: designTokens.space.lg,
      paddingXL: designTokens.space.xl,
      // 注意: paddingXXL 不是标准 AliasToken，通过 paddingXL 扩展

      // === 控制组件尺寸 ===
      controlHeight: 40,
      controlHeightSM: 32,
      controlHeightLG: 48,

      // === 阴影 ===
      boxShadow: (isDark ? designTokens.shadow.dark : designTokens.shadow.light).sm,
      boxShadowSecondary: (isDark ? designTokens.shadow.dark : designTokens.shadow.light).md,
    },
    components: {
      // === Card 组件 ===
      Card: {
        borderRadiusLG: designTokens.radius.lg,
        bodyPadding: designTokens.space.xl,
        bodyPaddingSM: designTokens.space.lg,
        headerHeight: 52,
        headerHeightSM: 44,
        headerFontSize: 16,
        headerPadding: designTokens.space.lg,
      },

      // === Layout 组件 ===
      Layout: {
        headerBg: 'transparent',
        siderBg: 'transparent',
        bodyBg: 'transparent',
      },

      // === Menu 组件 ===
      Menu: {
        itemBorderRadius: designTokens.radius.md,
        itemMarginInline: designTokens.space.xs,
        itemMarginBlock: designTokens.space.xs,
        itemSelectedBg: palette.selectedBg,
        itemSelectedColor: palette.text,
        itemHoverBg: palette.hoverBg,
        itemHoverColor: palette.text,
        itemColor: palette.textSecondary,
        itemHeight: 44,
        iconSize: 18,
        iconMarginInlineEnd: designTokens.space.sm,
        // 深色模式专用
        darkItemBg: 'transparent',
        darkItemSelectedBg: palette.selectedBg,
        darkItemSelectedColor: palette.text,
        darkItemHoverBg: palette.hoverBg,
        darkItemHoverColor: palette.text,
        darkItemColor: palette.textSecondary,
      },

      // === Button 组件 ===
      Button: {
        borderRadius: designTokens.radius.md,
        controlHeight: 40,
        controlHeightSM: 32,
        controlHeightLG: 48,
        fontWeight: 'var(--nb-font-weight-strong)',
        paddingInline: designTokens.space.lg,
        paddingInlineSM: designTokens.space.md,
        paddingInlineLG: designTokens.space.xl,
        primaryColor: '#ffffff',
        defaultBg: palette.bgContainer,
        defaultBorderColor: palette.border,
        defaultColor: palette.text,
      },

      // === Input 组件 ===
      Input: {
        borderRadius: designTokens.radius.md,
        paddingInline: designTokens.space.lg,
        paddingBlock: 10,
        activeShadow: `0 0 0 2px ${isDark ? 'rgba(10, 132, 255, 0.22)' : 'rgba(0, 122, 255, 0.18)'}`,
      },

      // === InputNumber 组件 ===
      InputNumber: {
        borderRadius: designTokens.radius.md,
      },

      // === Select 组件 ===
      Select: {
        borderRadius: designTokens.radius.md,
      },

      // === Segmented 组件 ===
      Segmented: {
        itemActiveBg: palette.hoverBg,
        itemSelectedBg: palette.selectedBg,
        trackBg: palette.bgLayout,
      },

      // === Tabs 组件 ===
      Tabs: {
        itemSelectedColor: palette.accent,
        itemHoverColor: palette.accent,
        inkBarColor: palette.accent,
        itemColor: palette.textSecondary,
        titleFontSize: 14,
        titleFontSizeLG: 16,
        titleFontSizeSM: 12,
        horizontalItemPadding: '12px 0',
      },

      // === Tag 组件 ===
      Tag: {
        borderRadiusSM: 999,
        defaultBg: palette.selectedBg,
        defaultColor: palette.accent,
      },

      // === Drawer 组件 ===
      Drawer: {
        colorBgElevated: palette.bgContainer,
        paddingLG: designTokens.space.xl,
      },

      // === Modal 组件 ===
      Modal: {
        contentBg: palette.bgContainer,
        headerBg: palette.bgContainer,
        footerBg: palette.bgContainer,
        titleColor: palette.text,
        titleFontSize: 18,
        titleLineHeight: 1.4,
        borderRadiusLG: designTokens.radius.lg,
      },

      // === Table 组件 ===
      Table: {
        headerBg: palette.bgLayout,
        headerColor: palette.text,
        rowHoverBg: palette.hoverBg,
        rowSelectedBg: palette.selectedBg,
        borderRadiusLG: designTokens.radius.md,
        cellPaddingBlock: designTokens.space.md,
        cellPaddingInline: designTokens.space.lg,
      },

      // === Form 组件 ===
      Form: {
        labelColor: palette.textSecondary,
        labelFontSize: 14,
        labelHeight: 32,
        itemMarginBottom: designTokens.space.xl,
      },

      // === Tooltip 组件 ===
      Tooltip: {
        colorBgSpotlight: palette.bgElevated,
        colorTextLightSolid: '#ffffff',
      },

      // === Dropdown 组件 ===
      Dropdown: {
        colorBgElevated: palette.bgElevated,
        controlItemBgHover: palette.hoverBg,
        controlItemBgActive: palette.selectedBg,
      },

      // === Popover 组件 ===
      Popover: {
        colorBgElevated: palette.bgElevated,
      },

      // === Message 组件 ===
      Message: {
        contentBg: palette.bgElevated,
      },

      // === Notification 组件 ===
      Notification: {
        colorBgElevated: palette.bgElevated,
      },
    },
  }
}
