import type { ReactNode } from 'react'
import { Suspense, lazy } from 'react'
import { Button, Card, Flex, Spin, Typography } from 'antd'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import AppShell from './components/AppShell'
import { AuthProvider, useAuth } from './auth'
import { DevModeProvider } from './devMode'
import { SetupProvider, useSetup } from './setup'
import { testIds } from './testIds'

const ChatPage = lazy(() => import('./pages/ChatPage'))
const DashboardPage = lazy(() => import('./pages/DashboardPage'))
const ChannelsPage = lazy(() => import('./pages/channels').then((m) => ({ default: m.ChannelsPage })))
const ChannelDetailPage = lazy(() => import('./pages/channels').then((m) => ({ default: m.ChannelDetailPage })))
const LoginPage = lazy(() => import('./pages/LoginPage'))
const McpPage = lazy(() => import('./pages/mcp'))
const ModelsPage = lazy(() => import('./pages/models'))
const OperationsPage = lazy(() => import('./pages/OperationsPage'))
const ProfilePage = lazy(() => import('./pages/ProfilePage'))
const PreferencesPage = lazy(() => import('./pages/PreferencesPage'))
const AutomationPage = lazy(() => import('./pages/AutomationPage'))
const SetupPage = lazy(() => import('./pages/SetupPage'))
const SkillsPage = lazy(() => import('./pages/SkillsPage'))
const StudioLayoutPage = lazy(() => import('./pages/StudioLayoutPage'))
const AgentsPage = lazy(() => import('./pages/agents'))
const AgentChatPage = lazy(() => import('./pages/AgentChatPage'))
const RunsPage = lazy(() => import('./pages/runs'))
const KnowledgePage = lazy(() => import('./pages/knowledge').then((m) => ({ default: m.KnowledgePage })))
const KnowledgeFilePreviewPage = lazy(() => import('./pages/knowledge').then((m) => ({ default: m.KnowledgeFilePreviewPage })))
const SystemLayoutPage = lazy(() => import('./pages/SystemLayoutPage'))
const SystemPage = lazy(() => import('./pages/SystemPage'))
const ValidationPage = lazy(() => import('./pages/ValidationPage'))
const ChannelBindingsPage = lazy(() => import('./pages/channels').then((m) => ({ default: m.ChannelBindingsPage })))
const ChannelAuditPage = lazy(() => import('./pages/channels').then((m) => ({ default: m.ChannelAuditPage })))
const ChannelsLayoutPage = lazy(() => import('./pages/channels').then((m) => ({ default: m.ChannelsLayoutPage })))
const TenantsPage = lazy(() => import('./pages/tenants').then((m) => ({ default: m.TenantsPage })))
const TemplatesPage = lazy(() => import('./pages/templates').then((m) => ({ default: m.TemplatesPage })))

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

function RouteStateCard({
  title,
  description,
  actionLabel,
  actionTestId,
  onAction,
}: {
  title: string
  description: string
  actionLabel: string
  actionTestId: string
  onAction: () => void
}) {
  return (
    <div className="page-card center-box route-state-card">
      <Card variant="borderless" className="route-state-copy" style={{ width: 'min(100%, 28rem)' }}>
        <Flex vertical gap={16} align="flex-start">
          <Typography.Title level={4} style={{ margin: 0 }}>
            {title}
          </Typography.Title>
          <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
            {description}
          </Typography.Paragraph>
          <Button type="primary" onClick={onAction} data-testid={actionTestId}>
            {actionLabel}
          </Button>
        </Flex>
      </Card>
    </div>
  )
}

function AuthStateError() {
  const { error, refresh } = useAuth()

  return (
    <RouteStateCard
      title="登录状态检查失败"
      description={error || '暂时无法连接认证接口。'}
      actionLabel="重新检查"
      actionTestId={testIds.app.authStateRetry}
      onAction={() => void refresh()}
    />
  )
}

function SetupStateError() {
  const { error, refresh } = useSetup()

  return (
    <RouteStateCard
      title="初始化配置状态检查失败"
      description={error || '暂时无法读取初始化配置进度。'}
      actionLabel="重新检查"
      actionTestId={testIds.app.setupStateRetry}
      onAction={() => void refresh()}
    />
  )
}

function AuthIndexRedirect() {
  const { loading, error, status } = useAuth()
  const setup = useSetup()

  if (!status && (loading || !error)) {
    return <RouteFallback />
  }

  if (error && !status) {
    return <AuthStateError />
  }

  if (!status?.authenticated) {
    return <Navigate to="/login" replace />
  }

  if (!setup.status && (setup.loading || !setup.error)) {
    return <RouteFallback />
  }

  if (setup.error && !setup.status) {
    return <SetupStateError />
  }

  return <Navigate to={setup.status?.completed ? '/dashboard' : '/setup'} replace />
}

