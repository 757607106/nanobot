import { render } from '@testing-library/react'
import { App as AntdApp, ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import type { ReactElement } from 'react'
import { AuthProvider } from '../auth'
import { SetupProvider } from '../setup'
import { ThemeModeProvider } from '../themeMode'

export function renderWithProviders(ui: ReactElement) {
  return render(
    <ThemeModeProvider>
      <ConfigProvider locale={zhCN}>
        <AntdApp>
          <AuthProvider>
            <SetupProvider>
              {ui}
            </SetupProvider>
          </AuthProvider>
        </AntdApp>
      </ConfigProvider>
    </ThemeModeProvider>,
  )
}
