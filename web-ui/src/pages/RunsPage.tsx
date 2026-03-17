import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  App,
  Badge,
  Button,
  Card,
  Col,
  Descriptions,
  Empty,
  List,
  Row,
  Select,
  Space,
  Spin,
  Steps,
  Table,
  Tabs,
  Tag,
  Typography,
  Tooltip,
} from 'antd'
import type { TableProps } from 'antd'
import {
  ClockCircleOutlined,
  CodeOutlined,
  DownloadOutlined,
  PauseCircleOutlined,
  ReloadOutlined,
  RobotOutlined,
  TeamOutlined,
  UserOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  SyncOutlined,
  FileTextOutlined,
  ApartmentOutlined,
  MessageOutlined,
  InfoCircleOutlined,
} from '@ant-design/icons'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { api, ApiError } from '../api'
import DevOnly from '../components/DevOnly'
import PageHero from '../components/PageHero'
import { useDevMode } from '../devMode'
import { formatDateTimeZh } from '../locale'
import type {
  AgentRunSummary,
  AgentRunTreeNode,
  ChatMessage,
  RunArtifactDetail,
  TeamThreadSummary,
} from '../types'

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

function statusColor(status: AgentRunSummary['status']) {
  switch (status) {
    case 'succeeded':
      return 'success'
    case 'failed':
      return 'error'
    case 'running':
      return 'processing'
    case 'cancel_requested':
      return 'warning'
    case 'cancelled':
      return 'default'
    default:
      return 'default'
  }
}

function statusBadgeStatus(status: AgentRunSummary['status']) {
  switch (status) {
    case 'succeeded':
      return 'success'
    case 'failed':
      return 'error'
    case 'running':
      return 'processing'
    case 'cancel_requested':
      return 'warning'
    case 'cancelled':
      return 'default'
    default:
      return 'default'
  }
}

function statusLabel(status: AgentRunSummary['status']) {
  switch (status) {
    case 'succeeded':
      return '成功'
    case 'failed':
      return '失败'
    case 'running':
      return '运行中'
    case 'queued':
      return '排队中'
    case 'cancel_requested':
      return '取消中'
    case 'cancelled':
      return '已取消'
    default:
      return status
  }
}

function isActiveStatus(status: AgentRunSummary['status']) {
  return status === 'queued' || status === 'running' || status === 'cancel_requested'
}

function isCancelable(status: AgentRunSummary['status']) {
  return status === 'queued' || status === 'running'
}

function eventLabel(eventType: string, devMode = true) {
  switch (eventType) {
    case 'queued':
      return '已排队'
    case 'started':
      return '开始执行'
    case 'completed':
      return '执行完成'
    case 'failed':
      return '执行失败'
    case 'cancel_requested':
      return '已请求取消'
    case 'cancelled':
      return '已取消'
    case 'bindings_resolved':
      return devMode ? '已装配绑定能力' : '准备就绪'
    case 'knowledge_retrieved':
      return devMode ? '已检索知识库' : '准备就绪'
    case 'team_run_requested':
      return '收到团队任务'
    case 'team_definition_resolved':
      return devMode ? '已解析 TeamDefinition' : '准备就绪'
    case 'team_knowledge_retrieved':
      return devMode ? '已检索团队共享知识' : '准备就绪'
    case 'retry_requested':
      return '已发起重跑'
    case 'memory_candidate_proposed':
      return '已生成记忆候选'
    case 'member_scheduled':
      return '成员已派发'
    case 'member_completed':
      return '成员已完成'
    case 'leader_scheduled':
      return 'Leader 已开始汇总'
    case 'leader_completed':
      return 'Leader 已完成汇总'
    case 'team_completed':
      return '团队运行完成'
    default:
      return eventType
  }
}

