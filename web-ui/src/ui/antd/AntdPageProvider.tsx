import type { ReactNode } from 'react'
import { App as AntdApp, ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import { useThemeMode } from '../../themeMode'
import { buildAntdThemeConfig } from './theme'

export default function AntdPageProvider({ children }: { children: ReactNode }) {
  const { resolvedTheme } = useThemeMode()

  return (
    <ConfigProvider 
      locale={zhCN} 
      theme={buildAntdThemeConfig(resolvedTheme)}
      renderEmpty={() => (
        <div className="minimal-empty">
          <div className="ant-empty-description">暂无数据</div>
        </div>
      )}
    >
      <AntdApp>
        {children}
      </AntdApp>
    </ConfigProvider>
  )
}
