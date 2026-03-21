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
      colorPrimary: '#f07a2b',
      colorInfo: '#f59b45',
      colorSuccess: '#2fa76d',
      colorWarning: '#f59e0b',
      colorError: '#db5d38',
      colorBgLayout: isDark ? '#17110f' : '#f7f1ea',
      colorBgContainer: isDark ? '#211815' : '#ffffff',
      colorTextBase: isDark ? '#f5ece4' : '#34261d',
      colorBorderSecondary: isDark ? '#3a2a22' : '#eadfce',
      borderRadius: 10,
      borderRadiusLG: 18,
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
        itemSelectedBg: isDark ? '#3a2418' : '#fff0e4',
        itemSelectedColor: isDark ? '#ffbf84' : '#bf5d1c',
        itemHoverColor: isDark ? '#ffd2aa' : '#c35b1c',
        darkItemBg: 'transparent',
        darkItemSelectedBg: '#3a2418',
        darkItemSelectedColor: '#ffbf84',
        darkItemHoverBg: '#2a1d18',
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
        itemActiveBg: isDark ? '#2f231e' : '#ffffff',
        itemSelectedBg: isDark ? '#473127' : '#ffffff',
        trackBg: isDark ? '#17110f' : '#efe5da',
      },
      Tabs: {
        itemSelectedColor: '#f07a2b',
        inkBarColor: '#f07a2b',
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