function eventPayloadSummary(eventType: string, payload?: Record<string, unknown>, devMode = true) {
  if (!payload) {
    return null
  }
  switch (eventType) {
    case 'progress':
      return String(payload.content || '')
    case 'team_run_requested':
      return String(payload.contentPreview || '')
    case 'bindings_resolved': {
      if (!devMode) {
        const total =
          (Array.isArray(payload.toolAllowlist) ? payload.toolAllowlist.length : 0) +
          (Array.isArray(payload.mcpServerIds) ? payload.mcpServerIds.length : 0) +
          (Array.isArray(payload.skillIds) ? payload.skillIds.length : 0) +
          (Array.isArray(payload.knowledgeBindingIds) ? payload.knowledgeBindingIds.length : 0)
        return `已加载 ${total} 项能力`
      }
      return [
        `tools: ${Array.isArray(payload.toolAllowlist) ? payload.toolAllowlist.length : 0}`,
        `mcp: ${Array.isArray(payload.mcpServerIds) ? payload.mcpServerIds.length : 0}`,
        `skills: ${Array.isArray(payload.skillIds) ? payload.skillIds.length : 0}`,
        `kb: ${Array.isArray(payload.knowledgeBindingIds) ? payload.knowledgeBindingIds.length : 0}`,
      ].join(' · ')
    }
    case 'knowledge_retrieved':
    case 'team_knowledge_retrieved':
      return `mode: ${payload.effectiveMode || payload.requestedMode || 'keyword'} · hits: ${payload.hitCount || 0}`
    case 'team_definition_resolved':
      return [
        `members: ${Array.isArray(payload.memberAgentIds) ? payload.memberAgentIds.length : 0}`,
        `shared KB: ${Array.isArray(payload.sharedKnowledgeBindingIds) ? payload.sharedKnowledgeBindingIds.length : 0}`,
      ].join(' · ')
    case 'retry_requested':
      return [
        `source: ${payload.sourceRunId || 'n/a'}`,
        payload.appendContextProvided ? 'with append context' : 'direct retry',
      ].join(' · ')
    case 'memory_candidate_proposed':
      return [payload.candidateId, payload.agentId, payload.runId].filter(Boolean).join(' · ')
    case 'member_scheduled':
    case 'member_completed':
    case 'leader_scheduled':
    case 'leader_completed':
      return [payload.agentName, payload.runId].filter(Boolean).join(' · ')
    case 'team_completed':
      return [
        `supervisor: ${payload.supervisorRunId || 'n/a'}`,
        `members: ${Array.isArray(payload.memberRunIds) ? payload.memberRunIds.length : 0}`,
      ].join(' · ')
    default:
      return JSON.stringify(payload, null, 2)
  }
}

function controlScopeTag(scope: string) {
  switch (scope) {
    case 'leader':
      return <Tag color="purple" bordered={false}>Supervisor</Tag>
    case 'member':
      return <Tag color="cyan" bordered={false}>成员</Tag>
    case 'child':
      return <Tag color="orange" bordered={false}>子任务</Tag>
    default:
      return null
  }
}

