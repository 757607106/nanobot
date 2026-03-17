import { useEffect, useState } from 'react'
import { App, Button, Card, Spin, Tag, Typography } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import { api } from '../api'
import DevOnly from '../components/DevOnly'
import { MotionGroup, MotionPanel } from '../components/MotionSurface'
import PageHero from '../components/PageHero'
import { useDevMode } from '../devMode'
import { formatUptimeZh } from '../locale'
import type { SystemStatus } from '../types'

const { Text } = Typography

export default function SystemPage() {
  const { message } = App.useApp()
  const { devMode } = useDevMode()
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
        className="page-hero-compact studio-hero"
        eyebrow="后端健康度"
        title="实例健康与环境"
        description="查看实例状态与运行环境。"
        badges={[
          status?.web.provider ? <Tag key="provider">{status.web.provider}</Tag> : null,
          <Tag key="scope">系统总览</Tag>,
        ].filter(Boolean)}
        actions={(
          <Button icon={<ReloadOutlined />} onClick={() => void loadStatus()} loading={loading}>
            刷新
          </Button>
        )}
        stats={[
          { label: '运行时长', value: status ? formatUptimeZh(status.web.uptime) : '--' },
          { label: '版本', value: status?.web.version ?? '--' },
          ...(devMode ? [
            { label: 'Python', value: status?.environment.python ?? '--' },
            { label: '平台', value: status?.environment.platform ?? '--' },
          ] : []),
        ]}
      />

      {status ? (
        <>
          <MotionGroup className="page-grid system-dashboard-grid">
            <MotionPanel hover={false}>
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
            </MotionPanel>

            <MotionGroup className="page-stack system-side-stack">
              <DevOnly>
                <MotionPanel hover={false}>
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
                </MotionPanel>
              </DevOnly>
            </MotionGroup>
          </MotionGroup>
        </>
      ) : null}
    </div>
  )
}
