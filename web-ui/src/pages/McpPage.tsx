import { useEffect, useMemo, useState } from 'react'
import { Alert, App, Button, Card, Drawer, Empty, Form, Input, InputNumber, Select, Space, Spin, Switch, Tag, Typography } from 'antd'
import { EditOutlined, PlusOutlined, PlayCircleOutlined, ReloadOutlined, SaveOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import PageHero from '../components/PageHero'
import { useDevMode } from '../devMode'
import { formatDateTimeZh } from '../locale'
import { testIds } from '../testIds'
import type {
  McpRepositoryAnalysis,
  McpRepositoryInstallResult,
  McpServerCreateInput,
  McpServerEntry,
  McpServerListResponse,
  McpServerStatus,
  McpServerTransport,
} from '../types'

const { Text } = Typography

const transportLabels: Record<McpServerTransport, string> = {
  stdio: 'stdio',
  sse: 'SSE',
  streamableHttp: 'Streamable HTTP',
  unknown: '未识别',
}

const statusMeta: Record<McpServerStatus, { label: string; color: string }> = {
  ready: { label: '可加载', color: 'success' },
  incomplete: { label: '待补全', color: 'warning' },
  disabled: { label: '已停用', color: 'default' },
}

interface ServerCreateDraft {
  serverName?: string
  displayName: string
  sourceKind: 'manual' | 'config' | 'repository'
  sourceLabel: string
  enabled: boolean
  transport: 'stdio' | 'sse' | 'streamableHttp'
  command: string
  argsText: string
  envText: string
  url: string
  headersText: string
  toolTimeout: number
}

function parseJsonMap(raw: string, label: string) {
  const trimmed = raw.trim()
  if (!trimmed) {
    return {}
  }
  const payload = JSON.parse(trimmed) as Record<string, unknown>
  if (!payload || Array.isArray(payload) || typeof payload !== 'object') {
    throw new Error(`${label} 必须是 JSON 对象`)
  }
  return Object.fromEntries(Object.entries(payload).map(([key, value]) => [key, String(value ?? '')]))
}

function parseLines(raw: string) {
  return raw
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean)
}

function buildCreateDraft(): ServerCreateDraft {
  return {
    displayName: '',
    sourceKind: 'manual',
    sourceLabel: '手动登记',
    enabled: true,
    transport: 'stdio',
    command: '',
    argsText: '',
    envText: '{}',
    url: '',
    headersText: '{}',
    toolTimeout: 30,
  }
}

