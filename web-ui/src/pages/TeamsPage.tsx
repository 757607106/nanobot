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
  Select,
  Space,
  Spin,
  Switch,
  Tag,
  Typography,
} from 'antd'
import {
  ApartmentOutlined,
  CopyOutlined,
  DeleteOutlined,
  PlusOutlined,
  ReloadOutlined,
  SaveOutlined,
  SearchOutlined,
} from '@ant-design/icons'
import { useNavigate, useParams } from 'react-router-dom'
import { api, ApiError } from '../api'
import PageHero from '../components/PageHero'
import { formatDateTimeZh } from '../locale'
import type {
  AgentDefinition,
  AgentRunSummary,
  ChatMessage,
  KnowledgeBaseDefinition,
  MemoryCandidate,
  MemorySourceDetail,
  TeamDefinition,
  TeamDefinitionMutationInput,
  TeamMemorySnapshot,
  TeamThreadSummary,
} from '../types'

const { Text, Paragraph } = Typography
const { TextArea } = Input

interface TeamFormState {
  name: string
  description: string
  leaderAgentId: string
  memberAgentIds: string[]
  workflowMode: string
  sharedKnowledgeBindingIds: string[]
  teamSharedKnowledgePolicy: string
  teamSharedMemoryPolicy: string
  tags: string[]
  enabled: boolean
}

const workflowOptions = [
  { value: 'parallel_fanout', label: '并行 fan-out', description: 'leader 分派给多个成员并汇总结果。' },
  { value: 'sequential_handoff', label: '顺序交接', description: '成员按顺序接力完成同一任务。' },
  { value: 'leader_summary', label: 'leader 汇总', description: 'leader 主导，成员按需补充分析结果。' },
]

const teamSharedKnowledgeOptions = [
  { value: 'explicit_only', label: '显式授权后可读' },
  { value: 'members_read', label: '成员可读 team 知识库' },
  { value: 'leader_only', label: '仅 leader 可读' },
]

const teamSharedMemoryOptions = [
  { value: 'leader_write_member_read', label: 'leader 写，member 读' },
  { value: 'leader_only', label: '仅 leader 读写' },
  { value: 'isolated', label: '成员不读取 team shared memory' },
]

function createEmptyForm(): TeamFormState {
  return {
    name: '',
    description: '',
    leaderAgentId: '',
    memberAgentIds: [],
    workflowMode: 'parallel_fanout',
    sharedKnowledgeBindingIds: [],
    teamSharedKnowledgePolicy: 'explicit_only',
    teamSharedMemoryPolicy: 'leader_write_member_read',
    tags: [],
    enabled: true,
  }
}

function teamToForm(team: TeamDefinition): TeamFormState {
  return {
    name: team.name,
    description: team.description,
    leaderAgentId: team.leaderAgentId,
    memberAgentIds: [...team.memberAgentIds],
    workflowMode: team.workflowMode || 'parallel_fanout',
    sharedKnowledgeBindingIds: [...team.sharedKnowledgeBindingIds],
    teamSharedKnowledgePolicy: String(team.memberAccessPolicy?.teamSharedKnowledge || 'explicit_only'),
    teamSharedMemoryPolicy: String(team.memberAccessPolicy?.teamSharedMemory || 'leader_write_member_read'),
    tags: [...team.tags],
    enabled: team.enabled,
  }
}

function toPayload(form: TeamFormState): TeamDefinitionMutationInput {
  return {
    name: form.name.trim(),
    description: form.description.trim(),
    leaderAgentId: form.leaderAgentId,
    memberAgentIds: [...form.memberAgentIds],
    workflowMode: form.workflowMode,
    sharedKnowledgeBindingIds: [...form.sharedKnowledgeBindingIds],
    memberAccessPolicy: {
      teamSharedKnowledge: form.teamSharedKnowledgePolicy,
      teamSharedMemory: form.teamSharedMemoryPolicy,
    },
    tags: [...form.tags],
    enabled: form.enabled,
  }
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof ApiError) {
    return error.message
  }
  if (error instanceof Error && error.message) {
    return error.message
  }
  return fallback
}

function isActiveRunStatus(status: AgentRunSummary['status']) {
  return status === 'queued' || status === 'running' || status === 'cancel_requested'
}

