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
  ApartmentOutlined,
  ReloadOutlined,
  SearchOutlined,
} from '@ant-design/icons'
import { useNavigate, useParams } from 'react-router-dom'
import { api, ApiError } from '../api'
import PageHero from '../components/PageHero'
import { formatDateTimeZh } from '../locale'
import type {
  AgentRunSummary,
  MemoryCandidate,
  MemorySearchHit,
  MemorySourceDetail,
  TeamDefinition,
  TeamMemorySnapshot,
  TeamThreadMessages,
  TeamThreadSummary,
} from '../types'

const { Text, Paragraph } = Typography

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof ApiError) {
    return error.message
  }
  if (error instanceof Error && error.message) {
    return error.message
  }
  return fallback
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
  const { message } = App.useApp()
  const navigate = useNavigate()
  const { teamId } = useParams()
  const selectedTeamId = teamId || null

  const [teams, setTeams] = useState<TeamDefinition[]>([])
  const [currentTeam, setCurrentTeam] = useState<TeamDefinition | null>(null)
  const [teamMemory, setTeamMemory] = useState<TeamMemorySnapshot | null>(null)
  const [memoryCandidates, setMemoryCandidates] = useState<MemoryCandidate[]>([])
  const [teamThread, setTeamThread] = useState<TeamThreadSummary | null>(null)
  const [teamThreadMessages, setTeamThreadMessages] = useState<TeamThreadMessages['messages']>([])
  const [recentRuns, setRecentRuns] = useState<AgentRunSummary[]>([])
  const [memorySearchQuery, setMemorySearchQuery] = useState('impact clearly')
  const [memorySearchMode, setMemorySearchMode] = useState('hybrid')
  const [memorySearchEffectiveMode, setMemorySearchEffectiveMode] = useState<string | null>(null)
  const [memorySearchResults, setMemorySearchResults] = useState<MemorySearchHit[]>([])
  const [selectedMemorySource, setSelectedMemorySource] = useState<MemorySourceDetail | null>(null)
  const [candidateStatusFilter, setCandidateStatusFilter] = useState('all')
  const [activePanel, setActivePanel] = useState<'overview' | 'candidates' | 'search'>('overview')
  const [loadingWorkspace, setLoadingWorkspace] = useState(true)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searchError, setSearchError] = useState<string | null>(null)

  useEffect(() => {
    void loadWorkspace()
  }, [])

  useEffect(() => {
    if (loadingWorkspace) {
      return
    }
    if (!selectedTeamId && teams[0]) {
      navigate(`/studio/memory/${teams[0].teamId}`, { replace: true })
      return
    }
    if (!selectedTeamId) {
      setCurrentTeam(null)
      setTeamMemory(null)
      setMemoryCandidates([])
      setTeamThread(null)
      setTeamThreadMessages([])
      setRecentRuns([])
      setMemorySearchResults([])
      setSelectedMemorySource(null)
      return
    }
    void loadAudit(selectedTeamId)
  }, [loadingWorkspace, navigate, selectedTeamId, teams])

  useEffect(() => {
    setActivePanel('overview')
  }, [selectedTeamId])

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

  async function loadWorkspace() {
    try {
      setLoadingWorkspace(true)
      const teamList = await api.getTeams()
      setTeams(teamList)
      setError(null)
    } catch (loadError) {
      setError(getErrorMessage(loadError, '加载团队列表失败'))
    } finally {
      setLoadingWorkspace(false)
    }
  }

  async function loadAudit(nextTeamId: string) {
    try {
      setLoadingDetail(true)
      const [team, memory, candidates, thread, threadMessages, runs] = await Promise.all([
        api.getTeam(nextTeamId),
        api.getTeamMemory(nextTeamId),
        api.getMemoryCandidates({ teamId: nextTeamId, limit: 100 }),
        api.getTeamThread(nextTeamId),
        api.getTeamThreadMessages(nextTeamId, 12),
        api.getRuns({ teamId: nextTeamId, limit: 12 }),
      ])
      setCurrentTeam(team)
      setTeamMemory(memory)
      setMemoryCandidates(candidates.items)
      setTeamThread(thread)
      setTeamThreadMessages(threadMessages.messages)
      setRecentRuns(runs.items)
      setSelectedMemorySource(null)
      setMemorySearchEffectiveMode(null)
      setSearchError(null)
      setError(null)
    } catch (loadError) {
      setError(getErrorMessage(loadError, '加载记忆审计详情失败'))
    } finally {
      setLoadingDetail(false)
    }
  }

  async function handleApplyCandidate(candidateId: string) {
    if (!currentTeam) {
      return
    }
    try {
      await api.applyMemoryCandidate(candidateId)
      message.success('候选记忆已应用')
      await loadAudit(currentTeam.teamId)
    } catch (applyError) {
      setError(getErrorMessage(applyError, '应用候选记忆失败'))
    }
  }

  async function handleRejectCandidate(candidateId: string) {
    if (!currentTeam) {
      return
    }
    try {
      await api.rejectMemoryCandidate(candidateId)
      message.success('候选记忆已标记为忽略')
      await loadAudit(currentTeam.teamId)
    } catch (rejectError) {
      setError(getErrorMessage(rejectError, '忽略候选记忆失败'))
    }
  }

  async function handleSearch() {
    if (!currentTeam) {
      setSearchError('请先选择 Team。')
      return
    }
    if (!memorySearchQuery.trim()) {
      setSearchError('请输入检索关键词。')
      return
    }
    try {
      setSearching(true)
      const result = await api.searchMemory({
        query: memorySearchQuery.trim(),
        teamId: currentTeam.teamId,
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
    if (!currentTeam) {
      return
    }
    try {
      const source = await api.getMemorySource({
        sourceType,
        sourceId,
        teamId: currentTeam.teamId,
      })
      setSelectedMemorySource(source)
    } catch (sourceError) {
      setSearchError(getErrorMessage(sourceError, '加载记忆源失败'))
    }
  }

  if (loadingWorkspace && teams.length === 0 && !selectedTeamId) {
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
        title="团队记忆审计"
        actions={(
          <Space wrap>
            <Button icon={<ReloadOutlined />} onClick={() => void loadWorkspace()} loading={loadingWorkspace}>
              刷新团队
            </Button>
            {currentTeam ? (
              <Button onClick={() => navigate(`/studio/teams/${currentTeam.teamId}`)}>
                返回 Team 配置
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
              <Typography.Title level={4}>团队列表</Typography.Title>
            </div>
            <Tag color="blue">{teams.length}</Tag>
          </div>

          {teams.length === 0 ? (
            <Empty image={false} description="暂无 Team">
              <Button type="primary" onClick={() => navigate('/studio/teams/new')}>
                创建第一个 Team
              </Button>
            </Empty>
          ) : (
            <List
              className="studio-agent-list"
              dataSource={teams}
              renderItem={(item) => (
                <List.Item
                  className={`studio-agent-list-item ${selectedTeamId === item.teamId ? 'is-active' : ''}`}
                  onClick={() => navigate(`/studio/memory/${item.teamId}`)}
                >
                  <div className="studio-agent-list-copy">
                    <div className="studio-agent-list-head">
                      <Space size={8}>
                        <ApartmentOutlined />
                        <strong>{item.name}</strong>
                      </Space>
                      <Tag color={item.enabled ? 'success' : 'default'}>{item.enabled ? '启用' : '停用'}</Tag>
                    </div>
                    <div className="studio-agent-list-meta">
                      <Tag>{item.memberCount} 位成员</Tag>
                      <Tag>{item.enabled ? '可审计' : '已停用'}</Tag>
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
                <Typography.Title level={4}>{currentTeam ? currentTeam.name : '审计概览'}</Typography.Title>
              </div>
              {currentTeam ? <Tag color="purple">{currentTeam.teamId}</Tag> : <Tag>未选择</Tag>}
            </div>

            {!currentTeam ? (
              <Empty image={false} description="请选择 Team" />
            ) : (
              <Space wrap className="studio-chip-wrap">
                <Tag>{currentTeam.memberCount} 位成员</Tag>
                <Tag>{pendingCount} 待审</Tag>
                <Tag>{appliedCount} 已应用</Tag>
                {latestRun ? <Tag color={statusColor(latestRun.status)}>{latestRun.status}</Tag> : null}
              </Space>
            )}
          </Card>

          {currentTeam ? (
            <>
              <Tabs
                activeKey={activePanel}
                onChange={(value) => setActivePanel(value as 'overview' | 'candidates' | 'search')}
                items={[
                  { key: 'overview', label: '概览' },
                  { key: 'candidates', label: '候选审核' },
                  { key: 'search', label: '检索取证' },
                ]}
              />

              {activePanel === 'overview' ? (
                <>
                  <div className="page-grid studio-knowledge-detail-grid">
                    <Card className="config-panel-card" loading={loadingDetail}>
                      <div className="config-card-header">
                        <div className="page-section-title">
                          <Typography.Title level={4}>共享记忆概览</Typography.Title>
                        </div>
                        <Tag color="purple">{teamMemory?.candidateCount ?? pendingCount} 候选</Tag>
                      </div>

                      <Paragraph className="studio-result-copy">
                        {teamMemory?.content?.trim() || '当前 Team Shared Memory 为空。'}
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

                  <Card className="config-panel-card" loading={loadingDetail}>
                    <div className="config-card-header">
                      <div className="page-section-title">
                        <Typography.Title level={4}>最近对话</Typography.Title>
                      </div>
                      {teamThread ? <Tag color="cyan">{teamThread.session.messageCount} 条消息</Tag> : null}
                    </div>

                    {teamThreadMessages.length === 0 ? (
                      <Empty image={false} description="暂无对话" />
                    ) : (
                      <List
                        className="studio-run-list"
                        dataSource={teamThreadMessages}
                        renderItem={(item) => (
                          <List.Item className="studio-run-list-item">
                            <div className="studio-run-list-copy">
                              <div className="studio-run-list-head">
                                <Space wrap>
                                  <strong>{item.role === 'user' ? '用户消息' : '团队回复'}</strong>
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
                    )}
                  </Card>
                </>
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
                              <Text type="secondary">{candidate.agentId || 'unknown-agent'} · {candidate.runId || 'no-run-id'}</Text>
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
                        <Typography.Title level={4}>上下文参考</Typography.Title>
                      </div>
                      {selectedMemorySource ? <Tag color="purple">{selectedMemorySource.sourceType}</Tag> : <Tag>最近对话</Tag>}
                    </div>

                    {selectedMemorySource ? (
                      <div className="studio-run-result">
                        <Space wrap>
                          <Tag color="purple">{selectedMemorySource.sourceType}</Tag>
                          <Text type="secondary">{selectedMemorySource.title}</Text>
                        </Space>
                        <Paragraph className="studio-result-copy">{selectedMemorySource.content}</Paragraph>
                      </div>
                    ) : teamThreadMessages.length === 0 ? (
                      <Empty image={false} description="点击“查看全文”后显示原文" />
                    ) : (
                      <List
                        className="studio-run-list"
                        dataSource={teamThreadMessages.slice(0, 6)}
                        renderItem={(item) => (
                          <List.Item className="studio-run-list-item">
                            <div className="studio-run-list-copy">
                              <div className="studio-run-list-head">
                                <Space wrap>
                                  <strong>{item.role === 'user' ? '用户消息' : '团队回复'}</strong>
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
                    )}
                  </Card>
                </div>
              ) : null}

              {activePanel === 'search' ? (
                <Card className="config-panel-card" loading={loadingDetail}>
                  <div className="config-card-header">
                    <div className="page-section-title">
                      <Typography.Title level={4}>记忆检索</Typography.Title>
                    </div>
                    <Tag color="blue">{currentTeam.name}</Tag>
                  </div>

                  <div className="studio-form-field">
                    <Text type="secondary">检索关键词</Text>
                    <Space wrap>
                      <Input
                        value={memorySearchQuery}
                        onChange={(event) => setMemorySearchQuery(event.target.value)}
                        placeholder="例如：impact clearly、follow-up context、escalation artifact"
                        disabled={!currentTeam}
                      />
                      <Button icon={<SearchOutlined />} onClick={() => void handleSearch()} loading={searching} disabled={!currentTeam}>
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
                    <Text type="secondary">
                      {memorySearchEffectiveMode ? `当前：${memorySearchEffectiveMode}` : '选择检索模式'}
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

                      {selectedMemorySource ? (
                        <div className="studio-run-result">
                          <Space wrap>
                            <Tag color="purple">{selectedMemorySource.sourceType}</Tag>
                            <Text type="secondary">{selectedMemorySource.title}</Text>
                          </Space>
                          <Paragraph className="studio-result-copy">{selectedMemorySource.content}</Paragraph>
                        </div>
                      ) : (
                        <Empty image={false} description="选择结果后显示全文" />
                      )}
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
