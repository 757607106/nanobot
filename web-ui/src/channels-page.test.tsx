import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ChannelsPage } from './pages/channels'
import { renderWithProviders } from './test/renderApp'

const mockApi = vi.hoisted(() => ({
  getAuthStatus: vi.fn(),
  getSetupStatus: vi.fn(),
  getChannels: vi.fn(),
  getChannel: vi.fn(),
  updateChannel: vi.fn(),
  updateChannelDelivery: vi.fn(),
  testChannel: vi.fn(),
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
        statusDetail: '当前实例会在运行时加载 Telegram 渠道。',
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

function makeChannelDetail(channelName = 'telegram') {
  const list = makeChannelsList()
  const channel = list.items.find((item) => item.name === channelName) ?? list.items[0]
  const configMap: Record<string, Record<string, unknown>> = {
    telegram: {
      enabled: true,
      token: '123456:ABCDEF',
      allowFrom: ['alice'],
      proxy: 'http://127.0.0.1:7890',
      groupPolicy: 'mention',
      replyToMessage: true,
    },
    discord: {
      enabled: false,
      token: '',
      allowFrom: [],
      gatewayUrl: '',
      intents: 0,
      groupPolicy: 'mention',
    },
  }

  return {
    delivery: list.delivery,
    channel,
    config: configMap[channel.name] ?? { enabled: false },
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
      <ChannelsPage />
    </MemoryRouter>,
  )
}

describe('ChannelsPage', () => {
  beforeEach(() => {
    mockApi.getAuthStatus.mockReset()
    mockApi.getSetupStatus.mockReset()
    mockApi.getChannels.mockReset()
    mockApi.getChannel.mockReset()
    mockApi.updateChannel.mockReset()
    mockApi.updateChannelDelivery.mockReset()
    mockApi.testChannel.mockReset()

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
    mockApi.getChannel.mockImplementation(async (channelName: string) => makeChannelDetail(channelName))
    mockApi.updateChannel.mockImplementation(async (channelName: string, payload: Record<string, unknown>) => ({
      delivery: makeChannelsList().delivery,
      channel: {
        ...(makeChannelDetail(channelName).channel),
        enabled: Boolean(payload.enabled),
        status: payload.enabled ? 'enabled' : 'configured',
        statusLabel: payload.enabled ? '已启用' : '已配置',
        statusDetail: payload.enabled ? '当前实例会在运行时加载渠道。' : '当前配置可保存但未启用。',
      },
      config: payload,
    }))
    mockApi.updateChannelDelivery.mockResolvedValue(makeChannelsList())
  })

  it('renders the reference-style channels registry layout', async () => {
    renderPage()

    expect(await screen.findByText('消息投递设置')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /保存设置/ })).toBeInTheDocument()
    expect(screen.getByText('Telegram')).toBeInTheDocument()
    expect(screen.getByText('Discord')).toBeInTheDocument()
  })

  it('loads expanded channel details and saves through the update endpoint', async () => {
    const user = userEvent.setup()
    renderPage()

    expect(await screen.findByText('Discord')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Discord/ }))
    expect(await screen.findByText('Discord 渠道仍缺少必要字段。')).toBeInTheDocument()
    await user.type(screen.getByLabelText('机器人 Token'), 'discord-token')
    await user.click(screen.getByRole('button', { name: /保存配置/ }))

    await waitFor(() => {
      expect(mockApi.updateChannel).toHaveBeenCalledTimes(1)
    })

    expect(mockApi.updateChannel.mock.calls[0][0]).toBe('discord')
    expect(mockApi.updateChannel.mock.calls[0][1]).toMatchObject({
      enabled: false,
      token: 'discord-token',
    })
  })
})
