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
      colorPrimary: '#6366F1',
      colorInfo: '#6366F1',
      colorSuccess: '#10B981',
      colorWarning: '#F59E0B',
      colorError: '#EF4444',
      colorBgLayout: isDark ? '#0F0D1A' : '#F8F9FC',
      colorBgContainer: isDark ? '#1A1730' : '#ffffff',
      colorTextBase: isDark ? '#E8E6F0' : '#1E1B4B',
      colorTextLightSolid: isDark ? '#1E1B4B' : '#ffffff',
      colorBorderSecondary: isDark ? '#2D2A4A' : '#E0E0EC',
      borderRadius: 10,
      borderRadiusLG: 16,
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
        borderRadiusLG: 16,
        bodyPadding: 24,
        bodyPaddingSM: 20,
        headerHeight: 52,
        headerHeightSM: 44,
        headerFontSize: 16,
        colorBgContainer: isDark ? '#1A1730' : '#ffffff',
      },
      Layout: {
        headerBg: 'transparent',
        siderBg: 'transparent',
        bodyBg: 'transparent',
      },
      Menu: {
        itemBorderRadius: 10,
        itemMarginInline: 4,
        itemMarginBlock: 4,
        itemSelectedBg: isDark ? '#252247' : '#EEF2FF',
        itemSelectedColor: isDark ? '#A5B4FC' : '#4338CA',
        itemHoverColor: isDark ? '#E8E6F0' : '#4338CA',
        darkItemBg: 'transparent',
        darkItemSelectedBg: '#252247',
        darkItemSelectedColor: '#A5B4FC',
        darkItemHoverBg: '#1E1B3A',
        darkItemHoverColor: '#C7D2FE',
        darkItemColor: '#8B8AA0',
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
        itemActiveBg: isDark ? '#1E1B3A' : '#ffffff',
        itemSelectedBg: isDark ? '#2D2A4A' : '#EEF2FF',
        trackBg: isDark ? '#0F0D1A' : '#E0E0EC',
      },
      Tabs: {
        itemSelectedColor: isDark ? '#A5B4FC' : '#6366F1',
        inkBarColor: isDark ? '#A5B4FC' : '#6366F1',
      },
      Tag: {
        borderRadiusSM: 999,
      },
      Drawer: {
        colorBgElevated: isDark ? '#13112A' : '#ffffff',
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
