import { useEffect, useMemo, useState } from 'react'
import { Alert, App, Button, Card, Empty, List, Select, Space, Spin, Tag, Typography } from 'antd'
import { PauseCircleOutlined, ReloadOutlined } from '@ant-design/icons'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { api, ApiError } from '../api'
import PageHero from '../components/PageHero'
import { formatDateTimeZh } from '../locale'
import type {
  AgentRunSummary,
  AgentRunTreeNode,
  ChatMessage,
  RunArtifactDetail,
  TeamThreadSummary,
} from '../types'

const { Paragraph, Text } = Typography

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

function isActiveStatus(status: AgentRunSummary['status']) {
  return status === 'queued' || status === 'running' || status === 'cancel_requested'
}

function isCancelable(status: AgentRunSummary['status']) {
  return status === 'queued' || status === 'running'
}

function eventLabel(eventType: string) {
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
      return '已装配绑定能力'
    case 'knowledge_retrieved':
      return '已检索知识库'
    case 'team_run_requested':
      return '收到团队任务'
    case 'team_definition_resolved':
      return '已解析 TeamDefinition'
    case 'team_knowledge_retrieved':
      return '已检索团队共享知识'
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

function eventPayloadSummary(eventType: string, payload?: Record<string, unknown>) {
  if (!payload) {
    return null
  }
  switch (eventType) {
    case 'progress':
      return String(payload.content || '')
    case 'team_run_requested':
      return String(payload.contentPreview || '')
    case 'bindings_resolved':
      return [
        `tools: ${Array.isArray(payload.toolAllowlist) ? payload.toolAllowlist.length : 0}`,
        `mcp: ${Array.isArray(payload.mcpServerIds) ? payload.mcpServerIds.length : 0}`,
        `skills: ${Array.isArray(payload.skillIds) ? payload.skillIds.length : 0}`,
        `kb: ${Array.isArray(payload.knowledgeBindingIds) ? payload.knowledgeBindingIds.length : 0}`,
      ].join(' · ')
    case 'knowledge_retrieved':
    case 'team_knowledge_retrieved':
      return `mode: ${payload.effectiveMode || payload.requestedMode || 'keyword'} · hits: ${payload.hitCount || 0}`
    case 'team_definition_resolved':
      return [
        `workflow: ${payload.workflowMode || 'parallel_fanout'}`,
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
        `leader: ${payload.leaderRunId || 'n/a'}`,
        `members: ${Array.isArray(payload.memberRunIds) ? payload.memberRunIds.length : 0}`,
      ].join(' · ')
    default:
      return JSON.stringify(payload, null, 2)
  }
}

function renderTreeNode(node: AgentRunTreeNode, selectedRunId: string | null, navigate: ReturnType<typeof useNavigate>) {
  const children = node.children || []
  const active = node.runId === selectedRunId
  return (
    <div key={node.runId} className={`studio-run-tree-node ${active ? 'is-active' : ''}`}>
      <button
        type="button"
        className="studio-run-tree-button"
        onClick={() => navigate(`/studio/runs/${node.runId}`)}
      >
        <div className="studio-run-tree-head">
          <Space wrap>
            <strong>{node.label}</strong>
            <Tag>{node.kind}</Tag>
            <Tag color={statusColor(node.status)}>{node.status}</Tag>
          </Space>
          <Text type="secondary">{formatDateTimeZh(node.createdAt)}</Text>
        </div>
        <Paragraph className="studio-run-preview" ellipsis={{ rows: 2 }}>
          {node.resultSummary?.content || node.taskPreview}
        </Paragraph>
      </button>
      {children.length > 0 ? (
        <div className="studio-run-tree-children">
          {children.map((child) => renderTreeNode(child, selectedRunId, navigate))}
        </div>
      ) : null}
    </div>
  )
}

export default function RunsPage() {
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

  useEffect(() => {
    void loadRuns()
  }, [statusFilter, kindFilter, threadFilter])

  useEffect(() => {
    if (loadingRuns) {
      return
    }
    if (!selectedRunId && runs[0]) {
      navigate(`/studio/runs/${runs[0].runId}`, { replace: true })
      return
    }
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
  }, [loadingRuns, navigate, runs, selectedRunId])

  useEffect(() => {
    if (!selectedRunId || !selectedRun || !isActiveStatus(selectedRun.status)) {
      return
    }
    const timer = window.setInterval(() => {
      void loadRuns()
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

  return (
    <div className="page-stack">
      <PageHero
        className="page-hero-compact studio-hero"
        eyebrow="运行观测"
        title="Runs"
        description="当前已经覆盖 agent / subagent / 首版 team run。活动中的运行会自动刷新，方便直接追踪 leader/member fan-out、team thread 和回收汇总。"
        stats={[
          { label: '当前列表', value: runs.length },
          { label: '运行中', value: activeCount },
          { label: '失败', value: failedCount },
        ]}
        badges={[
          <Tag key="registry" color="processing">instance-scoped run registry</Tag>,
          <Tag key="runtime" color="geekblue">team root run + child runs</Tag>,
        ]}
        actions={(
          <Space wrap>
            <Button icon={<ReloadOutlined />} onClick={() => void loadRuns()} loading={loadingRuns}>
              刷新
            </Button>
          </Space>
        )}
      />

      {error ? <Alert type="error" showIcon message={error} /> : null}
      {threadFilter ? (
        <Alert
          type="info"
          showIcon
          message={`当前按 threadId 过滤：${threadFilter}`}
          action={(
            <Button
              size="small"
              onClick={() => {
                const next = new URLSearchParams(searchParams)
                next.delete('threadId')
                setSearchParams(next)
              }}
            >
              清除
            </Button>
          )}
        />
      ) : null}

      <div className="page-grid studio-runs-grid">
        <Card className="config-panel-card studio-runs-list-card">
          <div className="config-card-header">
            <div className="page-section-title">
              <Typography.Title level={4}>Run Catalog</Typography.Title>
              <Text type="secondary">按状态和类型筛选，优先看最近的运行。</Text>
            </div>
            <Tag color="blue">{runs.length}</Tag>
          </div>

          <div className="studio-form-grid studio-runs-filter-grid">
            <div className="studio-form-field">
              <Text type="secondary">状态</Text>
              <Select
                value={statusFilter}
                onChange={setStatusFilter}
                options={[
                  { value: 'all', label: '全部' },
                  { value: 'queued', label: 'queued' },
                  { value: 'running', label: 'running' },
                  { value: 'succeeded', label: 'succeeded' },
                  { value: 'failed', label: 'failed' },
                  { value: 'cancel_requested', label: 'cancel_requested' },
                  { value: 'cancelled', label: 'cancelled' },
                ]}
              />
            </div>

            <div className="studio-form-field">
              <Text type="secondary">类型</Text>
              <Select
                value={kindFilter}
                onChange={setKindFilter}
                options={[
                  { value: 'all', label: '全部' },
                  { value: 'agent', label: 'agent' },
                  { value: 'subagent', label: 'subagent' },
                  { value: 'team', label: 'team' },
                ]}
              />
            </div>
          </div>

          {loadingRuns ? (
            <div className="center-box">
              <Spin />
            </div>
          ) : runs.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前还没有符合条件的运行记录。" />
          ) : (
            <List
              className="studio-run-list studio-runs-master-list"
              dataSource={runs}
              renderItem={(run) => (
                <List.Item
                  className={`studio-agent-list-item ${selectedRunId === run.runId ? 'is-active' : ''}`}
                  onClick={() => navigate(`/studio/runs/${run.runId}`)}
                >
                  <div className="studio-agent-list-copy">
                    <div className="studio-run-list-head">
                      <Space wrap>
                        <strong>{run.label}</strong>
                        <Tag color={statusColor(run.status)}>{run.status}</Tag>
                        <Tag>{run.kind}</Tag>
                      </Space>
                      <Text type="secondary">{formatDateTimeZh(run.createdAt)}</Text>
                    </div>
                    <Paragraph className="studio-run-preview" ellipsis={{ rows: 2 }}>
                      {run.resultSummary?.content || run.taskPreview}
                    </Paragraph>
                    <div className="studio-agent-list-meta">
                      {run.agentId ? <Tag>{run.agentId}</Tag> : null}
                      {run.teamId ? <Tag>{run.teamId}</Tag> : null}
                      {typeof run.childrenCount === 'number' ? <Tag>{run.childrenCount} children</Tag> : null}
                    </div>
                    {run.lastErrorMessage ? <Text type="danger">{run.lastErrorMessage}</Text> : null}
                  </div>
                </List.Item>
              )}
            />
          )}
        </Card>

        <div className="page-stack">
          <Card className="config-panel-card" loading={loadingDetail}>
            <div className="config-card-header">
              <div className="page-section-title">
                <Typography.Title level={4}>{selectedRun ? selectedRun.label : 'Run Detail'}</Typography.Title>
                <Text type="secondary">查看当前 run 的状态、作用域、错误摘要和结果摘要。</Text>
              </div>
              {selectedRun ? <Tag color="purple">{selectedRun.runId}</Tag> : <Tag>未选择</Tag>}
            </div>

            {!selectedRun ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="从左侧选择一个运行记录查看详情。" />
            ) : (
              <div className="page-stack">
                <div className="studio-run-detail-grid">
                  <div className="studio-form-field">
                    <Text type="secondary">状态</Text>
                    <Tag color={statusColor(selectedRun.status)}>{selectedRun.status}</Tag>
                  </div>
                  <div className="studio-form-field">
                    <Text type="secondary">类型</Text>
                    <Tag>{selectedRun.kind}</Tag>
                  </div>
                  <div className="studio-form-field">
                    <Text type="secondary">Agent</Text>
                    <Text>{selectedRun.agentId || '未绑定'}</Text>
                  </div>
                  <div className="studio-form-field">
                    <Text type="secondary">Team</Text>
                    <Text>{selectedRun.teamId || '未绑定'}</Text>
                  </div>
                  <div className="studio-form-field">
                    <Text type="secondary">Session Key</Text>
                    <Text>{selectedRun.sessionKey || '无'}</Text>
                  </div>
                  <div className="studio-form-field">
                    <Text type="secondary">Thread</Text>
                    <Text>{selectedRun.threadId || '无'}</Text>
                  </div>
                  <div className="studio-form-field">
                    <Text type="secondary">Parent Run</Text>
                    <Text>{selectedRun.parentRunId || '无'}</Text>
                  </div>
                  <div className="studio-form-field">
                    <Text type="secondary">Root Run</Text>
                    <Text>{selectedRun.rootRunId || selectedRun.runId}</Text>
                  </div>
                  <div className="studio-form-field">
                    <Text type="secondary">控制作用域</Text>
                    <Text>{selectedRun.controlScope}</Text>
                  </div>
                  <div className="studio-form-field">
                    <Text type="secondary">Spawn Depth</Text>
                    <Text>{selectedRun.spawnDepth}</Text>
                  </div>
                </div>

                <div className="studio-form-field">
                  <Text type="secondary">任务摘要</Text>
                  <Paragraph className="studio-run-preview">{selectedRun.taskPreview}</Paragraph>
                </div>

                {selectedRun.resultSummary?.content ? (
                  <div className="studio-run-result">
                    <Text type="secondary">结果摘要</Text>
                    <Paragraph className="studio-result-copy">{selectedRun.resultSummary.content}</Paragraph>
                  </div>
                ) : null}

                {selectedRun.lastErrorMessage ? (
                  <Alert
                    type="error"
                    showIcon
                    message={selectedRun.lastErrorMessage}
                    description={selectedRun.lastErrorCode || undefined}
                  />
                ) : null}

                <div className="studio-form-actions">
                  <Space wrap>
                    <Button onClick={() => void loadRunDetail(selectedRun.runId)} loading={loadingDetail}>
                      刷新详情
                    </Button>
                    {selectedRun.teamId ? (
                      <Button onClick={() => navigate(`/studio/teams/${selectedRun.teamId}`)}>
                        查看 Team
                      </Button>
                    ) : null}
                    {selectedRun.rootRunId && selectedRun.rootRunId !== selectedRun.runId ? (
                      <Button onClick={() => navigate(`/studio/runs/${selectedRun.rootRunId}`)}>
                        跳到 Root Run
                      </Button>
                    ) : null}
                    {selectedRun.teamId ? (
                      <Button onClick={() => navigate(`/studio/memory/${selectedRun.teamId}`)}>
                        查看 Memory 审计
                      </Button>
                    ) : null}
                    <Button
                      icon={<PauseCircleOutlined />}
                      danger
                      onClick={() => void handleCancelRun()}
                      loading={cancelling}
                      disabled={!isCancelable(selectedRun.status)}
                    >
                      请求取消
                    </Button>
                  </Space>
                </div>
              </div>
            )}
          </Card>

          <div className="page-grid studio-runs-detail-grid">
            <Card className="config-panel-card">
              <div className="config-card-header">
                <div className="page-section-title">
                  <Typography.Title level={4}>Children</Typography.Title>
                  <Text type="secondary">直接子运行，方便先看这一层 fan-out。</Text>
                </div>
                <Tag>{children.length}</Tag>
              </div>

              {children.length === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前 run 没有直接 children。" />
              ) : (
                <List
                  className="studio-run-list"
                  dataSource={children}
                  renderItem={(item) => (
                    <List.Item className="studio-run-list-item" onClick={() => navigate(`/studio/runs/${item.runId}`)}>
                      <div className="studio-run-list-copy">
                        <div className="studio-run-list-head">
                          <Space wrap>
                            <strong>{item.label}</strong>
                            <Tag color={statusColor(item.status)}>{item.status}</Tag>
                            <Tag>{item.controlScope}</Tag>
                          </Space>
                          <Text type="secondary">{formatDateTimeZh(item.createdAt)}</Text>
                        </div>
                        <Paragraph className="studio-run-preview" ellipsis={{ rows: 2 }}>
                          {item.resultSummary?.content || item.taskPreview}
                        </Paragraph>
                      </div>
                    </List.Item>
                  )}
                />
              )}
            </Card>

            <Card className="config-panel-card">
              <div className="config-card-header">
                <div className="page-section-title">
                  <Typography.Title level={4}>Run Tree</Typography.Title>
                  <Text type="secondary">从 root run 回看 leader/member 结构，避免只看扁平列表。</Text>
                </div>
                {runTree ? <Tag>{runTree.runId}</Tag> : null}
              </div>

              {!runTree ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前还没有可展示的运行树。" />
              ) : (
                <div className="studio-run-tree">
                  {renderTreeNode(runTree, selectedRunId, navigate)}
                </div>
              )}
            </Card>
          </div>

          <Card className="config-panel-card">
            <div className="config-card-header">
              <div className="page-section-title">
                <Typography.Title level={4}>Thread Audit</Typography.Title>
                <Text type="secondary">把当前 team run 所属 thread 的最近消息拉到 Runs 内，方便直接核对线程上下文。</Text>
              </div>
              {threadSummary?.threadId ? <Tag color="cyan">{threadSummary.threadId}</Tag> : null}
            </div>

            {!selectedRun?.teamId || !selectedRun.threadId ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前 run 没有可审计的 team thread。" />
            ) : loadingThreadAudit ? (
              <div className="center-box">
                <Spin />
              </div>
            ) : threadMessages.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前 thread 还没有可回看的消息。" />
            ) : (
              <div className="page-stack">
                <div className="studio-form-actions">
                  <Space wrap>
                    <Button onClick={() => void loadRunDetail(selectedRun.runId)} loading={loadingDetail}>
                      刷新 Thread
                    </Button>
                    <Button onClick={() => navigate(`/studio/runs?threadId=${encodeURIComponent(selectedRun.threadId || '')}`)}>
                      按 Thread 过滤 Runs
                    </Button>
                  </Space>
                </div>
                <List
                  className="studio-run-list"
                  dataSource={threadMessages}
                  renderItem={(item) => (
                    <List.Item className="studio-run-list-item">
                      <div className="studio-run-list-copy">
                        <div className="studio-run-list-head">
                          <Space wrap>
                            <strong>{item.role === 'user' ? 'User Turn' : item.role === 'assistant' ? 'Team Reply' : item.role}</strong>
                            <Tag color={item.role === 'user' ? 'blue' : 'success'}>{item.role}</Tag>
                          </Space>
                          <Text type="secondary">{formatDateTimeZh(item.createdAt)}</Text>
                        </div>
                        <Paragraph className="studio-run-preview" ellipsis={{ rows: 3 }}>
                          {item.content}
                        </Paragraph>
                      </div>
                    </List.Item>
                  )}
                />
              </div>
            )}
          </Card>

          <Card className="config-panel-card">
            <div className="config-card-header">
              <div className="page-section-title">
                <Typography.Title level={4}>Event Timeline</Typography.Title>
                <Text type="secondary">活动中的 run 会自动刷新，适合直接追踪 team orchestration 的过程。</Text>
              </div>
              {selectedRun ? <Tag>{selectedRun.events?.length || 0}</Tag> : null}
            </div>

            {!selectedRun?.events?.length ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前 run 还没有事件记录。" />
            ) : (
              <List
                className="studio-event-list"
                dataSource={selectedRun.events}
                renderItem={(event) => (
                  <List.Item className="studio-run-list-item">
                    <div className="studio-run-list-copy">
                      <div className="studio-run-list-head">
                        <Space wrap>
                          <strong>{eventLabel(event.eventType)}</strong>
                          <Tag>{event.eventType}</Tag>
                        </Space>
                        <Text type="secondary">{formatDateTimeZh(event.createdAt)}</Text>
                      </div>
                      {eventPayloadSummary(event.eventType, event.payload) ? (
                        <Paragraph className="studio-run-preview">
                          {eventPayloadSummary(event.eventType, event.payload)}
                        </Paragraph>
                      ) : null}
                    </div>
                  </List.Item>
                )}
              />
            )}
          </Card>

          <Card className="config-panel-card">
            <div className="config-card-header">
              <div className="page-section-title">
                <Typography.Title level={4}>Run Artifact</Typography.Title>
                <Text type="secondary">把这次运行的关键结果归档成 Markdown，方便回看和导出。</Text>
              </div>
              {selectedRun?.artifactPath ? <Tag>{selectedRun.artifactPath}</Tag> : null}
            </div>

            {!selectedRun ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="先选择一个运行记录。" />
            ) : loadingArtifact ? (
              <div className="center-box">
                <Spin />
              </div>
            ) : !artifact ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前运行还没有可读取的 artifact。" />
            ) : (
              <div className="page-stack">
                <div className="studio-form-actions">
                  <Space wrap>
                    <Button onClick={() => void loadRunDetail(selectedRun.runId)} loading={loadingDetail}>
                      刷新 Artifact
                    </Button>
                    <Button onClick={handleDownloadArtifact}>
                      下载 Markdown
                    </Button>
                  </Space>
                </div>
                <pre className="studio-artifact-preview">{artifact.content}</pre>
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}
