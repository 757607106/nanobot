import { useMemo, useEffect, useState } from 'react'
import { Alert, Button, Card, Space, Table, Tag, Typography, Select, Skeleton } from 'antd'
import type { TableProps } from 'antd'
import { ReloadOutlined, CheckCircleOutlined, CloseCircleOutlined, LoadingOutlined, ClockCircleOutlined } from '@ant-design/icons'
import { useNavigate, useSearchParams } from 'react-router-dom'
import PageHeader from '../../components/console/PageHeader'
import { formatDateTimeZh } from '../../locale'
import type { AgentRunSummary, AgentDefinition } from '../../types'
import { api } from '../../api'
import { statusBadgeStatus, statusLabel } from './utils'

const { Text } = Typography

interface RunsListProps {
  runs: AgentRunSummary[]
  loading: boolean
  error: string | null
  onRefresh: (filters?: { agentId?: string }) => void
}

/** 格式化耗时（秒 → 友好文本） */
function formatDuration(createdAt: string, finishedAt?: string | null): string {
  if (!finishedAt) return '-'
  const start = new Date(createdAt).getTime()
  const end = new Date(finishedAt).getTime()
  const diffMs = end - start
  if (diffMs < 0 || Number.isNaN(diffMs)) return '-'
  const seconds = Math.floor(diffMs / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  return `${hours}h ${remainingMinutes}m`
}

/** 状态图标 */
function statusIcon(status: string) {
  switch (status) {
    case 'succeeded':
      return <CheckCircleOutlined style={{ color: 'var(--ant-color-success)', marginRight: 4 }} />
    case 'failed':
      return <CloseCircleOutlined style={{ color: 'var(--ant-color-error)', marginRight: 4 }} />
    case 'running':
    case 'queued':
      return <LoadingOutlined style={{ color: 'var(--ant-color-warning)', marginRight: 4 }} />
    default:
      return <ClockCircleOutlined style={{ color: 'var(--ant-color-text-quaternary)', marginRight: 4 }} />
  }
}

export default function RunsList({ runs, loading, error, onRefresh }: RunsListProps) {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const threadFilter = (searchParams.get('threadId') || '').trim()
  const agentFilter = (searchParams.get('agentId') || '').trim()

  const [agents, setAgents] = useState<AgentDefinition[]>([])
  
  useEffect(() => {
    api.getAgents().then(setAgents).catch(() => {})
  }, [])

  /** agentId → friendly name 映射 */
  const agentNameMap = useMemo(() => {
    const map: Record<string, string> = {}
    for (const a of agents) {
      map[a.agentId] = a.name
    }
    return map
  }, [agents])

  const activeCount = useMemo(
    () => runs.filter((item) => ['queued', 'running', 'cancel_requested'].includes(item.status)).length,
    [runs]
  )

  const failedCount = useMemo(
    () => runs.filter((item) => item.status === 'failed').length,
    [runs]
  )

  const handleAgentChange = (value: string) => {
    const next = new URLSearchParams(searchParams)
    if (value) {
      next.set('agentId', value)
    } else {
      next.delete('agentId')
    }
    setSearchParams(next)
    onRefresh({ agentId: value || undefined })
  }

  const columns: TableProps<AgentRunSummary>['columns'] = [
    {
      title: '任务名称',
      dataIndex: 'label',
      key: 'label',
      render: (text) => (
        <Text strong style={{ fontSize: 'var(--nb-text-sm)' }}>{text}</Text>
      ),
    },
    {
      title: '状态',
      key: 'status',
      width: 130,
      render: (_, record) => (
        <Tag color={statusBadgeStatus(record.status)} bordered={false}>
          {statusIcon(record.status)}
          {statusLabel(record.status)}
        </Tag>
      ),
    },
    {
      title: 'Agent',
      key: 'agentId',
      width: 150,
      render: (_, record) =>
        record.agentId ? (
          <Tag bordered={false} color="blue">
            {agentNameMap[record.agentId] || record.agentId}
          </Tag>
        ) : (
          <Text type="secondary">-</Text>
        ),
    },
    {
      title: '耗时',
      key: 'duration',
      width: 100,
      render: (_, record) => (
        <Text type="secondary" style={{ fontFamily: 'var(--nb-font-mono)', fontSize: 'var(--nb-text-sm)' }}>
          {formatDuration(record.createdAt ?? '', record.finishedAt)}
        </Text>
      ),
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 180,
      render: (text) => <Text type="secondary">{formatDateTimeZh(text)}</Text>,
    },
  ]

  return (
    <div className="page-stack">
      <PageHeader
        title="执行记录"
        subtitle={error
          ? `加载失败：${error}`
          : `${activeCount > 0 ? `运行中: ${activeCount}  ` : ''}${failedCount > 0 ? `失败: ${failedCount}` : ''}`}
        actions={
          <Space>
            <Select
              allowClear
              placeholder="通过 Agent 筛选"
              value={agentFilter || undefined}
              onChange={handleAgentChange}
              style={{ width: 200 }}
              options={agents.map(a => ({ value: a.agentId, label: a.name }))}
            />
            <Button icon={<ReloadOutlined />} onClick={() => onRefresh({ agentId: agentFilter || undefined })} loading={loading}>
              刷新列表
            </Button>
          </Space>
        }
      />

      <div className="page-content-wrapper">
        <Card
          className="page-card"
          variant="borderless"
          styles={{ body: { padding: 0 } }}
        >
          {error ? (
            <Alert
              type="error"
              showIcon
              className="page-alert"
              message="运行记录加载失败"
              description={error}
            />
          ) : null}

          {threadFilter && (
            <div className="page-filter-bar">
              <Tag
                closable
                onClose={() => {
                  const next = new URLSearchParams(searchParams)
                  next.delete('threadId')
                  setSearchParams(next)
                }}
              >
                Thread: {threadFilter}
              </Tag>
            </div>
          )}

          {loading && !runs.length ? (
            <div className="page-filter-bar">
              <Skeleton active paragraph={{ rows: 3 }} />
            </div>
          ) : (
            <Table
              dataSource={runs}
              columns={columns}
              rowKey="runId"
              loading={loading}
              scroll={{ x: 'max-content' }}
              pagination={{
                pageSize: 15,
                showTotal: (total) => `共 ${total} 条记录`,
                showSizeChanger: false,
              }}
              onRow={(record) => ({
                onClick: () => navigate(`/studio/runs/${record.runId}`),
                style: { cursor: 'pointer' },
              })}
            />
          )}
        </Card>
      </div>
    </div>
  )
}