function renderTreeNode(node: AgentRunTreeNode, selectedRunId: string | null, navigate: ReturnType<typeof useNavigate>) {
  const children = node.children || []
  const active = node.runId === selectedRunId
  
  return (
    <div key={node.runId} className={`studio-run-tree-node ${active ? 'is-active' : ''}`}>
      <div 
        className={`studio-run-tree-content ${active ? 'bg-primary-50 border-primary-200' : ''}`}
        onClick={() => navigate(`/studio/runs/${node.runId}`)}
        style={{ 
          cursor: 'pointer',
          padding: '12px',
          border: '1px solid var(--nb-border)',
          borderRadius: 8,
          marginBottom: 8,
          background: active ? 'var(--nb-conversation-active-bg)' : 'var(--nb-card-bg)',
          borderColor: active ? 'var(--nb-conversation-active-border)' : 'var(--nb-border)',
          transition: 'all 0.2s'
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <Space>
            {node.kind === 'team' ? <TeamOutlined /> : <RobotOutlined />}
            <Text strong>{node.label}</Text>
            {controlScopeTag(node.controlScope)}
          </Space>
          <Badge status={statusBadgeStatus(node.status)} text={statusLabel(node.status)} />
        </div>
        {node.resultSummary?.content && (
          <Paragraph type="secondary" ellipsis={{ rows: 1 }} style={{ margin: 0, fontSize: 12 }}>
            {node.resultSummary.content}
          </Paragraph>
        )}
      </div>
      {children.length > 0 && (
        <div style={{ paddingLeft: 24, borderLeft: '1px solid var(--nb-border)', marginLeft: 12 }}>
          {children.map((child) => renderTreeNode(child, selectedRunId, navigate))}
        </div>
      )}
    </div>
  )
}

export default function RunsPage() {
  const { devMode } = useDevMode()
  const { message } = App.useApp()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { runId } = useParams()
  const selectedRunId = runId || null
  const threadFilter = (searchParams.get('threadId') || '').trim()

  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [kindFilter, setKindFilter] = useState<string>('all')
  const [runs, setRuns] = useState<AgentRunSummary[]>([])
  const [selectedRun, setSelectedRun] = useState<AgentRunSummary | null>(null)
  const [children, setChildren] = useState<AgentRunSummary[]>([])
  const [runTree, setRunTree] = useState<AgentRunTreeNode | null>(null)
  const [artifact, setArtifact] = useState<RunArtifactDetail | null>(null)
  const [threadSummary, setThreadSummary] = useState<TeamThreadSummary | null>(null)
  const [threadMessages, setThreadMessages] = useState<ChatMessage[]>([])
  const [loadingRuns, setLoadingRuns] = useState(true)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [loadingArtifact, setLoadingArtifact] = useState(false)
  const [loadingThreadAudit, setLoadingThreadAudit] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Table columns for run list
  const columns: TableProps<AgentRunSummary>['columns'] = [
    {
      title: '任务名称/ID',
      dataIndex: 'label',
      key: 'label',
      render: (text, record) => (
        <Space direction="vertical" size={0}>
          <Text strong>{text}</Text>
          <Text type="secondary" style={{ fontSize: 12, fontFamily: 'var(--font-mono)' }}>{record.runId}</Text>
        </Space>
      ),
    },
    {
      title: '类型',
      key: 'kind',
      width: 120,
      render: (_, record) => (
        <Space direction="vertical" size={0}>
          <Tag bordered={false}>{record.kind === 'team' ? 'Team' : 'Agent'}</Tag>
          {record.controlScope && controlScopeTag(record.controlScope)}
        </Space>
      ),
    },
    {
      title: '状态',
      key: 'status',
      width: 120,
      render: (_, record) => <Badge status={statusBadgeStatus(record.status)} text={statusLabel(record.status)} />,
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
        <Button type="link" size="small" onClick={() => navigate(`/studio/runs/${record.runId}`)}>
          详情
        </Button>
      ),
    },
  ]

  useEffect(() => {
    void loadRuns()
  }, [statusFilter, kindFilter, threadFilter])

  useEffect(() => {
    if (loadingRuns) return
    
    // Don't auto-select first run if none selected, let user see the list
    if (!selectedRunId) {
      setSelectedRun(null)
      setChildren([])
      setRunTree(null)
      setArtifact(null)
      setThreadSummary(null)
      setThreadMessages([])
      return
    }
    void loadRunDetail(selectedRunId)
  }, [loadingRuns, selectedRunId])

  useEffect(() => {
    if (!selectedRunId || !selectedRun || !isActiveStatus(selectedRun.status)) {
      return
    }
    const timer = window.setInterval(() => {
      void loadRuns() // Refresh list status too
      void loadRunDetail(selectedRunId)
    }, 2500)
    return () => window.clearInterval(timer)
  }, [selectedRun, selectedRunId])

  const activeCount = useMemo(
    () => runs.filter((item) => isActiveStatus(item.status)).length,
    [runs],
  )
  const failedCount = useMemo(
    () => runs.filter((item) => item.status === 'failed').length,
    [runs],
  )

  async function loadRuns() {
    try {
      setLoadingRuns(true)
      const payload = await api.getRuns({
        status: statusFilter === 'all' ? undefined : statusFilter,
        kind: kindFilter === 'all' ? undefined : kindFilter,
        threadId: threadFilter || undefined,
        limit: 80,
      })
      setRuns(payload.items)
      setError(null)
    } catch (loadError) {
      setError(getErrorMessage(loadError, '加载运行列表失败'))
    } finally {
      setLoadingRuns(false)
    }
  }

  async function loadRunDetail(nextRunId: string) {
    try {
      setLoadingDetail(true)
      const [run, childPayload, tree] = await Promise.all([
        api.getRun(nextRunId),
        api.getRunChildren(nextRunId),
        api.getRunTree(nextRunId),
      ])
      setSelectedRun(run)
      setChildren(childPayload.items)
      setRunTree(tree)
      if (run.teamId && run.threadId) {
        setLoadingThreadAudit(true)
        try {
          const [summary, messages] = await Promise.all([
            api.getTeamThread(run.teamId),
            api.getTeamThreadMessages(run.teamId, 8),
          ])
          setThreadSummary(summary)
          setThreadMessages(messages.messages)
        } catch {
          setThreadSummary(null)
          setThreadMessages([])
        } finally {
          setLoadingThreadAudit(false)
        }
      } else {
        setThreadSummary(null)
        setThreadMessages([])
      }
      let artifactErrorMessage: string | null = null
      if (run.artifactPath) {
        setLoadingArtifact(true)
        try {
          const artifactDetail = await api.getRunArtifact(nextRunId)
          setArtifact(artifactDetail)
        } catch (artifactError) {
          setArtifact(null)
          artifactErrorMessage = getErrorMessage(artifactError, '加载运行归档失败')
        } finally {
          setLoadingArtifact(false)
        }
      } else {
        setArtifact(null)
      }
      setError(artifactErrorMessage)
    } catch (loadError) {
      setError(getErrorMessage(loadError, '加载运行详情失败'))
    } finally {
      setLoadingDetail(false)
    }
  }

  function handleDownloadArtifact() {
    if (!artifact) {
      return
    }
    const blob = new Blob([artifact.content], { type: artifact.contentType || 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = artifact.fileName || `${artifact.runId}.md`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  async function handleCancelRun() {
    if (!selectedRun) {
      return
    }
    try {
      setCancelling(true)
      const cancelled = await api.cancelRun(selectedRun.runId)
      message.success(cancelled.taskCancellationSent ? '已向运行时发送取消请求' : '已标记为取消请求')
      await loadRuns()
      await loadRunDetail(selectedRun.runId)
    } catch (cancelError) {
      setError(getErrorMessage(cancelError, '取消运行失败'))
    } finally {
      setCancelling(false)
    }
  }

  // Detail View
  if (selectedRunId && selectedRun) {
    const tabItems = [
      {
        key: 'overview',
        label: '概览',
        icon: <InfoCircleOutlined />,
        children: (
          <Space direction="vertical" size={24} style={{ width: '100%' }}>
            {/* Result Card */}
            {selectedRun.resultSummary?.content ? (
              <Card title="执行结果" className="page-card" bordered={false}>
                <div className="markdown-body" style={{ background: 'var(--nb-surface-strong)', padding: 24, borderRadius: 8 }}>
                  <pre style={{ whiteSpace: 'pre-wrap', margin: 0, fontFamily: 'inherit', fontSize: 14, lineHeight: 1.6 }}>
                    {selectedRun.resultSummary.content}
                  </pre>
                </div>
              </Card>
            ) : (
              <Card className="page-card" bordered={false}>
                <Empty description="暂无执行结果" image={Empty.PRESENTED_IMAGE_SIMPLE} />
              </Card>
            )}
            
            <Row gutter={[24, 24]}>
              <Col span={24}>
                 <Card title="基础信息" className="page-card" bordered={false} size="small">
                  <Descriptions column={{ xs: 1, sm: 2, md: 3 }} size="middle">
                    <Descriptions.Item label="Run ID">
                      <Text copyable code>{selectedRun.runId}</Text>
                    </Descriptions.Item>
                    <Descriptions.Item label="Agent">
                      {selectedRun.agentId ? <Tag color="blue" bordered={false}>{selectedRun.agentId}</Tag> : '-'}
                    </Descriptions.Item>
                    <Descriptions.Item label="Team">
                      {selectedRun.teamId ? <Tag color="geekblue" bordered={false}>{selectedRun.teamId}</Tag> : '-'}
                    </Descriptions.Item>
                    <Descriptions.Item label="创建时间">
                      {formatDateTimeZh(selectedRun.createdAt)}
                    </Descriptions.Item>
                    <Descriptions.Item label="Thread ID">
                      {selectedRun.threadId ? <Text code copyable>{selectedRun.threadId}</Text> : '-'}
                    </Descriptions.Item>
                  </Descriptions>
                </Card>
              </Col>
            </Row>
          </Space>
        )
      },
      {
        key: 'timeline',
        label: '时间轴',
        icon: <ClockCircleOutlined />,
        children: (
          <Card className="page-card" bordered={false} title="执行过程">
            {!selectedRun.events?.length ? (
              <Empty description="暂无过程记录" />
            ) : (
              <div style={{ maxWidth: 800, margin: '0 auto', padding: '24px 0' }}>
                <Steps
                  direction="vertical"
                  size="small"
                  current={selectedRun.events.length - 1}
                  status={selectedRun.status === 'failed' ? 'error' : 'process'}
                  items={selectedRun.events.map(event => ({
                    title: (
                      <Space>
                        <Text strong>{eventLabel(event.eventType, devMode)}</Text>
                        <Tag bordered={false}>{event.eventType}</Tag>
                        <Text type="secondary" style={{ fontSize: 12 }}>{formatDateTimeZh(event.createdAt)}</Text>
                      </Space>
                    ),
                    description: eventPayloadSummary(event.eventType, event.payload, devMode) && (
                      <div style={{ 
                        marginTop: 12, 
                        padding: '12px 16px', 
                        background: 'var(--nb-surface-strong)', 
                        borderRadius: 8,
                        border: '1px solid var(--nb-border)'
                      }}>
                        <Text type="secondary" style={{ fontSize: 13, fontFamily: 'var(--font-mono)' }}>
                          {eventPayloadSummary(event.eventType, event.payload, devMode)}
                        </Text>
                      </div>
                    ),
                    icon: event.eventType === 'failed' ? <CloseCircleOutlined style={{ color: 'var(--nb-error)' }} /> : 
                          event.eventType === 'completed' ? <CheckCircleOutlined style={{ color: 'var(--nb-success)' }} /> : undefined
                  }))}
                />
              </div>
            )}
          </Card>
        )
      },
      {
        key: 'tree',
        label: '任务树',
        icon: <ApartmentOutlined />,
        children: (
          <Card className="page-card" bordered={false} title="任务层级结构">
            {runTree ? renderTreeNode(runTree, selectedRunId, navigate) : <Empty />}
          </Card>
        )
      }
    ]

    // Add conversation tab if applicable
    if (selectedRun.teamId && selectedRun.threadId) {
      tabItems.push({
        key: 'conversation',
        label: '对话',
        icon: <MessageOutlined />,
        children: (
          <Card className="page-card" bordered={false} title="对话记录" extra={<Tag>{selectedRun.threadId}</Tag>}>
            <List
              dataSource={threadMessages}
              renderItem={(item) => (
                <List.Item style={{ border: 'none', padding: '16px 0' }}>
                  <div style={{ width: '100%' }}>
                    <div style={{ display: 'flex', gap: 16 }}>
                      <div style={{ 
                        width: 36, height: 36, borderRadius: 18, 
                        background: item.role === 'user' ? 'var(--nb-accent)' : 'var(--nb-surface-strong)',
                        color: item.role === 'user' ? '#fff' : 'var(--nb-text-secondary)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        flexShrink: 0
                      }}>
                        {item.role === 'user' ? <UserOutlined /> : <RobotOutlined />}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                          <Text strong style={{ fontSize: 15 }}>{item.role === 'user' ? '用户' : item.role}</Text>
                          <Text type="secondary" style={{ fontSize: 12 }}>{formatDateTimeZh(item.createdAt)}</Text>
                        </div>
                        <div style={{ 
                          padding: 16, 
                          background: item.role === 'user' ? 'var(--nb-surface-strong)' : 'transparent',
                          borderRadius: 8,
                          border: item.role === 'user' ? 'none' : '1px solid var(--nb-border)'
                        }}>
                          <Text style={{ lineHeight: 1.6 }}>{item.content}</Text>
                        </div>
                      </div>
                    </div>
                  </div>
                </List.Item>
              )}
            />
          </Card>
        )
      })
    }

    // Add artifact tab if applicable
    if (selectedRun.artifactPath) {
      tabItems.push({
        key: 'artifact',
        label: '产物',
        icon: <FileTextOutlined />,
        children: (
          <Card className="page-card" bordered={false} title="任务产出归档">
            <div style={{ padding: 24, textAlign: 'center', background: 'var(--nb-surface-strong)', borderRadius: 8 }}>
              <Space direction="vertical" size={16}>
                <FileTextOutlined style={{ fontSize: 48, color: 'var(--nb-primary)' }} />
                <Title level={4} style={{ margin: 0 }}>任务生成了归档文件</Title>
                <Text type="secondary">包含执行过程中生成的所有代码、文档和数据。</Text>
                <Space size={16} style={{ marginTop: 16 }}>
                  <Button type="primary" icon={<DownloadOutlined />} onClick={handleDownloadArtifact} size="large">
                    下载结果
                  </Button>
                  <Button icon={<CodeOutlined />} onClick={() => { /* View logic */ }} size="large">
                    查看源码
                  </Button>
                </Space>
              </Space>
            </div>
          </Card>
        )
      })
    }

    return (
      <div className="page-stack">
        <PageHero
          className="page-hero-compact studio-hero"
          eyebrow={
            <Space>
              <a onClick={() => navigate('/studio/runs')} style={{ color: 'inherit', cursor: 'pointer' }}>执行记录</a>
              <span>/</span>
              <span>详情</span>
            </Space>
          }
          title={selectedRun.label}
          description={selectedRun.taskPreview || '查看任务执行详情与结果。'}
          badges={[
            <Badge key="status" status={statusBadgeStatus(selectedRun.status)} text={statusLabel(selectedRun.status)} />,
            <Tag key="kind" bordered={false}>{selectedRun.kind === 'team' ? 'Team' : 'Agent'}</Tag>,
            selectedRun.teamId ? <Tag key="team" color="geekblue" bordered={false}>Team: {selectedRun.teamId}</Tag> : null
          ]}
          actions={(
            <Space>
              <Tooltip title="刷新状态">
                <Button onClick={() => void loadRunDetail(selectedRun.runId)} loading={loadingDetail} icon={<ReloadOutlined />} shape="circle" />
              </Tooltip>
              <Button
                icon={<PauseCircleOutlined />}
                danger
                onClick={() => void handleCancelRun()}
                loading={cancelling}
                disabled={!isCancelable(selectedRun.status)}
              >
                停止任务
              </Button>
            </Space>
          )}
        />

        <div className="page-content-wrapper" style={{ padding: '0 var(--nb-layout-gutter)' }}>
          <Tabs items={tabItems} defaultActiveKey="overview" type="card" className="commercial-tabs" />
        </div>
      </div>
    )
  }

  // List View
  return (
    <div className="page-stack">
      <PageHero
        className="page-hero-compact studio-hero"
        eyebrow="任务中心"
        title="执行记录"
        description="追踪 Agent 与团队协作任务的执行状态与历史。"
        stats={[
          { label: '总任务', value: runs.length },
          { label: '运行中', value: activeCount },
          { label: '异常终止', value: failedCount },
        ]}
        actions={(
          <Button icon={<ReloadOutlined />} onClick={() => void loadRuns()} loading={loadingRuns}>
            刷新列表
          </Button>
        )}
      />

      {error && <Alert type="error" showIcon message={error} style={{ margin: '0 var(--nb-layout-gutter)' }} />}

      <div className="page-content-wrapper" style={{ padding: '0 var(--nb-layout-gutter)' }}>
        <Card className="page-card" bordered={false} bodyStyle={{ padding: 0 }}>
          <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--nb-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Space>
              <Select
                value={statusFilter}
                onChange={setStatusFilter}
                style={{ width: 140 }}
                options={[
                  { value: 'all', label: '全部状态' },
                  { value: 'running', label: '运行中' },
                  { value: 'succeeded', label: '成功' },
                  { value: 'failed', label: '失败' },
                ]}
              />
              <Select
                value={kindFilter}
                onChange={setKindFilter}
                style={{ width: 140 }}
                options={[
                  { value: 'all', label: '全部类型' },
                  { value: 'agent', label: 'Agent' },
                  { value: 'team', label: 'Team' },
                ]}
              />
            </Space>
            {threadFilter && (
              <Tag closable onClose={() => {
                const next = new URLSearchParams(searchParams)
                next.delete('threadId')
                setSearchParams(next)
              }}>
                Thread: {threadFilter}
              </Tag>
            )}
          </div>

          <Table
            dataSource={runs}
            columns={columns}
            rowKey="runId"
            loading={loadingRuns}
            pagination={{ 
              pageSize: 15,
              showTotal: (total) => `共 ${total} 条记录`,
              showSizeChanger: false
            }}
            onRow={(record) => ({
              onClick: () => navigate(`/studio/runs/${record.runId}`),
              style: { cursor: 'pointer' }
            })}
          />
        </Card>
      </div>
    </div>
  )
}
