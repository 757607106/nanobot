import { screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppRoutes } from './App'
import { renderWithProviders } from './test/renderApp'

const mockApi = vi.hoisted(() => ({
  getAuthStatus: vi.fn(),
  getSetupStatus: vi.fn(),
  getConfig: vi.fn(),
  getConfigMeta: vi.fn(),
}))

vi.mock('./api', () => ({
  ApiError: class MockApiError extends Error {
    statusCode = 0
    code?: string
    details?: unknown
  },
  api: mockApi,
}))

function makeConfig() {
  return {
    agents: {
      defaults: {
        workspace: '/tmp/workspace',
        model: 'deepseek/deepseek-chat',
        provider: 'deepseek',
        maxTokens: 4096,
        contextWindowTokens: 128000,
        temperature: 0.7,
        maxToolIterations: 12,
        reasoningEffort: 'medium',
      },
    },
    providers: {
      deepseek: {
        apiKey: 'sk-test',
        apiBase: 'https://api.deepseek.com',
        extraHeaders: {},
      },
    },
    channels: {
      sendProgress: true,
      sendToolHints: true,
      telegram: {
        enabled: false,
        token: '',
        allowFrom: [],
      },
    },
    gateway: {
      host: '127.0.0.1',
      port: 18790,
      heartbeat: {
        enabled: true,
        intervalS: 1800,
      },
    },
    tools: {
      restrictToWorkspace: true,
      web: {
        proxy: '',
        search: {
          apiKey: '',
          maxResults: 5,
        },
      },
      mcpServers: {},
    },
  }
}

function makeConfigMeta() {
  return {
    providers: [
      {
        name: 'deepseek',
        label: 'DeepSeek',
        category: 'standard' as const,
        keywords: ['deepseek'],
        defaultApiBase: 'https://api.deepseek.com',
        supportsPromptCaching: false,
        isGateway: false,
        isLocal: false,
        isOauth: false,
        isDirect: false,
      },
    ],
    resolvedProvider: 'deepseek',
  }
}

function makeSetupStatus() {
  return {
    completed: false,
    currentStep: 'provider' as const,
    completedAt: null,
    steps: [
      { key: 'provider' as const, label: '模型供应商', optional: false, complete: false },
      { key: 'channel' as const, label: '消息频道', optional: true, complete: false, skipped: false },
      { key: 'agent' as const, label: 'Agent 默认值', optional: false, complete: false },
    ],
  }
}

describe('setup route', () => {
  beforeEach(() => {
    window.localStorage.clear()
    mockApi.getAuthStatus.mockReset()
    mockApi.getSetupStatus.mockReset()
    mockApi.getConfig.mockReset()
    mockApi.getConfigMeta.mockReset()

    mockApi.getAuthStatus.mockResolvedValue({
      initialized: true,
      authenticated: true,
      username: 'admin',
    })
    mockApi.getSetupStatus.mockResolvedValue(makeSetupStatus())
    mockApi.getConfig.mockResolvedValue(makeConfig())
    mockApi.getConfigMeta.mockResolvedValue(makeConfigMeta())
  })

  it('renders setup once without triggering a request loop', async () => {
    renderWithProviders(
      <MemoryRouter
        initialEntries={['/setup']}
        future={{
          v7_startTransition: true,
          v7_relativeSplatPath: true,
        }}
      >
        <AppRoutes />
      </MemoryRouter>,
    )

    expect(await screen.findByText('欢迎使用 Nanobot', undefined, { timeout: 3000 })).toBeInTheDocument()

    await waitFor(() => {
      expect(mockApi.getAuthStatus).toHaveBeenCalledTimes(1)
      expect(mockApi.getSetupStatus).toHaveBeenCalledTimes(1)
      expect(mockApi.getConfig).toHaveBeenCalledTimes(1)
      expect(mockApi.getConfigMeta).toHaveBeenCalledTimes(1)
    })
  })
})
