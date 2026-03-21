import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  App,
  Button,
  Card,
  Input,
  InputNumber,
  Modal,
  Select,
  Spin,
  Tag,
  Typography,
} from 'antd'
import {
  CodeOutlined,
  DeleteOutlined,
  EditOutlined,
  GlobalOutlined,
  PlusOutlined,
  PoweroffOutlined,
  ReloadOutlined,
  UploadOutlined,
} from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import DevOnly from '../components/DevOnly'
import { useDevMode } from '../devMode'
import { formatDateTimeZh } from '../locale'
import { testIds } from '../testIds'
import type {
  ConfigData,
  McpRepositoryAnalysis,
  McpRepositoryInstallResult,
  McpServerEntry,
  McpServerListResponse,
  McpServerStatus,
  McpServerTransport,
} from '../types'

const { Text, Paragraph } = Typography

type DialogMode = 'manual' | 'json'
type EditableTransport = 'stdio' | 'sse' | 'streamableHttp'

type ServerDraft = {
  name: string
  displayName: string
  type: EditableTransport
  command: string
  argsText: string
  envText: string
  url: string
  headersText: string
  toolTimeout: number
}

type ParsedJsonServer = {
  name: string
  type: EditableTransport
  command: string
  args: string[]
  env: Record<string, string>
  url: string
  headers: Record<string, string>
  toolTimeout: number
}

const transportLabels: Record<McpServerTransport, string> = {
  stdio: 'stdio',
  sse: 'SSE',
  streamableHttp: 'HTTP',
  unknown: '未识别',
}

const statusMeta: Record<
  McpServerStatus,
  { label: string; chipClass: string; accentClass: string }
> = {
  ready: { label: '可加载', chipClass: 'is-ready', accentClass: 'is-ready' },
  incomplete: { label: '待补全', chipClass: 'is-incomplete', accentClass: 'is-incomplete' },
  disabled: { label: '已停用', chipClass: 'is-disabled', accentClass: 'is-disabled' },
}

const transportOptions = [
  { value: 'stdio', label: 'stdio', description: '本地进程' },
  { value: 'streamableHttp', label: 'http', description: '远程 HTTP' },
  { value: 'sse', label: 'sse', description: '远程 SSE' },
] satisfies Array<{ value: EditableTransport; label: string; description: string }>

function createEmptyDraft(type: EditableTransport = 'stdio'): ServerDraft {
  return {
    name: '',
    displayName: '',
    type,
    command: '',
    argsText: '',
    envText: '',
    url: '',
    headersText: '',
    toolTimeout: 30,
  }
}

function toDraft(entry: McpServerEntry): ServerDraft {
  const type = entry.transport === 'unknown' ? 'stdio' : entry.transport
  return {
    name: entry.name,
    displayName: entry.displayName || entry.name,
    type,
    command: entry.command || '',
    argsText: (entry.args || []).join(' '),
    envText: Object.entries(entry.env || {})
      .map(([key, value]) => `${key}=${value}`)
      .join('\n'),
    url: entry.url || '',
    headersText: Object.entries(entry.headers || {})
      .map(([key, value]) => `${key}: ${value}`)
      .join('\n'),
    toolTimeout: Number(entry.toolTimeout || 30),
  }
}

