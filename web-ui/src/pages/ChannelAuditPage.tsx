import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  App,
  Button,
  Card,
  Empty,
  Input,
  List,
  Select,
  Space,
  Spin,
  Statistic,
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
  TeamOutlined,
  WarningOutlined,
} from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { api, ApiError } from '../api'
import PageHero from '../components/PageHero'
import { formatDateTimeZh } from '../locale'
import type { ChannelAuditEntry, ChannelAuditListResponse } from '../types'

const { Paragraph, Text, Title } = Typography

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof ApiError) {
    return error.message
  }
  if (error instanceof Error && error.message) {
    return error.message
  }
  return fallback
}

function statusColor(status: ChannelAuditEntry['status']) {
  switch (status) {
    case 'dispatched':
      return 'success'
    case 'dispatch_error':
      return 'error'
    case 'no_handler':
      return 'warning'
    case 'resolved':
      return 'processing'
    case 'unmatched':
      return 'default'
    default:
      return 'default'
  }
}

function statusLabel(status: ChannelAuditEntry['status']) {
  switch (status) {
    case 'dispatched':
      return '已派发'
    case 'dispatch_error':
      return '派发失败'
    case 'no_handler':
      return '无处理器'
    case 'resolved':
      return '已命中绑定'
    case 'unmatched':
      return '未命中'
    default:
      return status
  }
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
      const next = await api.getChannelAudit({
        limit: 100,
        query: query.trim() || undefined,
        status: status !== 'all' ? status : undefined,
        channelName: channelName !== 'all' ? channelName : undefined,
      })
      setData(next)
    } catch (err) {
      const nextError = getErrorMessage(err, '加载渠道审计失败')
      setError(nextError)
      message.error(nextError)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadAudit()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, channelName])

  const items = data.items || []
  const channels = useMemo(() => {
    const unique = new Set(items.map((item) => item.channelName).filter(Boolean))
    return ['all', ...Array.from(unique)]
  }, [items])
  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    if (!normalizedQuery) {
      return items
    }
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
        .some((value) => String(value).toLowerCase().includes(normalizedQuery)),
    )
  }, [items, query])

  const summary = useMemo(() => {
    return filteredItems.reduce(
      (acc, item) => {
        acc.total += 1
        if (item.status === 'dispatched') acc.dispatched += 1
        if (item.status === 'dispatch_error' || item.status === 'no_handler') acc.failed += 1
        if (item.status === 'unmatched') acc.unmatched += 1
        return acc
      },
      { total: 0, dispatched: 0, failed: 0, unmatched: 0 },
    )
  }, [filteredItems])

  return (
    <div className="page-stack">
      <PageHero
        className="page-hero-compact studio-hero"
        title="渠道审计"
        actions={(
          <Space>
            <Button icon={<LinkOutlined />} onClick={() => navigate('/channels/bindings')}>
              返回消息路由
            </Button>
            <Button icon={<ReloadOutlined />} onClick={() => void loadAudit()}>
              刷新
            </Button>
          </Space>
        )}
      />

      {error ? <Alert type="error" showIcon message={error} /> : null}

      <div className="page-grid" style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}>
        <Card><Statistic title="最近审计" value={summary.total} prefix={<MessageOutlined />} /></Card>
        <Card><Statistic title="成功派发" value={summary.dispatched} prefix={<ApartmentOutlined />} /></Card>
        <Card><Statistic title="需排查" value={summary.failed} prefix={<WarningOutlined />} /></Card>
        <Card><Statistic title="未命中绑定" value={summary.unmatched} prefix={<LinkOutlined />} /></Card>
      </div>

      <Card className="config-panel-card">
        <Space wrap style={{ width: '100%', justifyContent: 'space-between' }}>
          <Space wrap>
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onPressEnter={() => void loadAudit()}
              prefix={<SearchOutlined />}
              placeholder="按 chat、target、消息内容搜索"
              style={{ width: 280 }}
            />
            <Select
              value={channelName}
              onChange={setChannelName}
              style={{ width: 180 }}
              options={channels.map((item) => ({
                value: item,
                label: item === 'all' ? '全部渠道' : item,
              }))}
            />
            <Select
              value={status}
              onChange={setStatus}
              style={{ width: 180 }}
              options={[
                { value: 'all', label: '全部状态' },
                { value: 'dispatched', label: '已派发' },
                { value: 'resolved', label: '已命中绑定' },
                { value: 'unmatched', label: '未命中' },
                { value: 'no_handler', label: '无处理器' },
                { value: 'dispatch_error', label: '派发失败' },
              ]}
            />
            <Button onClick={() => void loadAudit()}>应用筛选</Button>
          </Space>
          <Text type="secondary">展示最近 {data.limit} 条入口审计</Text>
        </Space>
      </Card>

      <Card className="config-panel-card">
        <div className="config-card-header">
          <div className="page-section-title">
            <Title level={4}>最近入口事件</Title>
          </div>
          <Tag>{filteredItems.length}</Tag>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: 64 }}>
            <Spin size="large" />
          </div>
        ) : filteredItems.length === 0 ? (
          <Empty description="最近没有符合条件的渠道审计" />
        ) : (
          <List
            dataSource={filteredItems}
            renderItem={(item) => (
              <List.Item>
                <Card style={{ width: '100%' }}>
                  <Space direction="vertical" size="small" style={{ width: '100%' }}>
                    <Space wrap>
                      <Tag color={statusColor(item.status)}>{statusLabel(item.status)}</Tag>
                      <Tag>{item.channelName}</Tag>
                      <Tag>{item.chatId}</Tag>
                      <Tag>{item.resolutionKind === 'wildcard' ? '通配命中' : item.resolutionKind === 'exact' ? '精确命中' : '未命中'}</Tag>
                      {item.targetType ? (
                        <Tag color="blue" icon={item.targetType === 'team' ? <TeamOutlined /> : <RobotOutlined />}>
                          {item.targetType}:{item.targetId}
                        </Tag>
                      ) : null}
                      {item.bindingId ? <Tag bordered={false}>binding:{item.bindingId}</Tag> : null}
                      {item.dispatchRunId ? (
                        <Button type="link" size="small" onClick={() => navigate(`/studio/runs/${item.dispatchRunId}`)}>
                          查看运行
                        </Button>
                      ) : null}
                    </Space>

                    <Paragraph style={{ marginBottom: 0 }}>
                      <Text strong>消息：</Text>{item.messagePreview || '-'}
                    </Paragraph>
                    {item.responsePreview ? (
                      <Paragraph style={{ marginBottom: 0 }}>
                        <Text strong>返回：</Text>{item.responsePreview}
                      </Paragraph>
                    ) : null}
                    {item.errorMessage ? (
                      <Paragraph type="danger" style={{ marginBottom: 0 }}>
                        <Text strong>错误：</Text>{item.errorMessage}
                      </Paragraph>
                    ) : null}

                    <Space wrap split={<Text type="secondary">/</Text>}>
                      <Text type="secondary">tenant: {item.tenantId}</Text>
                      <Text type="secondary">sender: {item.senderId}</Text>
                      <Text type="secondary">session: {item.sessionKey}</Text>
                      <Text type="secondary">{formatDateTimeZh(item.createdAt)}</Text>
                    </Space>
                  </Space>
                </Card>
              </List.Item>
            )}
          />
        )}
      </Card>
    </div>
  )
}