export default function McpPage() {
  const { message } = App.useApp()
  const navigate = useNavigate()
  const { devMode } = useDevMode()
  const [data, setData] = useState<McpServerListResponse | null>(null)
  const [analysis, setAnalysis] = useState<McpRepositoryAnalysis | null>(null)
  const [lastInstall, setLastInstall] = useState<McpRepositoryInstallResult | null>(null)
  const [repoSource, setRepoSource] = useState('')
  const [analyzing, setAnalyzing] = useState(false)
  const [installing, setInstalling] = useState(false)
  const [actingName, setActingName] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [createDrawerOpen, setCreateDrawerOpen] = useState(false)
  const [creatingServer, setCreatingServer] = useState(false)
  const [createForm] = Form.useForm<ServerCreateDraft>()
  const createTransport = Form.useWatch('transport', createForm)

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

  function openCreateDrawer() {
    setCreateDrawerOpen(true)
    createForm.resetFields()
    createForm.setFieldsValue(buildCreateDraft())
  }

  function closeCreateDrawer() {
    setCreateDrawerOpen(false)
    createForm.resetFields()
  }

  async function handleCreateServer() {
    try {
      const values = await createForm.validateFields()
      const payload: McpServerCreateInput = {
        serverName: values.serverName?.trim() || undefined,
        displayName: values.displayName.trim() || null,
        sourceKind: values.sourceKind,
        sourceLabel: values.sourceLabel.trim() || '手动登记',
        enabled: values.enabled,
        transport: values.transport,
        command: values.transport === 'stdio' ? values.command.trim() || null : null,
        args: values.transport === 'stdio' ? parseLines(values.argsText) : [],
        env: values.transport === 'stdio' ? parseJsonMap(values.envText, '环境变量') : {},
        url: values.transport === 'stdio' ? null : values.url.trim() || null,
        headers: values.transport === 'stdio' ? {} : parseJsonMap(values.headersText, '请求头'),
        toolTimeout: Number(values.toolTimeout || 30),
      }

      setCreatingServer(true)
      const next = await api.createMcpServer(payload)
      closeCreateDrawer()
      await loadServers()
      message.success(`MCP ${next.serverName} 已创建`)
      navigate(`/mcp/${encodeURIComponent(next.serverName)}`)
    } catch (error) {
      if (error instanceof SyntaxError) {
        message.error('环境变量或请求头必须是合法 JSON')
        return
      }
      if (typeof error === 'object' && error && 'errorFields' in error) {
        return
      }
      if (error instanceof Error && error.message) {
        message.error(error.message)
      }
    } finally {
      setCreatingServer(false)
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

  async function handleProbe(entry: McpServerEntry) {
    try {
      setActingName(entry.name)
      const next = await api.probeMcpServer(entry.name)
      await loadServers()
      message.success(next.ok ? `${entry.displayName} 探测通过` : `${entry.displayName} ${next.statusLabel}`)
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'MCP 探测失败')
    } finally {
      setActingName(null)
    }
  }

  const summary = useMemo(
    () =>
      data?.summary ?? {
        total: 0,
        enabled: 0,
        disabled: 0,
        ready: 0,
        incomplete: 0,
        knownToolCount: 0,
        verifiedServers: 0,
      },
    [data],
  )
  if (loading && !data) {
    return (
      <div className="center-box page-card">
        <Spin />
      </div>
    )
  }

  return (
    <div className="page-stack">
      <PageHero
        className="page-hero-compact studio-hero"
        eyebrow={devMode ? 'MCP Registry' : '连接'}
        title={devMode ? '连接目录' : '第三方服务连接'}
        description={devMode ? '管理 MCP 与连接状态。' : '管理第三方连接。'}
        badges={[
          <Tag key="scope">{devMode ? '仓库安装' : '连接总览'}</Tag>,
          summary.enabled > 0 ? <Tag key="enabled" color="success">已启用 {summary.enabled}</Tag> : null,
        ].filter(Boolean)}
        actions={(
          <div className="mcp-hero-actions">
            <Button icon={<PlusOutlined />} onClick={openCreateDrawer} type="primary">
              手动添加 Server
            </Button>
            <Button icon={<ReloadOutlined />} onClick={() => void loadServers()} loading={loading}>
              刷新
            </Button>
          </div>
        )}
        stats={[
          { label: '登记 MCP', value: summary.total },
          { label: '可加载', value: summary.ready },
          { label: '待补全', value: summary.incomplete },
          { label: '已验证', value: summary.verifiedServers },
        ]}
      />

      {summary.incomplete > 0 ? (
        <Alert
          className="mcp-inline-alert"
          type="info"
          message="先补齐配置，再执行探测"
          description={`还有 ${summary.incomplete} 个未完成配置。`}
        />
      ) : null}

      <Card className="config-panel-card">
        <div className="config-card-header">
          <div className="page-section-title">
            <Typography.Title level={4}>手动添加 MCP Server</Typography.Title>
            <Text type="secondary">适合直接填写 stdio / SSE / streamable HTTP 连接信息。</Text>
          </div>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreateDrawer}>
            新建
          </Button>
        </div>

        <div className="page-meta-grid mcp-meta-grid">
          <div className="page-meta-card">
            <span>支持传输</span>
            <strong>stdio / sse / streamableHttp</strong>
          </div>
          <div className="page-meta-card">
            <span>默认来源</span>
            <strong>manual</strong>
          </div>
          <div className="page-meta-card">
            <span>安装流程</span>
            <strong>无需仓库预检</strong>
          </div>
          <div className="page-meta-card">
            <span>后续动作</span>
            <strong>保存后可进入详情继续探测</strong>
          </div>
        </div>
      </Card>

      <Card className="config-panel-card">
        <div className="config-card-header">
          <div className="page-section-title">
            <Typography.Title level={4}>从仓库安装</Typography.Title>
            <Text type="secondary">输入仓库地址后预检安装。</Text>
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
                  <Text type="secondary">运行预览</Text>
                  <div className="mono-block mono-block-large">{analysis.commandPreview || analysis.runUrl || '--'}</div>
                </div>
                <div className="detail-block">
                  <Text type="secondary">下一步</Text>
                  <div className="mono-block mono-block-large">{analysis.nextStep}</div>
                </div>
              </div>

              {analysis.requiredEnv.length > 0 ? (
                <div className="config-section-stack">
                  <Text strong>必填环境变量</Text>
                  <div className="tag-cloud">
                    {analysis.requiredEnv.map((item) => (
                      <Tag key={item}>{item}</Tag>
                    ))}
                  </div>
                </div>
              ) : null}

              {analysis.missingRuntimes.length > 0 ? (
                <div className="config-section-stack">
                  <Text strong>缺失运行时</Text>
                  <div className="tag-cloud">
                    {analysis.missingRuntimes.map((item) => (
                      <Tag color="warning" key={item}>
                        {item}
                      </Tag>
                    ))}
                  </div>
                </div>
              ) : null}
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

      <Card className="config-panel-card">
        <div className="config-card-header">
          <div className="page-section-title">
            <Typography.Title level={4}>MCP 目录</Typography.Title>
            <Text type="secondary">查看状态、探测和详情。</Text>
          </div>
          <div className="tag-cloud">
            <Tag>登记 {summary.total}</Tag>
            <Tag>已验证 {summary.verifiedServers}</Tag>
            <Tag>待补全 {summary.incomplete}</Tag>
          </div>
        </div>

        {data && data.items.length > 0 ? (
          <div className="mcp-card-grid">
            {data.items.map((entry) => (
              <article className="mcp-item-card" key={entry.name}>
                <div className="mcp-item-header">
                  <div className="page-section-title">
                    <Typography.Title level={4}>{entry.displayName}</Typography.Title>
                    <Text type="secondary">{entry.repoUrl || entry.sourceLabel}</Text>
                  </div>
                  <div className="tag-cloud">
                    <Tag color={statusMeta[entry.status].color}>{statusMeta[entry.status].label}</Tag>
                    <Tag>{entry.enabled ? '启用' : '停用'}</Tag>
                    <Tag>{transportLabels[entry.transport]}</Tag>
                  </div>
                </div>

                <div className="page-meta-grid mcp-meta-grid">
                  <div className="page-meta-card">
                    <span>工具数</span>
                    <strong>{entry.toolCountKnown ? entry.toolCount : '待探测'}</strong>
                  </div>
                  <div className="page-meta-card">
                    <span>最近探测</span>
                    <strong>{entry.lastCheckedAt ? formatDateTimeZh(entry.lastCheckedAt) : '未探测'}</strong>
                  </div>
                  <div className="page-meta-card">
                    <span>来源</span>
                    <strong>{entry.sourceLabel}</strong>
                  </div>
                </div>

                <Text type="secondary">{entry.statusDetail}</Text>

                {entry.lastError ? (
                  <Alert
                    type="warning"
                    className="mcp-entry-alert"
                    message="最近一次同步记录了错误"
                    description={entry.lastError}
                  />
                ) : null}

                <div className="mcp-hero-actions">
                  <Button
                    icon={<PlayCircleOutlined />}
                    loading={actingName === entry.name}
                    onClick={() => void handleProbe(entry)}
                    data-testid={`${testIds.mcp.probePrefix}${entry.name}`}
                  >
                    探测
                  </Button>
                  <Button
                    icon={<EditOutlined />}
                    onClick={() => navigate(`/mcp/${encodeURIComponent(entry.name)}`)}
                    data-testid={`${testIds.mcp.detailLinkPrefix}${entry.name}`}
                  >
                    进入详情
                  </Button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <Empty
            className="empty-block"
            description="还没有 MCP"
          />
        )}
      </Card>

      <Drawer
        title="手动添加 MCP Server"
        open={createDrawerOpen}
        width={720}
        onClose={closeCreateDrawer}
        destroyOnClose
        extra={(
          <Space>
            <Button onClick={closeCreateDrawer}>取消</Button>
            <Button type="primary" icon={<SaveOutlined />} loading={creatingServer} onClick={() => void handleCreateServer()}>
              保存
            </Button>
          </Space>
        )}
      >
        <Form layout="vertical" form={createForm} initialValues={buildCreateDraft()} preserve={false}>
          <Form.Item label="服务器名" name="serverName">
            <Input placeholder="可留空，由系统自动生成" />
          </Form.Item>
          <Form.Item label="展示名称" name="displayName" rules={[{ required: true, message: '请输入展示名称' }]}>
            <Input placeholder="例如 Filesystem" />
          </Form.Item>
          <Form.Item label="来源类型" name="sourceKind">
            <Select
              options={[
                { label: '手动登记', value: 'manual' },
                { label: '现有配置', value: 'config' },
                { label: '仓库安装', value: 'repository' },
              ]}
            />
          </Form.Item>
          <Form.Item label="来源标签" name="sourceLabel">
            <Input placeholder="例如 手动登记" />
          </Form.Item>
          <Form.Item label="传输类型" name="transport" rules={[{ required: true, message: '请选择传输类型' }]}>
            <Select
              options={[
                { label: 'stdio', value: 'stdio' },
                { label: 'sse', value: 'sse' },
                { label: 'streamableHttp', value: 'streamableHttp' },
              ]}
            />
          </Form.Item>
          {createTransport === 'stdio' ? (
            <>
              <Form.Item label="Command" name="command" rules={[{ required: true, message: 'stdio 需要 command' }]}>
                <Input placeholder="例如 node" />
              </Form.Item>
              <Form.Item label="Args" name="argsText">
                <Input.TextArea rows={4} placeholder="每行一个参数" />
              </Form.Item>
              <Form.Item label="环境变量 JSON" name="envText">
                <Input.TextArea rows={4} placeholder='{"NODE_ENV":"production"}' />
              </Form.Item>
            </>
          ) : (
            <>
              <Form.Item label="URL" name="url" rules={[{ required: true, message: 'HTTP 连接需要 URL' }]}>
                <Input placeholder="https://example.com/mcp" />
              </Form.Item>
              <Form.Item label="请求头 JSON" name="headersText">
                <Input.TextArea rows={4} placeholder='{"Authorization":"Bearer xxx"}' />
              </Form.Item>
            </>
          )}
          <Form.Item label="Tool Timeout" name="toolTimeout">
            <InputNumber min={1} max={300} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item label="启用" name="enabled" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Drawer>
    </div>
  )
}
