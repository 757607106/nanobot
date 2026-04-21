import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ModelsPage from './pages/models'
import { renderWithProviders } from './test/renderApp'

const mockApi = vi.hoisted(() => ({
  getAuthStatus: vi.fn(),
  getSetupStatus: vi.fn(),
  getConfig: vi.fn(),
  getConfigMeta: vi.fn(),
  getAgents: vi.fn(),
  fetchModelBindingModels: vi.fn(),
  testModelBinding: vi.fn(),
  updateConfig: vi.fn(),
}))

vi.mock('./api', () => ({
  ApiError: class MockApiError extends Error {
    statusCode = 0
    code?: string
    details?: unknown
  },
  api: mockApi,
}))

vi.mock('framer-motion', async () => {
  const React = await import('react')
  return {
    AnimatePresence: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
    motion: new Proxy({}, {
      get: (_target, key: string) =>
        React.forwardRef((props: Record<string, unknown>, ref: React.Ref<unknown>) => {
          const { initial, animate, exit, transition, whileHover, whileTap, whileFocus, variants, ...rest } = props
          return React.createElement(key, { ...rest, ref })
        }),
    }),
  }
})

function makeConfig() {
  return {
    agents: {
      defaults: {
        workspace: '/tmp/workspace',
        model: 'deepseek-chat',
        provider: 'deepseek',
        maxTokens: 4096,
        contextWindowTokens: 128000,
        temperature: 0.3,
        maxToolIterations: 12,
        reasoningEffort: 'medium',
      },
    },
    providers: {
      deepseek: {
        apiKey: 'sk-deepseek',
        apiBase: 'https://api.deepseek.com',
        extraHeaders: {},
      },
      dashscope: {
        apiKey: 'sk-dashscope',
        apiBase: null,
        extraHeaders: {},
      },
      moonshot: {
        apiKey: 'sk-moonshot',
        apiBase: null,
        extraHeaders: {},
      },
      zhipu: {
        apiKey: 'sk-zhipu',
        apiBase: null,
        extraHeaders: {},
      },
      volcengine: {
        apiKey: 'sk-volc',
        apiBase: null,
        extraHeaders: {},
      },
    },
    channels: {
      sendProgress: true,
      sendToolHints: true,
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
      {
        name: 'dashscope',
        label: 'DashScope',
        category: 'standard' as const,
        keywords: ['dashscope', 'qwen'],
        defaultApiBase: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        supportsPromptCaching: false,
        isGateway: false,
        isLocal: false,
        isOauth: false,
        isDirect: false,
      },
      {
        name: 'moonshot',
        label: 'Moonshot',
        category: 'standard' as const,
        keywords: ['moonshot', 'kimi'],
        defaultApiBase: 'https://api.moonshot.ai/v1',
        supportsPromptCaching: false,
        isGateway: false,
        isLocal: false,
        isOauth: false,
        isDirect: false,
      },
      {
        name: 'zhipu',
        label: 'Zhipu AI',
        category: 'standard' as const,
        keywords: ['zhipu', 'glm', 'zai'],
        defaultApiBase: null,
        supportsPromptCaching: false,
        isGateway: false,
        isLocal: false,
        isOauth: false,
        isDirect: false,
      },
      {
        name: 'volcengine',
        label: 'VolcEngine',
        category: 'gateway' as const,
        keywords: ['volcengine', 'ark', 'doubao'],
        defaultApiBase: 'https://ark.cn-beijing.volces.com/api/v3',
        supportsPromptCaching: false,
        isGateway: true,
        isLocal: false,
        isOauth: false,
        isDirect: false,
      },
    ],
    resolvedProvider: 'deepseek',
  }
}

function makeAgents() {
  return [
    {
      agentId: 'agent-1',
      tenantId: 'tenant-1',
      instanceId: 'instance-1',
      name: '默认助手',
      description: '',
      systemPrompt: 'help',
      rules: [],
      model: null,
      backend: null,
      enabled: true,
      toolAllowlist: [],
      mcpServerIds: [],
      skillIds: [],
      knowledgeBindingIds: [],
      tags: [],
    },
    {
      agentId: 'agent-2',
      tenantId: 'tenant-1',
      instanceId: 'instance-1',
      name: '中文写作',
      description: '',
      systemPrompt: 'write',
      rules: [],
      model: 'kimi-k2.5',
      backend: null,
      enabled: true,
      toolAllowlist: [],
      mcpServerIds: [],
      skillIds: [],
      knowledgeBindingIds: [],
      tags: [],
    },
  ]
}

function renderPage() {
  return renderWithProviders(
    <MemoryRouter
      future={{
        v7_startTransition: true,
        v7_relativeSplatPath: true,
      }}
    >
      <ModelsPage />
    </MemoryRouter>,
  )
}

