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
              boxShadow: `0 0 10px ${isSystemOnline ? token.colorSuccess : token.colorWarning}`,
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
          helper={`P: ${(overview?.promptTokens ?? system?.stats.promptTokens ?? 0).toLocaleString()} / C: ${(overview?.completionTokens ?? system?.stats.completionTokens ?? 0).toLocaleString()}`}
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
        <div className="dashboard-quick-action tone-accent" onClick={() => navigate('/studio')}>
          <div className="dashboard-quick-action-icon">
            <RobotOutlined />
          </div>
          <div>
            <Typography.Text strong style={{ display: 'block', fontSize: 'var(--nb-text-sm)' }}>创建智能体</Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 'var(--nb-text-xs)', lineHeight: 1.4, display: 'block' }}>配置并调试核心数字员工角色</Typography.Text>
          </div>
        </div>
        <div className="dashboard-quick-action tone-warning" onClick={() => navigate('/knowledge')}>
          <div className="dashboard-quick-action-icon">
            <DatabaseOutlined />
          </div>
          <div>
            <Typography.Text strong style={{ display: 'block', fontSize: 'var(--nb-text-sm)' }}>构建知识库</Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 'var(--nb-text-xs)', lineHeight: 1.4, display: 'block' }}>导入私有语料训练专属大脑</Typography.Text>
          </div>
        </div>
        <div className="dashboard-quick-action tone-success" onClick={() => navigate('/channels')}>
          <div className="dashboard-quick-action-icon">
            <ApiOutlined />
          </div>
          <div>
            <Typography.Text strong style={{ display: 'block', fontSize: 'var(--nb-text-sm)' }}>连接发布渠道</Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 'var(--nb-text-xs)', lineHeight: 1.4, display: 'block' }}>将中枢系统接入办公平台或社群</Typography.Text>
          </div>
        </div>
      </div>

      {/* ── 图表区域 ── */}
      <div className="dashboard-charts-grid">
        {/* 模型调用趋势 (full width) */}
        <SectionCard title="模型调用趋势">
          <Suspense fallback={chartSkeleton()}>
            {chartsLoading ? chartSkeleton() : <ModelCallTrendChart data={analytics?.timeSeries ?? []} />}
          </Suspense>
        </SectionCard>

        {/* Token 消耗分布 */}
        <SectionCard title="Token 消耗分布">
          <Suspense fallback={chartSkeleton()}>
            {chartsLoading ? chartSkeleton() : <TokenConsumptionPieChart data={analytics?.timeSeries ?? []} />}
          </Suspense>
        </SectionCard>

        {/* 工具使用 TOP10 */}
        <SectionCard title="工具使用 TOP10">
          <Suspense fallback={chartSkeleton()}>
            {chartsLoading ? chartSkeleton() : <ToolUsageBarChart data={analytics?.toolRanking ?? []} />}
          </Suspense>
        </SectionCard>
      </div>

      {/* ── 状态区域 ── */}
      <div className="dashboard-status-grid">
        {/* MCP 服务健康度 */}
        <SectionCard title="MCP 服务健康度">
          <Suspense fallback={chartSkeleton()}>
            {chartsLoading ? chartSkeleton() : <McpHealthGauge data={mcpHealth} />}
          </Suspense>
        </SectionCard>

        {/* 知识库活动 */}
        <SectionCard title="知识库活动">
          <Suspense fallback={chartSkeleton()}>
            {chartsLoading ? chartSkeleton() : <KnowledgeActivityHeatmap data={kbActivity} />}
          </Suspense>
        </SectionCard>

        {/* 系统状态 */}
        <SectionCard title="系统状态">
          {loading ? (
            <Skeleton active paragraph={{ rows: 3 }} title={false} />
          ) : (
            <Flex vertical gap={0}>
              {[
                { label: '调度引擎', value: cron?.enabled ? '运行中' : '已离线', color: cron?.enabled ? 'green' : 'default' },
                { label: '网关服务', value: '运行中', color: 'green' },
                { label: '接入渠道', value: `${activeChannels.length} 个`, color: activeChannels.length > 0 ? 'blue' : 'default' },
                { label: '运行版本', value: system?.web.version || '—', color: undefined },
              ].map((row, i, arr) => (
                <Flex
                  key={row.label}
                  justify="space-between"
                  align="center"
                  style={{
                    padding: '10px 0',
                    borderBottom: i < arr.length - 1 ? `1px solid ${token.colorBorderSecondary}` : 'none',
                  }}
                >
                  <Typography.Text type="secondary" style={{ fontSize: 'var(--nb-text-sm)' }}>{row.label}</Typography.Text>
                  {row.color ? (
                    <Tag color={row.color} style={{ margin: 0 }}>{row.value}</Tag>
                  ) : (
                    <Typography.Text strong style={{ fontSize: 'var(--nb-text-sm)', fontFamily: 'var(--nb-font-mono)' }}>{row.value}</Typography.Text>
                  )}
                </Flex>
              ))}
            </Flex>
          )}
        </SectionCard>
      </div>

      {/* ── Agent 效能诊断 ── */}
      <SectionCard title="Agent 开销与效能分析">
        {loading ? (
          <Skeleton active paragraph={{ rows: 4 }} title={false} />
        ) : Object.keys(agentMetrics).length > 0 ? (
          <Flex vertical gap="var(--nb-spacing-lg)">
            {agents.map((agent) => {
              const metrics = agentMetrics[agent.agentId]
              if (!metrics || (metrics.tokens.length === 0 && Object.keys(metrics.tools || {}).length === 0 && Object.keys(metrics.mcps || {}).length === 0 && Object.keys(metrics.knowledge || {}).length === 0)) return null

              return (
                <div key={agent.agentId} style={{
                  background: token.colorFillQuaternary,
                  borderRadius: 'var(--nb-radius-lg)',
                  padding: 'var(--nb-spacing-lg)',
                  border: `1px solid ${token.colorBorderSecondary}`,
                }}>
                  <Flex align="center" gap={12} style={{ marginBottom: 'var(--nb-spacing-md)' }}>
                    <div style={{
                      width: 32, height: 32, borderRadius: 8, background: 'var(--nb-accent)',
                      color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center'
                    }}>
                      <RobotOutlined />
                    </div>
                    <Typography.Text strong style={{ fontSize: 'var(--nb-text-md)' }}>{agent.name}</Typography.Text>
                  </Flex>

                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                    gap: 'var(--nb-spacing-md)'
                  }}>
                    {/* Tokens Module */}
                    <div style={{ background: token.colorBgContainer, padding: 'var(--nb-spacing-md)', borderRadius: 10, border: `1px solid ${token.colorBorderSecondary}` }}>
                      <Flex align="center" gap={8} style={{ marginBottom: 12, opacity: 0.85 }}>
                        <FireOutlined style={{ color: 'var(--nb-accent)' }} />
                        <Typography.Text type="secondary" style={{ fontSize: 'var(--nb-text-xs)', fontWeight: 600, letterSpacing: '0.04em' }}>模型算力消耗 (TOKENS)</Typography.Text>
                      </Flex>
                      {metrics.tokens.length > 0 ? (
                        <Flex vertical gap={8}>
                          {metrics.tokens.map((t, idx) => (
                            <Flex justify="space-between" align="center" key={idx} style={{ paddingBottom: 6, borderBottom: idx < metrics.tokens.length - 1 ? `1px dashed ${token.colorBorderSecondary}` : 'none' }}>
                              <div style={{ fontSize: 'var(--nb-text-xs)' }}>
                                <div style={{ fontFamily: 'var(--nb-font-mono)', color: token.colorTextSecondary }}>{t.provider}/{t.model}</div>
                                <div style={{ fontSize: '10px', color: token.colorTextQuaternary }}>P:{t.promptTokens} / C:{t.completionTokens}{t.cachedTokens ? ` / Ca:${t.cachedTokens}` : ''}</div>
                              </div>
                              <Typography.Text strong style={{ fontSize: 'var(--nb-text-sm)', color: token.colorTextHeading }}>{t.totalTokens.toLocaleString()}</Typography.Text>
                            </Flex>
                          ))}
                        </Flex>
                      ) : (
                        <Typography.Text type="secondary" style={{ fontSize: 'var(--nb-text-xs)' }}>— 无流水 —</Typography.Text>
                      )}
                    </div>

                    {/* Tools Module */}
                    <div style={{ background: token.colorBgContainer, padding: 'var(--nb-spacing-md)', borderRadius: 10, border: `1px solid ${token.colorBorderSecondary}` }}>
                      <Flex align="center" gap={8} style={{ marginBottom: 12, opacity: 0.85 }}>
                        <ApiOutlined style={{ color: '#1677ff' }} />
                        <Typography.Text type="secondary" style={{ fontSize: 'var(--nb-text-xs)', fontWeight: 600, letterSpacing: '0.04em' }}>内部执行工具 (TOOLS)</Typography.Text>
                      </Flex>
                      {Object.keys(metrics.tools || {}).length > 0 ? (
                        <Flex wrap="wrap" gap={6}>
                          {Object.entries(metrics.tools || {}).map(([t, c]) => (
                            <div key={t} style={{ background: token.colorFillAlter, border: `1px solid ${token.colorBorderSecondary}`, padding: '4px 10px', borderRadius: 4, display: 'flex', gap: 8, alignItems: 'center' }}>
                              <Typography.Text style={{ fontSize: 'var(--nb-text-xs)' }}>{t}</Typography.Text>
                              <Tag color="blue" bordered={false} style={{ margin: 0, minWidth: 24, textAlign: 'center' }}>{c}</Tag>
                            </div>
                          ))}
                        </Flex>
                      ) : (
                        <Typography.Text type="secondary" style={{ fontSize: 'var(--nb-text-xs)' }}>— 无记录 —</Typography.Text>
                      )}
                    </div>

                    {/* MCPs Module */}
                    <div style={{ background: token.colorBgContainer, padding: 'var(--nb-spacing-md)', borderRadius: 10, border: `1px solid ${token.colorBorderSecondary}` }}>
                      <Flex align="center" gap={8} style={{ marginBottom: 12, opacity: 0.85 }}>
                        <DatabaseOutlined style={{ color: '#2f54eb' }} />
                        <Typography.Text type="secondary" style={{ fontSize: 'var(--nb-text-xs)', fontWeight: 600, letterSpacing: '0.04em' }}>外联跨端节点 (MCP)</Typography.Text>
                      </Flex>
                      {Object.keys(metrics.mcps || {}).length > 0 ? (
                        <Flex wrap="wrap" gap={6}>
                          {Object.entries(metrics.mcps || {}).map(([m, c]) => (
                            <div key={m} style={{ background: token.colorFillAlter, border: `1px solid ${token.colorBorderSecondary}`, padding: '4px 10px', borderRadius: 4, display: 'flex', gap: 8, alignItems: 'center' }}>
                              <Typography.Text style={{ fontSize: 'var(--nb-text-xs)' }}>{m}</Typography.Text>
                              <Tag color="geekblue" bordered={false} style={{ margin: 0, minWidth: 24, textAlign: 'center' }}>{c}</Tag>
                            </div>
                          ))}
                        </Flex>
                      ) : (
                        <Typography.Text type="secondary" style={{ fontSize: 'var(--nb-text-xs)' }}>— 无记录 —</Typography.Text>
                      )}
                    </div>

                    {/* KB Module */}
                    <div style={{ background: token.colorBgContainer, padding: 'var(--nb-spacing-md)', borderRadius: 10, border: `1px solid ${token.colorBorderSecondary}` }}>
                      <Flex align="center" gap={8} style={{ marginBottom: 12, opacity: 0.85 }}>
                        <DatabaseOutlined style={{ color: '#13c2c2' }} />
                        <Typography.Text type="secondary" style={{ fontSize: 'var(--nb-text-xs)', fontWeight: 600, letterSpacing: '0.04em' }}>知识检索引擎 (KB)</Typography.Text>
                      </Flex>
                      {Object.keys(metrics.knowledge || {}).length > 0 ? (
                        <Flex wrap="wrap" gap={6}>
                          {Object.entries(metrics.knowledge || {}).map(([k, c]) => (
                            <div key={k} style={{ background: token.colorFillAlter, border: `1px solid ${token.colorBorderSecondary}`, padding: '4px 10px', borderRadius: 4, display: 'flex', gap: 8, alignItems: 'center' }}>
                              <Typography.Text style={{ fontSize: 'var(--nb-text-xs)' }}>{k}</Typography.Text>
                              <Tag color="cyan" bordered={false} style={{ margin: 0, minWidth: 24, textAlign: 'center' }}>{c}</Tag>
                            </div>
                          ))}
                        </Flex>
                      ) : (
                        <Typography.Text type="secondary" style={{ fontSize: 'var(--nb-text-xs)' }}>— 无记录 —</Typography.Text>
                      )}
                    </div>
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
