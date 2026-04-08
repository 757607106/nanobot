import { useEffect, useState } from 'react'
import {
  CheckCircleOutlined,
  ClusterOutlined,
  DatabaseOutlined,
  ReloadOutlined,
  ScheduleOutlined,
} from '@ant-design/icons'
import { Alert, Button, Card, Flex, Skeleton, Tag, Typography, theme } from 'antd'
import { api } from '../api'
import MetricCard from '../components/console/MetricCard'
import PageHeader from '../components/console/PageHeader'
import SectionCard from '../components/console/SectionCard'
import { useDevMode } from '../devMode'
import { formatUptimeZh } from '../locale'
import { useToast } from '../toast'
import type { SystemStatus } from '../types'

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        padding: '12px 16px',
        borderRadius: 12,
        background: 'var(--nb-card-subtle-bg)',
        border: '1px solid var(--nb-card-subtle-border)',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}
    >
      <Typography.Text type="secondary" style={{ fontSize: 'var(--nb-text-xs)', textTransform: 'uppercase', letterSpacing: '0.02em' }}>{label}</Typography.Text>
      <Typography.Text className="break-all" strong style={{ fontSize: 'var(--nb-text-sm)' }}>{value}</Typography.Text>
    </div>
  )
}

function formatWakeTime(nextWakeAtMs?: number | null) {
  if (!nextWakeAtMs) {
    return '未安排'
  }

  return new Date(nextWakeAtMs).toLocaleString('zh-CN', {
    hour12: false,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function SystemPage() {
  const toast = useToast()
  const { token } = theme.useToken()
  const { devMode } = useDevMode()
  const [status, setStatus] = useState<SystemStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void loadStatus()
  }, [])

  async function loadStatus() {
    try {
      setLoading(true)
      await api.health()
      const next = await api.getSystemStatus()
      setStatus(next)
      setError(null)
    } catch (loadError) {
      const nextError = loadError instanceof Error ? loadError.message : '加载系统状态失败'
      setError(nextError)
      toast.error(nextError)
    } finally {
      setLoading(false)
    }
  }

  if (loading && !status) {
    return (
      <Flex vertical gap={24}>
        <Skeleton active paragraph={{ rows: 2 }} title={{ width: '32%' }} />
        <div className="grid gap-4 grid-cols-[repeat(auto-fit,minmax(220px,1fr))]">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} active paragraph={{ rows: 2 }} title={{ width: '45%' }} />
          ))}
        </div>
        <Skeleton active paragraph={{ rows: 8 }} title={{ width: '24%' }} />
      </Flex>
    )
  }

  if (!status) {
    return (
      <Flex vertical gap={24}>
        <PageHeader
          title="系统状态"
          subtitle="无法连接服务"
          actions={(
            <Button icon={<ReloadOutlined />} onClick={() => void loadStatus()}>
              重试
            </Button>
          )}
        />
        <Alert type="error" showIcon message={error || '系统状态尚未加载完成。'} />
      </Flex>
    )
  }

  return (
    <div className="page-stack">
    <Flex vertical gap={24}>
      <PageHeader
        title="系统状态"
        actions={(
          <Button icon={<ReloadOutlined />} onClick={() => void loadStatus()} loading={loading}>
            刷新
          </Button>
        )}
      />

      {error ? <Alert type="error" showIcon message={error} /> : null}

      <div className="grid gap-6 grid-cols-[repeat(auto-fit,minmax(220px,1fr))]">
        <MetricCard
          label="健康状态"
          value="在线"
          helper="Online"
          icon={<CheckCircleOutlined />}
          tone="success"
        />
        <MetricCard
          label="默认模型"
          value={status.web.model}
          helper={status.web.provider}
          icon={<DatabaseOutlined />}
          tone="primary"
        />
        <MetricCard
          label="消息渠道"
          value={status.stats.enabledChannelCount}
          helper={status.stats.enabledChannels.join(', ') || '—'}
          icon={<ClusterOutlined />}
          tone={status.stats.enabledChannelCount > 0 ? 'success' : 'warning'}
        />
        <MetricCard
          label="计划任务"
          value={status.cron.jobs}
          helper={status.cron.enabled ? 'Active' : 'Inactive'}
          icon={<ScheduleOutlined />}
          tone={status.cron.enabled ? 'success' : 'warning'}
        />
      </div>

      <div className="grid gap-6 grid-cols-[minmax(0,1.12fr)_minmax(320px,0.88fr)]">
        <SectionCard
          title="运行清单"
          action={<Tag color="blue">v{status.web.version}</Tag>}
        >
          <Flex vertical gap={20}>
            <div className="grid gap-4 grid-cols-[repeat(auto-fit,minmax(220px,1fr))]">
              <DetailRow label="工作区" value={status.web.workspace} />
              <DetailRow label="配置文件" value={status.web.configPath} />
              <DetailRow label="Provider" value={status.web.provider} />
              <DetailRow label="默认模型" value={status.web.model} />
              <DetailRow label="运行时长" value={formatUptimeZh(status.web.uptime)} />
              <DetailRow label="版本" value={status.web.version} />
              {devMode ? <DetailRow label="Python" value={status.environment.python} /> : null}
              {devMode ? <DetailRow label="平台" value={status.environment.platform} /> : null}
            </div>

            <div className="pt-5 border-t" style={{ borderTopColor: token.colorBorderSecondary }}>
              <Typography.Title level={5} className="!mb-0 !text-sm">
                已启用渠道
              </Typography.Title>
              <Flex gap={8} wrap="wrap" className="mt-3">
                {(status.stats.enabledChannels.length > 0 ? status.stats.enabledChannels : ['—']).map((item) => (
                  <Tag key={item} color="blue">
                    {item}
                  </Tag>
                ))}
              </Flex>
            </div>
          </Flex>
        </SectionCard>

        <Flex vertical gap={16}>
          <SectionCard title="服务流量">
            <div
              style={{
                padding: '20px',
                borderRadius: 16,
                background: 'var(--nb-card-subtle-bg)',
                border: '1px solid var(--nb-card-subtle-border)',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              <Typography.Text type="secondary">当前 Web 会话</Typography.Text>
              <Typography.Title level={2} style={{ margin: 0 }}>
                {status.stats.webSessions}
              </Typography.Title>
              <Typography.Paragraph type="secondary" style={{ margin: '8px 0 0', fontSize: 'var(--nb-text-sm)', lineHeight: 1.6 }}>
                {status.stats.totalSessions} 会话 · {status.stats.messages} 消息
              </Typography.Paragraph>
            </div>
          </SectionCard>

          <SectionCard title="调度状态">
            <Flex vertical gap={12}>
              <Flex gap={8} wrap="wrap">
                <Tag color={status.cron.enabled ? 'green' : 'orange'}>
                  {status.cron.enabled ? '运行中' : '未启用'}
                </Tag>
                <Tag>任务 {status.stats.scheduledJobs}</Tag>
              </Flex>

              <div
                style={{
                  padding: '20px',
                  borderRadius: 16,
                  background: 'var(--nb-card-subtle-bg)',
                  border: '1px solid var(--nb-card-subtle-border)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                }}
              >
                <Typography.Text type="secondary">下一次唤醒时间</Typography.Text>
                <Typography.Title level={4} style={{ margin: 0 }}>
                  {formatWakeTime(status.cron.nextWakeAtMs)}
                </Typography.Title>
              </div>
            </Flex>
          </SectionCard>
        </Flex>
      </div>
    </Flex>
    </div>
  )
}