export default function TeamsPage() {
  const { message } = App.useApp()
  const navigate = useNavigate()
  const { teamId } = useParams()
  const selectedTeamId = teamId && teamId !== 'new' ? teamId : null

  const [teams, setTeams] = useState<TeamDefinition[]>([])
  const [agents, setAgents] = useState<AgentDefinition[]>([])
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBaseDefinition[]>([])
  const [currentTeam, setCurrentTeam] = useState<TeamDefinition | null>(null)
  const [form, setForm] = useState<TeamFormState>(() => createEmptyForm())
  const [testPrompt, setTestPrompt] = useState('请协作完成一次团队任务分解，并给出最终结论。')
  const [retryContext, setRetryContext] = useState('')
  const [teamMemory, setTeamMemory] = useState<TeamMemorySnapshot | null>(null)
  const [teamMemoryDraft, setTeamMemoryDraft] = useState('')
  const [memoryCandidates, setMemoryCandidates] = useState<MemoryCandidate[]>([])
  const [memorySearchQuery, setMemorySearchQuery] = useState('')
  const [memorySearchMode, setMemorySearchMode] = useState('hybrid')
  const [memorySearchEffectiveMode, setMemorySearchEffectiveMode] = useState<string | null>(null)
  const [teamThread, setTeamThread] = useState<TeamThreadSummary | null>(null)
  const [teamThreadMessages, setTeamThreadMessages] = useState<ChatMessage[]>([])
  const [memorySearchResults, setMemorySearchResults] = useState<Array<{
    sourceType: string
    sourceId: string
    title: string
    preview: string
    score: number
    metadata: Record<string, unknown>
  }> | null>(null)
  const [selectedMemorySource, setSelectedMemorySource] = useState<MemorySourceDetail | null>(null)
  const [lastResult, setLastResult] = useState<string | null>(null)
  const [recentRuns, setRecentRuns] = useState<AgentRunSummary[]>([])
  const [loadingWorkspace, setLoadingWorkspace] = useState(true)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [loadingRuns, setLoadingRuns] = useState(false)
  const [loadingMemory, setLoadingMemory] = useState(false)
  const [loadingThread, setLoadingThread] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [copying, setCopying] = useState(false)
  const [savingMemory, setSavingMemory] = useState(false)
  const [searchingMemory, setSearchingMemory] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [runError, setRunError] = useState<string | null>(null)
  const [memoryError, setMemoryError] = useState<string | null>(null)
  const [threadError, setThreadError] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)

  useEffect(() => {
    void loadWorkspace()
  }, [])

  useEffect(() => {
    if (loadingWorkspace) {
      return
    }
    if (!teamId && teams[0]) {
      navigate(`/studio/teams/${teams[0].teamId}`, { replace: true })
      return
    }
    if (!selectedTeamId) {
      setCurrentTeam(null)
      setForm(createEmptyForm())
      setRecentRuns([])
      setLastResult(null)
      setTeamMemory(null)
      setTeamMemoryDraft('')
      setMemoryCandidates([])
      setMemorySearchResults(null)
      setMemorySearchEffectiveMode(null)
      setSelectedMemorySource(null)
      setMemoryError(null)
      setTeamThread(null)
      setTeamThreadMessages([])
      setThreadError(null)
      return
    }
    void loadTeamDetail(selectedTeamId)
    void loadRecentRuns(selectedTeamId)
    void loadTeamMemory(selectedTeamId)
    void loadTeamThread(selectedTeamId)
  }, [loadingWorkspace, navigate, selectedTeamId, teamId, teams])

  const enabledCount = useMemo(() => teams.filter((item) => item.enabled).length, [teams])
  const sharedKbCount = useMemo(
    () => teams.reduce((sum, item) => sum + item.sharedKnowledgeBindingIds.length, 0),
    [teams],
  )

  const agentOptions = useMemo(
    () =>
      agents.map((agent) => ({
        value: agent.agentId,
        label: `${agent.name} · ${agent.enabled ? '启用' : '停用'}`,
      })),
    [agents],
  )

  const memberOptions = useMemo(
    () => agentOptions.filter((item) => item.value !== form.leaderAgentId),
    [agentOptions, form.leaderAgentId],
  )

  const knowledgeOptions = useMemo(() => {
    const map = new Map(
      knowledgeBases.map((item) => [
        item.kbId,
        `${item.name} · ${item.description || '团队知识库'}`,
      ]),
    )
    for (const kbId of form.sharedKnowledgeBindingIds) {
      if (!map.has(kbId)) {
        map.set(kbId, `${kbId} · 当前定义中的知识库绑定`)
      }
    }
    return Array.from(map.entries()).map(([value, label]) => ({ value, label }))
  }, [form.sharedKnowledgeBindingIds, knowledgeBases])

  const selectedLeader = useMemo(
    () => agents.find((agent) => agent.agentId === form.leaderAgentId) ?? null,
    [agents, form.leaderAgentId],
  )

  const selectedMembers = useMemo(
    () => agents.filter((agent) => form.memberAgentIds.includes(agent.agentId)),
    [agents, form.memberAgentIds],
  )
  const latestRun = recentRuns[0] ?? null
  const activeRecentRun = useMemo(
    () => recentRuns.find((item) => isActiveRunStatus(item.status)) ?? null,
    [recentRuns],
  )

  useEffect(() => {
    if (!currentTeam?.teamId || !activeRecentRun) {
      return
    }
    const timer = window.setInterval(() => {
      void loadRecentRuns(currentTeam.teamId)
      void loadTeamMemory(currentTeam.teamId, { silent: true })
      void loadTeamThread(currentTeam.teamId, { silent: true })
    }, 2500)
    return () => window.clearInterval(timer)
  }, [activeRecentRun, currentTeam?.teamId])

  async function loadWorkspace() {
    try {
      setLoadingWorkspace(true)
      const [teamList, agentList, kbList] = await Promise.all([
        api.getTeams(),
        api.getAgents(),
        api.getKnowledgeBases(true),
      ])
      setTeams(teamList)
      setAgents(agentList)
      setKnowledgeBases(kbList)
      setError(null)
    } catch (loadError) {
      setError(getErrorMessage(loadError, '加载 Teams 失败'))
    } finally {
      setLoadingWorkspace(false)
    }
  }

  async function loadTeamDetail(nextTeamId: string) {
    try {
      setLoadingDetail(true)
      const detail = await api.getTeam(nextTeamId)
      setCurrentTeam(detail)
      setForm(teamToForm(detail))
      setError(null)
    } catch (loadError) {
      setError(getErrorMessage(loadError, '加载 Team 详情失败'))
    } finally {
      setLoadingDetail(false)
    }
  }

  async function loadRecentRuns(nextTeamId: string) {
    try {
      setLoadingRuns(true)
      const payload = await api.getRuns({
        teamId: nextTeamId,
        kind: 'team',
        limit: 8,
      })
      setRecentRuns(payload.items)
      const latestSuccessful = payload.items.find((item) => item.status === 'succeeded' && item.resultSummary?.content)
      if (latestSuccessful?.resultSummary?.content) {
        setLastResult(latestSuccessful.resultSummary.content)
      }
      setRunError(null)
    } catch (loadError) {
      setRunError(getErrorMessage(loadError, '加载最近团队运行失败'))
    } finally {
      setLoadingRuns(false)
    }
  }

  async function loadTeamMemory(nextTeamId: string, options?: { silent?: boolean }) {
    try {
      if (!options?.silent) {
        setLoadingMemory(true)
      }
      const [snapshot, candidatesPayload] = await Promise.all([
        api.getTeamMemory(nextTeamId),
        api.getMemoryCandidates({
          teamId: nextTeamId,
          limit: 12,
        }),
      ])
      setTeamMemory(snapshot)
      setTeamMemoryDraft(snapshot.content)
      setMemoryCandidates(candidatesPayload.items)
      setMemorySearchEffectiveMode(null)
      setMemoryError(null)
    } catch (loadError) {
      setMemoryError(getErrorMessage(loadError, '加载 Team 记忆失败'))
    } finally {
      if (!options?.silent) {
        setLoadingMemory(false)
      }
    }
  }

  async function loadTeamThread(nextTeamId: string, options?: { silent?: boolean }) {
    try {
      if (!options?.silent) {
        setLoadingThread(true)
      }
      const [summary, messagesPayload] = await Promise.all([
        api.getTeamThread(nextTeamId),
        api.getTeamThreadMessages(nextTeamId, 12),
      ])
      setTeamThread(summary)
      setTeamThreadMessages(messagesPayload.messages)
      setThreadError(null)
    } catch (loadError) {
      setThreadError(getErrorMessage(loadError, '加载 Team Thread 失败'))
    } finally {
      if (!options?.silent) {
        setLoadingThread(false)
      }
    }
  }

  function updateForm<K extends keyof TeamFormState>(key: K, value: TeamFormState[K]) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  async function handleSave() {
    const payload = toPayload(form)
    if (!payload.name) {
      setError('Team 名称不能为空。')
      return
    }
    if (!payload.leaderAgentId) {
      setError('请先选择 leader agent。')
      return
    }
    try {
      setSaving(true)
      const saved = currentTeam
        ? await api.updateTeam(currentTeam.teamId, payload)
        : await api.createTeam(payload)
      message.success(currentTeam ? 'Team 已更新' : 'Team 已创建')
      await loadWorkspace()
      navigate(`/studio/teams/${saved.teamId}`, { replace: true })
      await loadTeamDetail(saved.teamId)
    } catch (saveError) {
      setError(getErrorMessage(saveError, '保存 Team 失败'))
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!currentTeam) {
      return
    }
    try {
      setDeleting(true)
      await api.deleteTeam(currentTeam.teamId)
      message.success('Team 已删除')
      const remaining = teams.filter((item) => item.teamId !== currentTeam.teamId)
      await loadWorkspace()
      if (remaining[0]) {
        navigate(`/studio/teams/${remaining[0].teamId}`, { replace: true })
      } else {
        navigate('/studio/teams/new', { replace: true })
      }
    } catch (deleteError) {
      setError(getErrorMessage(deleteError, '删除 Team 失败'))
    } finally {
      setDeleting(false)
    }
  }

  async function handleCopy() {
    if (!currentTeam) {
      return
    }
    try {
      setCopying(true)
      const copied = await api.copyTeam(currentTeam.teamId)
      message.success('Team 已复制')
      await loadWorkspace()
      navigate(`/studio/teams/${copied.teamId}`, { replace: true })
    } catch (copyError) {
      setError(getErrorMessage(copyError, '复制 Team 失败'))
    } finally {
      setCopying(false)
    }
  }

  async function handleTestRun() {
    if (!currentTeam) {
      setRunError('请先保存 Team，再发起团队运行。')
      return
    }
    if (!testPrompt.trim()) {
      setRunError('请输入团队任务。')
      return
    }
    try {
      setTesting(true)
      const result = await api.runTeam(currentTeam.teamId, testPrompt.trim())
      setLastResult(null)
      if (result.run.status === 'queued') {
        message.success('团队运行已启动，已进入队列')
      } else {
        message.success('团队运行已启动')
      }
      await loadRecentRuns(currentTeam.teamId)
      setRunError(null)
    } catch (runTeamError) {
      setRunError(getErrorMessage(runTeamError, '团队运行失败'))
    } finally {
      setTesting(false)
    }
  }

  async function handleCancelRun(runId: string) {
    try {
      await api.cancelRun(runId)
      message.success('已向团队运行发送取消请求')
      if (currentTeam) {
        await loadRecentRuns(currentTeam.teamId)
      }
    } catch (cancelError) {
      setRunError(getErrorMessage(cancelError, '取消团队运行失败'))
    }
  }

  async function handleRetryRun(runId: string, mode: 'direct' | 'append') {
    if (!currentTeam) {
      setRunError('请先保存 Team，再重跑团队运行。')
      return
    }
    const appendContext = mode === 'append' ? retryContext.trim() : ''
    if (mode === 'append' && !appendContext) {
      setRunError('请输入追加上下文后再执行重跑。')
      return
    }
    try {
      setTesting(true)
      await api.retryTeamRun(currentTeam.teamId, runId, appendContext || undefined)
      setLastResult(null)
      message.success(mode === 'append' ? '已带追加上下文重新发起团队运行' : '已重新发起团队运行')
      await loadRecentRuns(currentTeam.teamId)
      setRunError(null)
    } catch (retryError) {
      setRunError(getErrorMessage(retryError, '重跑团队运行失败'))
    } finally {
      setTesting(false)
    }
  }

  async function handleSaveTeamMemory() {
    if (!currentTeam) {
      setMemoryError('请先保存 Team，再编辑共享记忆。')
      return
    }
    try {
      setSavingMemory(true)
      const snapshot = await api.updateTeamMemory(currentTeam.teamId, teamMemoryDraft)
      setTeamMemory(snapshot)
      setTeamMemoryDraft(snapshot.content)
      setMemoryError(null)
      message.success('Team Shared Memory 已更新')
      await loadTeamMemory(currentTeam.teamId, { silent: true })
    } catch (saveError) {
      setMemoryError(getErrorMessage(saveError, '保存 Team Shared Memory 失败'))
    } finally {
      setSavingMemory(false)
    }
  }

  async function handleApplyCandidate(candidateId: string) {
    if (!currentTeam) {
      return
    }
    try {
      await api.applyMemoryCandidate(candidateId)
      message.success('记忆候选已应用到 Team Shared Memory')
      await loadTeamMemory(currentTeam.teamId)
    } catch (applyError) {
      setMemoryError(getErrorMessage(applyError, '应用记忆候选失败'))
    }
  }

  async function handleRejectCandidate(candidateId: string) {
    if (!currentTeam) {
      return
    }
    try {
      await api.rejectMemoryCandidate(candidateId)
      message.success('记忆候选已忽略')
      await loadTeamMemory(currentTeam.teamId)
    } catch (rejectError) {
      setMemoryError(getErrorMessage(rejectError, '忽略记忆候选失败'))
    }
  }

  async function handleSearchMemory() {
    if (!currentTeam) {
      setMemoryError('请先保存 Team，再检索团队记忆。')
      return
    }
    if (!memorySearchQuery.trim()) {
      setMemoryError('请输入检索关键词。')
      return
    }
    try {
      setSearchingMemory(true)
      const result = await api.searchMemory({
        query: memorySearchQuery.trim(),
        teamId: currentTeam.teamId,
        limit: 8,
        mode: memorySearchMode,
      })
      setMemorySearchResults(result.items)
      setMemorySearchEffectiveMode(result.effectiveMode)
      setMemoryError(null)
    } catch (searchError) {
      setMemoryError(getErrorMessage(searchError, '检索团队记忆失败'))
    } finally {
      setSearchingMemory(false)
    }
  }

  async function handlePreviewMemorySource(sourceType: string, sourceId: string) {
    if (!currentTeam) {
      return
    }
    try {
      const detail = await api.getMemorySource({
        sourceType,
        sourceId,
        teamId: currentTeam.teamId,
      })
      setSelectedMemorySource(detail)
      setMemoryError(null)
    } catch (detailError) {
      setMemoryError(getErrorMessage(detailError, '加载记忆内容失败'))
    }
  }

  if (loadingWorkspace && teams.length === 0 && !selectedTeamId) {
    return (
      <div className="page-card center-box">
        <Spin />
      </div>
    )
  }

  return (
    <div className="page-stack">
      <PageHero
        className="page-hero-compact studio-hero"
        eyebrow="P3 Team 最小闭环"
        title="数字团队 Teams"
        description="先把团队定义做成可创建、可配置、可复用的协作对象，并接通后台 team run。现在已经可以轮询 recent runs、跳转统一时间线，并对运行中的团队任务发起取消。"
        stats={[
          { label: '已创建 Teams', value: teams.length },
          { label: '启用中', value: enabledCount },
          { label: '可选 Agents', value: agents.length },
          { label: '共享知识绑定', value: sharedKbCount },
        ]}
        badges={[
          <Tag key="crud" color="processing">TeamDefinition CRUD 已接后端</Tag>,
          <Tag key="runtime" color="geekblue">首版 team run 已异步接通</Tag>,
        ]}
        actions={(
          <Space wrap>
            <Button icon={<ReloadOutlined />} onClick={() => void loadWorkspace()} loading={loadingWorkspace}>
              刷新
            </Button>
            <Button onClick={() => navigate('/studio/runs')}>查看统一 Runs</Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/studio/teams/new')}>
              新建 Team
            </Button>
          </Space>
        )}
      />

      {error ? <Alert type="error" showIcon message={error} /> : null}

      <div className="page-grid studio-agents-grid">
        <Card className="config-panel-card studio-agent-list-card">
          <div className="config-card-header">
            <div className="page-section-title">
              <Typography.Title level={4}>Team Catalog</Typography.Title>
              <Text type="secondary">选择已有团队，或者把多个数字员工组装成新的协作单元。</Text>
            </div>
            <Tag color="blue">{teams.length}</Tag>
          </div>

          {teams.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前还没有可复用 Team。">
              <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/studio/teams/new')}>
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
                  onClick={() => navigate(`/studio/teams/${item.teamId}`)}
                >
                  <div className="studio-agent-list-copy">
                    <div className="studio-agent-list-head">
                      <Space size={8}>
                        <ApartmentOutlined />
                        <strong>{item.name}</strong>
                      </Space>
                      <Tag color={item.enabled ? 'success' : 'default'}>{item.enabled ? '启用' : '停用'}</Tag>
                    </div>
                    <Text type="secondary">{item.description || '暂未补充团队说明。'}</Text>
                    <div className="studio-agent-list-meta">
                      <Tag>{item.workflowMode}</Tag>
                      <Tag>{item.memberCount} agents</Tag>
                      <Tag>{item.sharedKnowledgeBindingIds.length} KB</Tag>
                    </div>
                  </div>
                </List.Item>
              )}
            />
          )}
        </Card>

        <div className="page-stack">
          <Card className="config-panel-card studio-agent-editor-card" loading={loadingDetail}>
            <div className="config-card-header">
              <div className="page-section-title">
                <Typography.Title level={4}>{currentTeam ? 'Team Detail' : 'New Team'}</Typography.Title>
                <Text type="secondary">定义 leader、成员、协作模式和共享知识读取边界。</Text>
              </div>
              {currentTeam ? <Tag color="blue">{currentTeam.teamId}</Tag> : <Tag>未保存</Tag>}
            </div>

            <div className="studio-form-grid">
              <div className="studio-form-field studio-form-field-span-2">
                <Text type="secondary">名称</Text>
                <Input
                  value={form.name}
                  onChange={(event) => updateForm('name', event.target.value)}
                  placeholder="例如：客服协同组、研究评审组"
                />
              </div>

              <div className="studio-form-field">
                <Text type="secondary">Workflow Mode</Text>
                <Select
                  value={form.workflowMode}
                  onChange={(value) => updateForm('workflowMode', value)}
                  options={workflowOptions.map((item) => ({
                    value: item.value,
                    label: `${item.label} · ${item.description}`,
                  }))}
                />
              </div>

              <div className="studio-form-field studio-form-switch-field">
                <Text type="secondary">启用状态</Text>
                <Switch checked={form.enabled} onChange={(checked) => updateForm('enabled', checked)} />
              </div>

              <div className="studio-form-field studio-form-field-span-2">
                <Text type="secondary">描述</Text>
                <TextArea
                  value={form.description}
                  onChange={(event) => updateForm('description', event.target.value)}
                  rows={3}
                  placeholder="说明团队负责什么场景、leader 如何分工、需要什么产出。"
                />
              </div>

              <div className="studio-form-field">
                <Text type="secondary">Leader Agent</Text>
                <Select
                  value={form.leaderAgentId || undefined}
                  onChange={(value) => updateForm('leaderAgentId', value)}
                  options={agentOptions}
                  placeholder="选择负责汇总与调度的 leader"
                />
              </div>

              <div className="studio-form-field">
                <Text type="secondary">Member Agents</Text>
                <Select
                  mode="multiple"
                  value={form.memberAgentIds}
                  onChange={(value) => updateForm('memberAgentIds', value)}
                  options={memberOptions}
                  placeholder="选择参与协作的成员"
                />
              </div>

              <div className="studio-form-field studio-form-field-span-2">
                <Text type="secondary">Shared Knowledge Bindings</Text>
                <Select
                  mode="multiple"
                  value={form.sharedKnowledgeBindingIds}
                  onChange={(value) => updateForm('sharedKnowledgeBindingIds', value)}
                  options={knowledgeOptions}
                  placeholder="选择 team 共享知识库"
                />
              </div>

              <div className="studio-form-field">
                <Text type="secondary">Team Shared Knowledge Policy</Text>
                <Select
                  value={form.teamSharedKnowledgePolicy}
                  onChange={(value) => updateForm('teamSharedKnowledgePolicy', value)}
                  options={teamSharedKnowledgeOptions}
                />
              </div>

              <div className="studio-form-field">
                <Text type="secondary">Team Shared Memory Policy</Text>
                <Select
                  value={form.teamSharedMemoryPolicy}
                  onChange={(value) => updateForm('teamSharedMemoryPolicy', value)}
                  options={teamSharedMemoryOptions}
                />
              </div>

              <div className="studio-form-field studio-form-field-span-2">
                <Text type="secondary">Tags</Text>
                <Select
                  mode="tags"
                  value={form.tags}
                  onChange={(value) => updateForm('tags', value)}
                  placeholder="例如 support, reviewer, research"
                />
              </div>
            </div>

            <Alert
              className="studio-inline-alert"
              type="info"
              showIcon
              message="当前页面已经接通首版真实 team run，可直接验证 leader/member 协作、共享知识读取、统一 Runs 时间线，以及取消 / 直接重跑 / 追加上下文重跑。"
            />

            <div className="studio-form-actions">
              <Space wrap>
                <Button icon={<CopyOutlined />} onClick={() => void handleCopy()} disabled={!currentTeam} loading={copying}>
                  复制
                </Button>
                <Button icon={<DeleteOutlined />} danger onClick={() => void handleDelete()} disabled={!currentTeam} loading={deleting}>
                  删除
                </Button>
                <Button type="primary" icon={<SaveOutlined />} onClick={() => void handleSave()} loading={saving}>
                  保存 Team
                </Button>
              </Space>
            </div>
          </Card>

          <Card className="config-panel-card studio-agent-run-card">
            <div className="config-card-header">
              <div className="page-section-title">
                <Typography.Title level={4}>Team Thread</Typography.Title>
                <Text type="secondary">团队级多轮短期记忆。每次 team run 会把用户任务和最终团队回复沉淀到这个线程里。</Text>
              </div>
              {teamThread ? <Tag color="cyan">{teamThread.session.messageCount} messages</Tag> : null}
            </div>

            {threadError ? <Alert type="error" showIcon message={threadError} /> : null}

            <div className="studio-form-actions">
              <Space wrap>
                <Button icon={<ReloadOutlined />} onClick={() => currentTeam && void loadTeamThread(currentTeam.teamId)} loading={loadingThread} disabled={!currentTeam}>
                  刷新 Thread
                </Button>
                {teamThread ? (
                  <Button onClick={() => navigate(`/studio/runs?threadId=${encodeURIComponent(teamThread.threadId)}`)}>
                    查看 Thread Runs
                  </Button>
                ) : null}
              </Space>
            </div>

            {!currentTeam ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="先保存 Team，才能生成团队线程。" />
            ) : loadingThread && teamThreadMessages.length === 0 ? (
              <div className="center-box">
                <Spin />
              </div>
            ) : teamThreadMessages.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="这个 Team 还没有 thread 消息。" />
            ) : (
              <List
                className="studio-run-list"
                dataSource={teamThreadMessages}
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
            )}
          </Card>

          <Card className="config-panel-card studio-agent-run-card">
            <div className="config-card-header">
              <div className="page-section-title">
                <Typography.Title level={4}>Team Memory Governance</Typography.Title>
                <Text type="secondary">在 Team 详情页内直接维护共享长期记忆，并审核 member 生成的候选记忆。</Text>
              </div>
              <Tag color="purple">{teamMemory?.candidateCount ?? memoryCandidates.filter((item) => item.status === 'proposed').length} pending</Tag>
            </div>

            {memoryError ? <Alert type="error" showIcon message={memoryError} /> : null}

            <div className="studio-form-grid">
              <div className="studio-form-field studio-form-field-span-2">
                <Text type="secondary">Team Shared Memory</Text>
                <TextArea
                  value={teamMemoryDraft}
                  onChange={(event) => setTeamMemoryDraft(event.target.value)}
                  rows={6}
                  placeholder="这里存放团队已经确认过的稳定事实、规则和协作约定。"
                  disabled={!currentTeam}
                />
                <Space wrap>
                  <Text type="secondary">
                    {teamMemory?.updatedAt ? `最近更新时间：${formatDateTimeZh(teamMemory.updatedAt)}` : '当前还没有保存过 Team Shared Memory。'}
                  </Text>
                  {currentTeam ? <Tag>{form.teamSharedMemoryPolicy}</Tag> : null}
                </Space>
              </div>
            </div>

            <div className="studio-form-actions">
              <Space wrap>
                <Button icon={<ReloadOutlined />} onClick={() => currentTeam && void loadTeamMemory(currentTeam.teamId)} loading={loadingMemory} disabled={!currentTeam}>
                  刷新记忆
                </Button>
                <Button type="primary" icon={<SaveOutlined />} onClick={() => void handleSaveTeamMemory()} loading={savingMemory} disabled={!currentTeam}>
                  保存 Team Shared Memory
                </Button>
              </Space>
            </div>

            <div className="studio-runs-header">
              <Typography.Title level={5}>Memory Candidates</Typography.Title>
              <Text type="secondary">member 只生成候选，不直接改写共享长期记忆；这里由 leader 或人工决定是否应用。</Text>
            </div>

            {loadingMemory && memoryCandidates.length === 0 ? (
              <div className="center-box">
                <Spin />
              </div>
            ) : memoryCandidates.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前还没有团队记忆候选。" />
            ) : (
              <List
                className="studio-run-list"
                dataSource={memoryCandidates}
                renderItem={(candidate) => (
                  <List.Item className="studio-run-list-item">
                    <div className="studio-run-list-copy">
                      <div className="studio-run-list-head">
                        <strong>{candidate.title}</strong>
                        <Tag color={candidate.status === 'applied' ? 'success' : candidate.status === 'rejected' ? 'default' : 'processing'}>
                          {candidate.status}
                        </Tag>
                      </div>
                      <Paragraph className="studio-run-preview" ellipsis={{ rows: 3 }}>
                        {candidate.content}
                      </Paragraph>
                      <Text type="secondary">
                        {candidate.agentId || 'unknown-agent'} · {candidate.updatedAt ? formatDateTimeZh(candidate.updatedAt) : '未记录时间'}
                      </Text>
                      <Space wrap>
                        <Button size="small" onClick={() => void handlePreviewMemorySource('memory_candidate', candidate.candidateId)}>
                          查看全文
                        </Button>
                        {candidate.status === 'proposed' ? (
                          <Button size="small" onClick={() => void handleApplyCandidate(candidate.candidateId)}>
                            应用到 Team Memory
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

            <div className="studio-runs-header">
              <Typography.Title level={5}>Memory Search</Typography.Title>
              <Text type="secondary">范围包括 workspace shared memory、team shared memory、team memory candidates、team thread transcript 和 run artifacts。</Text>
            </div>

            <div className="studio-form-field">
              <Text type="secondary">检索关键词</Text>
              <Space wrap>
                <Input
                  value={memorySearchQuery}
                  onChange={(event) => setMemorySearchQuery(event.target.value)}
                  placeholder="例如：triage、customer escalation、impact clearly"
                  disabled={!currentTeam}
                />
                <Button icon={<SearchOutlined />} onClick={() => void handleSearchMemory()} loading={searchingMemory} disabled={!currentTeam}>
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
                  { label: 'keyword', value: 'keyword' },
                  { label: 'hybrid', value: 'hybrid' },
                  { label: 'semantic', value: 'semantic' },
                ]}
              />
              <Text type="secondary">
                {memorySearchEffectiveMode
                  ? `当前生效模式：${memorySearchEffectiveMode}`
                  : '当前采用本地可解释的 keyword / semantic / hybrid 检索基线。'}
              </Text>
            </div>

            {memorySearchResults?.length ? (
              <List
                className="studio-run-list"
                dataSource={memorySearchResults}
                renderItem={(item) => (
                  <List.Item className="studio-run-list-item">
                    <div className="studio-run-list-copy">
                      <div className="studio-run-list-head">
                        <strong>{item.title}</strong>
                        <Tag color="blue">score {item.score}</Tag>
                      </div>
                      <Paragraph className="studio-run-preview" ellipsis={{ rows: 3 }}>
                        {item.preview}
                      </Paragraph>
                      <Space wrap>
                        <Tag>{item.sourceType}</Tag>
                        <Button size="small" onClick={() => void handlePreviewMemorySource(item.sourceType, item.sourceId)}>
                          查看全文
                        </Button>
                      </Space>
                    </div>
                  </List.Item>
                )}
              />
            ) : null}

            {selectedMemorySource ? (
              <div className="studio-run-result">
                <Text type="secondary">{selectedMemorySource.title}</Text>
                <Paragraph className="studio-result-copy">{selectedMemorySource.content}</Paragraph>
              </div>
            ) : null}
          </Card>

          <Card className="config-panel-card studio-agent-run-card">
            <div className="config-card-header">
              <div className="page-section-title">
                <Typography.Title level={4}>Team Test Run</Typography.Title>
                <Text type="secondary">用一次真实 team run 验证 leader/member 协作、共享知识读取和最终汇总结果。</Text>
              </div>
              <Tag color="geekblue">{currentTeam ? currentTeam.workflowMode : form.workflowMode}</Tag>
            </div>

            <div className="studio-form-field">
                <Text type="secondary">团队任务</Text>
                <TextArea
                  value={testPrompt}
                onChange={(event) => setTestPrompt(event.target.value)}
                rows={4}
                  placeholder="描述需要这个团队共同完成的任务。"
                />
              </div>

            <div className="studio-form-field">
              <Text type="secondary">追加上下文</Text>
              <TextArea
                value={retryContext}
                onChange={(event) => setRetryContext(event.target.value)}
                rows={3}
                placeholder="如果要基于某次历史运行重跑，可以在这里补充新的限制、信息或修正说明。"
              />
            </div>

            <div className="studio-form-actions">
              <Space wrap>
                <Button type="primary" onClick={() => void handleTestRun()} loading={testing} disabled={!currentTeam}>
                  发起团队运行
                </Button>
                {latestRun ? (
                  <Button onClick={() => navigate(`/studio/runs/${latestRun.runId}`)}>
                    查看最近时间线
                  </Button>
                ) : null}
                {currentTeam ? (
                  <Button onClick={() => void loadRecentRuns(currentTeam.teamId)} loading={loadingRuns}>
                    刷新最近运行
                  </Button>
                ) : null}
              </Space>
            </div>

            {runError ? <Alert type="error" showIcon message={runError} /> : null}

            <div className="page-section-title">
              <Typography.Title level={5}>当前编排摘要</Typography.Title>
              <Text type="secondary">这张卡片展示当前 team runtime 使用的静态定义，方便和最近一次真实运行结果对照。</Text>
            </div>

            <Space wrap size={[8, 8]}>
              <Tag color="blue">Leader: {selectedLeader?.name || '未选择'}</Tag>
              <Tag color="processing">Members: {form.memberAgentIds.length}</Tag>
              <Tag color="gold">Shared KB: {form.sharedKnowledgeBindingIds.length}</Tag>
            </Space>

            <Paragraph className="studio-result-copy">
              {workflowOptions.find((item) => item.value === form.workflowMode)?.description || '将按选定模式进行协作。'}
            </Paragraph>

            {activeRecentRun ? (
              <Alert
                type="info"
                showIcon
                message={`检测到运行中的 team run：${activeRecentRun.label}`}
                description="最近运行列表会自动刷新，你也可以直接跳转到统一 Runs 页面查看完整时间线。"
              />
            ) : null}

            {lastResult ? (
              <div className="studio-run-result">
                <Text type="secondary">最近一次返回摘要</Text>
                <Paragraph className="studio-result-copy">{lastResult}</Paragraph>
              </div>
            ) : null}

            <div className="studio-runs-header">
              <Typography.Title level={5}>Recent Team Runs</Typography.Title>
            </div>

            {loadingRuns ? (
              <div className="center-box">
                <Spin />
              </div>
            ) : recentRuns.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有该 Team 的运行记录。" />
            ) : (
              <List
                className="studio-run-list"
                dataSource={recentRuns}
                renderItem={(run) => (
                  <List.Item className="studio-run-list-item">
                    <div className="studio-run-list-copy">
                      <div className="studio-run-list-head">
                        <strong>{run.label}</strong>
                        <Tag color={run.status === 'succeeded' ? 'success' : run.status === 'failed' ? 'error' : 'processing'}>
                          {run.status}
                        </Tag>
                      </div>
                      <Paragraph className="studio-run-preview" ellipsis={{ rows: 2 }}>
                        {run.resultSummary?.content || run.taskPreview}
                      </Paragraph>
                      <Text type="secondary">{formatDateTimeZh(run.createdAt)}</Text>
                      <Space wrap>
                        <Button size="small" onClick={() => navigate(`/studio/runs/${run.runId}`)}>
                          查看时间线
                        </Button>
                        <Button size="small" onClick={() => setTestPrompt(run.taskPreview)}>
                          用任务摘要填充
                        </Button>
                        {!isActiveRunStatus(run.status) ? (
                          <Button size="small" loading={testing} onClick={() => void handleRetryRun(run.runId, 'direct')}>
                            直接重跑
                          </Button>
                        ) : null}
                        {!isActiveRunStatus(run.status) ? (
                          <Button size="small" loading={testing} onClick={() => void handleRetryRun(run.runId, 'append')}>
                            追加上下文重跑
                          </Button>
                        ) : null}
                        {isActiveRunStatus(run.status) ? (
                          <Button size="small" danger onClick={() => void handleCancelRun(run.runId)}>
                            请求取消
                          </Button>
                        ) : null}
                      </Space>
                    </div>
                  </List.Item>
                )}
              />
            )}

            <div className="studio-runs-header">
              <Typography.Title level={5}>成员快照</Typography.Title>
            </div>

            {selectedMembers.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有选择 member agents。" />
            ) : (
              <List
                className="studio-run-list"
                dataSource={selectedMembers}
                renderItem={(agent) => (
                  <List.Item className="studio-run-list-item">
                    <div className="studio-run-list-copy">
                      <div className="studio-run-list-head">
                        <strong>{agent.name}</strong>
                        <Tag color={agent.enabled ? 'success' : 'default'}>{agent.enabled ? '启用' : '停用'}</Tag>
                      </div>
                      <Paragraph className="studio-run-preview" ellipsis={{ rows: 2 }}>
                        {agent.description || '暂无成员说明。'}
                      </Paragraph>
                    </div>
                  </List.Item>
                )}
              />
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}
