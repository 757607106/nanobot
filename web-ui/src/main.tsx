import React from 'react'
import ReactDOM from 'react-dom/client'
import { App as AntdApp, ConfigProvider, theme as antdTheme, type ThemeConfig } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import { MotionConfig } from 'framer-motion'
import App from './App'
import { ThemeModeProvider, useThemeMode, type ResolvedTheme } from './themeMode'
import 'antd/dist/reset.css'
import './index.css'

function buildThemeConfig(mode: ResolvedTheme): ThemeConfig {
  const isDark = mode === 'dark'

  return {
    algorithm: isDark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
    token: {
      colorPrimary: '#2563eb',
      colorInfo: '#3b82f6',
      colorSuccess: '#10b981',
      colorWarning: '#f59e0b',
      colorError: '#ef4444',
      colorBgLayout: isDark ? '#0f172a' : '#f1f5f9',
      colorBgContainer: isDark ? '#1e293b' : '#ffffff',
      colorTextBase: isDark ? '#f8fafc' : '#1e293b',
      colorBorderSecondary: isDark ? '#334155' : '#e2e8f0',
      borderRadius: 8,
      borderRadiusLG: 12,
      fontSize: 14,
      fontSizeSM: 13,
      fontSizeLG: 16,
      fontSizeXL: 20,
      fontSizeHeading1: 40,
      fontSizeHeading2: 32,
      fontSizeHeading3: 24,
      fontSizeHeading4: 20,
      fontSizeHeading5: 16,
      lineHeight: 1.5,
      fontFamily: '"IBM Plex Sans", "Avenir Next", "PingFang SC", "Microsoft YaHei", sans-serif',
    },
    components: {
      Card: {
        borderRadiusLG: 12,
        bodyPadding: 24,
        bodyPaddingSM: 20,
        headerHeight: 52,
        headerHeightSM: 44,
        headerFontSize: 16,
        colorBgContainer: isDark ? '#1e293b' : '#ffffff',
      },
      Layout: {
        headerBg: 'transparent',
        siderBg: 'transparent',
        bodyBg: 'transparent',
      },
      Menu: {
        itemBorderRadius: 8,
        itemMarginInline: 4,
        itemMarginBlock: 4,
        itemSelectedBg: isDark ? '#1e3a8a' : '#eff6ff',
        itemSelectedColor: isDark ? '#93c5fd' : '#1d4ed8',
        itemHoverColor: isDark ? '#bfdbfe' : '#2563eb',
        darkItemBg: 'transparent',
        darkItemSelectedBg: '#1e3a8a',
        darkItemSelectedColor: '#93c5fd',
        darkItemHoverBg: '#334155',
        darkItemHoverColor: '#f8fafc',
        darkItemColor: '#cbd5e1',
      },
      Button: {
        borderRadius: 8,
        controlHeight: 36,
        fontWeight: 500,
      },
      Input: {
        borderRadius: 6,
      },
      InputNumber: {
        borderRadius: 6,
      },
      Select: {
        borderRadius: 6,
      },
      Segmented: {
        itemActiveBg: isDark ? '#334155' : '#ffffff',
        itemSelectedBg: isDark ? '#475569' : '#ffffff',
        trackBg: isDark ? '#0f172a' : '#e2e8f0',
      },
      Tabs: {
        itemSelectedColor: '#2563eb',
        inkBarColor: '#2563eb',
      },
      Tag: {
        borderRadiusSM: 4,
      },
      Drawer: {
        colorBgElevated: isDark ? '#0f172a' : '#ffffff',
      },
    },
  }
}

function ThemedApp() {
  const { resolvedTheme } = useThemeMode()

  return (
    <ConfigProvider locale={zhCN} theme={buildThemeConfig(resolvedTheme)}>
      <MotionConfig
        transition={{
          type: 'spring',
          stiffness: 170,
          damping: 22,
          mass: 0.9,
        }}
      >
        <AntdApp>
          <App />
        </AntdApp>
      </MotionConfig>
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
