import { useEffect, useMemo, useState } from 'react'
import { App, Button, Card, Empty, List, Spin, Tag, Typography } from 'antd'
import { CodeOutlined, ReloadOutlined } from '@ant-design/icons'
import { api } from '../api'
import PageHero from '../components/PageHero'
import { formatDateTimeZh } from '../locale'
import type {
  OpsActionItem,
  OpsLogResponse,
} from '../types'

const { Text, Paragraph } = Typography

export default function OperationsPage() {
  const { message } = App.useApp()
  const [logs, setLogs] = useState<OpsLogResponse | null>(null)
  const [actions, setActions] = useState<OpsActionItem[]>([])
  const [loading, setLoading] = useState(true)
  const [actingName, setActingName] = useState<string | null>(null)

  useEffect(() => {
    void loadOps()
  }, [])

  async function loadOps() {
    try {
      setLoading(true)
      const [logsResult, actionsResult] = await Promise.all([
        api.getOpsLogs(),
        api.getOpsActions(),
      ])
      setLogs(logsResult)
      setActions(actionsResult.items)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载运维中心失败')
    } finally {
      setLoading(false)
    }
  }

  async function handleAction(actionName: string) {
    try {
      setActingName(actionName)
      const result = await api.triggerOpsAction(actionName)
      setActions((current) =>
        current.map((item) => (item.name === result.item.name ? result.item : item)),
      )
      message.success(`${result.item.label} 已触发`)
      const refreshed = await api.getOpsActions()
      setActions(refreshed.items)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '执行运维动作失败')
    } finally {
      setActingName(null)
    }
  }

  const configuredActions = useMemo(
    () => actions.filter((item) => item.configured).length,
    [actions],
  )
  const runningActions = useMemo(
    () => actions.filter((item) => item.running).length,
    [actions],
  )

  if (loading && !logs && actions.length === 0) {
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
        title="日志与运维"
        actions={(
          <Button icon={<ReloadOutlined />} onClick={() => void loadOps()} loading={loading}>
            刷新
          </Button>
        )}
      />

      <div className="page-grid system-dashboard-grid">
        <Card className="config-panel-card">
          <div className="config-card-header">
            <div className="page-section-title">
              <Typography.Title level={4}>日志尾部</Typography.Title>
            </div>
          </div>

          <div className="page-scroll-shell ops-log-shell">
            {logs?.items.length ? (
              <List
                dataSource={logs.items.slice(0, 3)}
                renderItem={(item) => (
                  <List.Item>
                    <div className="page-stack">
                      <div className="config-card-header">
                        <div className="page-section-title">
                          <Typography.Title level={5}>{item.name}</Typography.Title>
                          <Text type="secondary">{item.path}</Text>
                        </div>
                        <Tag>{item.lineCount} 行</Tag>
                      </div>
                      <Paragraph className="mono-block mono-block-large">{item.tail.join('\n') || '--'}</Paragraph>
                    </div>
                  </List.Item>
                )}
              />
            ) : (
              <Empty description="暂无可读日志" className="empty-block" />
            )}
          </div>
        </Card>

        <Card className="config-panel-card">
          <div className="config-card-header">
            <div className="page-section-title">
              <Typography.Title level={4}>运维动作</Typography.Title>
            </div>
          </div>

          <div className="page-scroll-shell ops-action-shell">
            {actions.length ? (
              <List
                dataSource={actions}
                renderItem={(item) => (
                  <List.Item>
                    <div className="page-stack">
                      <div className="config-card-header">
                        <div className="page-section-title">
                          <Typography.Title level={5}>{item.label}</Typography.Title>
                        </div>
                        <Tag>{item.lastStatus}</Tag>
                      </div>
                      <Paragraph className={`ops-action-note ${item.configured ? 'is-configured' : 'is-pending'}`}>
                        {item.caution}
                      </Paragraph>
                      <Text type="secondary">工作区：{item.workspace}</Text>
                      <Text type="secondary">命令：{item.commandPreview || '未配置'}</Text>
                      {item.lastRequestedAt ? (
                        <Text type="secondary">最近触发：{formatDateTimeZh(item.lastRequestedAt)}</Text>
                      ) : null}
                      <Button
                        type="primary"
                        icon={<CodeOutlined />}
                        disabled={!item.configured || item.running}
                        loading={actingName === item.name}
                        onClick={() => void handleAction(item.name)}
                      >
                        {item.running ? '执行中' : `执行${item.label}`}
                      </Button>
                    </div>
                  </List.Item>
                )}
              />
            ) : (
              <Empty description="暂无可用运维动作" className="empty-block" />
            )}
          </div>
        </Card>
      </div>
    </div>
  )
}
