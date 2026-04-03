import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  App,
  Button,
  Card,
  Flex,
  Input,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Typography,
} from 'antd'
import {
  ApartmentOutlined,
  LinkOutlined,
  MessageOutlined,
  ReloadOutlined,
  RobotOutlined,
  SearchOutlined,
  WarningOutlined,
} from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { api, ApiError } from '../../api'
import { formatDateTimeZh } from '../../locale'
import type { ChannelAuditEntry, ChannelAuditListResponse } from '../../types'
import { getAuditStatusColor, getAuditStatusLabel } from './shared'

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error && error.message) return error.message
  return fallback
}

export default function ChannelAuditPage() {
  const navigate = useNavigate()
  const { message } = App.useApp()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<string>('all')
  const [channelName, setChannelName] = useState<string>('all')
  const [data, setData] = useState<ChannelAuditListResponse>({ items: [], limit: 100 })

  async function loadAudit() {
    setLoading(true)
    setError(null)
    try {
      const result = await api.getChannelAudit({
        limit: 100,
        query: query.trim() || undefined,
        status: status !== 'all' ? status : undefined,
        channelName: channelName !== 'all' ? channelName : undefined,
      })
      setData(result)
    } catch (err) {
      const errorMsg = getErrorMessage(err, '加载渠道审计失败')
      setError(errorMsg)
      message.error(errorMsg)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadAudit()
  }, [status, channelName])

  const items = data.items || []

  const channels = useMemo(() => {
    const unique = new Set(items.map((item) => item.channelName).filter(Boolean))
    return ['all', ...Array.from(unique)]
  }, [items])

  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    if (!normalizedQuery) return items
    return items.filter((item) =>
      [
        item.channelName,
        item.chatId,
        item.senderId,
        item.bindingId,
        item.targetId,
        item.messagePreview,
        item.responsePreview,
        item.errorMessage,
      ]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(normalizedQuery)),
    )
  }, [items, query])

  const summary = useMemo(
    () =>
      filteredItems.reduce(
        (acc, item) => {
          acc.total += 1
          if (item.status === 'dispatched') acc.dispatched += 1
          if (item.status === 'dispatch_error' || item.status === 'no_handler') acc.failed += 1
          if (item.status === 'unmatched') acc.unmatched += 1
          return acc
        },
        { total: 0, dispatched: 0, failed: 0, unmatched: 0 },
      ),
    [filteredItems],
  )

  const columns = [
    {
      title: '时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 160,
      render: (date: string) => formatDateTimeZh(date),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status: ChannelAuditEntry['status']) => (
        <Tag color={getAuditStatusColor(status)}>{getAuditStatusLabel(status)}</Tag>
      ),
    },
    {
      title: '渠道',
      dataIndex: 'channelName',
      key: 'channelName',
      width: 100,
      render: (name: string, record: ChannelAuditEntry) => (
        <Space size={4}>
          <Tag>{name}</Tag>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {record.chatId}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: '命中',
      dataIndex: 'resolutionKind',
      key: 'resolutionKind',
      width: 100,
      render: (kind: string) => (
        <Tag>
          {kind === 'wildcard' ? '通配' : kind === 'exact' ? '精确' : '未命中'}
        </Tag>
      ),
    },
    {
      title: '目标',
      key: 'target',
      width: 140,
      render: (_: unknown, record: ChannelAuditEntry) =>
        record.targetType && record.targetId ? (
          <Tag color="processing" icon={<RobotOutlined />}>
            {record.targetId}
          </Tag>
        ) : null,
    },
    {
      title: '消息预览',
      dataIndex: 'messagePreview',
      key: 'messagePreview',
      ellipsis: true,
      render: (preview: string) => (
        <Typography.Text
          ellipsis={{ tooltip: preview }}
          style={{ maxWidth: 300 }}
        >
          {preview || '-'}
        </Typography.Text>
      ),
    },
    {
      title: '操作',
      key: 'action',
      width: 80,
      render: (_: unknown, record: ChannelAuditEntry) =>
        record.dispatchRunId ? (
          <Button
            type="link"
            size="small"
            onClick={() => navigate(`/studio/runs/${record.dispatchRunId}`)}
          >
            查看
          </Button>
        ) : null,
    },
  ]

  return (
    <Flex vertical gap={16}>
      <Flex justify="space-between" align="center" gap={12} wrap="wrap">
        <Space size={16}>
          <Flex align="center" gap={6}>
            <MessageOutlined />
            <Typography.Text strong>{summary.total}</Typography.Text>
            <Typography.Text type="secondary">条记录</Typography.Text>
          </Flex>
          <Flex align="center" gap={6}>
            <ApartmentOutlined style={{ color: 'var(--nb-success)' }} />
            <Typography.Text strong>{summary.dispatched}</Typography.Text>
            <Typography.Text type="secondary">已派发</Typography.Text>
          </Flex>
          <Flex align="center" gap={6}>
            <WarningOutlined style={{ color: 'var(--nb-error)' }} />
            <Typography.Text strong>{summary.failed}</Typography.Text>
            <Typography.Text type="secondary">需排查</Typography.Text>
          </Flex>
          <Flex align="center" gap={6}>
            <LinkOutlined style={{ color: 'var(--nb-muted)' }} />
            <Typography.Text strong>{summary.unmatched}</Typography.Text>
            <Typography.Text type="secondary">未命中</Typography.Text>
          </Flex>
        </Space>
        <Space>
          <Button icon={<LinkOutlined />} onClick={() => navigate('/channels/bindings')}>
            消息路由
          </Button>
          <Button icon={<ReloadOutlined />} onClick={() => void loadAudit()} loading={loading}>
            刷新
          </Button>
        </Space>
      </Flex>

      {error && <Alert type="error" showIcon message={error} />}

      <Card styles={{ body: { padding: 12 } }}>
        <Flex justify="space-between" align="center" gap={12} wrap="wrap">
          <Space>
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onPressEnter={() => void loadAudit()}
              prefix={<SearchOutlined />}
              placeholder="搜索审计记录"
              style={{ width: 240 }}
              allowClear
            />
            <Select
              value={channelName}
              onChange={setChannelName}
              style={{ width: 140 }}
              options={channels.map((item) => ({
                value: item,
                label: item === 'all' ? '全部渠道' : item,
              }))}
            />
            <Select
              value={status}
              onChange={setStatus}
              style={{ width: 140 }}
              options={[
                { value: 'all', label: '全部状态' },
                { value: 'dispatched', label: '已派发' },
                { value: 'resolved', label: '已命中绑定' },
                { value: 'unmatched', label: '未命中' },
                { value: 'no_handler', label: '无处理器' },
                { value: 'dispatch_error', label: '派发失败' },
              ]}
            />
            <Button onClick={() => void loadAudit()}>筛选</Button>
          </Space>
          <Typography.Text type="secondary">最近 {data.limit} 条</Typography.Text>
        </Flex>
      </Card>

      <Card styles={{ body: { padding: 0 } }}>
        {loading ? (
          <Flex justify="center" align="center" style={{ minHeight: 300 }}>
            <Spin size="large" />
          </Flex>
        ) : (
          <Table
            dataSource={filteredItems}
            columns={columns}
            rowKey="auditId"
            size="small"
            pagination={{ pageSize: 20, showSizeChanger: false }}
            scroll={{ x: 1000 }}
            expandable={{
              expandedRowRender: (record) => (
                <Flex vertical gap={8} style={{ padding: '8px 0' }}>
                  {record.responsePreview && (
                    <div>
                      <Typography.Text strong>返回：</Typography.Text>
                      <Typography.Text>{record.responsePreview}</Typography.Text>
                    </div>
                  )}
                  {record.errorMessage && (
                    <div>
                      <Typography.Text type="danger" strong>错误：</Typography.Text>
                      <Typography.Text type="danger">{record.errorMessage}</Typography.Text>
                    </div>
                  )}
                  <Space split={<Typography.Text type="secondary">|</Typography.Text>}>
                    <Typography.Text type="secondary">tenant: {record.tenantId}</Typography.Text>
                    <Typography.Text type="secondary">sender: {record.senderId}</Typography.Text>
                    <Typography.Text type="secondary">session: {record.sessionKey}</Typography.Text>
                    {record.bindingId && (
                      <Typography.Text type="secondary">binding: {record.bindingId}</Typography.Text>
                    )}
                  </Space>
                </Flex>
              ),
              rowExpandable: (record) =>
                Boolean(record.responsePreview || record.errorMessage),
            }}
          />
        )}
      </Card>
    </Flex>
  )
}
