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
      colorPrimary: '#1f8f88',
      colorInfo: '#2563eb',
      colorSuccess: '#15803d',
      colorWarning: '#b45309',
      colorError: '#dc2626',
      colorBgLayout: isDark ? '#07111f' : '#eef4fb',
      colorBgContainer: isDark ? '#0d1728' : '#f8fbff',
      colorTextBase: isDark ? '#e6eef8' : '#152033',
      colorBorderSecondary: isDark ? 'rgba(148, 163, 184, 0.14)' : 'rgba(15, 23, 42, 0.08)',
      borderRadius: 18,
      borderRadiusLG: 28,
      fontFamily: '"IBM Plex Sans", "Avenir Next", "PingFang SC", "Microsoft YaHei", sans-serif',
    },
    components: {
      Card: {
        borderRadiusLG: 24,
        colorBgContainer: isDark ? 'rgba(9, 18, 33, 0.82)' : 'rgba(255, 255, 255, 0.84)',
      },
      Layout: {
        headerBg: 'transparent',
        siderBg: 'transparent',
        bodyBg: 'transparent',
      },
      Menu: {
        itemBorderRadius: 16,
        itemMarginInline: 0,
        itemMarginBlock: 6,
        itemSelectedBg: isDark ? 'rgba(95, 235, 218, 0.14)' : 'rgba(31, 143, 136, 0.12)',
        itemSelectedColor: isDark ? '#f8fffe' : '#0f766e',
        itemHoverColor: isDark ? '#f8fffe' : '#0f766e',
        darkItemBg: 'transparent',
        darkItemSelectedBg: 'rgba(95, 235, 218, 0.14)',
        darkItemSelectedColor: '#f8fffe',
        darkItemHoverBg: 'rgba(255, 255, 255, 0.04)',
        darkItemHoverColor: '#f8fffe',
        darkItemColor: 'rgba(226, 232, 240, 0.88)',
      },
      Button: {
        borderRadius: 16,
        controlHeight: 44,
        fontWeight: 600,
      },
      Input: {
        borderRadius: 14,
      },
      InputNumber: {
        borderRadius: 14,
      },
      Select: {
        borderRadius: 14,
      },
      Segmented: {
        itemActiveBg: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(255, 255, 255, 0.9)',
        itemSelectedBg: isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(255, 255, 255, 0.96)',
        trackBg: isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(15, 23, 42, 0.06)',
      },
      Tabs: {
        itemSelectedColor: '#1f8f88',
        inkBarColor: '#1f8f88',
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
