import '@testing-library/jest-dom/vitest'
import { cleanup, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import DashboardPage from './pages/DashboardPage'
import { renderWithProviders } from './test/renderApp'

// Mock lazy-loaded chart components to avoid @antv/g-canvas crash in jsdom
vi.mock('./components/dashboard/ModelCallTrendChart', () => ({ default: () => <div data-testid="mock-trend-chart" /> }))
vi.mock('./components/dashboard/TokenConsumptionPieChart', () => ({ default: () => <div data-testid="mock-pie-chart" /> }))
vi.mock('./components/dashboard/ToolUsageBarChart', () => ({ default: () => <div data-testid="mock-bar-chart" /> }))

const mockApi = vi.hoisted(() => ({
  getAuthStatus: vi.fn(),
  getSetupStatus: vi.fn(),
  getChannels: vi.fn(),
  getInstalledSkills: vi.fn(),
  getCronStatus: vi.fn(),
  getChatWorkspace: vi.fn(),
  getAgents: vi.fn(),
  getSystemStatus: vi.fn(),
  getKnowledgeBases: vi.fn(),
  getDashboardAnalytics: vi.fn(),
}))

vi.mock('./api', () => ({
  ApiError: class MockApiError extends Error {
    statusCode = 0
    code?: string
    details?: unknown
  },
  api: mockApi,
}))

function makeChannelsList() {
  return {
    delivery: {
      sendProgress: true,
      sendToolHints: true,
    },
    items: [
      {
        name: 'telegram',
        enabled: true,
        configured: true,
        touched: true,
        status: 'enabled' as const,
        statusLabel: '已启用',
        statusDetail: 'Telegram 渠道已接入当前工作区。',
        missingRequiredFields: [],
      },
      {
        name: 'discord',
        enabled: false,
        configured: false,
        touched: true,
        status: 'incomplete' as const,
        statusLabel: '待补全',
        statusDetail: 'Discord 渠道仍缺少必要字段。',
        missingRequiredFields: ['token'],
      },
    ],
  }
}

function makeAnalyticsResponse() {
  return {
    timeSeries: [],
    toolRanking: [
      { tool: 'web_search', count: 5, agents: ['agent-1'] },
      { tool: 'read_file', count: 3, agents: ['agent-1', 'default'] },
    ],
    overview: {
      totalRuns: 42,
      activeAgents: 3,
      activeModels: 2,
      totalTokens: 12500,
      promptTokens: 8000,
      completionTokens: 4500,
      cachedTokens: 2000,
      runsByStatus: { succeeded: 38, failed: 3, timed_out: 1 },
    },
    agentMetrics: {},
  }
}

function renderPage() {
  return renderWithProviders(
    <MemoryRouter
      future={{
        v7_startTransition: true,
        v7_relativeSplatPath: true,
      }}
    >
      <DashboardPage />
    </MemoryRouter>,
  )
}

describe('DashboardPage', () => {
  afterEach(cleanup)

  beforeEach(() => {
    mockApi.getAuthStatus.mockReset()
    mockApi.getSetupStatus.mockReset()
    mockApi.getChannels.mockReset()
    mockApi.getInstalledSkills.mockReset()
    mockApi.getCronStatus.mockReset()
    mockApi.getChatWorkspace.mockReset()
    mockApi.getDashboardAnalytics.mockReset()

    mockApi.getAuthStatus.mockResolvedValue({
      initialized: true,
      authenticated: true,
      username: 'admin',
    })
    mockApi.getSetupStatus.mockResolvedValue({
      completed: true,
      currentStep: 'done',
      completedAt: '2026-03-20T10:00:00Z',
      steps: [],
    })
    mockApi.getChannels.mockResolvedValue(makeChannelsList())
    mockApi.getInstalledSkills.mockResolvedValue([
      {
        id: 'skill-1',
        name: 'frontend-design',
        description: 'Design helper',
        source: 'workspace',
        path: '/tmp/skills/frontend-design',
        enabled: true,
      },
    ])
    mockApi.getCronStatus.mockResolvedValue({
      enabled: true,
      jobs: 2,
      nextWakeAtMs: Date.now() + 60_000,
      deliveryMode: 'agent_only' as const,
    })
    mockApi.getAgents.mockResolvedValue([])
    mockApi.getSystemStatus.mockResolvedValue({ stats: { enabledChannels: ['telegram'] }, web: { version: '1.0' } })
    mockApi.getKnowledgeBases.mockResolvedValue([])
    mockApi.getDashboardAnalytics.mockResolvedValue(makeAnalyticsResponse())
  })

  it('renders the dashboard with only data-backed metric cards', async () => {
    renderPage()

    expect(await screen.findByText('控制台总览')).toBeInTheDocument()

    // Three real metric cards exist
    expect(screen.getAllByText('总对话数').length).toBeGreaterThan(0)
    expect(screen.getAllByText('智能体数').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/总 Token/).length).toBeGreaterThan(0)

    // Section headers exist
    expect(screen.getByText('AI智能体分析')).toBeInTheDocument()
    expect(screen.getByText('调用统计')).toBeInTheDocument()
    expect(screen.getByText('Token 消费分析')).toBeInTheDocument()

    // Removed fake cards and sections do not exist
    expect(screen.queryByText('总消息数')).not.toBeInTheDocument()
    expect(screen.queryByText('负反馈数')).not.toBeInTheDocument()
    expect(screen.queryByText('满意度')).not.toBeInTheDocument()
    expect(screen.queryByText('活跃对话')).not.toBeInTheDocument()
    expect(screen.queryByText('用户数')).not.toBeInTheDocument()
    expect(screen.queryByText('用户活跃度分析')).not.toBeInTheDocument()
  })

  it('calls the correct backend endpoints', async () => {
    renderPage()
    expect(await screen.findByText('控制台总览')).toBeInTheDocument()

    await waitFor(() => {
      expect(mockApi.getSystemStatus).toHaveBeenCalled()
      expect(mockApi.getAgents).toHaveBeenCalled()
      expect(mockApi.getCronStatus).toHaveBeenCalled()
      expect(mockApi.getKnowledgeBases).toHaveBeenCalled()
      expect(mockApi.getDashboardAnalytics).toHaveBeenCalled()
      expect(mockApi.getChatWorkspace).not.toHaveBeenCalled()
    })
  })

  it('displays real token count from analytics overview', async () => {
    renderPage()

    // totalTokens = 12500 → formatted as "12,500"
    const tokenDisplays = await screen.findAllByText('12,500')
    expect(tokenDisplays.length).toBeGreaterThan(0)
  })

  it('displays real failed count and success rate in tool monitoring', async () => {
    renderPage()

    // Wait for analytics to load and render
    await waitFor(() => {
      // failed=3, timed_out=1 → total=4 failures shown in tool monitoring
      expect(screen.getAllByText('4').length).toBeGreaterThan(0)
    })

    // succeeded=38, total completions=42 → 90% success rate
    await waitFor(() => {
      expect(screen.getAllByText('90%').length).toBeGreaterThan(0)
    })
  })

  it('includes default agent in active agents count', async () => {
    renderPage()

    // activeAgents = 3 (includes "default" agent)
    await waitFor(() => {
      expect(screen.getAllByText('3').length).toBeGreaterThan(0)
    })
  })
})
