import React from 'react'
import ReactDOM from 'react-dom/client'
import { App as AntdApp, ConfigProvider, theme as antdTheme, type ThemeConfig } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import App from './App'
import { ThemeModeProvider, useThemeMode, type ResolvedTheme } from './themeMode'
import 'antd/dist/reset.css'
import './index.css'

function buildThemeConfig(mode: ResolvedTheme): ThemeConfig {
  const isDark = mode === 'dark'

  return {
    algorithm: isDark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
    token: {
      colorPrimary: '#0f7b7b',
      colorInfo: '#3b82f6',
      colorSuccess: '#15803d',
      colorWarning: '#b45309',
      colorError: '#dc2626',
      colorBgLayout: isDark ? '#08121f' : '#eef4f7',
      colorBgContainer: isDark ? '#0d1726' : '#f8fbfd',
      colorTextBase: isDark ? '#e6eef8' : '#132235',
      colorBorderSecondary: isDark ? 'rgba(148, 163, 184, 0.12)' : 'rgba(15, 23, 42, 0.07)',
      borderRadius: 14,
      borderRadiusLG: 20,
      fontSize: 14,
      fontSizeSM: 13,
      fontSizeLG: 15,
      fontSizeXL: 18,
      fontSizeHeading1: 46,
      fontSizeHeading2: 30,
      fontSizeHeading3: 22,
      fontSizeHeading4: 18,
      fontSizeHeading5: 16,
      lineHeight: 1.6,
      fontFamily: '"IBM Plex Sans", "Avenir Next", "PingFang SC", "Microsoft YaHei", sans-serif',
    },
    components: {
      Card: {
        borderRadiusLG: 20,
        bodyPadding: 20,
        bodyPaddingSM: 16,
        headerHeight: 54,
        headerHeightSM: 46,
        headerFontSize: 16,
        colorBgContainer: isDark ? 'rgba(9, 18, 33, 0.84)' : 'rgba(255, 255, 255, 0.88)',
      },
      Layout: {
        headerBg: 'transparent',
        siderBg: 'transparent',
        bodyBg: 'transparent',
      },
      Menu: {
        itemBorderRadius: 14,
        itemMarginInline: 0,
        itemMarginBlock: 4,
        itemSelectedBg: isDark ? 'rgba(118, 201, 193, 0.16)' : 'rgba(15, 123, 123, 0.1)',
        itemSelectedColor: isDark ? '#f8fffe' : '#0f7b7b',
        itemHoverColor: isDark ? '#f8fffe' : '#0f7b7b',
        darkItemBg: 'transparent',
        darkItemSelectedBg: 'rgba(118, 201, 193, 0.16)',
        darkItemSelectedColor: '#f8fffe',
        darkItemHoverBg: 'rgba(255, 255, 255, 0.04)',
        darkItemHoverColor: '#f8fffe',
        darkItemColor: 'rgba(226, 232, 240, 0.88)',
      },
      Button: {
        borderRadius: 14,
        controlHeight: 38,
        fontWeight: 600,
      },
      Input: {
        borderRadius: 12,
      },
      InputNumber: {
        borderRadius: 12,
      },
      Select: {
        borderRadius: 12,
      },
      Segmented: {
        itemActiveBg: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(255, 255, 255, 0.9)',
        itemSelectedBg: isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(255, 255, 255, 0.96)',
        trackBg: isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(15, 23, 42, 0.06)',
      },
      Tabs: {
        itemSelectedColor: '#0f7b7b',
        inkBarColor: '#0f7b7b',
      },
      Tag: {
        borderRadiusSM: 999,
      },
      Drawer: {
        colorBgElevated: isDark ? '#08111f' : '#f7fbff',
      },
    },
  }
}

function ThemedApp() {
  const { resolvedTheme } = useThemeMode()

  return (
    <ConfigProvider locale={zhCN} theme={buildThemeConfig(resolvedTheme)}>
      <AntdApp>
        <App />
      </AntdApp>
    </ConfigProvider>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeModeProvider>
      <ThemedApp />
    </ThemeModeProvider>
  </React.StrictMode>,
)
