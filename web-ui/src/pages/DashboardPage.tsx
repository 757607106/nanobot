import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Flex,
  Segmented,
  Skeleton,
  Tag,
  Typography,
  theme,
} from 'antd'
import {
  ClockCircleOutlined,
  DownloadOutlined,
  MessageOutlined,
  ReloadOutlined,
  RobotOutlined,
  ApiOutlined,
  DatabaseOutlined,
  FireOutlined,
  BarChartOutlined,
} from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import MetricCard from '../components/console/MetricCard'
import SectionCard from '../components/console/SectionCard'
import PageHeader from '../components/console/PageHeader'
import type {
  AgentDefinition,
  CronStatus,
  KnowledgeBaseDefinition,
  SystemStatus,
  AgentExecutionMetrics,
  DashboardTimeBucket,
  DashboardAnalyticsResponse,
  DashboardMcpHealthResponse,
  DashboardKbActivityItem,
} from '../types'
import { useToast } from '../toast'

// Lazy-load chart components to keep initial bundle small
const ModelCallTrendChart = lazy(() => import('../components/dashboard/ModelCallTrendChart'))
const TokenConsumptionPieChart = lazy(() => import('../components/dashboard/TokenConsumptionPieChart'))
const ToolUsageBarChart = lazy(() => import('../components/dashboard/ToolUsageBarChart'))
const McpHealthGauge = lazy(() => import('../components/dashboard/McpHealthGauge'))
const KnowledgeActivityHeatmap = lazy(() => import('../components/dashboard/KnowledgeActivityHeatmap'))

function cardSkeleton(width = 72) {
  return <Skeleton active title={{ width }} paragraph={false} />
}

function chartSkeleton() {
  return <Skeleton active paragraph={{ rows: 6 }} title={false} />
}

const BUCKET_OPTIONS = [
  { label: '小时', value: 'hour' as const },
  { label: '天', value: 'day' as const },
  { label: '周', value: 'week' as const },
  { label: '月', value: 'month' as const },
]

/**
 * Build a simple CSV string from the analytics data and trigger a download.
 */
