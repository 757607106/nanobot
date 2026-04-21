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
  const { token } = theme.useToken()
  return (
    <div
      style={{
        padding: '12px 0',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}
    >
      <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM, letterSpacing: '0.01em' }}>{label}</Typography.Text>
      <Typography.Text className="break-all" style={{ fontSize: token.fontSizeSM, fontWeight: 500, fontFamily: token.fontFamilyCode }}>{value}</Typography.Text>
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
        <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
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
          title="实例健康与环境"
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
        title="实例健康与环境"
        actions={(
          <Button icon={<ReloadOutlined />} onClick={() => void loadStatus()} loading={loading}>
            刷新
          </Button>
        )}
      />

      {error ? <Alert type="error" showIcon message={error} /> : null}

      <div style={{ display: 'grid', gap: 24, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
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

      <div style={{ display: 'grid', gap: 24, gridTemplateColumns: 'minmax(0, 1.12fr) minmax(320px, 0.88fr)' }}>
        <SectionCard
          title="运行清单"
          action={<Tag bordered={false} style={{ background: token.colorFillAlter, color: token.colorTextTertiary }}>v{status.web.version}</Tag>}
        >
          <Flex vertical gap={0}>
            <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
              <DetailRow label="工作区" value={status.web.workspace} />
              <DetailRow label="配置文件" value={status.web.configPath} />
              <DetailRow label="Provider" value={status.web.provider} />
              <DetailRow label="默认模型" value={status.web.model} />
              <DetailRow label="运行时长" value={formatUptimeZh(status.web.uptime)} />
              <DetailRow label="版本" value={status.web.version} />
              {devMode ? <DetailRow label="Python" value={status.environment.python} /> : null}
              {devMode ? <DetailRow label="平台" value={status.environment.platform} /> : null}
            </div>

            <div style={{ paddingTop: 20 }}>
              <Typography.Text className="nb-section-label" style={{ marginBottom: 0 }}>
                已启用渠道
              </Typography.Text>
              <Flex gap={8} wrap="wrap" style={{ marginTop: 12 }}>
                {(status.stats.enabledChannels.length > 0 ? status.stats.enabledChannels : ['—']).map((item) => (
                  <Tag key={item} bordered={false} style={{ background: token.colorFillAlter, color: token.colorText }}>
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
                background: token.colorFillAlter,
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              <Typography.Text type="secondary">当前 Web 会话</Typography.Text>
              <Typography.Title level={2} style={{ margin: 0, fontSize: token.fontSizeHeading2, lineHeight: token.lineHeightHeading2 }}>
                {status.stats.webSessions}
              </Typography.Title>
              <Typography.Paragraph type="secondary" style={{ margin: '8px 0 0', fontSize: token.fontSizeSM, lineHeight: 1.6 }}>
                {status.stats.totalSessions} 会话 · {status.stats.messages} 消息
              </Typography.Paragraph>
            </div>
          </SectionCard>

          <SectionCard title="调度状态">
            <Flex vertical gap={12}>
              <Flex gap={8} wrap="wrap">
                <Tag bordered={false} style={{ background: token.colorFillAlter, color: status.cron.enabled ? token.colorSuccessText : token.colorWarningText }}>
                  <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: 3, background: status.cron.enabled ? token.colorSuccess : token.colorWarning, marginRight: 6 }}></span>
                  {status.cron.enabled ? '运行中' : '未启用'}
                </Tag>
                <Tag bordered={false} style={{ background: token.colorFillAlter, color: token.colorTextSecondary }}>任务 {status.stats.scheduledJobs}</Tag>
              </Flex>

              <div
                style={{
                  padding: '20px 0',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                  marginTop: 12,
                }}
              >
                <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }}>下一次唤醒时间</Typography.Text>
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
