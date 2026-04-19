import { screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import DashboardPage from './pages/DashboardPage'
import { renderWithProviders } from './test/renderApp'

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
  beforeEach(() => {
    mockApi.getAuthStatus.mockReset()
    mockApi.getSetupStatus.mockReset()
    mockApi.getChannels.mockReset()
    mockApi.getInstalledSkills.mockReset()
    mockApi.getCronStatus.mockReset()
    mockApi.getChatWorkspace.mockReset()

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
  })

  it('renders the dashboard as a standalone page', async () => {
    renderPage()

    expect(await screen.findByText('控制台总览')).toBeInTheDocument()
    expect(screen.getByText('总运行数')).toBeInTheDocument()
    expect(screen.getByText('知识库')).toBeInTheDocument()
    expect(screen.getAllByText('接入渠道').length).toBeGreaterThan(0)
    expect(screen.getAllByText('创建智能体').length).toBeGreaterThan(0)
    expect(screen.getByText('系统状态')).toBeInTheDocument()
  })

  it('loads standalone dashboard data through the backend summary endpoints', async () => {
    renderPage()

    expect(await screen.findByText('控制台总览')).toBeInTheDocument()

    await waitFor(() => {
      expect(mockApi.getSystemStatus).toHaveBeenCalled()
      expect(mockApi.getAgents).toHaveBeenCalled()
      expect(mockApi.getCronStatus).toHaveBeenCalled()
      expect(mockApi.getKnowledgeBases).toHaveBeenCalled()
      expect(mockApi.getChatWorkspace).not.toHaveBeenCalled()
    })
  })
})
