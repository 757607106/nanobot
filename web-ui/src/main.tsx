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
      colorPrimary: '#6f8d80',
      colorInfo: '#8ca4a0',
      colorSuccess: '#7f9b86',
      colorWarning: '#b19a7c',
      colorError: '#bb8b87',
      colorBgLayout: isDark ? '#18201f' : '#edf2ee',
      colorBgContainer: isDark ? '#222a2c' : '#f8fbf8',
      colorTextBase: isDark ? '#edf3ef' : '#46545a',
      colorBorderSecondary: isDark ? 'rgba(214, 223, 218, 0.1)' : 'rgba(126, 143, 136, 0.16)',
      borderRadius: 18,
      borderRadiusLG: 26,
      fontSize: 14,
      fontSizeSM: 13,
      fontSizeLG: 17,
      fontSizeXL: 21,
      fontSizeHeading1: 48,
      fontSizeHeading2: 32,
      fontSizeHeading3: 24,
      fontSizeHeading4: 19,
      fontSizeHeading5: 17,
      lineHeight: 1.6,
      fontFamily: '"IBM Plex Sans", "Avenir Next", "PingFang SC", "Microsoft YaHei", sans-serif',
    },
    components: {
      Card: {
        borderRadiusLG: 26,
        bodyPadding: 24,
        bodyPaddingSM: 20,
        headerHeight: 58,
        headerHeightSM: 50,
        headerFontSize: 17,
        colorBgContainer: isDark ? 'rgba(34, 42, 44, 0.74)' : 'rgba(250, 252, 249, 0.72)',
      },
      Layout: {
        headerBg: 'transparent',
        siderBg: 'transparent',
        bodyBg: 'transparent',
      },
      Menu: {
        itemBorderRadius: 16,
        itemMarginInline: 0,
        itemMarginBlock: 4,
        itemSelectedBg: isDark ? 'rgba(139, 160, 150, 0.18)' : 'rgba(111, 141, 128, 0.12)',
        itemSelectedColor: isDark ? '#f1f5f1' : '#688275',
        itemHoverColor: isDark ? '#f1f5f1' : '#688275',
        darkItemBg: 'transparent',
        darkItemSelectedBg: 'rgba(139, 160, 150, 0.18)',
        darkItemSelectedColor: '#f1f5f1',
        darkItemHoverBg: 'rgba(255, 255, 255, 0.05)',
        darkItemHoverColor: '#f1f5f1',
        darkItemColor: 'rgba(232, 236, 236, 0.88)',
      },
      Button: {
        borderRadius: 16,
        controlHeight: 42,
        fontWeight: 600,
      },
      Input: {
        borderRadius: 15,
      },
      InputNumber: {
        borderRadius: 15,
      },
      Select: {
        borderRadius: 15,
      },
      Segmented: {
        itemActiveBg: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(255, 255, 255, 0.82)',
        itemSelectedBg: isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(255, 255, 255, 0.92)',
        trackBg: isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(111, 141, 128, 0.08)',
      },
      Tabs: {
        itemSelectedColor: '#6f8d80',
        inkBarColor: '#6f8d80',
      },
      Tag: {
        borderRadiusSM: 999,
      },
      Drawer: {
        colorBgElevated: isDark ? '#1f2728' : '#f5f8f4',
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
