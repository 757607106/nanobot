import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ModelsPage from './pages/ModelsPage'
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
      memoryScope: 'agent_profile',
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
      memoryScope: 'agent_profile',
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

    expect(await screen.findByText('模型配置工作台')).toBeInTheDocument()
    expect(screen.getByText('工作台切换')).toBeInTheDocument()
    expect(screen.getByText('默认运行')).toBeInTheDocument()
    expect(screen.getByText('快速预设')).toBeInTheDocument()
    expect(screen.getByText('binding 目录')).toBeInTheDocument()
    expect(screen.getByText('连接编辑器')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /自定义 Agent/i }))

    expect(await screen.findByText('自定义 Agent 工作台')).toBeInTheDocument()
    expect(screen.getByText('自定义 Agent 总览')).toBeInTheDocument()
    expect(screen.getByText('这些 Agent 已经偏离全局策略，但连接归属还不够清晰。')).toBeInTheDocument()
    expect(screen.getByText('已自定义 Agent')).toBeInTheDocument()
    expect(screen.getByText('继承全局的 Agent')).toBeInTheDocument()
    expect(screen.getAllByText('中文写作').length).toBeGreaterThan(0)
  })

  it('applies a preset and saves the expected config payload', async () => {
    const user = userEvent.setup()

    renderPage()

    await screen.findByText('模型配置工作台')
    await user.click(screen.getByRole('button', { name: /Kimi 国内/i }))

    expect(screen.getAllByDisplayValue('kimi-k2.5').length).toBeGreaterThan(0)
    expect(screen.getByDisplayValue('https://api.moonshot.cn/v1')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /保存全部/i }))

    await waitFor(() => {
      expect(mockApi.updateConfig).toHaveBeenCalledTimes(1)
    })

    const savedConfig = mockApi.updateConfig.mock.calls[0][0]
    expect(savedConfig.agents.defaults.provider).toBe('moonshot')
    expect(savedConfig.agents.defaults.binding).toBe('kimi-cn')
    expect(savedConfig.agents.defaults.model).toBe('kimi-k2.5')
    expect(savedConfig.providers.moonshot.apiBase).toBe('https://api.moonshot.cn/v1')
    expect(savedConfig.modelBindings['kimi-cn'].apiBase).toBe('https://api.moonshot.cn/v1')
  })

  it('tests the selected binding with current api credentials', async () => {
    const user = userEvent.setup()

    renderPage()

    await screen.findByText('模型配置工作台')
    await user.click(screen.getByRole('button', { name: /Kimi 国内/i }))
    await user.click(screen.getByRole('button', { name: '检测连接' }))

    await waitFor(() => {
      expect(mockApi.testModelBinding).toHaveBeenCalledTimes(1)
    })

    expect(mockApi.testModelBinding.mock.calls[0][0]).toMatchObject({
      bindingName: 'kimi-cn',
      provider: 'moonshot',
      model: 'kimi-k2.5',
      apiBase: 'https://api.moonshot.cn/v1',
    })
    expect(await screen.findByText(/检测通过 · 120 ms/)).toBeInTheDocument()
  })

  it('fetches remote model ids for the selected binding', async () => {
    const user = userEvent.setup()

    renderPage()

    await screen.findByText('模型配置工作台')
    await user.click(screen.getByRole('button', { name: /Kimi 国内/i }))
    await user.click(screen.getByRole('button', { name: /获取模型/i }))

    await waitFor(() => {
      expect(mockApi.fetchModelBindingModels).toHaveBeenCalledTimes(1)
    })

    expect(mockApi.fetchModelBindingModels.mock.calls[0][0]).toMatchObject({
      bindingName: 'kimi-cn',
      provider: 'moonshot',
      apiBase: 'https://api.moonshot.cn/v1',
    })
    expect(await screen.findByText(/下方展示的是当前 API Key 和 API 地址返回的模型 ID/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'kimi-k2-0905-preview' })).toBeInTheDocument()
  })
})
