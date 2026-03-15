import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  App,
  Button,
  Card,
  Collapse,
  Empty,
  Input,
  List,
  Segmented,
  Select,
  Space,
  Spin,
  Switch,
  Tag,
  Tabs,
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
  { value: 'parallel_fanout', label: '并行协作', description: '负责人把任务分给多个成员并统一汇总。' },
  { value: 'sequential_handoff', label: '顺序接力', description: '成员按顺序接力完成同一任务。' },
  { value: 'leader_summary', label: '负责人汇总', description: '负责人主导，成员按需补充分析结果。' },
]

const teamSharedKnowledgeOptions = [
  { value: 'explicit_only', label: '按明确授权使用' },
  { value: 'members_read', label: '成员可使用共享知识库' },
  { value: 'leader_only', label: '仅负责人可使用' },
]

const teamSharedMemoryOptions = [
  { value: 'leader_write_member_read', label: '负责人维护，成员可参考' },
  { value: 'leader_only', label: '仅负责人使用' },
  { value: 'isolated', label: '成员不读取团队记忆' },
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
  const [activePanel, setActivePanel] = useState<'config' | 'runs' | 'memory'>('config')

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
        eyebrow="协作团队"
        title="团队"
        description="把多个 AI 员工组合成一支可协作的团队。你可以设置负责人、成员、共享知识，并直接发起团队任务。"
        stats={[
          { label: '已创建团队', value: teams.length },
          { label: '启用中', value: enabledCount },
          { label: '可选员工', value: agents.length },
          { label: '共享知识库', value: sharedKbCount },
        ]}
        badges={[
          <Tag key="crud" color="processing">支持团队配置</Tag>,
          <Tag key="runtime" color="geekblue">支持团队试运行</Tag>,
        ]}
        actions={(
          <Space wrap>
            <Button icon={<ReloadOutlined />} onClick={() => void loadWorkspace()} loading={loadingWorkspace}>
              刷新
            </Button>
            <Button onClick={() => navigate('/studio/runs')}>查看执行记录</Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/studio/teams/new')}>
              新建团队
            </Button>
          </Space>
        )}
      />

      {error ? <Alert type="error" showIcon message={error} /> : null}

      <div className="page-grid studio-agents-grid">
        <Card className="config-panel-card studio-agent-list-card">
          <div className="config-card-header">
            <div className="page-section-title">
              <Typography.Title level={4}>团队列表</Typography.Title>
              <Text type="secondary">选择已有团队，或者把多个 AI 员工组装成新的协作单元。</Text>
            </div>
            <Tag color="blue">{teams.length}</Tag>
          </div>

          {teams.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前还没有可复用团队。">
              <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/studio/teams/new')}>
                创建第一个团队
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
                      <Tag>{workflowOptions.find((option) => option.value === item.workflowMode)?.label || item.workflowMode}</Tag>
                      <Tag>{item.memberCount} 名成员</Tag>
                      <Tag>{item.sharedKnowledgeBindingIds.length} 个知识库</Tag>
                    </div>
                  </div>
                </List.Item>
              )}
            />
          )}
        </Card>

        <div className="page-stack">
          <Tabs
            activeKey={activePanel}
            onChange={(value) => setActivePanel(value as 'config' | 'runs' | 'memory')}
            items={[
              { key: 'config', label: '团队配置' },
              { key: 'runs', label: '团队运行' },
              { key: 'memory', label: '团队记忆' },
            ]}
          />

          {activePanel === 'config' ? (
          <Card className="config-panel-card studio-agent-editor-card" loading={loadingDetail}>
            <div className="config-card-header">
              <div className="page-section-title">
                <Typography.Title level={4}>{currentTeam ? '团队配置' : '新建团队'}</Typography.Title>
                <Text type="secondary">设置负责人、成员、协作方式和可共享的知识资源。</Text>
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
                <Text type="secondary">协作方式</Text>
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
                <Text type="secondary">团队说明</Text>
                <TextArea
                  value={form.description}
                  onChange={(event) => updateForm('description', event.target.value)}
                  rows={3}
                  placeholder="说明团队负责什么场景、leader 如何分工、需要什么产出。"
                />
              </div>

              <div className="studio-form-field">
                <Text type="secondary">负责人</Text>
                <Select
                  value={form.leaderAgentId || undefined}
                  onChange={(value) => updateForm('leaderAgentId', value)}
                  options={agentOptions}
                  placeholder="选择负责统筹与汇总的员工"
                />
              </div>

              <div className="studio-form-field">
                <Text type="secondary">成员</Text>
                <Select
                  mode="multiple"
                  value={form.memberAgentIds}
                  onChange={(value) => updateForm('memberAgentIds', value)}
                  options={memberOptions}
                  placeholder="选择参与协作的员工"
                />
              </div>

              <div className="studio-form-field studio-form-field-span-2">
                <Text type="secondary">共享知识库</Text>
                <Select
                  mode="multiple"
                  value={form.sharedKnowledgeBindingIds}
                  onChange={(value) => updateForm('sharedKnowledgeBindingIds', value)}
                  options={knowledgeOptions}
                  placeholder="选择团队可使用的共享知识库"
                />
              </div>

              <div className="studio-form-field studio-form-field-span-2">
                <Text type="secondary">标签</Text>
                <Select
                  mode="tags"
                  value={form.tags}
                  onChange={(value) => updateForm('tags', value)}
                  placeholder="例如：客服、运营、排障"
                />
              </div>
            </div>

            <Collapse
              className="studio-inline-collapse"
              items={[
                {
                  key: 'advanced',
                  label: '高级设置',
                  children: (
                    <div className="studio-form-grid">
                      <div className="studio-form-field">
                        <Text type="secondary">共享知识权限</Text>
                        <Select
                          value={form.teamSharedKnowledgePolicy}
                          onChange={(value) => updateForm('teamSharedKnowledgePolicy', value)}
                          options={teamSharedKnowledgeOptions}
                        />
                      </div>

                      <div className="studio-form-field">
                        <Text type="secondary">团队记忆权限</Text>
                        <Select
                          value={form.teamSharedMemoryPolicy}
                          onChange={(value) => updateForm('teamSharedMemoryPolicy', value)}
                          options={teamSharedMemoryOptions}
                        />
                      </div>
                    </div>
                  ),
                },
              ]}
            />

            <Alert
              className="studio-inline-alert"
              type="info"
              showIcon
              message="保存后就可以直接发起团队试运行，验证负责人分工、成员协作和最终汇总结果。"
            />

            <div className="studio-form-actions">
              <Space wrap>
                <Button icon={<CopyOutlined />} onClick={() => void handleCopy()} disabled={!currentTeam} loading={copying}>
                  复制团队
                </Button>
                <Button icon={<DeleteOutlined />} danger onClick={() => void handleDelete()} disabled={!currentTeam} loading={deleting}>
                  删除团队
                </Button>
                <Button type="primary" icon={<SaveOutlined />} onClick={() => void handleSave()} loading={saving}>
                  保存团队
                </Button>
              </Space>
            </div>
          </Card>
          ) : null}

          {activePanel === 'runs' ? (
            <>
              <Card className="config-panel-card studio-agent-run-card">
                <div className="config-card-header">
                  <div className="page-section-title">
                    <Typography.Title level={4}>团队对话</Typography.Title>
                    <Text type="secondary">这里记录团队任务和团队回复，方便回看一次协作是怎么完成的。</Text>
                  </div>
                  {teamThread ? <Tag color="cyan">{teamThread.session.messageCount} 条消息</Tag> : null}
                </div>

                {threadError ? <Alert type="error" showIcon message={threadError} /> : null}

                <div className="studio-form-actions">
                  <Space wrap>
                    <Button icon={<ReloadOutlined />} onClick={() => currentTeam && void loadTeamThread(currentTeam.teamId)} loading={loadingThread} disabled={!currentTeam}>
                      刷新对话
                    </Button>
                    {teamThread ? (
                      <Button onClick={() => navigate(`/studio/runs?threadId=${encodeURIComponent(teamThread.threadId)}`)}>
                        查看相关执行
                      </Button>
                    ) : null}
                  </Space>
                </div>

                {!currentTeam ? (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="先保存团队，才能生成团队对话。" />
                ) : loadingThread && teamThreadMessages.length === 0 ? (
                  <div className="center-box">
                    <Spin />
                  </div>
                ) : teamThreadMessages.length === 0 ? (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="这个团队还没有对话记录。" />
                ) : (
                  <List
                    className="studio-run-list"
                    dataSource={teamThreadMessages}
                    renderItem={(item) => (
                      <List.Item className="studio-run-list-item">
                        <div className="studio-run-list-copy">
                          <div className="studio-run-list-head">
                            <Space wrap>
                              <strong>{item.role === 'user' ? '用户消息' : item.role === 'assistant' ? '团队回复' : item.role}</strong>
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
                    <Typography.Title level={4}>团队试运行</Typography.Title>
                    <Text type="secondary">发起一次真实团队任务，验证负责人分工、成员协作和最终汇总结果。</Text>
                  </div>
                  <Tag color="geekblue">
                    {workflowOptions.find((item) => item.value === (currentTeam ? currentTeam.workflowMode : form.workflowMode))?.label ||
                      (currentTeam ? currentTeam.workflowMode : form.workflowMode)}
                  </Tag>
                </div>

                <div className="studio-form-field">
                  <Text type="secondary">团队任务</Text>
                  <TextArea
                    value={testPrompt}
                    onChange={(event) => setTestPrompt(event.target.value)}
                    rows={4}
                    placeholder="描述希望团队共同完成的任务。"
                  />
                </div>

                <div className="studio-form-field">
                  <Text type="secondary">追加说明</Text>
                  <TextArea
                    value={retryContext}
                    onChange={(event) => setRetryContext(event.target.value)}
                    rows={3}
                    placeholder="如果要基于历史执行重新发起，可以在这里补充新的限制、信息或修正说明。"
                  />
                </div>

                <div className="studio-form-actions">
                  <Space wrap>
                    <Button type="primary" onClick={() => void handleTestRun()} loading={testing} disabled={!currentTeam}>
                      开始试运行
                    </Button>
                    {latestRun ? (
                      <Button onClick={() => navigate(`/studio/runs/${latestRun.runId}`)}>
                        查看最近执行
                      </Button>
                    ) : null}
                    {currentTeam ? (
                      <Button onClick={() => void loadRecentRuns(currentTeam.teamId)} loading={loadingRuns}>
                        刷新最近执行
                      </Button>
                    ) : null}
                  </Space>
                </div>

                {runError ? <Alert type="error" showIcon message={runError} /> : null}

                <div className="page-section-title">
                  <Typography.Title level={5}>当前团队摘要</Typography.Title>
                  <Text type="secondary">这里展示当前团队的基础配置，方便和最近一次执行结果对照。</Text>
                </div>

                <Space wrap size={[8, 8]}>
                  <Tag color="blue">负责人：{selectedLeader?.name || '未选择'}</Tag>
                  <Tag color="processing">成员：{form.memberAgentIds.length}</Tag>
                  <Tag color="gold">共享知识库：{form.sharedKnowledgeBindingIds.length}</Tag>
                </Space>

                <Paragraph className="studio-result-copy">
                  {workflowOptions.find((item) => item.value === form.workflowMode)?.description || '将按选定方式进行协作。'}
                </Paragraph>

                {activeRecentRun ? (
                  <Alert
                    type="info"
                    showIcon
                    message={`检测到运行中的团队任务：${activeRecentRun.label}`}
                    description="最近执行列表会自动刷新，你也可以直接跳转到执行记录页面查看完整过程。"
                  />
                ) : null}

                {lastResult ? (
                  <div className="studio-run-result">
                    <Text type="secondary">最近一次返回摘要</Text>
                    <Paragraph className="studio-result-copy">{lastResult}</Paragraph>
                  </div>
                ) : null}

                <div className="studio-runs-header">
                  <Typography.Title level={5}>最近执行</Typography.Title>
                </div>

                {loadingRuns ? (
                  <div className="center-box">
                    <Spin />
                  </div>
                ) : recentRuns.length === 0 ? (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="这个团队还没有执行记录。" />
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
                              查看过程
                            </Button>
                            <Button size="small" onClick={() => setTestPrompt(run.taskPreview)}>
                              使用这次任务
                            </Button>
                            {!isActiveRunStatus(run.status) ? (
                              <Button size="small" loading={testing} onClick={() => void handleRetryRun(run.runId, 'direct')}>
                                直接重试
                              </Button>
                            ) : null}
                            {!isActiveRunStatus(run.status) ? (
                              <Button size="small" loading={testing} onClick={() => void handleRetryRun(run.runId, 'append')}>
                                补充说明后重试
                              </Button>
                            ) : null}
                            {isActiveRunStatus(run.status) ? (
                              <Button size="small" danger onClick={() => void handleCancelRun(run.runId)}>
                                请求停止
                              </Button>
                            ) : null}
                          </Space>
                        </div>
                      </List.Item>
                    )}
                  />
                )}

                <div className="studio-runs-header">
                  <Typography.Title level={5}>团队成员</Typography.Title>
                </div>

                {selectedMembers.length === 0 ? (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有选择团队成员。" />
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
            </>
          ) : null}

          {activePanel === 'memory' ? (
            <Card className="config-panel-card studio-agent-run-card">
              <div className="config-card-header">
                <div className="page-section-title">
                  <Typography.Title level={4}>团队记忆</Typography.Title>
                  <Text type="secondary">维护团队共享记忆，并审核成员沉淀出来的候选内容。</Text>
                </div>
                <Tag color="purple">
                  {teamMemory?.candidateCount ?? memoryCandidates.filter((item) => item.status === 'proposed').length} 待处理
                </Tag>
              </div>

              {memoryError ? <Alert type="error" showIcon message={memoryError} /> : null}

              <div className="studio-form-grid">
                <div className="studio-form-field studio-form-field-span-2">
                  <Text type="secondary">团队共享记忆</Text>
                  <TextArea
                    value={teamMemoryDraft}
                    onChange={(event) => setTeamMemoryDraft(event.target.value)}
                    rows={6}
                    placeholder="这里存放团队已经确认过的稳定事实、规则和协作约定。"
                    disabled={!currentTeam}
                  />
                  <Space wrap>
                    <Text type="secondary">
                      {teamMemory?.updatedAt ? `最近更新时间：${formatDateTimeZh(teamMemory.updatedAt)}` : '当前还没有保存过团队共享记忆。'}
                    </Text>
                    {currentTeam ? (
                      <Tag>
                        {teamSharedMemoryOptions.find((item) => item.value === form.teamSharedMemoryPolicy)?.label || form.teamSharedMemoryPolicy}
                      </Tag>
                    ) : null}
                  </Space>
                </div>
              </div>

              <div className="studio-form-actions">
                <Space wrap>
                  <Button icon={<ReloadOutlined />} onClick={() => currentTeam && void loadTeamMemory(currentTeam.teamId)} loading={loadingMemory} disabled={!currentTeam}>
                    刷新记忆
                  </Button>
                  <Button type="primary" icon={<SaveOutlined />} onClick={() => void handleSaveTeamMemory()} loading={savingMemory} disabled={!currentTeam}>
                    保存团队记忆
                  </Button>
                </Space>
              </div>

              <div className="studio-runs-header">
                <Typography.Title level={5}>记忆候选</Typography.Title>
                <Text type="secondary">成员只提出候选，不直接改写团队共享记忆；这里由负责人或人工决定是否采用。</Text>
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
                              应用到团队记忆
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
                <Typography.Title level={5}>记忆检索</Typography.Title>
                <Text type="secondary">可以一起检索工作区记忆、团队记忆、候选内容、团队对话和结果文档。</Text>
              </div>

              <div className="studio-form-field">
                <Text type="secondary">检索关键词</Text>
                <Space wrap>
                  <Input
                    value={memorySearchQuery}
                    onChange={(event) => setMemorySearchQuery(event.target.value)}
                    placeholder="例如：客户升级、处理原则、影响说明"
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
                    { label: '标准', value: 'keyword' },
                    { label: '平衡', value: 'hybrid' },
                    { label: '深度', value: 'semantic' },
                  ]}
                />
                <Text type="secondary">
                  {memorySearchEffectiveMode
                    ? `当前使用：${memorySearchEffectiveMode}`
                    : '标准适合快速查找，平衡适合通用检索，深度适合更宽松的语义召回。'}
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
          ) : null}

        </div>
      </div>
    </div>
  )
}
