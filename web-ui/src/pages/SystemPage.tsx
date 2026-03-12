import { useEffect, useState } from 'react'
import { App, Button, Card, Col, Row, Space, Spin, Statistic, Tag, Typography } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import { api } from '../api'
import type { SystemStatus } from '../types'

const { Title, Text } = Typography

function formatUptime(seconds: number) {
  if (!Number.isFinite(seconds)) {
    return '--'
  }
  const total = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const remain = total % 60
  return `${hours}h ${minutes}m ${remain}s`
}

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
      message.error(error instanceof Error ? error.message : 'Failed to load system status')
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
    <div className="page-card">
      <div className="page-header-block">
        <div>
          <Title level={2}>System</Title>
          <Text type="secondary">
            Runtime status for the current nanobot backend and workspace.
          </Text>
        </div>
        <Button icon={<ReloadOutlined />} onClick={() => void loadStatus()} loading={loading}>
          Refresh
        </Button>
      </div>

      {status && (
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          <Row gutter={[16, 16]}>
            <Col xs={24} md={6}>
              <Card>
                <Statistic title="Uptime" value={formatUptime(status.web.uptime)} />
              </Card>
            </Col>
            <Col xs={24} md={6}>
              <Card>
                <Statistic title="Web Sessions" value={status.stats.webSessions} />
              </Card>
            </Col>
            <Col xs={24} md={6}>
              <Card>
                <Statistic title="Messages" value={status.stats.messages} />
              </Card>
            </Col>
            <Col xs={24} md={6}>
              <Card>
                <Statistic title="Scheduled Jobs" value={status.stats.scheduledJobs} />
              </Card>
            </Col>
          </Row>

          <Card title="Runtime">
            <Row gutter={[16, 16]}>
              <Col xs={24} md={12}>
                <Text type="secondary">Version</Text>
                <div className="mono-block">{status.web.version}</div>
              </Col>
              <Col xs={24} md={12}>
                <Text type="secondary">Provider</Text>
                <div className="mono-block">{status.web.provider}</div>
              </Col>
              <Col xs={24} md={12}>
                <Text type="secondary">Model</Text>
                <div className="mono-block">{status.web.model}</div>
              </Col>
              <Col xs={24} md={12}>
                <Text type="secondary">Python</Text>
                <div className="mono-block">{status.environment.python}</div>
              </Col>
              <Col span={24}>
                <Text type="secondary">Workspace</Text>
                <div className="mono-block">{status.web.workspace}</div>
              </Col>
              <Col span={24}>
                <Text type="secondary">Config Path</Text>
                <div className="mono-block">{status.web.configPath}</div>
              </Col>
              <Col span={24}>
                <Text type="secondary">Platform</Text>
                <div className="mono-block">{status.environment.platform}</div>
              </Col>
            </Row>
          </Card>

          <Card title="Enabled Channels">
            <Space wrap>
              {status.stats.enabledChannels.length > 0 ? (
                status.stats.enabledChannels.map((channel) => (
                  <Tag key={channel} color="green">
                    {channel}
                  </Tag>
                ))
              ) : (
                <Text type="secondary">No channels enabled in the current config.</Text>
              )}
            </Space>
          </Card>

          <Card title="Cron Runtime">
            <Row gutter={[16, 16]}>
              <Col xs={24} md={8}>
                <Text type="secondary">Service</Text>
                <div className="mono-block">{status.cron.enabled ? 'running' : 'stopped'}</div>
              </Col>
              <Col xs={24} md={8}>
                <Text type="secondary">Delivery Mode</Text>
                <div className="mono-block">{status.cron.deliveryMode}</div>
              </Col>
              <Col xs={24} md={8}>
                <Text type="secondary">Next Wake</Text>
                <div className="mono-block">
                  {status.cron.nextWakeAtMs ? new Date(status.cron.nextWakeAtMs).toLocaleString() : '--'}
                </div>
              </Col>
            </Row>
          </Card>
        </Space>
      )}
    </div>
  )
}
