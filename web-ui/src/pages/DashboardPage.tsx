import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Badge,
  Button,
  Flex,
  Segmented,
  Skeleton,
  Tag,
  Typography,
  theme,
} from 'antd'
import {
  MessageOutlined,
  ReloadOutlined,
  RobotOutlined,
  FireOutlined,
} from '@ant-design/icons'

import { api } from '../api'
import MetricCard from '../components/console/MetricCard'
import SectionCard from '../components/console/SectionCard'
import PageHeader from '../components/console/PageHeader'
import type {
  AgentDefinition,
  CronStatus,
  KnowledgeBaseDefinition,
  SystemStatus,
  DashboardTimeBucket,
  DashboardAnalyticsResponse,
} from '../types'
import { useToast } from '../toast'

// Lazy-load chart components to keep initial bundle small
const ModelCallTrendChart = lazy(() => import('../components/dashboard/ModelCallTrendChart'))
const TokenConsumptionPieChart = lazy(() => import('../components/dashboard/TokenConsumptionPieChart'))
const ToolUsageBarChart = lazy(() => import('../components/dashboard/ToolUsageBarChart'))


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


  // ── existing state ──
  const [cron, setCron] = useState<CronStatus | null>(null)
  const [agents, setAgents] = useState<AgentDefinition[]>([])
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBaseDefinition[]>([])
  const [system, setSystem] = useState<SystemStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // ── analytics state ──
  const [bucket, setBucket] = useState<DashboardTimeBucket>('day')
  const [analytics, setAnalytics] = useState<DashboardAnalyticsResponse | null>(null)
  const [chartsLoading, setChartsLoading] = useState(true)

  const isSystemOnline = cron?.enabled ?? false
  const dateString = new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })

  const overview = analytics?.overview

  // ── derived metrics (avoids inline computation in JSX) ──
  const runMetrics = useMemo(() => {
    const byStatus = overview?.runsByStatus ?? {}
    const succeeded = byStatus.succeeded ?? 0
    const failed = (byStatus.failed ?? 0) + (byStatus.timed_out ?? 0)
    const total = succeeded + failed
    const successRate = total > 0 ? `${Math.round((succeeded / total) * 100)}%` : '—'
    return { succeeded, failed, successRate }
  }, [overview])

  const kbSummary = useMemo(() => {
    let totalFiles = 0
    const typeCounts: Record<string, number> = {}
    for (const kb of knowledgeBases) {
      totalFiles += kb.stats?.fileCount ?? 0
      const t = kb.kbType || 'unknown'
      typeCounts[t] = (typeCounts[t] ?? 0) + 1
    }
    return { totalFiles, typeCounts }
  }, [knowledgeBases])

  const loadDashboard = useCallback(async () => {
    try {
      setLoading(true)
      const [cronData, agentsData, systemData, kbData] = await Promise.all([
        api.getCronStatus(),
        api.getAgents(),
        api.getSystemStatus(),
        api.getKnowledgeBases().catch(() => [] as KnowledgeBaseDefinition[]),
      ])
      setCron(cronData)
      setAgents(agentsData)
      setSystem(systemData)
      setKnowledgeBases(Array.isArray(kbData) ? kbData : [])
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
      const data = await api.getDashboardAnalytics({ bucket: b })
      setAnalytics(data)
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
          <Flex align="center" gap={8}>
            <Badge status={isSystemOnline ? 'success' : 'warning'} />
            <Typography.Text type="secondary" style={{ fontFamily: token.fontFamilyCode }}>
              {isSystemOnline ? '系统运行中' : '系统待机'} · {dateString}
            </Typography.Text>
          </Flex>
        }
        actions={
          <Flex gap={8} align="center">
            <Button
              type="text"
              icon={<ReloadOutlined spin={loading || chartsLoading} />}
              onClick={handleRefresh}
              disabled={loading && chartsLoading}
              style={{ color: token.colorTextSecondary }}
            >
              刷新
            </Button>
          </Flex>
        }
      />

      {error ? <Alert type="error" showIcon message={error} style={{ marginBottom: token.marginLG }} /> : null}

      {/* ── 第一排：核心指标卡 (对齐参考图) ── */}
      <div className="dashboard-metrics-grid">
        <MetricCard
          label="总对话数"
          value={loading && !overview ? cardSkeleton() : (overview?.totalRuns ?? system?.stats.totalSessions ?? 0).toLocaleString()}
          tone="primary"
          icon={<MessageOutlined />}
        />
        <MetricCard
          label="智能体数"
          value={loading && !overview ? cardSkeleton() : overview?.activeAgents ?? agents.length}
          tone="success"
          icon={<RobotOutlined />}
        />
        <MetricCard
          label="总 Token 数"
          value={loading && !overview ? cardSkeleton() : (overview?.totalTokens ?? 0).toLocaleString()}
          tone="primary"
          icon={<FireOutlined />}
        />

      </div>

      {/* ── 第二排：主图表区域 (左大右小) ── */}
      <div className="dashboard-main-grid" style={{ marginTop: token.marginLG }}>
        {/* 调用统计 */}
        <SectionCard 
          title="调用统计" 
          action={<Segmented size="small" options={BUCKET_OPTIONS} value={bucket} onChange={handleBucketChange} />}
        >
          <Suspense fallback={chartSkeleton()}>
            {chartsLoading ? chartSkeleton() : <ModelCallTrendChart data={analytics?.timeSeries ?? []} />}
          </Suspense>
        </SectionCard>

        {/* Token 消费分析 */}
        <SectionCard title="Token 消费分析">
          <Flex justify="space-around" align="center" style={{ marginBottom: token.marginLG, textAlign: 'center' }}>
            <Flex vertical align="center">
              <Typography.Text type="secondary">总 Token</Typography.Text>
              <Typography.Title level={3} style={{ margin: 0 }}>{(overview?.totalTokens ?? 0).toLocaleString()}</Typography.Title>
            </Flex>
            <Flex vertical align="center">
              <Typography.Text type="secondary">Prompt</Typography.Text>
              <Typography.Title level={3} style={{ margin: 0 }}>{(overview?.promptTokens ?? 0).toLocaleString()}</Typography.Title>
            </Flex>
            <Flex vertical align="center">
              <Typography.Text type="secondary">Completion</Typography.Text>
              <Typography.Title level={3} style={{ margin: 0 }}>{(overview?.completionTokens ?? 0).toLocaleString()}</Typography.Title>
            </Flex>
          </Flex>
          <Typography.Text type="secondary" style={{ display: 'block', marginBottom: token.marginMD }}>消费趋势</Typography.Text>
          <Suspense fallback={chartSkeleton()}>
            {chartsLoading ? chartSkeleton() : <TokenConsumptionPieChart data={analytics?.timeSeries ?? []} />}
          </Suspense>
        </SectionCard>
      </div>

      {/* ── 第三排：详情监控区域 (3等分) ── */}
      <div className="dashboard-status-grid" style={{ marginTop: token.marginLG }}>
        
        {/* AI智能体分析 */}
        <SectionCard title="AI智能体分析">
          <Flex justify="space-between" style={{ marginBottom: token.marginLG }}>
            <Flex vertical>
              <Typography.Text type="secondary">智能体总数</Typography.Text>
              <Typography.Title level={4} style={{ margin: 0, color: token.colorPrimary }}>{overview?.activeAgents ?? agents.length} <Typography.Text type="secondary">个</Typography.Text></Typography.Title>
            </Flex>
            <Flex vertical>
              <Typography.Text type="secondary">总对话数</Typography.Text>
              <Typography.Title level={4} style={{ margin: 0, color: token.colorInfo }}>{overview?.totalRuns ?? 0} <Typography.Text type="secondary">次</Typography.Text></Typography.Title>
            </Flex>
            <Flex vertical>
              <Typography.Text type="secondary">工具调用总数</Typography.Text>
              <Typography.Title level={4} style={{ margin: 0, color: token.colorWarning }}>{analytics?.toolRanking.reduce((sum, item) => sum + item.count, 0) || 0} <Typography.Text type="secondary">次</Typography.Text></Typography.Title>
            </Flex>
          </Flex>
          <Typography.Text type="secondary" style={{ display: 'block', marginBottom: token.marginMD }}>对话/工具调用分布 (TOP 3)</Typography.Text>
          <Suspense fallback={chartSkeleton()}>
            {chartsLoading ? chartSkeleton() : <ToolUsageBarChart data={analytics?.toolRanking?.slice(0, 3) ?? []} />}
          </Suspense>
        </SectionCard>

        {/* 工具调用监控 */}
        <SectionCard title="工具调用监控">
           <Flex justify="space-between" style={{ marginBottom: token.marginLG }}>
            <Flex vertical>
              <Typography.Text type="secondary">总调用次数</Typography.Text>
              <Typography.Title level={4} style={{ margin: 0, color: token.colorPrimary }}>{analytics?.toolRanking.reduce((sum, item) => sum + item.count, 0) || 0}</Typography.Title>
            </Flex>
            <Flex vertical>
              <Typography.Text type="secondary">失败任务</Typography.Text>
              <Typography.Title level={4} style={{ margin: 0, color: token.colorError }}>{runMetrics.failed} <Typography.Text type="secondary">次</Typography.Text></Typography.Title>
            </Flex>
            <Flex vertical>
              <Typography.Text type="secondary">成功率</Typography.Text>
              <Typography.Title level={4} style={{ margin: 0, color: token.colorSuccess }}>{runMetrics.successRate}</Typography.Title>
            </Flex>
          </Flex>
          <Typography.Text type="secondary" style={{ display: 'block', marginBottom: token.marginMD }}>最常用工具 TOP 10</Typography.Text>
          <Suspense fallback={chartSkeleton()}>
            {chartsLoading ? chartSkeleton() : <ToolUsageBarChart data={analytics?.toolRanking ?? []} />}
          </Suspense>
        </SectionCard>

        {/* 知识库使用情况 */}
        <SectionCard title="知识库使用情况">
          <Flex justify="space-between" style={{ marginBottom: token.marginLG }}>
            <Flex vertical>
              <Typography.Text type="secondary">知识库总数</Typography.Text>
              <Typography.Title level={4} style={{ margin: 0, color: token.colorPrimary }}>{knowledgeBases.length} <Typography.Text type="secondary">个</Typography.Text></Typography.Title>
            </Flex>
            <Flex vertical>
              <Typography.Text type="secondary">文件总数</Typography.Text>
              <Typography.Title level={4} style={{ margin: 0, color: token.colorSuccess }}>{kbSummary.totalFiles} <Typography.Text type="secondary">个</Typography.Text></Typography.Title>
            </Flex>
            <Flex vertical>
              <Typography.Text type="secondary">引擎类型</Typography.Text>
              <Typography.Title level={4} style={{ margin: 0, color: token.colorWarning }}>{Object.keys(kbSummary.typeCounts).length} <Typography.Text type="secondary">种</Typography.Text></Typography.Title>
            </Flex>
          </Flex>

          {knowledgeBases.length > 0 && (
            <Flex vertical gap={token.marginXS}>
              <Typography.Text type="secondary">引擎分布</Typography.Text>
              {Object.entries(kbSummary.typeCounts).map(([type, count]) => (
                <Flex key={type} align="center" gap={token.marginXS}>
                  <div style={{ height: 6, background: token.colorPrimary, borderRadius: token.borderRadius, flex: 1 }} />
                  <Typography.Text type="secondary">{type} ({count})</Typography.Text>
                </Flex>
              ))}
            </Flex>
          )}
        </SectionCard>
      </div>

    </div>
  )
}
