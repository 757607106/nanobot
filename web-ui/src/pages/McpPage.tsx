import { useEffect, useMemo, useState } from 'react'
import { Alert, App, Button, Card, Empty, Input, Spin, Tag, Typography } from 'antd'
import { EditOutlined, PlayCircleOutlined, ReloadOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import PageHero from '../components/PageHero'
import { formatDateTimeZh } from '../locale'
import { testIds } from '../testIds'
import type {
  McpRepositoryAnalysis,
  McpRepositoryInstallResult,
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

export default function McpPage() {
  const { message } = App.useApp()
  const navigate = useNavigate()
  const [data, setData] = useState<McpServerListResponse | null>(null)
  const [analysis, setAnalysis] = useState<McpRepositoryAnalysis | null>(null)
  const [lastInstall, setLastInstall] = useState<McpRepositoryInstallResult | null>(null)
  const [repoSource, setRepoSource] = useState('')
  const [analyzing, setAnalyzing] = useState(false)
  const [installing, setInstalling] = useState(false)
  const [actingName, setActingName] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

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
        className="page-hero-compact"
        eyebrow="MCP Registry"
        title="MCP 扩展目录"
        description="在这里查看目录、从仓库安装、执行探测，并进入单个 MCP 做隔离测试。"
        actions={(
          <div className="mcp-hero-actions">
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
          description={`还有 ${summary.incomplete} 个 MCP 缺少关键配置，补齐后再探测。`}
        />
      ) : null}

      <Card className="config-panel-card">
        <div className="config-card-header">
          <div className="page-section-title">
            <Typography.Title level={4}>从仓库安装</Typography.Title>
            <Text type="secondary">输入仓库地址，预检后安装并登记。</Text>
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
                ? `安装目录：${lastInstall.installDir}。默认保持禁用，测试通过后再启用。`
                : '默认保持禁用，测试通过后再启用。'
            }
          />
        ) : null}
      </Card>

      <Card className="config-panel-card">
        <div className="config-card-header">
          <div className="page-section-title">
            <Typography.Title level={4}>MCP 目录</Typography.Title>
            <Text type="secondary">这里聚焦目录、探测和进入测试。</Text>
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
            description="还没有登记 MCP，先从上面的仓库入口安装一个。"
          />
        )}
      </Card>
    </div>
  )
}
