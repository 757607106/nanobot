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
      colorPrimary: '#3182ce',
      colorInfo: '#3182ce',
      colorSuccess: '#38a169',
      colorWarning: '#ecc94b',
      colorError: '#e53e3e',
      colorBgLayout: isDark ? '#1a202c' : '#f7fafc',
      colorBgContainer: isDark ? '#2d3748' : '#ffffff',
      colorTextBase: isDark ? '#f7fafc' : '#1a202c',
      colorTextLightSolid: isDark ? '#1a202c' : '#ffffff',
      colorBorderSecondary: isDark ? '#4a5568' : '#e2e8f0',
      borderRadius: 10,
      borderRadiusLG: 18,
      fontSize: 14,
      fontSizeSM: 12,
      fontSizeLG: 16,
      fontSizeXL: 24,
      fontSizeHeading1: 24,
      fontSizeHeading2: 24,
      fontSizeHeading3: 16,
      fontSizeHeading4: 16,
      fontSizeHeading5: 16,
      fontWeightStrong: 600,
      lineHeight: 1.5,
      fontFamily: '"Inter", "PingFang SC", "Microsoft YaHei", sans-serif',
    },
    components: {
      Card: {
        borderRadiusLG: 18,
        bodyPadding: 24,
        bodyPaddingSM: 20,
        headerHeight: 52,
        headerHeightSM: 44,
        headerFontSize: 16,
        colorBgContainer: isDark ? '#211815' : '#ffffff',
      },
      Layout: {
        headerBg: 'transparent',
        siderBg: 'transparent',
        bodyBg: 'transparent',
      },
      Menu: {
        itemBorderRadius: 12,
        itemMarginInline: 4,
        itemMarginBlock: 4,
        itemSelectedBg: isDark ? '#2a4365' : '#ebf8ff',
        itemSelectedColor: isDark ? '#bee3f8' : '#2b6cb0',
        itemHoverColor: isDark ? '#f7fafc' : '#2c5282',
        darkItemBg: 'transparent',
        darkItemSelectedBg: '#2a4365',
        darkItemSelectedColor: '#bee3f8',
        darkItemHoverBg: '#2d3748',
        darkItemHoverColor: '#ebf8ff',
        darkItemColor: '#a0aec0',
      },
      Button: {
        borderRadius: 10,
        controlHeight: 36,
        fontWeight: 600,
      },
      Input: {
        borderRadius: 10,
      },
      InputNumber: {
        borderRadius: 10,
      },
      Select: {
        borderRadius: 10,
      },
      Segmented: {
        itemActiveBg: isDark ? '#2d3748' : '#ffffff',
        itemSelectedBg: isDark ? '#4a5568' : '#edf2f7',
        trackBg: isDark ? '#1a202c' : '#e2e8f0',
      },
      Tabs: {
        itemSelectedColor: isDark ? '#63b3ed' : '#3182ce',
        inkBarColor: isDark ? '#63b3ed' : '#3182ce',
      },
      Tag: {
        borderRadiusSM: 999,
      },
      Drawer: {
        colorBgElevated: isDark ? '#1a202c' : '#ffffff',
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
          stiffness: 300,
          damping: 30,
          mass: 0.8,
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
