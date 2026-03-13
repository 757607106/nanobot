import { useEffect, useState } from 'react'
import { App, Button, Card, Spin, Tag, Typography } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import { api } from '../api'
import PageHero from '../components/PageHero'
import { formatUptimeZh } from '../locale'
import type { SystemStatus } from '../types'

const { Text } = Typography

export default function SystemPage() {
  const { message } = App.useApp()
  const [status, setStatus] = useState<SystemStatus | null>(null)
  const [loading, setLoading] = useState(true)

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
        title="实例健康与环境"
        description="查看健康状态、工作区绑定与运行环境。验证、自动化和运维细节放到系统域其他标签。"
        actions={(
          <Button icon={<ReloadOutlined />} onClick={() => void loadStatus()} loading={loading}>
            刷新
          </Button>
        )}
        stats={[
          { label: '运行时长', value: status ? formatUptimeZh(status.web.uptime) : '--' },
          { label: '版本', value: status?.web.version ?? '--' },
          { label: 'Python', value: status?.environment.python ?? '--' },
          { label: '平台', value: status?.environment.platform ?? '--' },
        ]}
      />

      {status ? (
        <div className="page-grid system-dashboard-grid">
          <Card className="config-panel-card system-runtime-card">
            <div className="config-card-header">
              <div className="page-section-title">
                <Typography.Title level={4}>实例绑定</Typography.Title>
                <Text type="secondary">确认当前绑定的工作区、模型和配置文件。</Text>
              </div>
              <Tag>{status.web.version}</Tag>
            </div>

            <div className="page-meta-grid system-health-grid">
              <div className="page-meta-card">
                <span>健康状态</span>
                <strong>已连接</strong>
              </div>
              <div className="page-meta-card">
                <span>当前供应商</span>
                <strong>{status.web.provider}</strong>
              </div>
              <div className="page-meta-card">
                <span>默认模型</span>
                <strong>{status.web.model}</strong>
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
              </div>
            </div>
          </Card>

          <div className="page-stack system-side-stack">
            <Card className="config-panel-card">
              <div className="config-card-header">
                <div className="page-section-title">
                  <Typography.Title level={4}>环境信息</Typography.Title>
                  <Text type="secondary">查看当前实例版本、平台与语言环境。</Text>
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
