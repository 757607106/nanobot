import { useEffect, useState } from 'react'
import { ReloadOutlined } from '@ant-design/icons'
import { Alert, Button, Flex, Modal, Space, Spin, Tabs, Tag, Typography } from 'antd'
import { useNavigate, useParams } from 'react-router-dom'
import { api } from '../../api'
import PageHeader from '../../components/console/PageHeader'
import { getErrorMessage } from '../../errorMessage'
import { formatDateTimeZh } from '../../locale'
import type {
  AgentDefinition,
  AgentMemorySnapshot,
  AgentRunSummary,
  MemoryCandidate,
  MemorySearchHit,
  MemorySourceDetail,
} from '../../types'
import AgentList from './AgentList'
import MemoryMetrics from './MemoryMetrics'
import OverviewPanel from './OverviewPanel'
import CandidatePanel from './CandidatePanel'
import SearchPanel from './SearchPanel'
import { scopeLabel, statusColor } from './types'
import type { AuditPanel } from './types'
import SectionCard from '../../components/console/SectionCard'
import { useToast } from '../../toast'

export default function MemoryAuditPage() {
  const message = useToast()
  const navigate = useNavigate()
  const { agentId } = useParams()
  const selectedAgentId = agentId || null

  const [agents, setAgents] = useState<AgentDefinition[]>([])
  const [currentAgent, setCurrentAgent] = useState<AgentDefinition | null>(null)
  const [agentMemory, setAgentMemory] = useState<AgentMemorySnapshot | null>(null)
  const [memoryCandidates, setMemoryCandidates] = useState<MemoryCandidate[]>([])
  const [recentRuns, setRecentRuns] = useState<AgentRunSummary[]>([])
  const [memorySearchQuery, setMemorySearchQuery] = useState('')
  const [memorySearchMode, setMemorySearchMode] = useState('hybrid')
  const [memorySearchResults, setMemorySearchResults] = useState<MemorySearchHit[]>([])
  const [selectedMemorySource, setSelectedMemorySource] = useState<MemorySourceDetail | null>(null)
  const [candidateStatusFilter, setCandidateStatusFilter] = useState('all')
  const [activePanel, setActivePanel] = useState<AuditPanel>('overview')
  const [loadingWorkspace, setLoadingWorkspace] = useState(true)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [agentSearch, setAgentSearch] = useState('')
  const [candidateToReject, setCandidateToReject] = useState<MemoryCandidate | null>(null)

  const pendingCount = memoryCandidates.filter((item) => item.status === 'proposed').length
  const appliedCount = memoryCandidates.filter((item) => item.status === 'applied').length
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
    try {
      await api.rejectMemoryCandidate(candidateId)
      message.success('候选记忆已标记为忽略')
      if (currentAgent) {
        await loadAgentAudit(currentAgent.agentId)
      }
    } catch (rejectError) {
      setError(getErrorMessage(rejectError, '忽略候选记忆失败'))
    }
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
      // effective mode info removed as per design requirements
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

  function handleViewRun(runId: string) {
    navigate(`/studio/runs/${runId}`)
  }

  function handleViewThreadRuns(threadId: string) {
    navigate(`/studio/runs?threadId=${encodeURIComponent(threadId)}`)
  }

  if (loadingWorkspace && agents.length === 0 && !selectedAgentId) {
    return (
      <Flex justify="center" align="center" style={{ minHeight: 320 }}>
        <Spin size="large" tip="正在加载审计目录..."><div /></Spin>
      </Flex>
    )
  }

  return (
    <Flex vertical gap={24}>
      <PageHeader
        title="记忆审计"
        actions={(
          <>
            <Button icon={<ReloadOutlined />} onClick={() => void loadWorkspace()}>
              刷新
            </Button>
            {currentAgent ? (
              <Button onClick={() => navigate(`/studio/agents/${currentAgent.agentId}`)}>
                员工配置
              </Button>
            ) : null}
          </>
        )}
      />

      {error ? <Alert type="error" message={error} showIcon /> : null}

      <MemoryMetrics
        agentCount={agents.length}
        pendingCount={pendingCount}
        appliedCount={appliedCount}
        recentRunsCount={recentRuns.length}
        latestRunStatus={latestRun?.status || null}
      />

      <div
        style={{
          display: 'grid',
          gap: 16,
          gridTemplateColumns: 'minmax(0, 320px) minmax(0, 1fr)',
          alignItems: 'start',
        }}
      >
        <AgentList
          agents={agents}
          selectedAgentId={selectedAgentId}
          agentSearch={agentSearch}
          onAgentSearchChange={setAgentSearch}
          onSelectAgent={handleSelectEntity}
        />

        <Flex vertical gap={16}>
          <SectionCard
            title={currentAgent?.name || '选择员工'}
            action={currentAgent?.agentId ? <Tag color="purple">{currentAgent.agentId}</Tag> : null}
          >
            {!currentAgent ? (
              <Alert type="info" message="选择左侧员工查看详情" showIcon />
            ) : (
              <Flex vertical gap={12}>
                <Space wrap size={[8, 8]}>
                  <Tag color="blue">{scopeLabel(currentAgent.memoryScope)}</Tag>
                  <Tag color={pendingCount > 0 ? 'warning' : 'default'}>{`${pendingCount} 待审`}</Tag>
                  <Tag color="success">{`${appliedCount} 已应用`}</Tag>
                  {latestRun ? <Tag color={statusColor(latestRun.status)}>{latestRun.status}</Tag> : null}
                </Space>
                <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
                  {agentMemory?.updatedAt ? `更新于 ${formatDateTimeZh(agentMemory.updatedAt)}` : '暂无更新记录'}
                </Typography.Paragraph>
              </Flex>
            )}
          </SectionCard>

          {currentAgent ? (
            <SectionCard title="工作台">
              {loadingDetail ? (
                <Flex justify="center" align="center" style={{ minHeight: 220 }}>
                  <Spin tip="正在加载员工审计详情..."><div /></Spin>
                </Flex>
              ) : (
                <Tabs
                  activeKey={activePanel}
                  onChange={(value) => setActivePanel(value as AuditPanel)}
                  items={[
                    {
                      key: 'overview',
                      label: '概览',
                      children: (
                        <OverviewPanel
                          agentMemory={agentMemory}
                          recentRuns={recentRuns}
                          onViewRun={handleViewRun}
                          onViewThreadRuns={handleViewThreadRuns}
                        />
                      ),
                    },
                    {
                      key: 'candidates',
                      label: '候选审核',
                      children: (
                        <CandidatePanel
                          candidates={memoryCandidates}
                          statusFilter={candidateStatusFilter}
                          onStatusFilterChange={setCandidateStatusFilter}
                          onApplyCandidate={handleApplyCandidate}
                          onRejectCandidate={setCandidateToReject}
                          onPreviewSource={handlePreviewSource}
                          agentMemory={agentMemory}
                          selectedSource={selectedMemorySource}
                        />
                      ),
                    },
                    {
                      key: 'search',
                      label: '检索取证',
                      children: (
                        <SearchPanel
                          query={memorySearchQuery}
                          mode={memorySearchMode}
                          results={memorySearchResults}
                          searching={searching}
                          error={searchError}
                          currentAgent={currentAgent}
                          onQueryChange={setMemorySearchQuery}
                          onModeChange={setMemorySearchMode}
                          onSearch={handleSearch}
                          onPreviewSource={handlePreviewSource}
                          selectedSource={selectedMemorySource}
                        />
                      ),
                    },
                  ]}
                />
              )}
            </SectionCard>
          ) : null}
        </Flex>
      </div>

      <Modal
        open={Boolean(candidateToReject)}
        onCancel={() => setCandidateToReject(null)}
        onOk={() => {
          if (candidateToReject) {
            void handleRejectCandidate(candidateToReject.candidateId)
          }
          setCandidateToReject(null)
        }}
        title="忽略候选记忆"
        okText="忽略"
        cancelText="取消"
        okButtonProps={{ danger: true }}
        destroyOnHidden
      >
        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
          确定要忽略「{candidateToReject?.title || '当前候选'}」吗？忽略后该条目将不再出现在待审列表中。
        </Typography.Paragraph>
      </Modal>
    </Flex>
  )
}
