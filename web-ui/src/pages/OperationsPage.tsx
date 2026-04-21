import { useEffect, useMemo, useState } from 'react'
import {
  CodeOutlined,
  DatabaseOutlined,
  FileTextOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
} from '@ant-design/icons'
import { Alert, Button, Empty, Flex, Tag, Typography, theme } from 'antd'
import { api } from '../api'
import MetricCard from '../components/console/MetricCard'
import PageHeader from '../components/console/PageHeader'
import SectionCard from '../components/console/SectionCard'
import { formatDateTimeZh } from '../locale'
import { useToast } from '../toast'
import type { OpsActionItem, OpsLogResponse } from '../types'

export default function OperationsPage() {
  const toast = useToast()
  const { token } = theme.useToken()
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
      toast.error(error instanceof Error ? error.message : '加载运维中心失败')
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
      toast.success(`${result.item.label} 已触发`)
      const refreshed = await api.getOpsActions()
      setActions(refreshed.items)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '执行运维动作失败')
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

  return (
    <div className="page-stack">
    <Flex vertical gap={24}>
      <PageHeader
        title="日志与运维"
        subtitle="日志 · 动作 · 状态"
        actions={(
          <Button icon={<ReloadOutlined />} onClick={() => void loadOps()} loading={loading}>
            刷新
          </Button>
        )}
      />

      <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
        <MetricCard
          label="日志文件"
          value={logs?.items.length ?? 0}
          helper="Sources"
          icon={<FileTextOutlined />}
          tone="primary"
        />
        <MetricCard
          label="动作数量"
          value={actions.length}
          helper="Endpoints"
          icon={<DatabaseOutlined />}
          tone="neutral"
        />
        <MetricCard
          label="已配置"
          value={configuredActions}
          helper="Ready"
          icon={<CodeOutlined />}
          tone={configuredActions > 0 ? 'success' : 'warning'}
        />
        <MetricCard
          label="执行中"
          value={runningActions}
          helper="Processing"
          icon={<PlayCircleOutlined />}
          tone={runningActions > 0 ? 'warning' : 'neutral'}
        />
      </div>

      <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
        <SectionCard title="日志尾部">
          {logs?.items.length ? (
            <Flex vertical gap={12}>
              {logs.items.slice(0, 3).map((item) => (
                <div
                  key={item.path}
                  style={{ overflow: 'hidden', borderRadius: token.borderRadius, border: `1px solid ${token.colorBorderSecondary}` }}
                >
                  <Flex vertical gap={12} style={{ padding: 18 }}>
                    <Flex justify="space-between" align="flex-start" gap={12} wrap="wrap">
                      <Flex vertical gap={4} style={{ minWidth: 0 }}>
                        <Typography.Text strong>{item.name}</Typography.Text>
                        <Typography.Text type="secondary" style={{ wordBreak: 'break-all' }}>
                          {item.path}
                        </Typography.Text>
                      </Flex>
                      <Tag>{item.lineCount} 行</Tag>
                    </Flex>

                    <pre
                      style={{
                        margin: 0,
                        padding: token.paddingMD,
                        overflow: 'auto',
                        borderRadius: token.borderRadius,
                        background: token.colorBgLayout,
                        color: token.colorText,
                        fontFamily: token.fontFamilyCode,
                        fontSize: token.fontSizeSM,
                        lineHeight: 1.6,
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                      }}
                    >
                      {item.tail.join('\n') || '--'}
                    </pre>
                  </Flex>
                </div>
              ))}
            </Flex>
          ) : (
            <Alert type="info" showIcon message="暂无可读日志。" />
          )}
        </SectionCard>

        <SectionCard title="运维动作">
          {actions.length ? (
            <Flex vertical gap={12}>
              {actions.map((item) => (
                <div
                  key={item.name}
                  style={{
                    padding: token.paddingMD,
                    borderRadius: token.borderRadius,
                    border: `1px solid ${token.colorBorderSecondary}`,
                    background: token.colorBgLayout,
                  }}
                >
                  <Flex vertical gap={12}>
                    <Flex justify="space-between" align="flex-start" gap={12} wrap="wrap">
                      <Flex vertical gap={6} style={{ minWidth: 0 }}>
                        <Typography.Text strong>{item.label}</Typography.Text>
                        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
                          {item.caution}
                        </Typography.Paragraph>
                      </Flex>
                      <Tag
                        color={
                          item.running
                            ? 'orange'
                            : item.lastStatus === 'failed'
                              ? 'red'
                              : item.configured
                                ? 'green'
                                : 'default'
                        }
                      >
                        {item.lastStatus}
                      </Tag>
                    </Flex>

                    <Flex vertical gap={4}>
                      <Typography.Text type="secondary">工作区：{item.workspace}</Typography.Text>
                      <Typography.Text type="secondary">命令：{item.commandPreview || '未配置'}</Typography.Text>
                      {item.lastRequestedAt ? (
                        <Typography.Text type="secondary">
                          最近触发：{formatDateTimeZh(item.lastRequestedAt)}
                        </Typography.Text>
                      ) : null}
                    </Flex>

                    <Button
                      type={item.configured ? 'primary' : 'default'}
                      icon={<CodeOutlined />}
                      disabled={!item.configured || item.running}
                      loading={actingName === item.name}
                      onClick={() => void handleAction(item.name)}
                    >
                      {item.running ? '执行中' : `执行${item.label}`}
                    </Button>
                  </Flex>
                </div>
              ))}
            </Flex>
          ) : loading ? (
            <Alert type="info" showIcon message="正在加载运维动作..." />
          ) : (
            <Empty description="暂无可用运维动作" image={false} className="minimal-empty" />
          )}
        </SectionCard>
      </div>
    </Flex>
    </div>
  )
}
