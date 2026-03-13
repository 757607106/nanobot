import { useEffect, useMemo, useState } from 'react'
import { App, Button, Card, Empty, Spin, Tag, Typography } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import { api } from '../api'
import PageHero from '../components/PageHero'
import { formatDateTimeZh, formatUptimeZh } from '../locale'
import type { SystemStatus } from '../types'

const { Text } = Typography

export default function SystemPage() {
  const { message } = App.useApp()
  const [status, setStatus] = useState<SystemStatus | null>(null)
  const [loading, setLoading] = useState(true)

  const enabledChannels = useMemo(() => status?.stats.enabledChannels ?? [], [status])

  useEffect(() => {
    void loadStatus()
  }, [])

  async function loadStatus() {
    try {
      setLoading(true)
      await api.health()
      const next = await api.getSystemStatus()
      setStatus(next)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载系统状态失败')
    } finally {
      setLoading(false)
    }
  }

  if (loading && !status) {
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
        eyebrow="后端健康度"
        title="聚焦实例健康、环境与调度状态"
        description="把当前 Web 控制台绑定的实例、环境与调度服务拆开呈现，避免信息堆在一块面板里。"
        actions={(
          <Button icon={<ReloadOutlined />} onClick={() => void loadStatus()} loading={loading}>
            刷新
          </Button>
        )}
        stats={[
          { label: '运行时长', value: status ? formatUptimeZh(status.web.uptime) : '--' },
          { label: '网页会话', value: status?.stats.webSessions ?? 0 },
          { label: '启用频道', value: status?.stats.enabledChannelCount ?? 0 },
          { label: '定时任务', value: status?.cron.jobs ?? 0 },
        ]}
      />

      {status ? (
        <div className="page-grid system-dashboard-grid">
          <Card className="config-panel-card system-runtime-card">
            <div className="config-card-header">
              <div className="page-section-title">
                <Typography.Title level={4}>实例详情</Typography.Title>
                <Text type="secondary">核心绑定信息集中在这里，方便确认当前控制台正在驱动哪个工作区与模型。</Text>
              </div>
              <Tag>{status.web.version}</Tag>
            </div>

            <div className="page-meta-grid system-health-grid">
              <div className="page-meta-card">
                <span>总会话数</span>
                <strong>{status.stats.totalSessions}</strong>
              </div>
              <div className="page-meta-card">
                <span>网页会话</span>
                <strong>{status.stats.webSessions}</strong>
              </div>
              <div className="page-meta-card">
                <span>当前供应商</span>
                <strong>{status.web.provider}</strong>
              </div>
              <div className="page-meta-card">
                <span>消息总数</span>
                <strong>{status.stats.messages}</strong>
              </div>
            </div>

            <div className="page-scroll-shell system-detail-shell">
              <div className="detail-grid">
                <div className="detail-block">
                  <Text type="secondary">工作区</Text>
                  <div className="mono-block mono-block-large">{status.web.workspace}</div>
                </div>
                <div className="detail-block">
                  <Text type="secondary">配置文件路径</Text>
                  <div className="mono-block mono-block-large">{status.web.configPath}</div>
                </div>
                <div className="detail-block">
                  <Text type="secondary">模型</Text>
                  <div className="mono-block">{status.web.model}</div>
                </div>
                <div className="detail-block">
                  <Text type="secondary">已启用频道</Text>
                  <div className="mono-block">{status.stats.enabledChannelCount}</div>
                </div>
                <div className="detail-block">
                  <Text type="secondary">定时任务</Text>
                  <div className="mono-block">{status.cron.jobs}</div>
                </div>
              </div>
            </div>
          </Card>

          <div className="page-stack system-side-stack">
            <Card className="config-panel-card">
              <div className="config-card-header">
                <div className="page-section-title">
                  <Typography.Title level={4}>频道状态</Typography.Title>
                  <Text type="secondary">当前保存配置中真正启用的频道。</Text>
                </div>
              </div>
              <div className="page-scroll-shell system-tag-shell">
                {enabledChannels.length > 0 ? (
                  <div className="tag-cloud">
                    {enabledChannels.map((channel) => (
                      <Tag key={channel}>{channel}</Tag>
                    ))}
                  </div>
                ) : (
                  <Empty description="当前没有启用任何频道" className="empty-block" />
                )}
              </div>
            </Card>

            <Card className="config-panel-card">
              <div className="config-card-header">
                <div className="page-section-title">
                  <Typography.Title level={4}>Cron 运行状态</Typography.Title>
                  <Text type="secondary">后台调度任务的服务心跳、投递策略和下一次唤醒时间。</Text>
                </div>
              </div>
              <div className="page-meta-grid system-side-grid">
                <div className="page-meta-card">
                  <span>服务状态</span>
                  <strong>{status.cron.enabled ? '运行中' : '已停止'}</strong>
                </div>
                <div className="page-meta-card">
                  <span>投递模式</span>
                  <strong>{status.cron.deliveryMode === 'agent_only' ? '仅 Agent' : status.cron.deliveryMode}</strong>
                </div>
                <div className="page-meta-card">
                  <span>下一次唤醒</span>
                  <strong>{status.cron.nextWakeAtMs ? formatDateTimeZh(status.cron.nextWakeAtMs) : '--'}</strong>
                </div>
                <div className="page-meta-card">
                  <span>已调度任务</span>
                  <strong>{status.cron.jobs}</strong>
                </div>
              </div>
            </Card>

            <Card className="config-panel-card">
              <div className="config-card-header">
                <div className="page-section-title">
                  <Typography.Title level={4}>环境信息</Typography.Title>
                  <Text type="secondary">方便确认当前实例版本与运行平台。</Text>
                </div>
              </div>
              <div className="page-meta-grid system-side-grid">
                <div className="page-meta-card">
                  <span>版本</span>
                  <strong>{status.web.version}</strong>
                </div>
                <div className="page-meta-card">
                  <span>Python</span>
                  <strong>{status.environment.python}</strong>
                </div>
                <div className="page-meta-card">
                  <span>平台</span>
                  <strong>{status.environment.platform}</strong>
                </div>
                <div className="page-meta-card">
                  <span>运行时长</span>
                  <strong>{formatUptimeZh(status.web.uptime)}</strong>
                </div>
              </div>
            </Card>
          </div>
        </div>
      ) : null}
    </div>
  )
}
