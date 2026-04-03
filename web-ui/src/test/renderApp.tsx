import { render } from '@testing-library/react'
import type { ReactElement } from 'react'
import { AuthProvider } from '../auth'
import { DevModeProvider } from '../devMode'
import { SetupProvider } from '../setup'
import { ThemeModeProvider } from '../themeMode'
import { ToastProvider } from '../toast'
import AntdPageProvider from '../ui/antd/AntdPageProvider'

export function renderWithProviders(ui: ReactElement) {
  return render(
    <ThemeModeProvider>
      <AntdPageProvider>
        <ToastProvider>
          <AuthProvider>
            <SetupProvider>
              <DevModeProvider>
                {ui}
              </DevModeProvider>
            </SetupProvider>
          </AuthProvider>
        </ToastProvider>
      </AntdPageProvider>
    </ThemeModeProvider>,
  )
}
