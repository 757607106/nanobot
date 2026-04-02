import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  App,
  Button,
  Card,
  Empty,
  Input,
  List,
  Segmented,
  Space,
  Spin,
  Tag,
  Tabs,
  Typography,
} from 'antd'
import {
  ReloadOutlined,
  RobotOutlined,
  SearchOutlined,
} from '@ant-design/icons'
import { useNavigate, useParams } from 'react-router-dom'
import { api } from '../api'
import { getErrorMessage } from '../components/AsyncContent'
import PageHero from '../components/PageHero'
import { formatDateTimeZh } from '../locale'
import type {
  AgentDefinition,
  AgentMemorySnapshot,
  AgentRunSummary,
  MemoryCandidate,
  MemorySearchHit,
  MemorySourceDetail,
} from '../types'

const { Text, Paragraph } = Typography

type AuditPanel = 'overview' | 'candidates' | 'search'

const agentMemoryScopeLabels: Record<string, string> = {
  agent_profile: '员工自身',
  workspace_shared: '工作区共享',
}


function statusColor(status: string) {
  if (status === 'applied' || status === 'succeeded') {
    return 'success'
  }
  if (status === 'rejected' || status === 'cancelled') {
    return 'default'
  }
  if (status === 'failed' || status === 'timed_out') {
    return 'error'
  }
  if (status === 'proposed' || status === 'running' || status === 'queued') {
    return 'processing'
  }
  return 'default'
}