function exportAnalyticsCsv(analytics: DashboardAnalyticsResponse | null) {
  if (!analytics) return

  const rows: string[][] = [['bucket', 'agentId', 'model', 'runCount', 'totalTokens', 'promptTokens', 'completionTokens', 'cachedTokens']]
  for (const pt of analytics.timeSeries) {
    rows.push([
      pt.bucket,
      pt.agentId ?? '',
      pt.model ?? '',
      String(pt.runCount),
      String(pt.totalTokens),
      String(pt.promptTokens),
      String(pt.completionTokens),
      String(pt.cachedTokens),
    ])
  }

  const csv = rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n')
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `dashboard-analytics-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

/* ── Helper Component for Agent Diagnostics ── */
function DiagnosticModule({
  title,
  icon,
  iconColor,
  isEmpty,
  children
}: {
  title: string
  icon: React.ReactNode
  iconColor: string
  isEmpty: boolean
  children: React.ReactNode
}) {
  return (
    <div className="dashboard-diagnostic-module">
      <Flex align="center" gap={8} className="dashboard-diagnostic-head">
        <span style={{ color: iconColor }} aria-hidden="true">
          {icon}
        </span>
        <Typography.Text type="secondary" className="dashboard-diagnostic-title">
          {title}
        </Typography.Text>
      </Flex>
      {isEmpty ? (
        <Typography.Text type="secondary" className="dashboard-diagnostic-empty">
          — 无记录 —
        </Typography.Text>
      ) : (
        children
      )}
    </div>
  )
}

function BasicTagList({ items, color }: { items: [string, number][], color: string }) {
  return (
    <Flex wrap="wrap" gap={6} className="dashboard-diagnostic-tags">
      {items.map(([key, count]) => (
        <div key={key} className="dashboard-diagnostic-tag">
          <Typography.Text className="dashboard-diagnostic-tag-label">
            {key}
          </Typography.Text>
          <Tag color={color} bordered={false} className="dashboard-diagnostic-tag-count">
            {count}
          </Tag>
        </div>
      ))}
    </Flex>
  )
}

export default function DashboardPage() {
  const message = useToast()
  const { token } = theme.useToken()
  const navigate = useNavigate()

  // ── existing state ──
  const [cron, setCron] = useState<CronStatus | null>(null)
  const [agents, setAgents] = useState<AgentDefinition[]>([])
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBaseDefinition[]>([])
  const [system, setSystem] = useState<SystemStatus | null>(null)
  const [agentMetrics, setAgentMetrics] = useState<Record<string, AgentExecutionMetrics>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // ── new analytics state ──
  const [bucket, setBucket] = useState<DashboardTimeBucket>('day')
  const [analytics, setAnalytics] = useState<DashboardAnalyticsResponse | null>(null)
  const [mcpHealth, setMcpHealth] = useState<DashboardMcpHealthResponse | null>(null)
  const [kbActivity, setKbActivity] = useState<DashboardKbActivityItem[]>([])
  const [chartsLoading, setChartsLoading] = useState(true)

  const activeChannels = system?.stats.enabledChannels || []
  const isSystemOnline = cron?.enabled ?? false
  const dateString = new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })

  // Overview metrics from analytics API (preferred) or system status fallback
  const overview = analytics?.overview

  const loadDashboard = useCallback(async () => {
    try {
      setLoading(true)
      const [cronData, agentsData, systemData, kbData, metricsData] = await Promise.all([
        api.getCronStatus(),
        api.getAgents(),
        api.getSystemStatus(),
        api.getKnowledgeBases().catch(() => [] as KnowledgeBaseDefinition[]),
        api.getAgentsMetrics().catch(() => ({})),
      ])
      setCron(cronData)
      setAgents(agentsData)
      setSystem(systemData)
      setKnowledgeBases(Array.isArray(kbData) ? kbData : [])
      setAgentMetrics(metricsData)
      setError(null)
    } catch (loadError) {
      const nextError = loadError instanceof Error ? loadError.message : '加载控制台总览失败'
      setError(nextError)
      message.error(nextError)
    } finally {
      setLoading(false)
    }
  }, [message])

  const loadAnalytics = useCallback(async (b: DashboardTimeBucket) => {
    try {
      setChartsLoading(true)
      const [analyticsData, mcpData, kbData] = await Promise.allSettled([
        api.getDashboardAnalytics({ bucket: b }),
        api.getDashboardMcpHealth(),
        api.getDashboardKbActivity(),
      ])
      if (analyticsData.status === 'fulfilled') setAnalytics(analyticsData.value)
      if (mcpData.status === 'fulfilled') setMcpHealth(mcpData.value)
      if (kbData.status === 'fulfilled') setKbActivity(kbData.value)
    } catch {
      // analytics errors are non-fatal — charts will show empty states
    } finally {
      setChartsLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadDashboard()
    void loadAnalytics(bucket)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Re-fetch analytics when bucket changes (after initial load)
  const handleBucketChange = useCallback(
    (v: string | number) => {
      const next = v as DashboardTimeBucket
      setBucket(next)
      void loadAnalytics(next)
    },
    [loadAnalytics],
  )

  const handleRefresh = useCallback(() => {
    void loadDashboard()
    void loadAnalytics(bucket)
  }, [bucket, loadDashboard, loadAnalytics])

  return (
    <div className="page-stack stagger-container" style={{ width: '100%', minWidth: 0 }}>
      {/* ── 顶部状态栏 ── */}
      <PageHeader
        title="控制台总览"
        subtitle={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: isSystemOnline ? token.colorSuccess : token.colorWarning,
            }} />
            <span style={{ fontFamily: 'var(--nb-font-mono)', fontSize: 'var(--nb-text-sm)', letterSpacing: '0.04em' }}>
              {isSystemOnline ? '系统运行中' : '系统待机'} · {dateString}
            </span>
          </div>
        }
        actions={
          <Flex gap={8} align="center">
            <Segmented size="small" options={BUCKET_OPTIONS} value={bucket} onChange={handleBucketChange} />
            <Button
              type="text"
              size="small"
              icon={<DownloadOutlined />}
              onClick={() => exportAnalyticsCsv(analytics)}
              disabled={!analytics}
              style={{ color: 'var(--nb-text-secondary)' }}
            >
              CSV
            </Button>
            <Button
              type="text"
              icon={<ReloadOutlined spin={loading || chartsLoading} />}
              onClick={handleRefresh}
              disabled={loading && chartsLoading}
              style={{ color: 'var(--nb-text-secondary)' }}
            >
              刷新
            </Button>
          </Flex>
        }
      />

      {error ? <Alert type="error" showIcon message={error} style={{ marginBottom: 'var(--nb-spacing-lg)' }} /> : null}

      {/* ── 核心指标卡 ── */}
      <div className="dashboard-metrics-grid">
        <MetricCard
          label="总运行数"
          value={loading && !overview ? cardSkeleton() : (overview?.totalRuns ?? system?.stats.totalSessions ?? 0).toLocaleString()}
          helper="历史任务运行总计"
          tone="primary"
          icon={<BarChartOutlined />}
        />
        <MetricCard
          label="活跃智能体"
          value={loading && !overview ? cardSkeleton() : overview?.activeAgents ?? agents.length}
          helper="有运行记录的智能体"
          tone="success"
          icon={<RobotOutlined />}
        />
        <MetricCard
          label="活跃模型"
          value={loading && !overview ? cardSkeleton() : overview?.activeModels ?? 0}
          helper="被调用过的模型数"
          tone="warning"
          icon={<FireOutlined />}
        />
        <MetricCard
          label="算力消耗"
          value={loading && !overview ? cardSkeleton() : (overview?.totalTokens ?? system?.stats.totalTokens ?? 0).toLocaleString()}
          helper={`输入 ${(
            overview?.promptTokens ?? system?.stats.promptTokens ?? 0
          ).toLocaleString()} · 输出 ${(
            overview?.completionTokens ?? system?.stats.completionTokens ?? 0
          ).toLocaleString()}`}
          tone="primary"
          icon={<FireOutlined />}
        />
        <MetricCard
          label="知识库"
          value={loading ? cardSkeleton() : knowledgeBases.length}
          helper="知识资源库数量"
          tone="neutral"
          icon={<DatabaseOutlined />}
        />
        <MetricCard
          label="定时任务"
          value={loading ? cardSkeleton() : cron?.jobs ?? 0}
          helper={cron?.enabled ? '调度引擎运行中' : '调度引擎离线'}
          tone={cron?.enabled ? 'neutral' : 'warning'}
          icon={<ClockCircleOutlined />}
        />
      </div>

      {/* ── 快捷操作 ── */}
      <div className="dashboard-quick-action-grid">
        <button type="button" className="dashboard-quick-action tone-accent" onClick={() => navigate('/studio')}>
          <div className="dashboard-quick-action-icon">
            <RobotOutlined />
          </div>
          <div className="dashboard-quick-action-copy">
            <Typography.Text strong className="dashboard-quick-action-title">
              创建智能体
            </Typography.Text>
            <Typography.Text type="secondary" className="dashboard-quick-action-description">
              配置并调试核心数字员工角色
            </Typography.Text>
          </div>
        </button>
        <button type="button" className="dashboard-quick-action tone-warning" onClick={() => navigate('/knowledge')}>
          <div className="dashboard-quick-action-icon">
            <DatabaseOutlined />
          </div>
          <div className="dashboard-quick-action-copy">
            <Typography.Text strong className="dashboard-quick-action-title">
              构建知识库
            </Typography.Text>
            <Typography.Text type="secondary" className="dashboard-quick-action-description">
              导入私有语料训练专属大脑
            </Typography.Text>
          </div>
        </button>
        <button type="button" className="dashboard-quick-action tone-success" onClick={() => navigate('/channels')}>
          <div className="dashboard-quick-action-icon">
            <ApiOutlined />
          </div>
          <div className="dashboard-quick-action-copy">
            <Typography.Text strong className="dashboard-quick-action-title">
              连接发布渠道
            </Typography.Text>
            <Typography.Text type="secondary" className="dashboard-quick-action-description">
              将中枢系统接入办公平台或社群
            </Typography.Text>
          </div>
        </button>
      </div>

      {/* ── 图表区域 ── */}
      <div className="dashboard-charts-grid">
        {/* 模型调用趋势 (full width) */}
        <SectionCard title="模型调用趋势" description="按选定时间粒度统计模型调用量与趋势。">
          <Suspense fallback={chartSkeleton()}>
            {chartsLoading ? chartSkeleton() : <ModelCallTrendChart data={analytics?.timeSeries ?? []} />}
          </Suspense>
        </SectionCard>

        {/* Token 消耗分布 */}
        <SectionCard title="Token 消耗分布" description="输入与输出 Token 的消耗结构与占比。">
          <Suspense fallback={chartSkeleton()}>
            {chartsLoading ? chartSkeleton() : <TokenConsumptionPieChart data={analytics?.timeSeries ?? []} />}
          </Suspense>
        </SectionCard>

        {/* 工具使用 TOP10 */}
        <SectionCard title="工具使用 TOP10" description="统计工具调用频次，定位高开销工具链。">
          <Suspense fallback={chartSkeleton()}>
            {chartsLoading ? chartSkeleton() : <ToolUsageBarChart data={analytics?.toolRanking ?? []} />}
          </Suspense>
        </SectionCard>
      </div>

      {/* ── 状态区域 ── */}
      <div className="dashboard-status-grid">
        {/* MCP 服务健康度 */}
        <SectionCard title="连接健康度" description="监控连接可用性与响应健康度。">
          <Suspense fallback={chartSkeleton()}>
            {chartsLoading ? chartSkeleton() : <McpHealthGauge data={mcpHealth} />}
          </Suspense>
        </SectionCard>

        {/* 知识库活动 */}
        <SectionCard title="知识库活动" description="最近知识检索与写入活跃度。">
          <Suspense fallback={chartSkeleton()}>
            {chartsLoading ? chartSkeleton() : <KnowledgeActivityHeatmap data={kbActivity} />}
          </Suspense>
        </SectionCard>

        {/* 系统状态 */}
        <SectionCard title="系统状态" description="核心服务与配置摘要。">
          {loading ? (
            <Skeleton active paragraph={{ rows: 3 }} title={false} />
          ) : (
            <div className="dashboard-status-list">
              {[
                { label: '调度引擎', value: cron?.enabled ? '运行中' : '已离线', color: cron?.enabled ? 'green' : 'default' },
                { label: '网关服务', value: '运行中', color: 'green' },
                { label: '接入渠道', value: `${activeChannels.length} 个`, color: activeChannels.length > 0 ? 'blue' : 'default' },
                { label: '运行版本', value: system?.web.version || '—', color: undefined },
              ].map((row, i, arr) => (
                <div
                  key={row.label}
                  className="dashboard-status-row"
                  data-last={i === arr.length - 1 ? 'true' : 'false'}
                >
                  <Typography.Text type="secondary" className="dashboard-status-label">
                    {row.label}
                  </Typography.Text>
                  {row.color ? (
                    <Tag color={row.color} style={{ margin: 0 }}>
                      {row.value}
                    </Tag>
                  ) : (
                    <Typography.Text strong className="dashboard-status-value">
                      {row.value}
                    </Typography.Text>
                  )}
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>

      {/* ── Agent 效能诊断 ── */}
      <SectionCard title="员工开销与效能分析">
        {loading ? (
          <Skeleton active paragraph={{ rows: 4 }} title={false} />
        ) : Object.keys(agentMetrics).length > 0 ? (
          <Flex vertical gap="var(--nb-spacing-lg)">
            {agents.map((agent) => {
              const metrics = agentMetrics[agent.agentId]
              if (!metrics || (metrics.tokens.length === 0 && Object.keys(metrics.tools || {}).length === 0 && Object.keys(metrics.mcps || {}).length === 0 && Object.keys(metrics.knowledge || {}).length === 0)) return null

              return (
                <div key={agent.agentId} className="dashboard-agent-diagnostic">
                  <Flex align="center" gap={12} className="dashboard-agent-diagnostic-head">
                    <div className="dashboard-agent-diagnostic-badge" aria-hidden="true">
                      <RobotOutlined />
                    </div>
                    <Typography.Text strong className="dashboard-agent-diagnostic-name">
                      {agent.name}
                    </Typography.Text>
                  </Flex>

                  <div className="dashboard-agent-diagnostic-grid">
                    {/* Tokens Module */}
                    <DiagnosticModule
                      title="模型消耗（Token）"
                      icon={<FireOutlined />}
                      iconColor="var(--nb-accent)"
                      isEmpty={metrics.tokens.length === 0}
                    >
                      <Flex vertical gap={8}>
                        {metrics.tokens.map((t, idx) => (
                          <div key={idx} className="dashboard-token-row" data-last={idx === metrics.tokens.length - 1 ? 'true' : 'false'}>
                            <div className="dashboard-token-row-left">
                              <div className="dashboard-token-row-model">{t.provider}/{t.model}</div>
                              <div className="dashboard-token-row-breakdown">
                                输入:{t.promptTokens} · 输出:{t.completionTokens}{t.cachedTokens ? ` · 缓存:${t.cachedTokens}` : ''}
                              </div>
                            </div>
                            <Typography.Text strong className="dashboard-token-row-total">
                              {t.totalTokens.toLocaleString()}
                            </Typography.Text>
                          </div>
                        ))}
                      </Flex>
                    </DiagnosticModule>

                    {/* Tools Module */}
                    <DiagnosticModule
                      title="工具调用"
                      icon={<ApiOutlined />}
                      iconColor="#1677ff"
                      isEmpty={Object.keys(metrics.tools || {}).length === 0}
                    >
                      <BasicTagList items={Object.entries(metrics.tools || {})} color="blue" />
                    </DiagnosticModule>

                    {/* MCPs Module */}
                    <DiagnosticModule
                      title="连接节点"
                      icon={<DatabaseOutlined />}
                      iconColor="#2f54eb"
                      isEmpty={Object.keys(metrics.mcps || {}).length === 0}
                    >
                      <BasicTagList items={Object.entries(metrics.mcps || {})} color="geekblue" />
                    </DiagnosticModule>

                    {/* KB Module */}
                    <DiagnosticModule
                      title="知识检索"
                      icon={<DatabaseOutlined />}
                      iconColor="#13c2c2"
                      isEmpty={Object.keys(metrics.knowledge || {}).length === 0}
                    >
                      <BasicTagList items={Object.entries(metrics.knowledge || {})} color="cyan" />
                    </DiagnosticModule>
                  </div>
                </div>
              )
            })}
          </Flex>
        ) : (
          <Typography.Text type="secondary" style={{ fontSize: 'var(--nb-text-sm)' }}>暂无分析数据</Typography.Text>
        )}
      </SectionCard>
    </div>
  )
}