describe('ModelsPage', () => {
  beforeEach(() => {
    window.localStorage.clear()
    mockApi.getAuthStatus.mockReset()
    mockApi.getSetupStatus.mockReset()
    mockApi.getConfig.mockReset()
    mockApi.getConfigMeta.mockReset()
    mockApi.getAgents.mockReset()
    mockApi.fetchModelBindingModels.mockReset()
    mockApi.testModelBinding.mockReset()
    mockApi.updateConfig.mockReset()

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
    mockApi.getConfig.mockResolvedValue(makeConfig())
    mockApi.getConfigMeta.mockResolvedValue(makeConfigMeta())
    mockApi.getAgents.mockResolvedValue(makeAgents())
    mockApi.fetchModelBindingModels.mockResolvedValue({
      provider: 'moonshot',
      bindingName: 'kimi-cn',
      label: 'Kimi 国内',
      models: ['kimi-k2.5', 'kimi-k2-0905-preview'],
      count: 2,
      message: '已获取 2 个模型',
      source: 'remote',
    })
    mockApi.testModelBinding.mockResolvedValue({
      ok: true,
      provider: 'moonshot',
      model: 'kimi-k2.5',
      bindingName: 'kimi-cn',
      label: 'Kimi 国内',
      latencyMs: 120,
      finishReason: 'stop',
      message: '检测通过',
      responsePreview: 'OK',
      usage: { total_tokens: 12 },
    })
    mockApi.updateConfig.mockImplementation(async (config) => config)
  })

  it('renders the multi-binding control surface', async () => {
    const user = userEvent.setup()

    renderPage()

    expect(await screen.findByText('模型配置')).toBeInTheDocument()
    // Default view is model overview - text appears in both Segmented and SectionCard
    expect(screen.getAllByText('模型总览').length).toBeGreaterThan(0)

    // Switch to provider view using the Segmented tab
    const providerTab = screen.getAllByText('供应商管理')[0]
    await user.click(providerTab)
    expect(screen.getByText('Moonshot')).toBeInTheDocument()
    expect(screen.getAllByText('DeepSeek').length).toBeGreaterThan(0)

    await user.click(screen.getByText('Moonshot'))

    expect(await screen.findByText('模型绑定')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /添加模型/ })).toBeInTheDocument()
  })

  it('switches between model overview and provider management views', async () => {
    const user = userEvent.setup()

    renderPage()

    await screen.findByText('模型配置')

    // Default view is model overview
    expect(screen.getAllByText('模型总览').length).toBeGreaterThan(0)

    // MetricCards should show updated labels
    expect(screen.getByText('已注册模型')).toBeInTheDocument()
    expect(screen.getByText('可用供应商')).toBeInTheDocument()
    expect(screen.getByText('默认模型')).toBeInTheDocument()

    // Switch to provider view
    await user.click(screen.getAllByText('供应商管理')[0])
    expect(await screen.findByText('接入模型供应商')).toBeInTheDocument()
    expect(screen.getByText('Moonshot')).toBeInTheDocument()

    // Switch back to model overview
    await user.click(screen.getAllByText('模型总览')[0])
    expect(screen.getAllByText('模型总览').length).toBeGreaterThanOrEqual(1)
  })

  it('tests the selected binding with current api credentials', async () => {
    const user = userEvent.setup()

    renderPage()

    await screen.findByText('模型配置')
    // Switch to provider view and open Moonshot drawer
    await user.click(screen.getAllByText('供应商管理')[0])
    await user.click(screen.getByText('Moonshot'))

    // Wait for drawer to render
    await screen.findByText('供应商配置')

    const apiBaseInput = (await screen.findAllByLabelText('API Base URL'))[0]
    await user.clear(apiBaseInput)
    await user.type(apiBaseInput, 'https://api.moonshot.cn/v1')

    // Click the test connection button (first button with "测试连接" text)
    const allTestBtns = await screen.findAllByText('测试连接')
    const testButton = allTestBtns.find(el => el.closest('button'))?.closest('button')
    expect(testButton).toBeTruthy()
    await user.click(testButton!)

    // Wait for the test connection modal to open
    await screen.findByText('目标模型')
    const modelIdInputs = screen.getAllByLabelText('模型 ID')
    const modalInput = modelIdInputs[modelIdInputs.length - 1]
    await user.type(modalInput, 'kimi-k2.5')
    await user.click(screen.getByRole('button', { name: '开始测试' }))

    await waitFor(() => {
      expect(mockApi.testModelBinding).toHaveBeenCalledTimes(1)
    })

    expect(mockApi.testModelBinding.mock.calls[0][0]).toMatchObject({
      bindingName: 'temp-test-binding',
      provider: 'moonshot',
      model: 'kimi-k2.5',
    })
    expect(await screen.findByText(/测试通过/)).toBeInTheDocument()
  })

  it('fetches remote model ids for the selected binding', async () => {
    const user = userEvent.setup()

    renderPage()

    await screen.findByText('模型配置')
    // Switch to provider view and open Moonshot drawer
    await user.click(screen.getAllByText('供应商管理')[0])
    await user.click(screen.getByText('Moonshot'))

    // Wait for the fetch button to render inside the drawer
    const fetchBtn = (await screen.findByText('拉取模型')).closest('button')!
    await user.click(fetchBtn)

    await waitFor(() => {
      expect(mockApi.fetchModelBindingModels).toHaveBeenCalledTimes(1)
    })

    expect(mockApi.fetchModelBindingModels.mock.calls[0][0]).toMatchObject({
      provider: 'moonshot',
      apiBase: 'https://api.moonshot.ai/v1',
    })
    expect(await screen.findByText('远端模型列表')).toBeInTheDocument()
    expect(screen.getByText('kimi-k2-0905-preview')).toBeInTheDocument()
  })
})
