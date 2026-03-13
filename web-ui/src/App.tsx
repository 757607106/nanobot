import { Suspense, lazy } from 'react'
import { Spin } from 'antd'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import AppShell from './components/AppShell'

const ChatPage = lazy(() => import('./pages/ChatPage'))
const ConfigPage = lazy(() => import('./pages/ConfigPage'))
const CronPage = lazy(() => import('./pages/CronPage'))
const MainPromptPage = lazy(() => import('./pages/MainPromptPage'))
const SkillsPage = lazy(() => import('./pages/SkillsPage'))
const SystemPage = lazy(() => import('./pages/SystemPage'))

function RouteFallback() {
  return (
    <div className="page-card center-box">
      <Spin size="large" />
    </div>
  )
}

function withRouteSuspense(element: JSX.Element) {
  return <Suspense fallback={<RouteFallback />}>{element}</Suspense>
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<AppShell />}>
          <Route index element={<Navigate to="/chat" replace />} />
          <Route path="chat" element={withRouteSuspense(<ChatPage />)} />
          <Route path="cron" element={withRouteSuspense(<CronPage />)} />
          <Route path="prompt" element={withRouteSuspense(<MainPromptPage />)} />
          <Route path="skills" element={withRouteSuspense(<SkillsPage />)} />
          <Route path="config" element={withRouteSuspense(<ConfigPage />)} />
          <Route path="system" element={withRouteSuspense(<SystemPage />)} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