export default function MemoryAuditPage() {
  const { message, modal } = App.useApp()
  const navigate = useNavigate()
  const { agentId } = useParams()
  const selectedAgentId = agentId || null

  const [agents, setAgents] = useState<AgentDefinition[]>([])
  const [currentAgent, setCurrentAgent] = useState<AgentDefinition | null>(null)
  const [agentMemory, setAgentMemory] = useState<AgentMemorySnapshot | null>(null)
  const [memoryCandidates, setMemoryCandidates] = useState<MemoryCandidate[]>([])
  const [recentRuns, setRecentRuns] = useState<AgentRunSummary[]>([])
  const [memorySearchQuery, setMemorySearchQuery] = useState('impact clearly')
  const [memorySearchMode, setMemorySearchMode] = useState('hybrid')
  const [memorySearchEffectiveMode, setMemorySearchEffectiveMode] = useState<string | null>(null)
  const [memorySearchResults, setMemorySearchResults] = useState<MemorySearchHit[]>([])
  const [selectedMemorySource, setSelectedMemorySource] = useState<MemorySourceDetail | null>(null)
  const [candidateStatusFilter, setCandidateStatusFilter] = useState('all')
  const [activePanel, setActivePanel] = useState<AuditPanel>('overview')
  const [loadingWorkspace, setLoadingWorkspace] = useState(true)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searchError, setSearchError] = useState<string | null>(null)

  const pendingCount = useMemo(
    () => memoryCandidates.filter((item) => item.status === 'proposed').length,
    [memoryCandidates],
  )
  const filteredCandidates = useMemo(() => {
    if (candidateStatusFilter === 'all') {
      return memoryCandidates
    }
    return memoryCandidates.filter((item) => item.status === candidateStatusFilter)
  }, [candidateStatusFilter, memoryCandidates])
  const appliedCount = useMemo(
    () => memoryCandidates.filter((item) => item.status === 'applied').length,
    [memoryCandidates],
  )
  const latestRun = recentRuns[0] ?? null

  useEffect(() => {
    void loadWorkspace()
  }, [])

  useEffect(() => {
    if (loadingWorkspace) {
      return
    }
    if (!selectedAgentId && agents[0]) {
      navigate(`/studio/memory/agents/${agents[0].agentId}`, { replace: true })
      return
    }
    if (!selectedAgentId) {
      resetAuditState()
      return
    }
    void loadAgentAudit(selectedAgentId)
  }, [agents, loadingWorkspace, navigate, selectedAgentId])

  useEffect(() => {
    setActivePanel('overview')
  }, [selectedAgentId])

  function resetAuditState() {
    setCurrentAgent(null)
    setAgentMemory(null)
    setMemoryCandidates([])
    setRecentRuns([])
    setMemorySearchResults([])
    setSelectedMemorySource(null)
    setMemorySearchEffectiveMode(null)
    setSearchError(null)
  }

  async function loadWorkspace() {
    try {
      setLoadingWorkspace(true)
      const agentList = await api.getAgents()
      setAgents(agentList)
      setError(null)
    } catch (loadError) {
      setError(getErrorMessage(loadError, '加载记忆审计目录失败'))
    } finally {
      setLoadingWorkspace(false)
    }
  }

  async function loadAgentAudit(nextAgentId: string) {
    try {
      setLoadingDetail(true)
      const [agent, memory, candidates, runs] = await Promise.all([
        api.getAgent(nextAgentId),
        api.getAgentMemory(nextAgentId),
        api.getMemoryCandidates({ agentId: nextAgentId, scope: 'agent_profile', limit: 100 }),
        api.getRuns({ agentId: nextAgentId, kind: 'agent', limit: 12 }),
      ])
      setCurrentAgent(agent)
      setAgentMemory(memory)
      setMemoryCandidates(candidates.items)
      setRecentRuns(runs.items)
      setSelectedMemorySource(null)
      setMemorySearchEffectiveMode(null)
      setSearchError(null)
      setError(null)
    } catch (loadError) {
      setError(getErrorMessage(loadError, '加载员工记忆审计详情失败'))
    } finally {
      setLoadingDetail(false)
    }
  }

  async function handleApplyCandidate(candidateId: string) {
    try {
      await api.applyMemoryCandidate(candidateId)
      message.success('候选记忆已应用')
      if (currentAgent) {
        await loadAgentAudit(currentAgent.agentId)
      }
    } catch (applyError) {
      setError(getErrorMessage(applyError, '应用候选记忆失败'))
    }
  }

  async function handleRejectCandidate(candidateId: string) {
    modal.confirm({
      title: '忽略候选记忆',
      content: '确定要忽略此候选记忆吗？忽略后该条目将不再出现在待审列表中。',
      okText: '忽略',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        try {
          await api.rejectMemoryCandidate(candidateId)
          message.success('候选记忆已标记为忽略')
          if (currentAgent) {
            await loadAgentAudit(currentAgent.agentId)
          }
        } catch (rejectError) {
          setError(getErrorMessage(rejectError, '忽略候选记忆失败'))
        }
      },
    })
  }

  async function handleSearch() {
    if (!memorySearchQuery.trim()) {
      setSearchError('请输入员工检索关键词。')
      return
    }
    try {
      setSearching(true)
      const result = await api.searchMemory({
        query: memorySearchQuery.trim(),
        agentId: currentAgent?.agentId,
        limit: 12,
        mode: memorySearchMode,
      })
      setMemorySearchResults(result.items)
      setMemorySearchEffectiveMode(result.effectiveMode)
      setSelectedMemorySource(null)
      setSearchError(null)
    } catch (searchValueError) {
      setSearchError(getErrorMessage(searchValueError, '执行记忆检索失败'))
    } finally {
      setSearching(false)
    }
  }

  async function handlePreviewSource(sourceType: string, sourceId: string) {
    try {
      const source = await api.getMemorySource({
        sourceType,
        sourceId,
        agentId: currentAgent?.agentId,
      })
      setSelectedMemorySource(source)
    } catch (sourceError) {
      setSearchError(getErrorMessage(sourceError, '加载记忆源失败'))
    }
  }

  function handleSelectEntity(id: string) {
    navigate(`/studio/memory/agents/${id}`)
  }

  function renderSourcePreview(emptyText: string, fallbackContent?: string | null) {
    if (selectedMemorySource) {
      return (
        <div className="studio-run-result">
          <Space wrap>
            <Tag color="purple">{selectedMemorySource.sourceType}</Tag>
            <Text type="secondary">{selectedMemorySource.title}</Text>
          </Space>
          <Paragraph className="studio-result-copy">{selectedMemorySource.content}</Paragraph>
        </div>
      )
    }
    if (fallbackContent?.trim()) {
      return <Paragraph className="studio-result-copy">{fallbackContent}</Paragraph>
    }
    return <Empty image={false} description={emptyText} />
  }

  if (loadingWorkspace && agents.length === 0 && !selectedAgentId) {
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
        title="统一记忆审计"
        actions={(
          <Space wrap>
            <Button icon={<ReloadOutlined />} onClick={() => void loadWorkspace()} loading={loadingWorkspace}>
              刷新目录
            </Button>
            {currentAgent ? (
              <Button onClick={() => navigate(`/studio/agents/${currentAgent.agentId}`)}>
                返回员工配置
              </Button>
            ) : null}
          </Space>
        )}
      />

      {error ? <Alert type="error" showIcon message={error} /> : null}

      <div className="page-grid studio-agents-grid">
        <Card className="config-panel-card studio-agent-list-card">
          <div className="config-card-header">
            <div className="page-section-title">
              <Typography.Title level={4}>员工列表</Typography.Title>
            </div>
            <Tag color="blue">{agents.length}</Tag>
          </div>

          {agents.length === 0 ? (
            <Empty image={false} description="暂无员工">
              <Button type="primary" onClick={() => navigate('/studio/agents/new')}>
                创建第一个员工
              </Button>
            </Empty>
          ) : (
            <List
              className="studio-agent-list"
              dataSource={agents}
              renderItem={(item) => (
                <List.Item
                  className={`studio-agent-list-item ${selectedAgentId === item.agentId ? 'is-active' : ''}`}
                  onClick={() => handleSelectEntity(item.agentId)}
                >
                  <div className="studio-agent-list-copy">
                    <div className="studio-agent-list-head">
                      <Space size={8}>
                        <RobotOutlined />
                        <strong>{item.name}</strong>
                      </Space>
                      <Tag color={item.enabled ? 'success' : 'default'}>{item.enabled ? '启用' : '停用'}</Tag>
                    </div>
                    <div className="studio-agent-list-meta">
                      <Tag>{item.toolAllowlist.length} 个工具</Tag>
                      <Tag>{agentMemoryScopeLabels[item.memoryScope] || item.memoryScope}</Tag>
                    </div>
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
                <Typography.Title level={4}>{currentAgent?.name || '审计概览'}</Typography.Title>
              </div>
              {currentAgent?.agentId ? <Tag color="purple">{currentAgent.agentId}</Tag> : <Tag>未选择</Tag>}
            </div>

            {!currentAgent ? (
              <Empty image={false} description="请选择员工" />
            ) : (
              <Space wrap className="studio-chip-wrap">
                <Tag>{agentMemoryScopeLabels[currentAgent.memoryScope] || currentAgent.memoryScope}</Tag>
                <Tag>{pendingCount} 待审</Tag>
                <Tag>{appliedCount} 已应用</Tag>
                {latestRun ? <Tag color={statusColor(latestRun.status)}>{latestRun.status}</Tag> : null}
              </Space>
            )}
          </Card>

          {currentAgent ? (
            <>
              <Tabs
                activeKey={activePanel}
                onChange={(value) => setActivePanel(value as AuditPanel)}
                items={[
                  { key: 'overview', label: '概览' },
                  { key: 'candidates', label: '候选审核' },
                  { key: 'search', label: '检索取证' },
                ]}
              />

              {activePanel === 'overview' ? (
                <div className="page-grid studio-knowledge-detail-grid">
                  <Card className="config-panel-card" loading={loadingDetail}>
                    <div className="config-card-header">
                      <div className="page-section-title">
                        <Typography.Title level={4}>员工记忆概览</Typography.Title>
                      </div>
                      <Tag color="purple">{agentMemory?.candidateCount ?? pendingCount} 候选</Tag>
                    </div>

                    <Paragraph className="studio-result-copy">
                      {agentMemory?.content?.trim() || '当前 Agent Profile Memory 为空。'}
                    </Paragraph>
                  </Card>

                  <Card className="config-panel-card" loading={loadingDetail}>
                    <div className="config-card-header">
                      <div className="page-section-title">
                        <Typography.Title level={4}>最近执行</Typography.Title>
                      </div>
                      <Tag>{recentRuns.length}</Tag>
                    </div>

                    {recentRuns.length === 0 ? (
                      <Empty image={false} description="暂无运行记录" />
                    ) : (
                      <List
                        className="studio-run-list"
                        dataSource={recentRuns.slice(0, 5)}
                        renderItem={(run) => (
                          <List.Item className="studio-run-list-item">
                            <div className="studio-run-list-copy">
                              <div className="studio-run-list-head">
                                <Space wrap>
                                  <strong>{run.label}</strong>
                                  <Tag color={statusColor(run.status)}>{run.status}</Tag>
                                  <Tag>{run.kind}</Tag>
                                </Space>
                                <Text type="secondary">{run.createdAt ? formatDateTimeZh(run.createdAt) : '未记录时间'}</Text>
                              </div>
                              <Paragraph className="studio-run-preview" ellipsis={{ rows: 2 }}>
                                {run.taskPreview}
                              </Paragraph>
                              <Space wrap>
                                <Button size="small" onClick={() => navigate(`/studio/runs/${run.runId}`)}>
                                  查看 Run
                                </Button>
                                {run.threadId ? (
                                  <Button size="small" onClick={() => navigate(`/studio/runs?threadId=${encodeURIComponent(String(run.threadId))}`)}>
                                    查看 Thread Runs
                                  </Button>
                                ) : null}
                              </Space>
                            </div>
                          </List.Item>
                        )}
                      />
                    )}
                  </Card>
                </div>
              ) : null}

              {activePanel === 'candidates' ? (
                <div className="page-grid studio-knowledge-detail-grid">
                  <Card className="config-panel-card" loading={loadingDetail}>
                    <div className="config-card-header">
                      <div className="page-section-title">
                        <Typography.Title level={4}>候选记录</Typography.Title>
                      </div>
                      <Tag color={pendingCount > 0 ? 'processing' : 'default'}>{filteredCandidates.length}/{memoryCandidates.length}</Tag>
                    </div>

                    <Segmented
                      block
                      value={candidateStatusFilter}
                      onChange={(value) => setCandidateStatusFilter(String(value))}
                      options={[
                        { label: '全部', value: 'all' },
                        { label: '待审', value: 'proposed' },
                        { label: '已应用', value: 'applied' },
                        { label: '已忽略', value: 'rejected' },
                      ]}
                    />

                    {filteredCandidates.length === 0 ? (
                      <Empty image={false} description="暂无候选记忆" />
                    ) : (
                      <List
                        className="studio-run-list"
                        dataSource={filteredCandidates}
                        renderItem={(candidate) => (
                          <List.Item className="studio-run-list-item">
                            <div className="studio-run-list-copy">
                              <div className="studio-run-list-head">
                                <Space wrap>
                                  <strong>{candidate.title}</strong>
                                  <Tag color={statusColor(candidate.status)}>{candidate.status}</Tag>
                                </Space>
                                <Text type="secondary">{candidate.updatedAt ? formatDateTimeZh(candidate.updatedAt) : '未记录时间'}</Text>
                              </div>
                              <Paragraph className="studio-run-preview" ellipsis={{ rows: 3 }}>
                                {candidate.content}
                              </Paragraph>
                              <Text type="secondary">
                                {candidate.agentId || 'unknown-source'} · {candidate.runId || 'no-run-id'}
                              </Text>
                              <Space wrap>
                                <Button size="small" onClick={() => void handlePreviewSource('memory_candidate', candidate.candidateId)}>
                                  查看全文
                                </Button>
                                {candidate.status === 'proposed' ? (
                                  <Button size="small" onClick={() => void handleApplyCandidate(candidate.candidateId)}>
                                    应用
                                  </Button>
                                ) : null}
                                {candidate.status === 'proposed' ? (
                                  <Button size="small" danger onClick={() => void handleRejectCandidate(candidate.candidateId)}>
                                    忽略
                                  </Button>
                                ) : null}
                              </Space>
                            </div>
                          </List.Item>
                        )}
                      />
                    )}
                  </Card>

                  <Card className="config-panel-card" loading={loadingDetail}>
                    <div className="config-card-header">
                      <div className="page-section-title">
                        <Typography.Title level={4}>当前记忆</Typography.Title>
                      </div>
                      {selectedMemorySource ? <Tag color="purple">{selectedMemorySource.sourceType}</Tag> : <Tag>员工记忆</Tag>}
                    </div>

                    {renderSourcePreview('当前员工记忆为空，点击候选或搜索结果后可查看全文。', agentMemory?.content)}
                  </Card>
                </div>
              ) : null}

              {activePanel === 'search' ? (
                <Card className="config-panel-card" loading={loadingDetail}>
                  <div className="config-card-header">
                    <div className="page-section-title">
                      <Typography.Title level={4}>记忆检索</Typography.Title>
                    </div>
                    {currentAgent ? <Tag color="blue">{currentAgent.name}</Tag> : null}
                  </div>

                  <div className="studio-form-field">
                    <Text type="secondary">检索关键词</Text>
                    <Space wrap>
                      <Input
                        value={memorySearchQuery}
                        onChange={(event) => setMemorySearchQuery(event.target.value)}
                        placeholder="例如：numbered remediation steps、operator summary style"
                        disabled={!currentAgent}
                      />
                      <Button icon={<SearchOutlined />} onClick={() => void handleSearch()} loading={searching} disabled={!currentAgent}>
                        检索
                      </Button>
                    </Space>
                  </div>

                  <div className="studio-form-field">
                    <Text type="secondary">检索模式</Text>
                    <Segmented
                      block
                      value={memorySearchMode}
                      onChange={(value) => setMemorySearchMode(String(value))}
                      options={[
                        { label: '标准', value: 'keyword' },
                        { label: '平衡', value: 'hybrid' },
                        { label: '深度', value: 'semantic' },
                      ]}
                    />
                    <Text type="secondary" style={{ fontSize: 12, lineHeight: 1.6 }}>
                      {memorySearchMode === 'keyword'
                        ? '标准模式：基于关键词精确匹配，速度最快，适合已知确切术语的查找。'
                        : memorySearchMode === 'hybrid'
                          ? '平衡模式：结合关键词与语义向量检索，兼顾精确度和召回率（推荐）。'
                          : '深度模式：纯语义向量检索，擅长理解含义相近但措辞不同的内容，速度较慢。'}
                      {memorySearchEffectiveMode ? ` 实际生效：${memorySearchEffectiveMode}` : ''}
                    </Text>
                  </div>

                  {searchError ? <Alert type="error" showIcon message={searchError} /> : null}

                  <div className="page-grid studio-knowledge-detail-grid">
                    <Card className="config-panel-card">
                      <div className="page-section-title">
                        <Typography.Title level={5}>Search Hits</Typography.Title>
                      </div>

                      {memorySearchResults.length === 0 ? (
                        <Empty image={false} description="暂无检索结果" />
                      ) : (
                        <List
                          className="studio-run-list"
                          dataSource={memorySearchResults}
                          renderItem={(item) => (
                            <List.Item className="studio-run-list-item">
                              <div className="studio-run-list-copy">
                                <div className="studio-run-list-head">
                                  <Space wrap>
                                    <strong>{item.title}</strong>
                                    <Tag color="blue">score {item.score}</Tag>
                                    <Tag>{item.sourceType}</Tag>
                                  </Space>
                                </div>
                                <Paragraph className="studio-run-preview" ellipsis={{ rows: 3 }}>
                                  {item.preview}
                                </Paragraph>
                                <Button size="small" onClick={() => void handlePreviewSource(item.sourceType, item.sourceId)}>
                                  查看全文
                                </Button>
                              </div>
                            </List.Item>
                          )}
                        />
                      )}
                    </Card>

                    <Card className="config-panel-card">
                      <div className="page-section-title">
                        <Typography.Title level={5}>Source Preview</Typography.Title>
                      </div>

                      {renderSourcePreview('选择结果后显示全文')}
                    </Card>
                  </div>
                </Card>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    </div>
  )
}
