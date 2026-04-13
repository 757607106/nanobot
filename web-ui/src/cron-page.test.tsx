import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import CronPage from './pages/CronPage'
import { renderWithProviders } from './test/renderApp'

const mockApi = vi.hoisted(() => ({
  getAuthStatus: vi.fn(),
  getSetupStatus: vi.fn(),
  getCronStatus: vi.fn(),
  getCronJobs: vi.fn(),
  createCronJob: vi.fn(),
  updateCronJob: vi.fn(),
  deleteCronJob: vi.fn(),
  runCronJob: vi.fn(),
}))

vi.mock('./api', () => ({
  ApiError: class MockApiError extends Error {
    statusCode = 0
    code?: string
    details?: unknown
  },
  api: mockApi,
}))

const defaultTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai'

function makeCronStatus() {
  return {
    enabled: true,
    jobs: 1,
    nextWakeAtMs: Date.now() + 60_000,
    deliveryMode: 'agent_only' as const,
  }
}

function makeJobs() {
  return {
    jobs: [
      {
        id: 'cron-1',
        name: 'daily recap',
        enabled: true,
        source: 'user',
        trigger: {
          type: 'cron' as const,
          cronExpr: '0 9 * * *',
          tz: 'Asia/Shanghai',
        },
        payload: {
          kind: 'agent_turn' as const,
          message: 'summarize the latest changes',
          deliver: false,
        },
        nextRunAtMs: Date.now() + 60_000,
        lastRunAtMs: Date.now() - 60_000,
        lastStatus: 'ok' as const,
        lastError: null,
        deleteAfterRun: false,
        createdAtMs: Date.now() - 120_000,
        updatedAtMs: Date.now() - 30_000,
      },
    ],
  }
}

function renderPage() {
  return renderWithProviders(<CronPage />)
}

describe('CronPage', () => {
  beforeEach(() => {
    mockApi.getAuthStatus.mockReset()
    mockApi.getSetupStatus.mockReset()
    mockApi.getCronStatus.mockReset()
    mockApi.getCronJobs.mockReset()
    mockApi.createCronJob.mockReset()
    mockApi.updateCronJob.mockReset()
    mockApi.deleteCronJob.mockReset()
    mockApi.runCronJob.mockReset()

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
    mockApi.getCronStatus.mockResolvedValue(makeCronStatus())
    mockApi.getCronJobs.mockResolvedValue(makeJobs())
    mockApi.createCronJob.mockResolvedValue({
      id: 'cron-2',
    })
  })

  it('renders the reference-style cron registry layout', async () => {
    renderPage()

    expect(await screen.findByText('任务列表')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /新建任务/ })).toBeInTheDocument()
    expect(screen.getByText('daily recap')).toBeInTheDocument()
    expect(screen.getByText('summarize the latest changes')).toBeInTheDocument()
  })

  it('creates cron jobs through the existing backend endpoint', async () => {
    const user = userEvent.setup()
    renderPage()

    expect(await screen.findByText('daily recap')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /新建任务/ }))
    await user.type(screen.getByLabelText('任务名称'), '早间总结')
    await user.type(screen.getByLabelText('执行指令'), '总结昨晚到现在的运行情况')
    await user.click(screen.getByRole('button', { name: '创建任务' }))

    await waitFor(() => {
      expect(mockApi.createCronJob).toHaveBeenCalledTimes(1)
    })

    expect(mockApi.createCronJob.mock.calls[0][0]).toMatchObject({
      name: '早间总结',
      enabled: true,
      triggerType: 'cron',
      triggerCronExpr: '0 9 * * *',
      triggerTz: defaultTimezone,
      payloadKind: 'agent_turn',
      payloadMessage: '总结昨晚到现在的运行情况',
      payloadDeliver: false,
      deleteAfterRun: false,
    })
  })
})
