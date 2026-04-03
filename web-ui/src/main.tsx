import React from 'react'
import ReactDOM from 'react-dom/client'
import { MotionConfig } from 'framer-motion'
import App from './App'
import { ThemeModeProvider } from './themeMode'
import { ToastProvider } from './toast'
import AntdPageProvider from './ui/antd/AntdPageProvider'
import 'antd/dist/reset.css'
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
