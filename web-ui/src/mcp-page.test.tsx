import { fireEvent, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import McpPage from './pages/mcp'
import { parseMappingInput } from './pages/mcp/utils'
import { testIds } from './testIds'
import { renderWithProviders } from './test/renderApp'

const mockApi = vi.hoisted(() => ({
  getAuthStatus: vi.fn(),
  getSetupStatus: vi.fn(),
  getMcpServers: vi.fn(),
  getMcpServer: vi.fn(),
  getConfig: vi.fn(),
  updateConfig: vi.fn(),
  updateMcpServer: vi.fn(),
  setMcpServerEnabled: vi.fn(),
  deleteMcpServer: vi.fn(),
  inspectMcpRepository: vi.fn(),
  installMcpRepository: vi.fn(),
}))

vi.mock('./api', () => ({
  ApiError: class MockApiError extends Error {
    statusCode = 0
    code?: string
    details?: unknown
  },
  api: mockApi,
}))

function makeConfig(mcpServers: Record<string, unknown> = {}) {
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
    },
    channels: {
      sendProgress: true,
      sendToolHints: true,
    },
    gateway: {
      host: '127.0.0.1',
      port: 18790,
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
      mcpServers,
    },
  }
}

function makeRegistry(items?: Array<Record<string, unknown>>) {
  const nextItems = (items ?? [
    {
      name: 'filesystem',
      displayName: 'Workspace Files',
      enabled: true,
      transport: 'stdio' as const,
      status: 'ready' as const,
      statusDetail: '配置结构完整，等待首次探测或运行时按需加载。',
      toolCount: 7,
      toolCountKnown: true,
      toolTimeout: 30,
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp/workspace'],
      env: { MCP_API_KEY: 'secret' },
      url: null,
      headers: {},
      envCount: 1,
      headerCount: 0,
      sourceKind: 'repository' as const,
      sourceLabel: '仓库安装',
      repoUrl: 'https://github.com/modelcontextprotocol/servers',
      lastToolSyncAt: '2026-03-13T12:30:00Z',
      lastCheckedAt: '2026-03-13T12:31:00Z',
      lastProbeStatus: 'passed',
      toolNames: ['read_file', 'list_dir'],
      lastError: null,
      updatedAt: '2026-03-13T12:29:00Z',
      installDir: '/tmp/mcp-installs/modelcontextprotocol__servers',
      installMode: 'source',
      installSteps: ['npm ci'],
      requiredEnv: ['MCP_API_KEY'],
      optionalEnv: [],
      cloneUrl: 'https://github.com/modelcontextprotocol/servers.git',
    },
  ]) as Array<Record<string, unknown>>

  return {
    items: nextItems,
    summary: {
      total: nextItems.length,
      enabled: nextItems.filter((item) => item.enabled).length,
      disabled: nextItems.filter((item) => !item.enabled).length,
      ready: nextItems.filter((item) => item.status === 'ready').length,
      incomplete: nextItems.filter((item) => item.status === 'incomplete').length,
      knownToolCount: nextItems.reduce((sum, item) => sum + Number(item.toolCount || 0), 0),
      verifiedServers: nextItems.filter((item) => item.toolCountKnown).length,
    },
  }
}

