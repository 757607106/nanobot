import type { ReactNode } from 'react'
import { Suspense, lazy } from 'react'
import { Button, Spin, Typography } from 'antd'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import AppShell from './components/AppShell'
import { AuthProvider, useAuth } from './auth'
import { SetupProvider, useSetup } from './setup'
import { testIds } from './testIds'

const ChatPage = lazy(() => import('./pages/ChatPage'))
const ChannelDetailPage = lazy(() => import('./pages/ChannelDetailPage'))
const ChannelsPage = lazy(() => import('./pages/ChannelsPage'))
const LoginPage = lazy(() => import('./pages/LoginPage'))
const MainPromptPage = lazy(() => import('./pages/MainPromptPage'))
const McpPage = lazy(() => import('./pages/McpPage'))
const McpServerDetailPage = lazy(() => import('./pages/McpServerDetailPage'))
const ModelsPage = lazy(() => import('./pages/ModelsPage'))
const OperationsPage = lazy(() => import('./pages/OperationsPage'))
const ProfilePage = lazy(() => import('./pages/ProfilePage'))
const AutomationPage = lazy(() => import('./pages/AutomationPage'))
const SetupPage = lazy(() => import('./pages/SetupPage'))
const SkillsPage = lazy(() => import('./pages/SkillsPage'))
const StudioLayoutPage = lazy(() => import('./pages/StudioLayoutPage'))
const AgentsPage = lazy(() => import('./pages/AgentsPage'))
const TeamsPage = lazy(() => import('./pages/TeamsPage'))
const MemoryAuditPage = lazy(() => import('./pages/MemoryAuditPage'))
const RunsPage = lazy(() => import('./pages/RunsPage'))
const KnowledgePage = lazy(() => import('./pages/KnowledgePage'))
const SystemLayoutPage = lazy(() => import('./pages/SystemLayoutPage'))
const SystemPage = lazy(() => import('./pages/SystemPage'))
const TemplatesPage = lazy(() => import('./pages/TemplatesPage'))
const ValidationPage = lazy(() => import('./pages/ValidationPage'))

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

function AuthStateError() {
  const { error, refresh } = useAuth()

  return (
    <div className="page-card center-box route-state-card">
      <div className="route-state-copy">
        <Typography.Title level={4}>登录状态检查失败</Typography.Title>
        <Typography.Paragraph>{error || '暂时无法连接认证接口。'}</Typography.Paragraph>
        <Button type="primary" onClick={() => void refresh()} data-testid={testIds.app.authStateRetry}>
          重新检查
        </Button>
      </div>
    </div>
  )
}

function SetupStateError() {
  const { error, refresh } = useSetup()

  return (
    <div className="page-card center-box route-state-card">
      <div className="route-state-copy">
        <Typography.Title level={4}>初始化向导状态检查失败</Typography.Title>
        <Typography.Paragraph>{error || '暂时无法读取首次配置进度。'}</Typography.Paragraph>
        <Button type="primary" onClick={() => void refresh()} data-testid={testIds.app.setupStateRetry}>
          重新检查
        </Button>
      </div>
    </div>
  )
}

function AuthIndexRedirect() {
  const { loading, error, status } = useAuth()
  const setup = useSetup()

  if (loading) {
    return <RouteFallback />
  }

  if (error && !status) {
    return <AuthStateError />
  }

  if (!status?.authenticated) {
    return <Navigate to="/login" replace />
  }

  if (setup.loading || (!setup.status && !setup.error)) {
    return <RouteFallback />
  }

  if (setup.error && !setup.status) {
    return <SetupStateError />
  }

  return <Navigate to={setup.status?.completed ? '/chat' : '/setup'} replace />
}

function RequireAuth({ children }: { children: ReactNode }) {
  const location = useLocation()
  const { loading, error, status } = useAuth()
  const setup = useSetup()

  if (loading) {
    return <RouteFallback />
  }

  if (error && !status) {
    return <AuthStateError />
  }

  if (!status?.initialized || !status.authenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />
  }

  if (setup.loading || (!setup.status && !setup.error)) {
    return <RouteFallback />
  }

  if (setup.error && !setup.status) {
    return <SetupStateError />
  }

  if (!setup.status?.completed) {
    return <Navigate to="/setup" replace />
  }

  return <>{children}</>
}

