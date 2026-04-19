import React from 'react'
import ReactDOM from 'react-dom/client'
import { MotionConfig } from 'framer-motion'
import App from './App'
import { ThemeModeProvider } from './themeMode'
import { ToastProvider } from './toast'
import AntdPageProvider from './ui/antd/AntdPageProvider'
import '@fontsource/geist-sans/400.css'
import '@fontsource/geist-sans/500.css'
import '@fontsource/geist-sans/600.css'
import '@fontsource/geist-sans/700.css'
import '@fontsource/geist-mono/400.css'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource-variable/manrope'
import '@fontsource-variable/noto-sans-sc'
import 'antd/dist/reset.css'
import '@ant-design/x-markdown/themes/light.css'
import './styles/layers/theme.css'
import './styles/layers/base.css'
import './styles/layers/components.css'
import './styles/layers/interactions.css'
import './index.css'
import './styles/utilities.css'
import './styles/forms.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeModeProvider>
      <AntdPageProvider>
        <ToastProvider>
          <MotionConfig
            transition={{
              type: 'spring',
              stiffness: 300,
              damping: 30,
              mass: 0.8,
            }}
          >
            <App />
          </MotionConfig>
        </ToastProvider>
      </AntdPageProvider>
    </ThemeModeProvider>
  </React.StrictMode>,
)
