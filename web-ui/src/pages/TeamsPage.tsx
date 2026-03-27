import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  App,
  Button,
  Card,
  Collapse,
  Drawer,
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
  CopyOutlined,
  DeleteOutlined,
  PlusOutlined,
  ReloadOutlined,
  SaveOutlined,
  SearchOutlined,
  TeamOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  AppstoreOutlined,
} from '@ant-design/icons'
import { motion } from 'framer-motion'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { api, ApiError } from '../api'
import { artifactRetentionPolicyToForm, buildArtifactRetentionPolicyInput } from '../artifactRetention'
import DevOnly from '../components/DevOnly'
import { useDevMode } from '../devMode'
import { formatDateTimeZh } from '../locale'
import { interactiveLift, interactiveTap, shellSpring } from '../motionTokens'
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
  TeamTestRunResult,
  TeamThreadSummary,
} from '../types'

const { Text, Paragraph } = Typography
const { TextArea } = Input

interface TeamFormState {
  name: string
  description: string
  supervisorAgentId: string
  memberAgentIds: string[]
  sharedKnowledgeBindingIds: string[]
  teamSharedKnowledgePolicy: string
  teamSharedMemoryPolicy: string
  tags: string[]
  enabled: boolean
  artifactArchiveAfterDays: string
  artifactDeleteAfterDays: string
}

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
    supervisorAgentId: '',
    memberAgentIds: [],
    sharedKnowledgeBindingIds: [],
    teamSharedKnowledgePolicy: 'explicit_only',
    teamSharedMemoryPolicy: 'leader_write_member_read',
    tags: [],
    enabled: true,
    artifactArchiveAfterDays: '',
    artifactDeleteAfterDays: '',
  }
}

function teamToForm(team: TeamDefinition): TeamFormState {
  const artifactRetention = artifactRetentionPolicyToForm(team.artifactRetentionPolicy)
  return {
    name: team.name,
    description: team.description,
    supervisorAgentId: team.supervisorAgentId,
    memberAgentIds: [...team.memberAgentIds],
    sharedKnowledgeBindingIds: [...team.sharedKnowledgeBindingIds],
    teamSharedKnowledgePolicy: String(team.memberAccessPolicy?.teamSharedKnowledge || 'explicit_only'),
    teamSharedMemoryPolicy: String(team.memberAccessPolicy?.teamSharedMemory || 'leader_write_member_read'),
    tags: [...team.tags],
    enabled: team.enabled,
    artifactArchiveAfterDays: artifactRetention.archiveAfterDays,
    artifactDeleteAfterDays: artifactRetention.deleteAfterDays,
  }
}