function GuestOnly({ children }: { children: ReactNode }) {
  const { loading, error, status } = useAuth()
  const setup = useSetup()

  if (loading) {
    return <RouteFallback />
  }

  if (error && !status) {
    return <AuthStateError />
  }

  if (status?.initialized && status.authenticated) {
    if (setup.loading || (!setup.status && !setup.error)) {
      return <RouteFallback />
    }
    if (setup.error && !setup.status) {
      return <SetupStateError />
    }
    return <Navigate to={setup.status?.completed ? '/chat' : '/setup'} replace />
  }

  return <>{children}</>
}

function SetupOnly({ children }: { children: ReactNode }) {
  const { loading, error, status } = useAuth()
  const setup = useSetup()

  if (loading) {
    return <RouteFallback />
  }

  if (error && !status) {
    return <AuthStateError />
  }

  if (!status?.initialized || !status.authenticated) {
    return <Navigate to="/login" replace />
  }

  if (setup.loading || (!setup.status && !setup.error)) {
    return <RouteFallback />
  }

  if (setup.error && !setup.status) {
    return <SetupStateError />
  }

  if (setup.status?.completed) {
    return <Navigate to="/chat" replace />
  }

  return <>{children}</>
}

export function AppRoutes() {
  return (
    <Routes>
      <Route index element={<AuthIndexRedirect />} />
      <Route
        path="login"
        element={(
          <GuestOnly>
            {withRouteSuspense(<LoginPage />)}
          </GuestOnly>
        )}
      />
      <Route
        path="setup"
        element={(
          <SetupOnly>
            {withRouteSuspense(<SetupPage />)}
          </SetupOnly>
        )}
      />
      <Route
        path="/"
        element={(
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        )}
      >
        <Route path="chat" element={withRouteSuspense(<ChatPage />)} />
        <Route path="channels" element={withRouteSuspense(<ChannelsPage />)} />
        <Route path="channels/:channelName" element={withRouteSuspense(<ChannelDetailPage />)} />
        <Route path="models" element={withRouteSuspense(<ModelsPage />)} />
        <Route path="studio" element={withRouteSuspense(<StudioLayoutPage />)}>
          <Route index element={<Navigate to="agents" replace />} />
          <Route path="agents" element={withRouteSuspense(<AgentsPage />)} />
          <Route path="agents/new" element={withRouteSuspense(<AgentsPage />)} />
          <Route path="agents/:agentId" element={withRouteSuspense(<AgentsPage />)} />
          <Route path="teams" element={withRouteSuspense(<TeamsPage />)} />
          <Route path="teams/new" element={withRouteSuspense(<TeamsPage />)} />
          <Route path="teams/:teamId" element={withRouteSuspense(<TeamsPage />)} />
          <Route path="memory" element={withRouteSuspense(<MemoryAuditPage />)} />
          <Route path="memory/:teamId" element={withRouteSuspense(<MemoryAuditPage />)} />
          <Route
            path="runs"
            element={withRouteSuspense(<RunsPage />)}
          />
          <Route path="runs/:runId" element={withRouteSuspense(<RunsPage />)} />
          <Route
            path="knowledge"
            element={withRouteSuspense(<KnowledgePage />)}
          />
          <Route path="knowledge/new" element={withRouteSuspense(<KnowledgePage />)} />
          <Route path="knowledge/:kbId" element={withRouteSuspense(<KnowledgePage />)} />
          <Route path="templates" element={withRouteSuspense(<TemplatesPage />)} />
        </Route>
        <Route path="mcp" element={withRouteSuspense(<McpPage />)} />
        <Route path="mcp/:serverName" element={withRouteSuspense(<McpServerDetailPage />)} />
        <Route path="prompt" element={withRouteSuspense(<MainPromptPage />)} />
        <Route path="skills" element={withRouteSuspense(<SkillsPage />)} />
        <Route path="system" element={withRouteSuspense(<SystemLayoutPage />)}>
          <Route index element={withRouteSuspense(<SystemPage />)} />
          <Route path="validation" element={withRouteSuspense(<ValidationPage />)} />
          <Route path="automation" element={withRouteSuspense(<AutomationPage />)} />
          <Route path="templates" element={withRouteSuspense(<TemplatesPage />)} />
          <Route path="operations" element={withRouteSuspense(<OperationsPage />)} />
          <Route path="admin" element={withRouteSuspense(<ProfilePage />)} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <SetupProvider>
          <AppRoutes />
        </SetupProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}
