import { useMemo } from 'react'
import { Alert, Button, Card, Space, Table, Tag, Typography } from 'antd'
import type { TableProps } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import { useNavigate, useSearchParams } from 'react-router-dom'
import PageHeader from '../../components/console/PageHeader'
import { formatDateTimeZh } from '../../locale'
import type { AgentRunSummary } from '../../types'
import { statusBadgeStatus, statusLabel } from './utils'

const { Text } = Typography

interface RunsListProps {
  runs: AgentRunSummary[]
  loading: boolean
  error: string | null
  onRefresh: () => void
}

export default function RunsList({ runs, loading, error, onRefresh }: RunsListProps) {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const threadFilter = (searchParams.get('threadId') || '').trim()

  const activeCount = useMemo(
    () => runs.filter((item) => ['queued', 'running', 'cancel_requested'].includes(item.status)).length,
    [runs]
  )

  const failedCount = useMemo(
    () => runs.filter((item) => item.status === 'failed').length,
    [runs]
  )

  const columns: TableProps<AgentRunSummary>['columns'] = [
    {
      title: '任务名称/ID',
      dataIndex: 'label',
      key: 'label',
      render: (text, record) => (
        <Space direction="vertical" size={0}>
          <Text strong>{text}</Text>
          <Text type="secondary" style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>
            {record.runId}
          </Text>
        </Space>
      ),
    },
    {
      title: '状态',
      key: 'status',
      width: 120,
      render: (_, record) => (
        <Tag color={statusBadgeStatus(record.status)} bordered={false}>
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
          <Tag bordered={false}>{record.agentId}</Tag>
        ) : (
          <Text type="secondary">-</Text>
        ),
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 180,
      render: (text) => <Text type="secondary">{formatDateTimeZh(text)}</Text>,
    },
    {
      title: '操作',
      key: 'action',
      width: 100,
      render: (_, record) => (
        <Button
          type="link"
          size="small"
          onClick={(e) => {
            e.stopPropagation()
            navigate(`/studio/runs/${record.runId}`)
          }}
        >
          详情
        </Button>
      ),
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
          <Button icon={<ReloadOutlined />} onClick={onRefresh} loading={loading}>
            刷新列表
          </Button>
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
              style={{ margin: '16px 24px 0' }}
              message="运行记录加载失败"
              description={error}
            />
          ) : null}

          {threadFilter && (
            <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--nb-border)' }}>
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
        </Card>
      </div>
    </div>
  )
}