function toPayload(form: TeamFormState): TeamDefinitionMutationInput {
  return {
    name: form.name.trim(),
    description: form.description.trim(),
    supervisorAgentId: form.supervisorAgentId,
    memberAgentIds: [...form.memberAgentIds],
    sharedKnowledgeBindingIds: [...form.sharedKnowledgeBindingIds],
    memberAccessPolicy: {
      teamSharedKnowledge: form.teamSharedKnowledgePolicy,
      teamSharedMemory: form.teamSharedMemoryPolicy,
    },
    tags: [...form.tags],
    enabled: form.enabled,
    artifactRetentionPolicy: buildArtifactRetentionPolicyInput(
      form.artifactArchiveAfterDays,
      form.artifactDeleteAfterDays,
    ),
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
  const location = useLocation()
  const navigate = useNavigate()
  const { teamId } = useParams()
  const { devMode } = useDevMode()
  const selectedTeamId = teamId && teamId !== 'new' ? teamId : null
  const isCreateRoute = location.pathname.endsWith('/studio/teams/new')

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
  const [lastTestRunResult, setLastTestRunResult] = useState<TeamTestRunResult | null>(null)
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
    if (!selectedTeamId) {
      setCurrentTeam(null)
      setForm(createEmptyForm())
      setRecentRuns([])
      setLastResult(null)
      setLastTestRunResult(null)
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
    () => agentOptions.filter((item) => item.value !== form.supervisorAgentId),
    [agentOptions, form.supervisorAgentId],
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
    () => agents.find((agent) => agent.agentId === form.supervisorAgentId) ?? null,
    [agents, form.supervisorAgentId],
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
    let payload: TeamDefinitionMutationInput
    try {
      payload = toPayload(form)
    } catch (payloadError) {
      const nextError = getErrorMessage(payloadError, '产物保留策略无效')
      setError(nextError)
      message.error(nextError)
      return
    }
    if (!payload.name) {
      const nextError = 'Team 名称不能为空。'
      setError(nextError)
      message.error(nextError)
      return
    }
    if (!payload.supervisorAgentId) {
      const nextError = '请先选择负责人 (supervisor agent)。'
      setError(nextError)
      message.error(nextError)
      return
    }
    try {
      setSaving(true)
      setError(null)
      const saved = currentTeam
        ? await api.updateTeam(currentTeam.teamId, payload)
        : await api.createTeam(payload)
      message.success(currentTeam ? 'Team 已更新' : 'Team 已创建')
      await loadWorkspace()
      navigate(`/studio/teams/${saved.teamId}`, { replace: true })
      await loadTeamDetail(saved.teamId)
    } catch (saveError) {
      const nextError = getErrorMessage(saveError, '保存 Team 失败')
      setError(nextError)
      message.error(nextError)
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
      await loadWorkspace()
      navigate('/studio/teams', { replace: true })
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
      setLastTestRunResult(result)
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
      const retryResult = await api.retryTeamRun(currentTeam.teamId, runId, appendContext || undefined)
      setLastResult(null)
      setLastTestRunResult(retryResult)
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
      <div className="stat-card-row">
        <div className="stat-card">
          <div className="stat-card-icon is-primary">
            <TeamOutlined />
          </div>
          <div className="stat-card-copy">
            <div className="stat-card-metric">{teams.length}</div>
            <div className="stat-card-label">已创建团队</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-card-icon is-success">
            <CheckCircleOutlined />
          </div>
          <div className="stat-card-copy">
            <div className="stat-card-metric">{enabledCount}</div>
            <div className="stat-card-label">启用中</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-card-icon is-warning">
            <ClockCircleOutlined />
          </div>
          <div className="stat-card-copy">
            <div className="stat-card-metric">{agents.length}</div>
            <div className="stat-card-label">可选员工</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-card-icon is-info">
            <AppstoreOutlined />
          </div>
          <div className="stat-card-copy">
            <div className="stat-card-metric">{sharedKbCount}</div>
            <div className="stat-card-label">共享知识库</div>
          </div>
        </div>
      </div>

      <div className="page-header-block">
        <div className="page-section-title">
          <Typography.Title level={4}>所有协作团队</Typography.Title>
        </div>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => void loadWorkspace()} loading={loadingWorkspace}>
            刷新
          </Button>
          <Button onClick={() => navigate('/studio/runs')}>查看执行记录</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/studio/teams/new')}>
            新建团队
          </Button>
        </Space>
      </div>

      {error ? <Alert type="error" showIcon message={error} style={{ marginBottom: '16px' }} /> : null}

      {teams.length === 0 && !loadingWorkspace ? (
        <Empty
          image={false}
          description="暂无团队数据"
          className="page-card"
        >
          <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/studio/teams/new')}>
            创建第一个团队
          </Button>
        </Empty>
      ) : (
        <div className="studio-grid-layout">
          {teams.map((item) => (
            <motion.div
              key={item.teamId}
              className="id-badge-card"
              onClick={() => navigate(`/studio/teams/${item.teamId}`)}
              style={{ cursor: 'pointer' }}
              whileHover={interactiveLift}
              whileTap={interactiveTap}
              transition={shellSpring}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <div className="id-badge-body">
                <div 
                  className="id-badge-sticker" 
                  data-status={item.enabled ? 'active' : 'inactive'}
                >
                  {item.enabled ? '在线' : '离线'}
                </div>
                <div className="id-badge-avatar is-team">
                  <TeamOutlined />
                </div>
                <div className="id-badge-info">
                  <h4>{item.name}</h4>
                  <p className="ant-typography-ellipsis ant-typography-ellipsis-single-line">
                    {item.description || '暂无说明'}
                  </p>
                  <div className="id-badge-id">{item.teamId.split('-')[0].toUpperCase()}</div>
                </div>
              </div>
              <div className="id-badge-stats is-two-up">
                <div className="id-badge-stat-item">
                  <span className="id-badge-stat-label">成员</span>
                  <span className="id-badge-stat-value">{item.memberCount}</span>
                </div>
                <div className="id-badge-stat-item">
                  <span className="id-badge-stat-label">知识库</span>
                  <span className="id-badge-stat-value">{item.sharedKnowledgeBindingIds.length}</span>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      <Drawer
        title={currentTeam ? '团队设置' : '新建团队'}
        width="min(680px, calc(100vw - 16px))"
        onClose={() => navigate('/studio/teams')}
        open={!!selectedTeamId || isCreateRoute}
        styles={{ body: { padding: 0 } }}
        extra={
          <Space>
            {currentTeam && (
              <Button icon={<CopyOutlined />} onClick={() => void handleCopy()} loading={copying}>
                复制
              </Button>
            )}
            <Button type="primary" icon={<SaveOutlined />} onClick={() => void handleSave()} loading={saving}>
              保存
            </Button>
          </Space>
        }
      >
        <div className="page-stack studio-drawer-stack">
          {error ? <Alert type="error" showIcon message={error} style={{ margin: '16px 16px 0' }} /> : null}
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
              </div>
              {currentTeam ? <DevOnly><Tag color="blue">{currentTeam.teamId}</Tag></DevOnly> : <Tag>未保存</Tag>}
            </div>

            <div className="studio-form-grid">
              <div className="studio-form-field studio-form-field-span-2">
                <Text type="secondary">名称</Text>
                <Input
                  value={form.name}
                  onChange={(event) => updateForm('name', event.target.value)}
                  placeholder="输入团队名称"
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
                  placeholder="输入团队说明"
                />
              </div>

              <div className="studio-form-field">
                <Text type="secondary">负责人</Text>
                <Select
                  value={form.supervisorAgentId || undefined}
                  onChange={(value) => updateForm('supervisorAgentId', value)}
                  options={agentOptions}
                  placeholder="选择负责人"
                />
              </div>

              <div className="studio-form-field">
                <Text type="secondary">成员</Text>
                <Select
                  mode="multiple"
                  value={form.memberAgentIds}
                  onChange={(value) => updateForm('memberAgentIds', value)}
                  options={memberOptions}
                  placeholder="选择成员"
                />
              </div>

              <div className="studio-form-field studio-form-field-span-2">
                <Text type="secondary">共享知识库</Text>
                <Select
                  mode="multiple"
                  value={form.sharedKnowledgeBindingIds}
                  onChange={(value) => updateForm('sharedKnowledgeBindingIds', value)}
                  options={knowledgeOptions}
                  placeholder="选择共享知识库"
                />
              </div>

              <div className="studio-form-field studio-form-field-span-2">
                <Text type="secondary">标签</Text>
                <Select
                  mode="tags"
                  value={form.tags}
                  onChange={(value) => updateForm('tags', value)}
                  placeholder="输入标签"
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
                        <Text type="secondary">知识库使用权限</Text>
                        <Select
                          value={form.teamSharedKnowledgePolicy}
                          onChange={(value) => updateForm('teamSharedKnowledgePolicy', value)}
                          options={teamSharedKnowledgeOptions}
                        />
                      </div>

                      <div className="studio-form-field">
                        <Text type="secondary">团队记忆共享方式</Text>
                        <Select
                          value={form.teamSharedMemoryPolicy}
                          onChange={(value) => updateForm('teamSharedMemoryPolicy', value)}
                          options={teamSharedMemoryOptions}
                        />
                      </div>
                      <div className="studio-form-field">
                        <Text type="secondary">产物归档天数</Text>
                        <Input
                          value={form.artifactArchiveAfterDays}
                          onChange={(event) => updateForm('artifactArchiveAfterDays', event.target.value)}
                          placeholder="留空表示不归档"
                        />
                      </div>
                      <div className="studio-form-field">
                        <Text type="secondary">产物删除天数</Text>
                        <Input
                          value={form.artifactDeleteAfterDays}
                          onChange={(event) => updateForm('artifactDeleteAfterDays', event.target.value)}
                          placeholder="留空表示不删除"
                        />
                      </div>
                      <div className="studio-form-field studio-form-field-span-2">
                        <Text type="secondary">
                          留空时回退到租户默认策略；Team 模板策略会覆盖成员模板策略。
                        </Text>
                      </div>
                    </div>
                  ),
                },
              ]}
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
                  <Empty image={false} description="先保存团队" />
                ) : loadingThread && teamThreadMessages.length === 0 ? (
                  <div className="center-box">
                    <Spin />
                  </div>
                ) : teamThreadMessages.length === 0 ? (
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
                  </div>
                  <Tag color="geekblue">{devMode ? 'Supervisor 模式' : '负责人汇总模式'}</Tag>
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
                </div>

                <Space wrap size={[8, 8]}>
                  <Tag color="blue">负责人：{selectedLeader?.name || '未选择'}</Tag>
                  <Tag color="processing">成员：{form.memberAgentIds.length}</Tag>
                  <Tag color="gold">共享知识库：{form.sharedKnowledgeBindingIds.length}</Tag>
                </Space>

                {activeRecentRun ? (
                  <Alert
                    type="info"
                    showIcon
                    message={`检测到运行中的团队任务：${activeRecentRun.label}`}
                  />
                ) : null}

                {lastResult ? (
                  <div className="studio-run-result">
                    <Text type="secondary">最近一次返回摘要</Text>
                    <Paragraph className="studio-result-copy">{lastResult}</Paragraph>
                  </div>
                ) : null}

                {lastTestRunResult ? (
                  <Collapse
                    className="studio-inline-collapse"
                    items={[
                      {
                        key: 'decomposition',
                        label: '运行分解',
                        children: (
                          <div className="page-stack">
                            <div className="studio-form-field">
                              <Text type="secondary">{devMode ? 'Supervisor 运行' : '负责人汇总'}</Text>
                              {lastTestRunResult.supervisorRun ? (
                                <div className="studio-run-list-copy">
                                  <Space wrap>
                                    <strong>{lastTestRunResult.supervisorRun.label}</strong>
                                    <Tag color={lastTestRunResult.supervisorRun.status === 'succeeded' ? 'success' : lastTestRunResult.supervisorRun.status === 'failed' ? 'error' : 'processing'}>
                                      {lastTestRunResult.supervisorRun.status}
                                    </Tag>
                                    <Button size="small" onClick={() => navigate(`/studio/runs/${lastTestRunResult.supervisorRun!.runId}`)}>
                                      查看过程
                                    </Button>
                                  </Space>
                                  {lastTestRunResult.supervisorRun.resultSummary?.content ? (
                                    <Paragraph className="studio-run-preview" ellipsis={{ rows: 3 }}>
                                      {lastTestRunResult.supervisorRun.resultSummary.content}
                                    </Paragraph>
                                  ) : null}
                                </div>
                              ) : (
                                <Text type="secondary">{devMode ? '暂无 Supervisor 运行记录' : '暂无负责人汇总记录'}</Text>
                              )}
                            </div>

                            <div className="studio-form-field">
                              <Text type="secondary">成员运行 ({lastTestRunResult.memberRuns.length})</Text>
                              {lastTestRunResult.memberRuns.length === 0 ? (
                                <Text type="secondary">暂无成员运行记录</Text>
                              ) : (
                                <List
                                  className="studio-run-list"
                                  size="small"
                                  dataSource={lastTestRunResult.memberRuns}
                                  renderItem={(memberRun) => (
                                    <List.Item className="studio-run-list-item">
                                      <div className="studio-run-list-copy">
                                        <Space wrap>
                                          <strong>{memberRun.label}</strong>
                                          <Tag color={memberRun.status === 'succeeded' ? 'success' : memberRun.status === 'failed' ? 'error' : 'processing'}>
                                            {memberRun.status}
                                          </Tag>
                                          <Button size="small" onClick={() => navigate(`/studio/runs/${memberRun.runId}`)}>
                                            查看过程
                                          </Button>
                                        </Space>
                                        {memberRun.resultSummary?.content ? (
                                          <Paragraph className="studio-run-preview" ellipsis={{ rows: 2 }}>
                                            {memberRun.resultSummary.content}
                                          </Paragraph>
                                        ) : null}
                                      </div>
                                    </List.Item>
                                  )}
                                />
                              )}
                            </div>

                            {lastTestRunResult.finalAssistantMessage ? (
                              <div className="studio-form-field">
                                <Text type="secondary">最终回复</Text>
                                <Paragraph className="studio-result-copy">
                                  {lastTestRunResult.finalAssistantMessage.content}
                                </Paragraph>
                              </div>
                            ) : null}

                            {lastTestRunResult.teamKnowledgeHits.length > 0 ? (
                              <div className="studio-form-field">
                                <Text type="secondary">团队知识命中 ({lastTestRunResult.teamKnowledgeHits.length})</Text>
                                <Space wrap>
                                  {lastTestRunResult.teamKnowledgeHits.map((hit, idx) => (
                                    <Tag key={idx} color="gold">{hit.title || hit.docId}</Tag>
                                  ))}
                                </Space>
                              </div>
                            ) : null}
                          </div>
                        ),
                      },
                    ]}
                  />
                ) : null}

                <div className="studio-runs-header">
                  <Typography.Title level={5}>最近执行</Typography.Title>
                </div>

                {loadingRuns ? (
              <div className="center-box">
                <Spin />
              </div>
            ) : recentRuns.length === 0 ? (
              <Empty image={false} description="暂无运行记录" />
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
                  <Empty image={false} description="暂无团队成员" />
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
                      {teamMemory?.updatedAt ? `最近更新：${formatDateTimeZh(teamMemory.updatedAt)}` : '未保存'}
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
                  <Button onClick={() => currentTeam && navigate(`/studio/memory/${currentTeam.teamId}`)} disabled={!currentTeam}>
                    进入统一记忆审计
                  </Button>
                </Space>
              </div>

              <div className="studio-runs-header">
                <Typography.Title level={5}>记忆候选</Typography.Title>
              </div>

              {loadingMemory && memoryCandidates.length === 0 ? (
                <div className="center-box">
                  <Spin />
                </div>
              ) : memoryCandidates.length === 0 ? (
                <Empty image={false} description="暂无记忆候选" />
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
                {memorySearchEffectiveMode ? (
                  <Text type="secondary">当前：{memorySearchEffectiveMode}</Text>
                ) : null}
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
      </Drawer>
    </div>
  )
}