function renderPage() {
  return renderWithProviders(
    <MemoryRouter
      initialEntries={['/mcp']}
      future={{
        v7_startTransition: true,
        v7_relativeSplatPath: true,
      }}
    >
      <Routes>
        <Route path="/mcp" element={<McpPage />} />
        <Route path="/mcp/:serverName" element={<McpPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('McpPage', () => {
  beforeEach(() => {
    window.localStorage.clear()
    mockApi.getAuthStatus.mockReset()
    mockApi.getSetupStatus.mockReset()
    mockApi.getMcpServers.mockReset()
    mockApi.getMcpServer.mockReset()
    mockApi.getConfig.mockReset()
    mockApi.updateConfig.mockReset()
    mockApi.updateMcpServer.mockReset()
    mockApi.setMcpServerEnabled.mockReset()
    mockApi.deleteMcpServer.mockReset()
    mockApi.inspectMcpRepository.mockReset()
    mockApi.installMcpRepository.mockReset()

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
    mockApi.getMcpServers.mockResolvedValue(makeRegistry())
    mockApi.getMcpServer.mockResolvedValue(makeRegistry().items[0])
    mockApi.getConfig.mockResolvedValue(makeConfig())
    mockApi.updateConfig.mockImplementation(async (config) => config)
    mockApi.updateMcpServer.mockResolvedValue({
      serverName: 'filesystem',
      entry: makeRegistry().items[0],
      config: makeConfig({
        filesystem: {
          enabled: true,
          type: 'stdio',
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp/workspace'],
          env: { MCP_API_KEY: 'secret' },
          url: '',
          headers: {},
          toolTimeout: 30,
        },
      }),
    })
  })

  it('accepts pasted JSON objects for mapping fields', () => {
    expect(parseMappingInput('{"Authorization":"Bearer token"}', '请求头', ':')).toEqual({
      Authorization: 'Bearer token',
    })
    expect(parseMappingInput('{"GITHUB_TOKEN":"token-123"}', '环境变量', '=')).toEqual({
      GITHUB_TOKEN: 'token-123',
    })
  })

  it('renders the reference-style registry layout', async () => {
    renderPage()

    expect(await screen.findByText('MCP 扩展')).toBeInTheDocument()
    expect(screen.getByText('添加服务器')).toBeInTheDocument()
    expect(screen.getByText('Workspace Files')).toBeInTheDocument()
    expect(screen.getByText('filesystem')).toBeInTheDocument()
  })

  it('creates a manual server by saving the config payload', async () => {
    const user = userEvent.setup()
    mockApi.getMcpServers.mockResolvedValueOnce(makeRegistry([])).mockResolvedValue(makeRegistry([
      {
        ...makeRegistry().items[0],
        name: 'github',
        displayName: 'github',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-github'],
        env: { GITHUB_TOKEN: 'token-123' },
        toolNames: [],
        toolCount: null,
        toolCountKnown: false,
        status: 'incomplete',
      },
    ]))

    renderPage()

    expect(await screen.findByText('暂无 MCP 服务器')).toBeInTheDocument()
    // Click the empty state button
    const addButton = await screen.findByText(/添加第一个服务器/)
    await user.click(addButton)
    await user.type(screen.getByPlaceholderText('唯一标识，如 weather-api'), 'github')
    await user.type(screen.getByPlaceholderText('uvx 或 npx'), 'npx')
    await user.type(screen.getByPlaceholderText('参数以空格分隔'), '-y @modelcontextprotocol/server-github')
    await user.type(screen.getByPlaceholderText(/KEY=value/), 'GITHUB_TOKEN=token-123')
    await user.click(screen.getByRole('button', { name: /保\s*存/ }))

    await waitFor(() => {
      expect(mockApi.updateConfig).toHaveBeenCalledTimes(1)
    })

    const savedConfig = mockApi.updateConfig.mock.calls[0][0]
    expect(savedConfig.tools.mcpServers.github).toMatchObject({
      enabled: true,
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
      env: {
        GITHUB_TOKEN: 'token-123',
      },
      toolTimeout: 30,
    })
  })



  it('edits an existing server through the update endpoint', async () => {
    const user = userEvent.setup()
    const item = {
      ...makeRegistry().items[0],
      displayName: 'Workspace Files Pro',
      command: 'node',
      env: { MCP_API_KEY: 'secret-2' },
    }
    mockApi.getMcpServers.mockResolvedValueOnce(makeRegistry()).mockResolvedValue(makeRegistry([item]))
    mockApi.getMcpServer.mockResolvedValue(item)

    renderPage()

    expect(await screen.findByText('Workspace Files')).toBeInTheDocument()
    // "编辑" logic has moved to clicking the card and then drawer. Let's just click '配置' or view
    const card = screen.getByText('Workspace Files')
    await user.click(card)
    await user.clear(await screen.findByLabelText('展示名称'))
    await user.type(screen.getByLabelText('展示名称'), 'Workspace Files Pro')
    await user.clear(screen.getByLabelText('命令'))
    await user.type(screen.getByLabelText('命令'), 'node')
    // Open sensitive values to edit env
    await user.click(screen.getByText('查看敏感值'))
    // Wait for button text to change to ensure state updated
    expect(await screen.findByText('隐藏敏感值')).toBeInTheDocument()
    
    // antd's readOnly toggle + userEvent sometimes causes weird writability check bugs. Use fireEvent.
    const envInput = screen.getByTestId(testIds.mcp.detailEnv)
    fireEvent.change(envInput, { target: { value: '{"MCP_API_KEY":"secret-2"}' } })
    
    await user.click(await screen.findByText(/保存配置/))

    await waitFor(() => {
      expect(mockApi.updateMcpServer).toHaveBeenCalledTimes(1)
    })

    expect(mockApi.updateMcpServer.mock.calls[0][0]).toBe('filesystem')
    expect(mockApi.updateMcpServer.mock.calls[0][1]).toMatchObject({
      displayName: 'Workspace Files Pro',
      enabled: true,
      type: 'stdio',
      command: 'node',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp/workspace'],
      env: { MCP_API_KEY: 'secret-2' },
      toolTimeout: 30,
    })
  })
})
