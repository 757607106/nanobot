import { theme as antdTheme, type ThemeConfig } from 'antd'
import type { ResolvedTheme } from '../../themeMode'

const CONSOLE_FONT_FAMILY = '"IBM Plex Sans", "Avenir Next", "PingFang SC", "Microsoft YaHei", sans-serif'

// 基础设计常量
const BORDER_RADIUS = {
  sm: 10,
  md: 14,
  lg: 20,
  xl: 28,
} as const

const SPACING = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const

export function buildAntdThemeConfig(mode: ResolvedTheme): ThemeConfig {
  const isDark = mode === 'dark'

  // 核心色板
  const colors = {
    // 主色
    primary: isDark ? '#8CB8FF' : '#1457D9',
    // 成功色
    success: isDark ? '#4FD1A2' : '#18795B',
    // 警告色
    warning: isDark ? '#F2C572' : '#B97824',
    // 错误色
    error: isDark ? '#FF9E93' : '#C84C35',
    // 背景色
    bgLayout: isDark ? '#0E1826' : '#EEF2F6',
    bgContainer: isDark ? '#152131' : '#FFFFFF',
    bgElevated: isDark ? '#1A2B40' : '#FFFFFF',
    // 文字色
    textBase: isDark ? '#E7EDF6' : '#152131',
    textSecondary: isDark ? '#A0B0C6' : '#5A6B7C',
    // 边框色
    borderSecondary: isDark ? '#25374B' : '#D7DFEA',
    // 交互状态背景
    itemSelectedBg: isDark ? '#1A2B40' : '#EAF1FE',
    itemHoverBg: isDark ? '#182639' : '#F5F8FC',
  } as const

  return {
    algorithm: isDark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
    token: {
      // === 品牌色 ===
      colorPrimary: colors.primary,
      colorInfo: colors.primary,
      colorSuccess: colors.success,
      colorWarning: colors.warning,
      colorError: colors.error,

      // === 背景色 ===
      colorBgLayout: colors.bgLayout,
      colorBgContainer: colors.bgContainer,
      colorBgElevated: colors.bgElevated,

      // === 文字色 ===
      colorTextBase: colors.textBase,
      colorTextLightSolid: '#ffffff',

      // === 边框与分割线 ===
      colorBorderSecondary: colors.borderSecondary,

      // === 圆角体系 ===
      borderRadius: BORDER_RADIUS.md,
      borderRadiusLG: BORDER_RADIUS.lg,
      borderRadiusSM: BORDER_RADIUS.sm,
      borderRadiusXS: 6,

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
      fontFamily: CONSOLE_FONT_FAMILY,

      // === 间距体系 ===
      paddingXS: SPACING.xs,
      paddingSM: SPACING.sm,
      padding: SPACING.md,
      paddingLG: SPACING.lg,
      paddingXL: SPACING.xl,
      // 注意: paddingXXL 不是标准 AliasToken，通过 paddingXL 扩展

      // === 控制组件尺寸 ===
      controlHeight: 40,
      controlHeightSM: 32,
      controlHeightLG: 48,

      // === 阴影 ===
      boxShadow: '0 4px 20px -2px rgba(99, 102, 241, 0.06)',
      boxShadowSecondary: '0 20px 40px -10px rgba(99, 102, 241, 0.08), 0 10px 20px -5px rgba(0, 0, 0, 0.04)',
    },
    components: {
      // === Card 组件 ===
      Card: {
        borderRadiusLG: BORDER_RADIUS.lg,
        bodyPadding: SPACING.xl,
        bodyPaddingSM: SPACING.lg,
        headerHeight: 52,
        headerHeightSM: 44,
        headerFontSize: 16,
        headerPadding: SPACING.lg,
      },

      // === Layout 组件 ===
      Layout: {
        headerBg: 'transparent',
        siderBg: 'transparent',
        bodyBg: 'transparent',
      },

      // === Menu 组件 ===
      Menu: {
        itemBorderRadius: BORDER_RADIUS.md,
        itemMarginInline: SPACING.xs,
        itemMarginBlock: SPACING.xs,
        itemSelectedBg: colors.itemSelectedBg,
        itemSelectedColor: colors.primary,
        itemHoverBg: colors.itemHoverBg,
        itemHoverColor: isDark ? colors.textBase : colors.primary,
        itemColor: colors.textSecondary,
        itemHeight: 44,
        iconSize: 18,
        iconMarginInlineEnd: SPACING.sm,
        // 深色模式专用
        darkItemBg: 'transparent',
        darkItemSelectedBg: colors.itemSelectedBg,
        darkItemSelectedColor: colors.primary,
        darkItemHoverBg: colors.itemHoverBg,
        darkItemHoverColor: colors.textBase,
        darkItemColor: colors.textSecondary,
      },

      // === Button 组件 ===
      Button: {
        borderRadius: 12,
        controlHeight: 40,
        controlHeightSM: 32,
        controlHeightLG: 48,
        fontWeight: 600,
        paddingInline: SPACING.lg,
        paddingInlineSM: SPACING.md,
        paddingInlineLG: SPACING.xl,
        primaryColor: '#ffffff',
        defaultBg: colors.bgContainer,
        defaultBorderColor: colors.borderSecondary,
        defaultColor: colors.textBase,
      },

      // === Input 组件 ===
      Input: {
        borderRadius: BORDER_RADIUS.md,
        paddingInline: SPACING.lg,
        paddingBlock: 10,
        activeShadow: `0 0 0 2px ${isDark ? 'rgba(140, 184, 255, 0.15)' : 'rgba(20, 87, 217, 0.15)'}`,
      },

      // === InputNumber 组件 ===
      InputNumber: {
        borderRadius: BORDER_RADIUS.md,
      },

      // === Select 组件 ===
      Select: {
        borderRadius: BORDER_RADIUS.md,
      },

      // === Segmented 组件 ===
      Segmented: {
        itemActiveBg: isDark ? '#182639' : '#FFFFFF',
        itemSelectedBg: colors.itemSelectedBg,
        trackBg: isDark ? '#0E1826' : '#D7DFEA',
      },

      // === Tabs 组件 ===
      Tabs: {
        itemSelectedColor: colors.primary,
        itemHoverColor: colors.primary,
        inkBarColor: colors.primary,
        itemColor: colors.textSecondary,
        titleFontSize: 14,
        titleFontSizeLG: 16,
        titleFontSizeSM: 12,
        horizontalItemPadding: '12px 0',
      },

      // === Tag 组件 ===
      Tag: {
        borderRadiusSM: 999,
        defaultBg: isDark ? '#1A2B40' : '#EAF1FE',
        defaultColor: colors.primary,
      },

      // === Drawer 组件 ===
      Drawer: {
        colorBgElevated: colors.bgContainer,
        paddingLG: SPACING.xl,
      },

      // === Modal 组件 ===
      Modal: {
        contentBg: colors.bgContainer,
        headerBg: colors.bgContainer,
        footerBg: colors.bgContainer,
        titleColor: colors.textBase,
        titleFontSize: 18,
        titleLineHeight: 1.4,
        borderRadiusLG: BORDER_RADIUS.lg,
      },

      // === Table 组件 ===
      Table: {
        headerBg: isDark ? '#1A2B40' : '#F5F8FC',
        headerColor: colors.textBase,
        rowHoverBg: colors.itemHoverBg,
        rowSelectedBg: colors.itemSelectedBg,
        borderRadiusLG: BORDER_RADIUS.md,
        cellPaddingBlock: SPACING.md,
        cellPaddingInline: SPACING.lg,
      },

      // === Form 组件 ===
      Form: {
        labelColor: colors.textSecondary,
        labelFontSize: 14,
        labelHeight: 32,
        itemMarginBottom: SPACING.xl,
      },

      // === Tooltip 组件 ===
      Tooltip: {
        colorBgSpotlight: isDark ? '#1A2B40' : '#152131',
        colorTextLightSolid: '#ffffff',
      },

      // === Dropdown 组件 ===
      Dropdown: {
        colorBgElevated: colors.bgElevated,
        controlItemBgHover: colors.itemHoverBg,
        controlItemBgActive: colors.itemSelectedBg,
      },

      // === Popover 组件 ===
      Popover: {
        colorBgElevated: colors.bgElevated,
      },

      // === Message 组件 ===
      Message: {
        contentBg: colors.bgElevated,
      },

      // === Notification 组件 ===
      Notification: {
        colorBgElevated: colors.bgElevated,
      },
    },
  }
}