function RequireAuth({ children }: { children: ReactNode }) {
  const location = useLocation()
  const { loading, error, status } = useAuth()
  const setup = useSetup()

  if (!status && (loading || !error)) {
    return <RouteFallback />
  }

  if (error && !status) {
    return <AuthStateError />
  }

  if (!status?.initialized || !status.authenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />
  }

  if (!setup.status && (setup.loading || !setup.error)) {
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

  if (!status && (loading || !error)) {
    return <RouteFallback />
  }

  if (error && !status) {
    return <AuthStateError />
  }

  if (status?.initialized && status.authenticated) {
    if (!setup.status && (setup.loading || !setup.error)) {
      return <RouteFallback />
    }
    if (setup.error && !setup.status) {
      return <SetupStateError />
    }
    return <Navigate to={setup.status?.completed ? '/dashboard' : '/setup'} replace />
  }

  return <>{children}</>
}

function SetupOnly({ children }: { children: ReactNode }) {
  const { loading, error, status } = useAuth()
  const setup = useSetup()

  if (!status && (loading || !error)) {
    return <RouteFallback />
  }

  if (error && !status) {
    return <AuthStateError />
  }

  if (!status?.initialized || !status.authenticated) {
    return <Navigate to="/login" replace />
  }

  if (!setup.status && (setup.loading || !setup.error)) {
    return <RouteFallback />
  }

  if (setup.error && !setup.status) {
    return <SetupStateError />
  }

  if (setup.status?.completed) {
    return <Navigate to="/dashboard" replace />
  }

  return <>{children}</>
}

function LegacyKnowledgeRedirect() {
  const location = useLocation()
  return (
    <Navigate
      to={`${location.pathname.replace('/studio/knowledge', '/knowledge')}${location.search}${location.hash}`}
      replace
    />
  )
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
        path="knowledge/:kbId/files/:fileId/preview"
        element={(
          <RequireAuth>
            {withRouteSuspense(<KnowledgeFilePreviewPage />)}
          </RequireAuth>
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
        <Route path="dashboard" element={withRouteSuspense(<DashboardPage />)} />
        <Route path="chat" element={withRouteSuspense(<ChatPage />)} />
        <Route path="chat/agent/:agentId" element={withRouteSuspense(<AgentChatPage />)} />
        <Route path="channels" element={withRouteSuspense(<ChannelsLayoutPage />)}>
          <Route index element={<Navigate to="list" replace />} />
          <Route path="list" element={withRouteSuspense(<ChannelsPage />)} />
          <Route path="bindings" element={withRouteSuspense(<ChannelBindingsPage />)} />
          <Route path="bindings/new" element={withRouteSuspense(<ChannelBindingsPage />)} />
          <Route path="bindings/:bindingId" element={withRouteSuspense(<ChannelBindingsPage />)} />
          <Route path="audit" element={withRouteSuspense(<ChannelAuditPage />)} />
        </Route>
        <Route path="channels/:channelName" element={withRouteSuspense(<ChannelDetailPage />)} />
        <Route path="models" element={withRouteSuspense(<ModelsPage />)} />
        <Route path="knowledge" element={withRouteSuspense(<KnowledgePage />)} />
        <Route path="knowledge/new" element={withRouteSuspense(<KnowledgePage />)} />
        <Route path="knowledge/:kbId" element={withRouteSuspense(<KnowledgePage />)} />
        <Route path="studio" element={withRouteSuspense(<StudioLayoutPage />)}>
          <Route index element={<Navigate to="agents" replace />} />
          <Route path="agents" element={withRouteSuspense(<AgentsPage />)} />
          <Route path="agents/new" element={withRouteSuspense(<AgentsPage />)} />
          <Route path="agents/:agentId" element={withRouteSuspense(<AgentsPage />)} />
          <Route path="agents/:agentId/chat" element={withRouteSuspense(<AgentChatPage />)} />
          <Route path="templates" element={withRouteSuspense(<TemplatesPage />)} />
          <Route
            path="runs"
            element={withRouteSuspense(<RunsPage />)}
          />
          <Route path="runs/:runId" element={withRouteSuspense(<RunsPage />)} />
          <Route path="knowledge" element={<LegacyKnowledgeRedirect />} />
          <Route path="knowledge/new" element={<LegacyKnowledgeRedirect />} />
          <Route path="knowledge/:kbId" element={<LegacyKnowledgeRedirect />} />
        </Route>
        <Route path="mcp" element={withRouteSuspense(<McpPage />)} />
        <Route path="mcp/:serverName" element={withRouteSuspense(<McpPage />)} />
        <Route path="skills" element={withRouteSuspense(<SkillsPage />)} />
        <Route path="system" element={withRouteSuspense(<SystemLayoutPage />)}>
          <Route index element={withRouteSuspense(<SystemPage />)} />
          <Route path="preferences" element={withRouteSuspense(<PreferencesPage />)} />
          <Route path="validation" element={withRouteSuspense(<ValidationPage />)} />
          <Route path="automation" element={withRouteSuspense(<AutomationPage />)} />
          <Route path="operations" element={withRouteSuspense(<OperationsPage />)} />
          <Route path="admin" element={withRouteSuspense(<ProfilePage />)} />
          <Route path="tenants" element={withRouteSuspense(<TenantsPage />)} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AuthProvider>
        <SetupProvider>
          <DevModeProvider>
            <AppRoutes />
          </DevModeProvider>
        </SetupProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}
