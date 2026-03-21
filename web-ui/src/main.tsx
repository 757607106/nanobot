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
      colorPrimary: '#FF9F43',
      colorInfo: '#FF9F43',
      colorSuccess: '#58D68D',
      colorWarning: '#F39C12',
      colorError: '#db5d38',
      colorBgLayout: isDark ? '#1d1614' : '#F3EEE8',
      colorBgContainer: isDark ? '#2c211e' : '#faf7f3',
      colorTextBase: isDark ? '#f3e8e1' : '#5D4037',
      colorBorderSecondary: isDark ? '#5f4840' : '#d9cec3',
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
        itemSelectedBg: isDark ? '#5a403f' : '#f0d9d9',
        itemSelectedColor: isDark ? '#f0dada' : '#8b5f63',
        itemHoverColor: isDark ? '#f3e8e1' : '#6f544c',
        darkItemBg: 'transparent',
        darkItemSelectedBg: '#5a403f',
        darkItemSelectedColor: '#f0dada',
        darkItemHoverBg: '#3a2c29',
        darkItemHoverColor: '#fff4eb',
        darkItemColor: '#dcc7b7',
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
        itemActiveBg: isDark ? '#4a3734' : '#fffaf8',
        itemSelectedBg: isDark ? '#5a403f' : '#f0d9d9',
        trackBg: isDark ? '#241b19' : '#ece2d8',
      },
      Tabs: {
        itemSelectedColor: isDark ? '#f0dada' : '#8b5f63',
        inkBarColor: isDark ? '#e8c1c1' : '#e8c1c1',
      },
      Tag: {
        borderRadiusSM: 999,
      },
      Drawer: {
        colorBgElevated: isDark ? '#17110f' : '#ffffff',
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
