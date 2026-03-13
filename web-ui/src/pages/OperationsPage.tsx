import { useEffect, useMemo, useState } from 'react'
import { Alert, App, Button, Card, Empty, List, Spin, Tag, Typography } from 'antd'
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
        className="page-hero-compact"
        eyebrow="Operations Center"
        title="只保留日志与运维动作"
        description="运维页不再重复展示会话、消息和实例用量，只保留实例级日志尾部和部署方声明的运维动作。"
        actions={(
          <Button icon={<ReloadOutlined />} onClick={() => void loadOps()} loading={loading}>
            刷新运维中心
          </Button>
        )}
        stats={[
          { label: '日志文件', value: logs?.items.length ?? 0 },
          { label: '可执行动作', value: actions.length },
          { label: '已配置动作', value: configuredActions },
        ].filter(Boolean)}
      />

      <div className="page-grid system-dashboard-grid">
        <Card className="config-panel-card">
          <div className="config-card-header">
            <div className="page-section-title">
              <Typography.Title level={4}>日志尾部</Typography.Title>
              <Text type="secondary">默认读取日志目录中的最新文件尾部，帮助快速定位实例级错误，不需要再切回终端。</Text>
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
              <Empty description="当前日志目录中没有可读文件" className="empty-block" />
            )}
          </div>
        </Card>

        <Card className="config-panel-card">
          <div className="config-card-header">
            <div className="page-section-title">
              <Typography.Title level={4}>运维动作</Typography.Title>
              <Text type="secondary">重启和更新动作只会在部署方显式声明 hook 命令后开放，默认保持不可执行。</Text>
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
                          <Text type="secondary">{item.description}</Text>
                        </div>
                        <Tag>{item.lastStatus}</Tag>
                      </div>
                      <Alert type={item.configured ? 'info' : 'warning'} message={item.caution} />
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
              <Empty description="当前没有可用运维动作" className="empty-block" />
            )}
          </div>
        </Card>
      </div>
    </div>
  )
}