function splitArgTokens(raw: string) {
  const matches = raw.match(/"[^"]*"|'[^']*'|\S+/g) || []
  return matches.map((item) => item.replace(/^['"]|['"]$/g, '').trim()).filter(Boolean)
}

function parseLineMapping(raw: string, label: string, separator: '=' | ':') {
  const result: Record<string, string> = {}
  const lines = raw
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean)

  for (const line of lines) {
    const index = line.indexOf(separator)
    if (index <= 0) {
      throw new Error(`${label}格式不正确，请按每行一条的方式填写`)
    }
    const key = line.slice(0, index).trim()
    const value = line.slice(index + 1).trim()
    if (!key) {
      throw new Error(`${label}中的键不能为空`)
    }
    result[key] = value
  }

  return result
}

function inferTransport(entry: Record<string, unknown>): EditableTransport {
  if (entry.type === 'stdio' || entry.command) {
    return 'stdio'
  }
  if (entry.type === 'sse') {
    return 'sse'
  }
  if (entry.type === 'http' || entry.type === 'streamable-http' || entry.type === 'streamableHttp') {
    return 'streamableHttp'
  }
  const url = String(entry.url || '')
  if (url.endsWith('/sse') || url.includes('/sse?')) {
    return 'sse'
  }
  return 'streamableHttp'
}

function parseJsonImport(raw: string): ParsedJsonServer[] {
  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(raw) as Record<string, unknown>
  } catch {
    throw new Error('JSON 格式不正确')
  }

  const dict =
    (payload.mcpServers as Record<string, unknown>) ||
    (payload.servers as Record<string, unknown>) ||
    payload

  return Object.entries(dict).map(([name, value]) => {
    const entry = (value || {}) as Record<string, unknown>
    const type = inferTransport(entry)
    return {
      name,
      type,
      command: String(entry.command || ''),
      args: Array.isArray(entry.args) ? entry.args.map((item) => String(item)) : [],
      env:
        entry.env && typeof entry.env === 'object' && !Array.isArray(entry.env)
          ? Object.fromEntries(Object.entries(entry.env as Record<string, unknown>).map(([key, item]) => [key, String(item ?? '')]))
          : {},
      url: String(entry.url || ''),
      headers:
        entry.headers && typeof entry.headers === 'object' && !Array.isArray(entry.headers)
          ? Object.fromEntries(Object.entries(entry.headers as Record<string, unknown>).map(([key, item]) => [key, String(item ?? '')]))
          : {},
      toolTimeout: Number(entry.toolTimeout ?? entry.timeout ?? 30) || 30,
    }
  })
}

function buildServerConfig(draft: {
  type: EditableTransport
  command: string
  argsText: string
  envText: string
  url: string
  headersText: string
  toolTimeout: number
}) {
  const isRemote = draft.type !== 'stdio'
  const timeout = Number(draft.toolTimeout || 30)
  if (timeout <= 0) {
    throw new Error('超时时间必须大于 0')
  }

  const command = draft.command.trim()
  const url = draft.url.trim()

  if (!isRemote && !command) {
    throw new Error('stdio 类型必须填写命令')
  }
  if (isRemote && !url) {
    throw new Error('远程类型必须填写远程地址')
  }

  return {
    type: draft.type,
    command: isRemote ? '' : command,
    args: isRemote ? [] : splitArgTokens(draft.argsText),
    env: isRemote ? {} : parseLineMapping(draft.envText, '环境变量', '='),
    url: isRemote ? url : '',
    headers: isRemote ? parseLineMapping(draft.headersText, '请求头', ':') : {},
    toolTimeout: timeout,
  }
}

export default function McpPage() {
  const { message, modal } = App.useApp()
  const navigate = useNavigate()
  const { devMode } = useDevMode()
  const [data, setData] = useState<McpServerListResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [actingName, setActingName] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [dialogMode, setDialogMode] = useState<DialogMode>('manual')
  const [editingEntry, setEditingEntry] = useState<McpServerEntry | null>(null)
  const [draft, setDraft] = useState<ServerDraft>(createEmptyDraft())
  const [savingDialog, setSavingDialog] = useState(false)
  const [jsonText, setJsonText] = useState('')
  const [jsonError, setJsonError] = useState('')
  const [jsonPreview, setJsonPreview] = useState<ParsedJsonServer[]>([])
  const [repoSource, setRepoSource] = useState('')
  const [analysis, setAnalysis] = useState<McpRepositoryAnalysis | null>(null)
  const [lastInstall, setLastInstall] = useState<McpRepositoryInstallResult | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [installing, setInstalling] = useState(false)

  useEffect(() => {
    void loadServers()
  }, [])

  async function loadServers() {
    try {
      setLoading(true)
      const next = await api.getMcpServers()
      setData(next)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载 MCP 索引失败')
    } finally {
      setLoading(false)
    }
  }

  async function handleInspect() {
    const source = repoSource.trim()
    if (!source) {
      message.error('请先输入 GitHub 仓库地址')
      return
    }

    try {
      setAnalyzing(true)
      setLastInstall(null)
      const next = await api.inspectMcpRepository(source)
      setAnalysis(next)
      message.success('仓库预检完成')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '仓库预检失败')
    } finally {
      setAnalyzing(false)
    }
  }

  async function handleInstall() {
    const source = analysis?.repoUrl || repoSource.trim()
    if (!source) {
      message.error('请先完成仓库预检')
      return
    }

    try {
      setInstalling(true)
      const next = await api.installMcpRepository(source)
      setLastInstall(next)
      setAnalysis(next.analysis)
      await loadServers()
      message.success(`MCP ${next.serverName} 已登记，当前保持禁用状态`)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '安装 MCP 失败')
    } finally {
      setInstalling(false)
    }
  }

  async function handleToggle(entry: McpServerEntry) {
    try {
      setActingName(entry.name)
      await api.setMcpServerEnabled(entry.name, !entry.enabled)
      await loadServers()
      message.success(entry.enabled ? 'MCP 已停用' : 'MCP 已启用')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '切换 MCP 启用状态失败')
    } finally {
      setActingName(null)
    }
  }

  function handleDelete(entry: McpServerEntry) {
    modal.confirm({
      title: `删除 ${entry.displayName || entry.name}`,
      content: '会从当前配置移除该 MCP 服务；如果它来自仓库安装，还会尝试删除本地 checkout。',
      okText: '删除',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: async () => {
        setActingName(entry.name)
        try {
          await api.deleteMcpServer(entry.name)
          await loadServers()
          message.success('MCP 已删除')
        } finally {
          setActingName(null)
        }
      },
    })
  }

  function openImportDialog() {
    setEditingEntry(null)
    setDialogMode('json')
    setJsonText('')
    setJsonError('')
    setJsonPreview([])
    setDraft(createEmptyDraft())
    setDialogOpen(true)
  }

  function openCreateDialog() {
    setEditingEntry(null)
    setDialogMode('manual')
    setDraft(createEmptyDraft('stdio'))
    setJsonText('')
    setJsonError('')
    setJsonPreview([])
    setDialogOpen(true)
  }

  function openEditDialog(entry: McpServerEntry) {
    setEditingEntry(entry)
    setDialogMode('manual')
    setDraft(toDraft(entry))
    setJsonText('')
    setJsonError('')
    setJsonPreview([])
    setDialogOpen(true)
  }

  function handleJsonChange(value: string) {
    setJsonText(value)
    if (!value.trim()) {
      setJsonError('')
      setJsonPreview([])
      return
    }
    try {
      const next = parseJsonImport(value)
      setJsonPreview(next)
      setJsonError('')
    } catch (error) {
      setJsonPreview([])
      setJsonError(error instanceof Error ? error.message : 'JSON 解析失败')
    }
  }

  const servers = data?.items ?? []
  const summary = data?.summary ?? {
    total: 0,
    enabled: 0,
    disabled: 0,
    ready: 0,
    incomplete: 0,
    knownToolCount: 0,
    verifiedServers: 0,
  }
  const existingServerNames = useMemo(() => new Set(servers.map((item) => item.name)), [servers])
  const jsonResolvedPreview = useMemo(() => {
    const seen = new Set<string>()
    return jsonPreview.map((item) => {
      const normalizedName = item.name.trim()
      const duplicateInBatch = seen.has(normalizedName)
      seen.add(normalizedName)
      const duplicateInRegistry = existingServerNames.has(normalizedName)
      return {
        ...item,
        normalizedName,
        duplicateInBatch,
        duplicateInRegistry,
        valid: Boolean(normalizedName) && !duplicateInBatch && !duplicateInRegistry,
      }
    })
  }, [existingServerNames, jsonPreview])
  const importableCount = jsonResolvedPreview.filter((item) => item.valid).length
  const activeName = editingEntry ? draft.displayName : draft.name
  const dialogIsRemote = draft.type !== 'stdio'

  async function saveManualDialog() {
    try {
      setSavingDialog(true)
      if (editingEntry) {
        const nextPayload = buildServerConfig(draft)
        await api.updateMcpServer(editingEntry.name, {
          displayName: activeName.trim() || null,
          enabled: editingEntry.enabled,
          ...nextPayload,
        })
        message.success('MCP 配置已保存')
      } else {
        const serverName = draft.name.trim()
        if (!serverName) {
          throw new Error('请先填写名称')
        }
        if (existingServerNames.has(serverName)) {
          throw new Error(`MCP '${serverName}' 已存在，请改名后再试`)
        }
        const nextPayload = buildServerConfig(draft)
        const currentConfig = await api.getConfig()
        const nextConfig: ConfigData = {
          ...currentConfig,
          tools: {
            ...currentConfig.tools,
            mcpServers: {
              ...(currentConfig.tools.mcpServers ?? {}),
              [serverName]: {
                enabled: true,
                ...nextPayload,
              },
            },
          },
        }
        await api.updateConfig(nextConfig)
        message.success('MCP 服务器已添加')
      }
      setDialogOpen(false)
      await loadServers()
    } catch (error) {
      message.error(error instanceof Error ? error.message : '保存 MCP 配置失败')
    } finally {
      setSavingDialog(false)
    }
  }

  async function saveJsonImport() {
    if (!importableCount) {
      return
    }
    try {
      setSavingDialog(true)
      const currentConfig = await api.getConfig()
      const nextServers = { ...(currentConfig.tools.mcpServers ?? {}) }
      for (const item of jsonResolvedPreview) {
        if (!item.valid) {
          continue
        }
        nextServers[item.normalizedName] = {
          enabled: true,
          type: item.type,
          command: item.type === 'stdio' ? item.command : '',
          args: item.type === 'stdio' ? item.args : [],
          env: item.type === 'stdio' ? item.env : {},
          url: item.type === 'stdio' ? '' : item.url,
          headers: item.type === 'stdio' ? {} : item.headers,
          toolTimeout: item.toolTimeout,
        }
      }
      const nextConfig: ConfigData = {
        ...currentConfig,
        tools: {
          ...currentConfig.tools,
          mcpServers: nextServers,
        },
      }
      await api.updateConfig(nextConfig)
      message.success(`已导入 ${importableCount} 个 MCP 服务器`)
      setDialogOpen(false)
      await loadServers()
    } catch (error) {
      message.error(error instanceof Error ? error.message : '导入 MCP 配置失败')
    } finally {
      setSavingDialog(false)
    }
  }

  if (loading && !data) {
    return (
      <div className="center-box page-card">
        <Spin />
      </div>
    )
  }

  return (
    <div className="page-stack">
      <section className="mcp-registry-shell">
        <div className="mcp-registry-topbar">
          <div className="mcp-registry-title-chip">MCP 服务器</div>

          <div className="mcp-registry-topbar-actions">
            <Button aria-label="导入配置" icon={<UploadOutlined />} onClick={openImportDialog}>
              导入配置
            </Button>
            <Button aria-label="添加 MCP 服务器" type="primary" icon={<PlusOutlined />} onClick={openCreateDialog}>
              添加 MCP 服务器
            </Button>
          </div>
        </div>

        {servers.length > 0 ? (
          <div className="mcp-registry-summary">
            <span>总数 {summary.total}</span>
            <span>已启用 {summary.enabled}</span>
            <span>待补全 {summary.incomplete}</span>
            <span>已验证 {summary.verifiedServers}</span>
          </div>
        ) : null}

        <div className="mcp-registry-list-shell">
          {servers.length > 0 ? (
            <div className="mcp-registry-list">
              {servers.map((entry) => {
                const meta = statusMeta[entry.status]
                const preview = entry.transport === 'stdio'
                  ? [entry.command || '', ...(entry.args || [])].filter(Boolean).join(' ')
                  : entry.url || '未填写远程地址'
                return (
                  <article className={`mcp-registry-row ${meta.accentClass}`} key={entry.name}>
                    <button
                      type="button"
                      className="mcp-registry-row-main"
                      onClick={() => navigate(`/mcp/${encodeURIComponent(entry.name)}`)}
                      data-testid={`${testIds.mcp.detailLinkPrefix}${entry.name}`}
                      aria-label={`打开 ${entry.displayName || entry.name} 维护详情`}
                    >
                      <div className="mcp-registry-row-head">
                        <div className="mcp-registry-row-name-block">
                          <span className="mcp-registry-row-icon">
                            {entry.transport === 'stdio' ? <CodeOutlined /> : <GlobalOutlined />}
                          </span>
                          <div>
                            <strong>{entry.displayName || entry.name}</strong>
                            <span>{entry.name}</span>
                          </div>
                        </div>
                        <div className="mcp-registry-row-badges">
                          <span className={`mcp-registry-state-chip ${meta.chipClass}`}>{meta.label}</span>
                          <Tag>{transportLabels[entry.transport]}</Tag>
                          {entry.enabled ? <Tag color="success">启用中</Tag> : <Tag>已停用</Tag>}
                        </div>
                      </div>

                      <p className="mcp-registry-row-preview">{preview}</p>

                      <div className="mcp-registry-row-meta">
                        <span>工具 {entry.toolCountKnown ? entry.toolCount ?? 0 : '待探测'}</span>
                        <span>最近探测 {entry.lastCheckedAt ? formatDateTimeZh(entry.lastCheckedAt) : '未探测'}</span>
                        <span>{entry.statusDetail}</span>
                      </div>

                      {entry.toolNames && entry.toolNames.length > 0 ? (
                        <div className="mcp-registry-tool-list">
                          {entry.toolNames.slice(0, 8).map((toolName) => (
                            <span className="mcp-registry-tool-chip" key={toolName}>
                              {toolName}
                            </span>
                          ))}
                          {entry.toolNames.length > 8 ? (
                            <span className="mcp-registry-tool-chip is-muted">+{entry.toolNames.length - 8}</span>
                          ) : null}
                        </div>
                      ) : null}

                      {entry.lastError ? (
                        <Alert
                          type="warning"
                          showIcon
                          className="mcp-registry-inline-alert"
                          message="最近一次记录了错误"
                          description={entry.lastError}
                        />
                      ) : null}
                    </button>

                    <div className="mcp-registry-row-actions">
                      <Button
                        type="text"
                        icon={<PoweroffOutlined />}
                        loading={actingName === entry.name}
                        onClick={() => void handleToggle(entry)}
                        data-testid={`${testIds.mcp.togglePrefix}${entry.name}`}
                        aria-label={entry.enabled ? `停用 ${entry.displayName || entry.name}` : `启用 ${entry.displayName || entry.name}`}
                      />
                      <Button
                        type="text"
                        icon={<EditOutlined />}
                        onClick={() => openEditDialog(entry)}
                        aria-label={`编辑 ${entry.displayName || entry.name}`}
                      />
                      <Button
                        type="text"
                        danger
                        icon={<DeleteOutlined />}
                        onClick={() => handleDelete(entry)}
                        aria-label={`删除 ${entry.displayName || entry.name}`}
                      />
                    </div>
                  </article>
                )
              })}
            </div>
          ) : (
            <div className="mcp-registry-empty">
              <strong>暂无数据</strong>
            </div>
          )}
        </div>
      </section>

      <DevOnly>
        <Card className="config-panel-card mcp-repository-card">
          <div className="config-card-header">
            <div className="page-section-title">
              <Typography.Title level={4}>从仓库安装</Typography.Title>
            </div>
          </div>

          <div className="mcp-install-form">
            <Input
              placeholder="https://github.com/owner/repo 或 owner/repo"
              value={repoSource}
              onChange={(event) => setRepoSource(event.target.value)}
              data-testid={testIds.mcp.repoSource}
            />
            <div className="mcp-hero-actions">
              <Button onClick={() => void handleInspect()} loading={analyzing} data-testid={testIds.mcp.inspect}>
                预检仓库
              </Button>
              <Button
                type="primary"
                onClick={() => void handleInstall()}
                loading={installing}
                disabled={!analysis || !analysis.canInstall}
                data-testid={testIds.mcp.install}
              >
                安装并登记
              </Button>
            </div>
          </div>

          {analysis ? (
            <div className="mcp-analysis-grid">
              <article className="mcp-item-card">
                <div className="mcp-item-header">
                  <div className="page-section-title">
                    <Typography.Title level={4}>{analysis.displayName}</Typography.Title>
                    <Text type="secondary">{analysis.repoUrl}</Text>
                  </div>
                  <div className="tag-cloud">
                    <Tag>{transportLabels[analysis.transport]}</Tag>
                    <Tag>{analysis.installMode}</Tag>
                    <Tag>{analysis.canInstall ? '可安装' : '待补运行时'}</Tag>
                  </div>
                </div>

                <div className="page-meta-grid mcp-meta-grid">
                  <div className="page-meta-card">
                    <span>服务器名</span>
                    <strong>{analysis.serverName}</strong>
                  </div>
                  <div className="page-meta-card">
                    <span>安装步骤</span>
                    <strong>{analysis.installSteps.length}</strong>
                  </div>
                  <div className="page-meta-card">
                    <span>缺失运行时</span>
                    <strong>{analysis.missingRuntimes.length}</strong>
                  </div>
                  <div className="page-meta-card">
                    <span>必填环境变量</span>
                    <strong>{analysis.requiredEnv.length}</strong>
                  </div>
                </div>

                <div className="detail-grid mcp-detail-grid">
                  <div className="detail-block">
                    <span className="mcp-detail-label">运行预览</span>
                    <div className="mono-block mono-block-large">{analysis.commandPreview || analysis.runUrl || '--'}</div>
                  </div>
                  <div className="detail-block">
                    <span className="mcp-detail-label">下一步</span>
                    <div className="mono-block mono-block-large">{analysis.nextStep}</div>
                  </div>
                </div>
              </article>
            </div>
          ) : null}

          {lastInstall ? (
            <Alert
              className="mcp-entry-alert"
              type="success"
              message={`MCP ${lastInstall.serverName} 已安装并登记`}
              description={
                lastInstall.installDir
                  ? `安装目录：${lastInstall.installDir}`
                  : '已完成登记'
              }
            />
          ) : null}
        </Card>
      </DevOnly>

      <Modal
        open={dialogOpen}
        title={editingEntry ? '编辑 MCP 服务器' : '添加 MCP 服务器'}
        onCancel={() => setDialogOpen(false)}
        footer={
          <div className="mcp-dialog-footer">
            {editingEntry ? (
              <Button onClick={() => navigate(`/mcp/${encodeURIComponent(editingEntry.name)}`)}>
                高级维护
              </Button>
            ) : (
              <span />
            )}
            <div className="mcp-dialog-footer-actions">
              <Button onClick={() => setDialogOpen(false)}>取消</Button>
              {dialogMode === 'json' && !editingEntry ? (
                <Button type="primary" onClick={() => void saveJsonImport()} disabled={!importableCount} loading={savingDialog}>
                  导入 {importableCount} 个服务器
                </Button>
              ) : (
                <Button type="primary" onClick={() => void saveManualDialog()} loading={savingDialog}>
                  保存
                </Button>
              )}
            </div>
          </div>
        }
        destroyOnHidden
        width={860}
        className="mcp-dialog"
      >
        {!editingEntry ? (
          <div className="mcp-dialog-mode-tabs">
            <button
              type="button"
              className={`mcp-dialog-mode-tab${dialogMode === 'json' ? ' is-active' : ''}`}
              onClick={() => setDialogMode('json')}
            >
              粘贴 JSON
            </button>
            <button
              type="button"
              className={`mcp-dialog-mode-tab${dialogMode === 'manual' ? ' is-active' : ''}`}
              onClick={() => setDialogMode('manual')}
            >
              手动填写
            </button>
          </div>
        ) : null}

        {dialogMode === 'json' && !editingEntry ? (
          <div className="mcp-dialog-section">
            <Paragraph className="mcp-dialog-copy">
              支持 Claude Desktop、Cursor 等标准 MCP 配置格式，直接粘贴即可批量添加。
            </Paragraph>
            <Input.TextArea
              rows={10}
              aria-label="MCP JSON 配置"
              value={jsonText}
              onChange={(event) => handleJsonChange(event.target.value)}
              placeholder='{ "mcpServers": { "my-server": { "url": "https://...", "headers": {} } } }'
            />

            {jsonError ? (
              <Alert showIcon type="error" message={jsonError} />
            ) : null}

            {jsonResolvedPreview.length > 0 ? (
              <div className="mcp-json-preview-list">
                {jsonResolvedPreview.map((item) => (
                  <div className="mcp-json-preview-row" key={item.normalizedName || item.name}>
                    <div>
                      <strong>{item.name}</strong>
                      <span>{item.type === 'stdio' ? item.command || '未填写命令' : item.url || '未填写远程地址'}</span>
                    </div>
                    {item.valid ? (
                      <Tag color="success">可导入</Tag>
                    ) : item.duplicateInRegistry ? (
                      <Tag color="warning">名称已存在</Tag>
                    ) : (
                      <Tag color="warning">批次内重名</Tag>
                    )}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="mcp-dialog-form">
            <div className="mcp-dialog-field">
              <Text>名称</Text>
              <Input
                aria-label="名称"
                value={activeName}
                onChange={(event) => setDraft((current) => (
                  editingEntry
                    ? { ...current, displayName: event.target.value }
                    : { ...current, name: event.target.value }
                ))}
                placeholder={editingEntry ? '显示名称' : '例如 github'}
              />
              {editingEntry ? (
                <span className="mcp-dialog-helper">服务 ID 固定为 `{editingEntry.name}`，这里修改的是展示名称。</span>
              ) : null}
            </div>

            <div className="mcp-dialog-field">
              <Text>类型</Text>
              <Select
                value={draft.type}
                options={transportOptions.map((item) => ({
                  value: item.value,
                  label: `${item.label} — ${item.description}`,
                }))}
                onChange={(value) => setDraft((current) => ({ ...current, type: value }))}
              />
            </div>

            {dialogIsRemote ? (
              <>
                <div className="mcp-dialog-field">
                  <Text>远程地址</Text>
                  <Input
                    aria-label="远程地址"
                    value={draft.url}
                    onChange={(event) => setDraft((current) => ({ ...current, url: event.target.value }))}
                    placeholder="https://mcp.example.com/sse"
                  />
                </div>

                <div className="mcp-dialog-field">
                  <Text>请求头（可选）</Text>
                  <Input.TextArea
                    rows={4}
                    aria-label="请求头（可选）"
                    value={draft.headersText}
                    onChange={(event) => setDraft((current) => ({ ...current, headersText: event.target.value }))}
                    placeholder={'Authorization: Bearer <token>\nX-Custom: value'}
                  />
                </div>
              </>
            ) : (
              <>
                <div className="mcp-dialog-field">
                  <Text>命令</Text>
                  <Input
                    aria-label="命令"
                    value={draft.command}
                    onChange={(event) => setDraft((current) => ({ ...current, command: event.target.value }))}
                    placeholder="npx"
                  />
                </div>

                <div className="mcp-dialog-field">
                  <Text>参数（可选）</Text>
                  <Input
                    aria-label="参数（可选）"
                    value={draft.argsText}
                    onChange={(event) => setDraft((current) => ({ ...current, argsText: event.target.value }))}
                    placeholder="-y @modelcontextprotocol/server-github"
                  />
                </div>

                <div className="mcp-dialog-field">
                  <Text>环境变量（可选）</Text>
                  <Input.TextArea
                    rows={5}
                    aria-label="环境变量（可选）"
                    value={draft.envText}
                    onChange={(event) => setDraft((current) => ({ ...current, envText: event.target.value }))}
                    placeholder={'GITHUB_TOKEN=xxx\nSOME_KEY=value'}
                  />
                </div>
              </>
            )}

            <div className="mcp-dialog-field mcp-dialog-timeout-field">
              <Text>超时时间 (s)</Text>
              <InputNumber
                min={1}
                value={draft.toolTimeout}
                onChange={(value) => setDraft((current) => ({ ...current, toolTimeout: Number(value || 30) }))}
              />
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
