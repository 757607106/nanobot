import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  App,
  AutoComplete,
  Button,
  Card,
  Collapse,
  Empty,
  Input,
  Select,
  Space,
  Spin,
  Switch,
  Tabs,
  Tag,
  Typography,
  Drawer,
} from 'antd'
import {
  CopyOutlined,
  DeleteOutlined,
  ExperimentOutlined,
  PlusOutlined,
  ReloadOutlined,
  RobotOutlined,
  SaveOutlined,
  AppstoreOutlined,
  ClockCircleOutlined,
  CheckCircleOutlined,
  MessageOutlined,
} from '@ant-design/icons'
import { motion } from 'framer-motion'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { api, ApiError } from '../api'
import { artifactRetentionPolicyToForm, buildArtifactRetentionPolicyInput } from '../artifactRetention'
import DevOnly from '../components/DevOnly'
import { useDevMode } from '../devMode'
import { getModelSuggestions } from '../modelCatalog'
import {
  getAllModelBindings,
  getPreferredProvider,
  getProviderOptions,
  inferProviderFromModel,
  modelMatchesProvider,
  resolveBindingCapabilityType,
} from '../modelConfig'
import { interactiveLift, interactiveTap, shellSpring } from '../motionTokens'
import { formatDateTimeZh } from '../locale'
import type {
  AgentDefinition,
  AgentDefinitionMutationInput,
  AgentMemorySnapshot,
  AgentRunSummary,
  AgentTemplateTool,
  ConfigData,
  ConfigMeta,
  InstalledSkill,
  KnowledgeBaseDefinition,
  MemoryCandidate,
  McpServerEntry,
} from '../types'

const { Text, Paragraph } = Typography
const { TextArea } = Input

interface AgentFormState {
  name: string
  description: string
  systemPrompt: string
  rulesText: string
  model: string
  binding: string
  provider: string
  backend: string
  enabled: boolean
  toolAllowlist: string[]
  mcpServerIds: string[]
  skillIds: string[]
  knowledgeBindingIds: string[]
  tags: string[]
  memoryScope: string
  artifactArchiveAfterDays: string
  artifactDeleteAfterDays: string
}

function createEmptyForm(): AgentFormState {
  return {
    name: '',
    description: '',
    systemPrompt: [
      '# Agent Profile',
      '',
      '你是一个面向明确任务的数字员工。',
      '优先利用已绑定的工具、MCP 和技能完成任务。',
      '给出清晰结果，必要时说明证据和边界。',
    ].join('\n'),
    rulesText: ['先确认任务边界', '优先使用已绑定能力', '输出结论时保持结构清晰'].join('\n'),
    model: '',
    binding: '',
    provider: '',
    backend: '',
    enabled: true,
    toolAllowlist: [],
    mcpServerIds: [],
    skillIds: [],
    knowledgeBindingIds: [],
    tags: [],
    memoryScope: 'agent_profile',
    artifactArchiveAfterDays: '',
    artifactDeleteAfterDays: '',
  }
}

function agentToForm(agent: AgentDefinition): AgentFormState {
  const artifactRetention = artifactRetentionPolicyToForm(agent.artifactRetentionPolicy)
  return {
    name: agent.name,
    description: agent.description,
    systemPrompt: agent.systemPrompt,
    rulesText: agent.rules.join('\n'),
    model: agent.model || '',
    binding: agent.binding || '',
    provider: agent.provider || '',
    backend: agent.backend || '',
    enabled: agent.enabled,
    toolAllowlist: [...agent.toolAllowlist],
    mcpServerIds: [...agent.mcpServerIds],
    skillIds: [...agent.skillIds],
    knowledgeBindingIds: [...agent.knowledgeBindingIds],
    tags: [...agent.tags],
    memoryScope: agent.memoryScope || 'agent_profile',
    artifactArchiveAfterDays: artifactRetention.archiveAfterDays,
    artifactDeleteAfterDays: artifactRetention.deleteAfterDays,
  }
}

function parseRules(value: string) {
  return Array.from(
    new Set(
      value
        .split('\n')
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  )
}

function toPayload(
  form: AgentFormState,
  availableBindings: Record<string, { provider: string; model?: string | null }>,
): AgentDefinitionMutationInput {
  const bindingConfig = form.binding ? availableBindings[form.binding] : undefined
  const binding = form.binding.trim() || null
  const provider = binding
    ? bindingConfig?.provider || null
    : form.provider.trim() || null
  const model = binding
    ? form.model.trim() || bindingConfig?.model || null
    : form.model.trim() || null

  return {
    name: form.name.trim(),
    description: form.description.trim(),
    systemPrompt: form.systemPrompt.trim(),
    rules: parseRules(form.rulesText),
    model,
    binding,
    provider,
    backend: form.backend.trim() || null,
    enabled: form.enabled,
    toolAllowlist: [...form.toolAllowlist],
    mcpServerIds: [...form.mcpServerIds],
    skillIds: [...form.skillIds],
    knowledgeBindingIds: [...form.knowledgeBindingIds],
    tags: [...form.tags],
    memoryScope: form.memoryScope,
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

const memoryScopeOptions = [
  { value: 'agent_profile', label: '仅员工自身' },
  { value: 'workspace_shared', label: '工作区共享' },
]

function memoryScopeLabel(scope: string) {
  return memoryScopeOptions.find((item) => item.value === scope)?.label || scope
}

export default function AgentsPage() {
  const { message } = App.useApp()
  const location = useLocation()
  const navigate = useNavigate()
  const { agentId } = useParams()
  const { devMode } = useDevMode()
  const selectedAgentId = agentId && agentId !== 'new' ? agentId : null
  const isCreateRoute = location.pathname.endsWith('/studio/agents/new')

  const [agents, setAgents] = useState<AgentDefinition[]>([])
  const [validTools, setValidTools] = useState<AgentTemplateTool[]>([])
  const [skills, setSkills] = useState<InstalledSkill[]>([])
  const [mcpServers, setMcpServers] = useState<McpServerEntry[]>([])
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBaseDefinition[]>([])
  const [currentAgent, setCurrentAgent] = useState<AgentDefinition | null>(null)
  const [agentMemory, setAgentMemory] = useState<AgentMemorySnapshot | null>(null)
  const [agentMemoryCandidates, setAgentMemoryCandidates] = useState<MemoryCandidate[]>([])
  const [recentRuns, setRecentRuns] = useState<AgentRunSummary[]>([])
  const [form, setForm] = useState<AgentFormState>(() => createEmptyForm())
  const [agentMemoryDraft, setAgentMemoryDraft] = useState('')
  const [agentCandidateDraft, setAgentCandidateDraft] = useState('')
  const [testPrompt, setTestPrompt] = useState('请基于当前配置，给我一个可执行的任务处理方案。')
  const [lastResult, setLastResult] = useState<string | null>(null)
  const [loadingWorkspace, setLoadingWorkspace] = useState(true)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [loadingMemory, setLoadingMemory] = useState(false)
  const [loadingRuns, setLoadingRuns] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savingMemory, setSavingMemory] = useState(false)
  const [creatingMemoryCandidate, setCreatingMemoryCandidate] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [copying, setCopying] = useState(false)
  const [testing, setTesting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [memoryError, setMemoryError] = useState<string | null>(null)
  const [runError, setRunError] = useState<string | null>(null)
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)
  const [globalConfig, setGlobalConfig] = useState<ConfigData | null>(null)
  const [globalConfigMeta, setGlobalConfigMeta] = useState<ConfigMeta | null>(null)
  const [capabilityTab, setCapabilityTab] = useState('tools')
  const [drawerTab, setDrawerTab] = useState('basic')

  useEffect(() => {
    void loadWorkspace()
  }, [])

  useEffect(() => {
    if (loadingWorkspace) {
      return
    }
    if (!selectedAgentId) {
      setCurrentAgent(null)
      setAgentMemory(null)
      setAgentMemoryCandidates([])
      setAgentMemoryDraft('')
      setAgentCandidateDraft('')
      setRecentRuns([])
      setLastResult(null)
      setForm(createEmptyForm())
      setIsDrawerOpen(isCreateRoute)
      return
    }
    void loadAgentDetail(selectedAgentId)
    void loadAgentMemoryGovernance(selectedAgentId)
    void loadRecentRuns(selectedAgentId)
    setIsDrawerOpen(true)
  }, [agents, isCreateRoute, loadingWorkspace, selectedAgentId])

  const handleCloseDrawer = () => {
    setIsDrawerOpen(false)
    navigate('/studio/agents')
  }

  const enabledCount = useMemo(() => agents.filter((item) => item.enabled).length, [agents])

  const agentProviderOptions = useMemo(
    () => getProviderOptions(globalConfigMeta),
    [globalConfigMeta],
  )
  const availableBindings = useMemo(
    () => (globalConfig ? getAllModelBindings(globalConfig, globalConfigMeta) : {}),
    [globalConfig, globalConfigMeta],
  )
  const agentBindingOptions = useMemo(
    () => Object.entries(availableBindings)
      .filter(([, binding]) => {
        const capabilityType = resolveBindingCapabilityType(binding)
        return capabilityType === 'text_chat' || capabilityType === 'multimodal'
      })
      .map(([bindingName, binding]) => ({
        value: bindingName,
        label: String(binding.model || bindingName).trim() || bindingName,
      }))
      .sort((left, right) => left.label.localeCompare(right.label)),
    [availableBindings],
  )
  const selectedBindingConfig = form.binding ? availableBindings[form.binding] : null
  const selectedBindingProviderLabel = useMemo(() => {
    const providerName = selectedBindingConfig?.provider
    if (!providerName) {
      return ''
    }
    return globalConfigMeta?.providers.find((item) => item.name === providerName)?.label || providerName
  }, [globalConfigMeta, selectedBindingConfig])

  const modelSuggestions = useMemo(() => {
    if (!globalConfig || !globalConfigMeta) return []
    const provider = (form.binding ? availableBindings[form.binding]?.provider : null)
      || form.provider
      || inferProviderFromModel(globalConfigMeta, form.model || null)
      || getPreferredProvider(globalConfig, globalConfigMeta)
    return getModelSuggestions(provider, form.model || null).map((m) => ({ value: m, label: m }))
  }, [availableBindings, form.binding, form.model, form.provider, globalConfig, globalConfigMeta])

  const toolCardItems = useMemo(() => {
    const map = new Map(validTools.map((item) => [item.name, { name: item.name, description: item.description, isOrphan: false }]))
    for (const toolName of form.toolAllowlist) {
      if (!map.has(toolName)) {
        map.set(toolName, { name: toolName, description: '当前定义中的工具', isOrphan: true })
      }
    }
    return Array.from(map.entries()).map(([key, meta]) => ({ key, ...meta }))
  }, [form.toolAllowlist, validTools])

  const skillCardItems = useMemo(() => {
    const map = new Map(skills.map((item) => [item.id, { name: item.name, description: item.description || item.name, isOrphan: false }]))
    for (const skillId of form.skillIds) {
      if (!map.has(skillId)) {
        map.set(skillId, { name: skillId, description: '当前定义中的技能', isOrphan: true })
      }
    }
    return Array.from(map.entries()).map(([key, meta]) => ({ key, ...meta }))
  }, [form.skillIds, skills])

  const mcpCardItems = useMemo(() => {
    const map = new Map(mcpServers.map((item) => [item.name, { name: item.displayName || item.name, description: `${item.toolCount ?? '?'} 个工具`, isOrphan: false }]))
    for (const serverId of form.mcpServerIds) {
      if (!map.has(serverId)) {
        map.set(serverId, { name: serverId, description: '当前定义中的服务', isOrphan: true })
      }
    }
    return Array.from(map.entries()).map(([key, meta]) => ({ key, ...meta }))
  }, [form.mcpServerIds, mcpServers])

  const knowledgeCardItems = useMemo(() => {
    const map = new Map(knowledgeBases.map((item) => [item.kbId, { name: item.name, description: item.description || '知识库', isOrphan: false }]))
    for (const kbId of form.knowledgeBindingIds) {
      if (!map.has(kbId)) {
        map.set(kbId, { name: kbId, description: '当前定义中的知识库', isOrphan: true })
      }
    }
    return Array.from(map.entries()).map(([key, meta]) => ({ key, ...meta }))
  }, [form.knowledgeBindingIds, knowledgeBases])

  async function loadWorkspace() {
    try {
      setLoadingWorkspace(true)
      const [agentList, toolCatalog, skillList, mcpRegistry, kbList, configResult, metaResult] = await Promise.all([
        api.getAgents(),
        api.getValidTemplateTools(),
        api.getInstalledSkills(),
        api.getMcpServers(),
        api.getKnowledgeBases(true),
        api.getConfig().catch(() => null),
        api.getConfigMeta().catch(() => null),
      ])
      setAgents(agentList)
      setValidTools(toolCatalog)
      setSkills(skillList)
      setMcpServers(mcpRegistry.items)
      setKnowledgeBases(kbList)
      setGlobalConfig(configResult)
      setGlobalConfigMeta(metaResult)
      setError(null)
    } catch (loadError) {
      setError(getErrorMessage(loadError, '加载协作域失败'))
    } finally {
      setLoadingWorkspace(false)
    }
  }

  async function loadAgentDetail(nextAgentId: string) {
    try {
      setLoadingDetail(true)
      const detail = await api.getAgent(nextAgentId)
      setCurrentAgent(detail)
      setForm(agentToForm(detail))
      setError(null)
    } catch (loadError) {
      setError(getErrorMessage(loadError, '加载 Agent 详情失败'))
    } finally {
      setLoadingDetail(false)
    }
  }

  async function loadRecentRuns(nextAgentId: string) {
    try {
      setLoadingRuns(true)
      const payload = await api.getRuns({
        agentId: nextAgentId,
        kind: 'agent',
        limit: 8,
      })
      setRecentRuns(payload.items)
      setRunError(null)
    } catch (loadError) {
      setRunError(getErrorMessage(loadError, '加载最近运行失败'))
    } finally {
      setLoadingRuns(false)
    }
  }

  async function loadAgentMemoryGovernance(nextAgentId: string) {
    try {
      setLoadingMemory(true)
      const [snapshot, candidates] = await Promise.all([
        api.getAgentMemory(nextAgentId),
        api.getMemoryCandidates({
          agentId: nextAgentId,
          scope: 'agent_profile',
          limit: 50,
        }),
      ])
      setAgentMemory(snapshot)
      setAgentMemoryDraft(snapshot.content || '')
      setAgentMemoryCandidates(candidates.items)
      setMemoryError(null)
    } catch (loadError) {
      setMemoryError(getErrorMessage(loadError, '加载员工记忆失败'))
    } finally {
      setLoadingMemory(false)
    }
  }

  function updateForm<K extends keyof AgentFormState>(key: K, value: AgentFormState[K]) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  function updateProvider(value: string) {
    setForm((current) => {
      const nextProvider = value
      const currentModel = current.model.trim()
      const nextModel = nextProvider && !modelMatchesProvider(globalConfigMeta, nextProvider, currentModel)
        ? getModelSuggestions(nextProvider)[0] || current.model
        : current.model

      return {
        ...current,
        binding: current.binding && availableBindings[current.binding]?.provider === nextProvider ? current.binding : '',
        provider: nextProvider,
        model: nextModel,
      }
    })
  }

  function updateBinding(value: string) {
    setForm((current) => {
      const nextBinding = value
      const bindingConfig = availableBindings[nextBinding]
      const nextProvider = bindingConfig?.provider || ''
      const currentModel = current.model.trim()
      let nextModel = current.model

      if (bindingConfig?.model) {
        nextModel = bindingConfig.model
      } else if (nextProvider && currentModel && !modelMatchesProvider(globalConfigMeta, nextProvider, currentModel)) {
        nextModel = getModelSuggestions(nextProvider)[0] || current.model
      }

      return {
        ...current,
        binding: nextBinding,
        provider: nextProvider || current.provider,
        model: nextModel,
      }
    })
  }

  function toggleArrayItem(key: 'toolAllowlist' | 'skillIds' | 'mcpServerIds' | 'knowledgeBindingIds', item: string) {
    setForm((prev) => ({
      ...prev,
      [key]: prev[key].includes(item) ? prev[key].filter((v) => v !== item) : [...prev[key], item],
    }))
  }

  function renderCapabilityCards(
    items: Array<{ key: string; name: string; description: string; isOrphan?: boolean }>,
    selectedKeys: string[],
    onToggle: (key: string) => void,
    emptyText: string,
  ) {
    if (items.length === 0) {
      return <Empty image={false} description={emptyText} />
    }
    return (
      <div className="capability-card-grid">
        {items.map((item) => {
          const isSelected = selectedKeys.includes(item.key)
          return (
            <div
              key={item.key}
              className={`capability-card${isSelected ? ' is-selected' : ''}${item.isOrphan ? ' is-orphan' : ''}`}
              onClick={() => onToggle(item.key)}
            >
              {isSelected && <CheckCircleOutlined className="capability-card-check" />}
              <div className="capability-card-name">{item.name}</div>
              <div className="capability-card-desc">{item.description}</div>
            </div>
          )
        })}
      </div>
    )
  }

  async function handleSave() {
    let payload: AgentDefinitionMutationInput
    try {
      payload = toPayload(form, availableBindings)
    } catch (payloadError) {
      const nextError = getErrorMessage(payloadError, '产物保留策略无效')
      setError(nextError)
      message.error(nextError)
      return
    }
    if (!payload.name) {
      const nextError = '员工名称不能为空。'
      setError(nextError)
      message.error(nextError)
      return
    }
    if (!payload.systemPrompt) {
      const nextError = '角色说明不能为空。'
      setError(nextError)
      message.error(nextError)
      return
    }
    if (!(payload.rules || []).length) {
      const nextError = '至少需要一条运行规则。'
      setError(nextError)
      message.error(nextError)
      return
    }
    try {
      setSaving(true)
      setError(null)
      const saved = currentAgent
        ? await api.updateAgent(currentAgent.agentId, payload)
        : await api.createAgent(payload)
      message.success(currentAgent ? 'Agent 已更新' : 'Agent 已创建')
      await loadWorkspace()
      navigate(`/studio/agents/${saved.agentId}`, { replace: true })
      await loadAgentDetail(saved.agentId)
      await loadAgentMemoryGovernance(saved.agentId)
      await loadRecentRuns(saved.agentId)
    } catch (saveError) {
      const nextError = getErrorMessage(saveError, '保存 Agent 失败')
      setError(nextError)
      message.error(nextError)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!currentAgent) {
      return
    }
    try {
      setDeleting(true)
      await api.deleteAgent(currentAgent.agentId)
      message.success('Agent 已删除')
      const remaining = agents.filter((item) => item.agentId !== currentAgent.agentId)
      await loadWorkspace()
      if (remaining[0]) {
        navigate(`/studio/agents/${remaining[0].agentId}`, { replace: true })
      } else {
        navigate('/studio/agents/new', { replace: true })
      }
    } catch (deleteError) {
      setError(getErrorMessage(deleteError, '删除 Agent 失败'))
    } finally {
      setDeleting(false)
    }
  }

  async function handleCopy() {
    if (!currentAgent) {
      return
    }
    try {
      setCopying(true)
      const copied = await api.copyAgent(currentAgent.agentId)
      message.success('Agent 已复制')
      await loadWorkspace()
      navigate(`/studio/agents/${copied.agentId}`, { replace: true })
    } catch (copyError) {
      setError(getErrorMessage(copyError, '复制 Agent 失败'))
    } finally {
      setCopying(false)
    }
  }

  async function handleTestRun() {
    if (!currentAgent) {
      setRunError('请先保存 Agent，再发起测试运行。')
      return
    }
    if (!testPrompt.trim()) {
      setRunError('请输入测试任务。')
      return
    }
    try {
      setTesting(true)
      const result = await api.testRunAgent(currentAgent.agentId, testPrompt.trim())
      setLastResult(result.assistantMessage?.content || result.run.resultSummary?.content || '本次运行未返回可显示摘要。')
      if (result.knowledgeHits.length > 0) {
        message.success(`测试运行已完成，并命中 ${result.knowledgeHits.length} 条知识证据`)
      } else {
        message.success('测试运行已完成')
      }
      await loadRecentRuns(currentAgent.agentId)
      setRunError(null)
    } catch (testError) {
      setRunError(getErrorMessage(testError, '测试运行失败'))
    } finally {
      setTesting(false)
    }
  }

  async function handleSaveAgentMemory() {
    if (!currentAgent) {
      setMemoryError('请先保存员工，再维护其长期记忆。')
      return
    }
    try {
      setSavingMemory(true)
      const snapshot = await api.updateAgentMemory(currentAgent.agentId, agentMemoryDraft)
      setAgentMemory(snapshot)
      setAgentMemoryDraft(snapshot.content || '')
      message.success('员工记忆已保存')
      await loadAgentMemoryGovernance(currentAgent.agentId)
    } catch (saveError) {
      setMemoryError(getErrorMessage(saveError, '保存员工记忆失败'))
    } finally {
      setSavingMemory(false)
    }
  }

  async function handleCreateAgentMemoryCandidate() {
    if (!currentAgent) {
      setMemoryError('请先保存员工，再提交记忆候选。')
      return
    }
    if (!agentCandidateDraft.trim()) {
      setMemoryError('请输入候选记忆内容。')
      return
    }
    try {
      setCreatingMemoryCandidate(true)
      await api.createAgentMemoryCandidate(currentAgent.agentId, {
        content: agentCandidateDraft.trim(),
        sourceKind: 'manual_note',
      })
      setAgentCandidateDraft('')
      message.success('员工记忆候选已提交')
      await loadAgentMemoryGovernance(currentAgent.agentId)
    } catch (createError) {
      setMemoryError(getErrorMessage(createError, '提交员工记忆候选失败'))
    } finally {
      setCreatingMemoryCandidate(false)
    }
  }

  async function handleApplyAgentMemoryCandidate(candidateId: string) {
    if (!currentAgent) {
      return
    }
    try {
      await api.applyMemoryCandidate(candidateId)
      message.success('候选已应用到员工记忆')
      await loadAgentMemoryGovernance(currentAgent.agentId)
    } catch (applyError) {
      setMemoryError(getErrorMessage(applyError, '应用员工记忆候选失败'))
    }
  }

  async function handleRejectAgentMemoryCandidate(candidateId: string) {
    if (!currentAgent) {
      return
    }
    try {
      await api.rejectMemoryCandidate(candidateId)
      message.success('候选已忽略')
      await loadAgentMemoryGovernance(currentAgent.agentId)
    } catch (rejectError) {
      setMemoryError(getErrorMessage(rejectError, '忽略员工记忆候选失败'))
    }
  }

  if (loadingWorkspace && agents.length === 0 && !selectedAgentId) {
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
            <RobotOutlined />
          </div>
          <div className="stat-card-copy">
            <div className="stat-card-metric">{agents.length}</div>
            <div className="stat-card-label">员工总数</div>
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
            <div className="stat-card-metric">{recentRuns.length}</div>
            <div className="stat-card-label">最近执行</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-card-icon is-info">
            <AppstoreOutlined />
          </div>
          <div className="stat-card-copy">
            <div className="stat-card-metric">{knowledgeBases.length}</div>
            <div className="stat-card-label">可用知识库</div>
          </div>
        </div>
      </div>

      <div className="page-header-block">
        <div className="page-section-title">
          <Typography.Title level={4}>所有数字员工</Typography.Title>
        </div>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => void loadWorkspace()} loading={loadingWorkspace}>
            刷新
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/studio/agents/new')}>
            创建新员工
          </Button>
        </Space>
      </div>

      {error ? <Alert type="error" showIcon message={error} style={{ marginBottom: '16px' }} /> : null}

      {agents.length === 0 && !loadingWorkspace ? (
        <Empty
          image={false}
          description="暂无员工数据"
          className="page-card"
        >
          <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/studio/agents/new')}>
            创建员工
          </Button>
        </Empty>
      ) : (
        <div className="studio-grid-layout">
          {agents.map((item) => (
            <motion.div
              key={item.agentId}
              className="id-badge-card"
              onClick={() => navigate(`/studio/agents/${item.agentId}`)}
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
                  {item.enabled ? '在职' : '离职'}
                </div>
                <div className="id-badge-avatar">
                  {item.name.charAt(0).toUpperCase()}
                </div>
                <div className="id-badge-info">
                  <h4>{item.name}</h4>
                  <p className="ant-typography-ellipsis ant-typography-ellipsis-single-line">
                    {item.description || '暂无职责说明'}
                  </p>
                  <div className="id-badge-id">{item.agentId.split('-')[0].toUpperCase()}</div>
                </div>
                {item.tags && item.tags.length > 0 && (
                  <div className="id-badge-tag">
                    {item.tags[0]}
                  </div>
                )}
              </div>
              <div className="id-badge-stats">
                <div className="id-badge-stat-item">
                  <span className="id-badge-stat-label">模型</span>
                  <span className="id-badge-stat-value">{item.model ? '定制' : '默认'}</span>
                </div>
                <div className="id-badge-stat-item">
                  <span className="id-badge-stat-label">工具</span>
                  <span className="id-badge-stat-value">{item.toolAllowlist.length}</span>
                </div>
                <div className="id-badge-stat-item">
                  <span className="id-badge-stat-label">技能</span>
                  <span className="id-badge-stat-value">{item.skillIds.length}</span>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      <Drawer
        title={null}
        width="min(680px, calc(100vw - 16px))"
        onClose={handleCloseDrawer}
        open={isDrawerOpen}
        styles={{ header: { display: 'none' }, body: { padding: 0 } }}
        className="agent-detail-drawer"
      >
        {/* Custom Drawer Header */}
        <div className="agent-drawer-header">
          <div className="agent-drawer-header-left">
            <div className="agent-drawer-avatar" data-status={form.enabled ? 'active' : 'inactive'}>
              {form.name ? form.name.charAt(0).toUpperCase() : '?'}
            </div>
            <div className="agent-drawer-identity">
              <h3 className="agent-drawer-name">
                {form.name || (currentAgent ? '未命名员工' : '新建员工')}
              </h3>
              <div className="agent-drawer-meta">
                <Tag color={form.enabled ? 'success' : 'default'} style={{ marginRight: 6 }}>
                  {form.enabled ? '在职' : '离职'}
                </Tag>
                {currentAgent?.sourceTemplateName && (
                  <Tag color="purple">模板：{currentAgent.sourceTemplateName}</Tag>
                )}
                {currentAgent && (
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {currentAgent.agentId.split('-')[0].toUpperCase()}
                  </Text>
                )}
              </div>
            </div>
          </div>
          <Space className="agent-drawer-header-actions">
            {currentAgent && (
              <Button size="small" icon={<MessageOutlined />} onClick={() => navigate(`/studio/agents/${currentAgent.agentId}/chat`)}>
                会话
              </Button>
            )}
            <Button size="small" type="primary" icon={<SaveOutlined />} onClick={() => void handleSave()} loading={saving}>
              保存
            </Button>
            <Button size="small" type="text" onClick={handleCloseDrawer} style={{ fontSize: 18, lineHeight: 1 }}>
              ✕
            </Button>
          </Space>
        </div>

        {/* Drawer-level Tab Navigation */}
        <Tabs
          activeKey={drawerTab}
          onChange={setDrawerTab}
          className="agent-drawer-tabs"
          items={[
            {
              key: 'basic',
              label: '基本信息',
              children: (
                <div className="agent-drawer-tab-body">
                  {error ? <Alert type="error" showIcon message={error} closable onClose={() => setError(null)} style={{ marginBottom: 16 }} /> : null}
                  <Spin spinning={loadingDetail}>
                    <div className="studio-form-grid">
                      <div className="studio-form-field studio-form-field-span-2">
                        <Text type="secondary">名称</Text>
                        <Input
                          value={form.name}
                          onChange={(event) => updateForm('name', event.target.value)}
                          placeholder="输入员工名称"
                        />
                      </div>

                      <div className="studio-form-field">
                        <Text type="secondary">标签</Text>
                        <Select
                          mode="tags"
                          value={form.tags}
                          onChange={(value) => updateForm('tags', value)}
                          placeholder="输入标签"
                        />
                      </div>

                      <div className="studio-form-field">
                        <Text type="secondary">模型绑定</Text>
                        <Select
                          allowClear
                          value={form.binding || undefined}
                          onChange={(value) => updateBinding(value ?? '')}
                          options={agentBindingOptions}
                          placeholder="推荐直接选择模型绑定"
                        />
                      </div>

                      <div className="studio-form-field studio-form-switch-field">
                        <Text type="secondary">启用状态</Text>
                        <Switch checked={form.enabled} onChange={(checked) => updateForm('enabled', checked)} />
                      </div>

                      <div className="studio-form-field studio-form-field-span-2">
                        <Text type="secondary">职责说明</Text>
                        <TextArea
                          value={form.description}
                          onChange={(event) => updateForm('description', event.target.value)}
                          rows={3}
                          placeholder="输入职责说明"
                        />
                      </div>

                      <div className="studio-form-field studio-form-field-span-2">
                        <Text type="secondary">角色说明</Text>
                        <TextArea
                          value={form.systemPrompt}
                          onChange={(event) => updateForm('systemPrompt', event.target.value)}
                          rows={8}
                          placeholder="输入角色说明"
                        />
                      </div>

                      <div className="studio-form-field studio-form-field-span-2">
                        <Text type="secondary">工作规则</Text>
                        <TextArea
                          value={form.rulesText}
                          onChange={(event) => updateForm('rulesText', event.target.value)}
                          rows={4}
                          placeholder="输入工作规则"
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
                              <div className="studio-form-field studio-form-field-span-2">
                                <Text type="secondary">
                                  兼容模式仅在未选择模型绑定时使用；如果已经选择了模型绑定，下方供应商和模型会被该绑定覆盖。
                                </Text>
                              </div>
                              <div className="studio-form-field">
                                <Text type="secondary">兼容供应商</Text>
                                <Select
                                  allowClear
                                  disabled={Boolean(form.binding)}
                                  value={form.provider || undefined}
                                  onChange={(value) => updateProvider(value ?? '')}
                                  options={agentProviderOptions}
                                  placeholder="不指定时自动推断"
                                />
                              </div>
                              <div className="studio-form-field">
                                <Text type="secondary">兼容模型</Text>
                                <AutoComplete
                                  disabled={Boolean(form.binding)}
                                  value={form.model}
                                  onChange={(value) => updateForm('model', value)}
                                  options={modelSuggestions}
                                  placeholder="不指定时使用绑定或默认模型"
                                  allowClear
                                  filterOption={(input, option) =>
                                    (option?.value ?? '').toLowerCase().includes(input.toLowerCase())
                                  }
                                />
                              </div>
                              <div className="studio-form-field">
                                <Text type="secondary">记忆范围</Text>
                                <Select
                                  value={form.memoryScope}
                                  onChange={(value) => updateForm('memoryScope', value)}
                                  options={memoryScopeOptions}
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
                                  留空时回退到租户默认策略；只填写删除天数时，会直接按删除策略治理产物。
                                </Text>
                              </div>
                              <DevOnly>
                                <div className="studio-form-field">
                                  <Text type="secondary">兼容后端</Text>
                                  <Input
                                    value={form.backend}
                                    onChange={(event) => updateForm('backend', event.target.value)}
                                    placeholder="仅在需要兼容特定运行后端时填写"
                                  />
                                </div>
                              </DevOnly>
                            </div>
                          ),
                        },
                      ]}
                    />

                    <div className="agent-drawer-bottom-actions">
                      <Button icon={<CopyOutlined />} onClick={() => void handleCopy()} disabled={!currentAgent} loading={copying}>
                        复制
                      </Button>
                      <Button icon={<DeleteOutlined />} danger onClick={() => void handleDelete()} disabled={!currentAgent} loading={deleting}>
                        删除
                      </Button>
                    </div>
                  </Spin>
                </div>
              ),
            },
            {
              key: 'capabilities',
              label: '能力配置',
              children: (
                <div className="agent-drawer-tab-body">
                  <Tabs
                    activeKey={capabilityTab}
                    onChange={setCapabilityTab}
                    size="small"
                    items={[
                      {
                        key: 'tools',
                        label: `工具 (${form.toolAllowlist.length})`,
                        children: renderCapabilityCards(
                          toolCardItems,
                          form.toolAllowlist,
                          (key) => toggleArrayItem('toolAllowlist', key),
                          '暂无可用内置工具',
                        ),
                      },
                      {
                        key: 'skills',
                        label: `技能 (${form.skillIds.length})`,
                        children: renderCapabilityCards(
                          skillCardItems,
                          form.skillIds,
                          (key) => toggleArrayItem('skillIds', key),
                          '暂无已安装技能',
                        ),
                      },
                      {
                        key: 'mcp',
                        label: `${devMode ? 'MCP 服务' : '连接'} (${form.mcpServerIds.length})`,
                        children: renderCapabilityCards(
                          mcpCardItems,
                          form.mcpServerIds,
                          (key) => toggleArrayItem('mcpServerIds', key),
                          '暂无可用连接',
                        ),
                      },
                      {
                        key: 'knowledge',
                        label: `知识库 (${form.knowledgeBindingIds.length})`,
                        children: renderCapabilityCards(
                          knowledgeCardItems,
                          form.knowledgeBindingIds,
                          (key) => toggleArrayItem('knowledgeBindingIds', key),
                          '暂无可用知识库',
                        ),
                      },
                    ]}
                  />
                </div>
              ),
            },
            {
              key: 'memory',
              label: '记忆治理',
              children: (
                <div className="agent-drawer-tab-body">
                  <div className="agent-section-header">
                    <Typography.Title level={5} style={{ margin: 0 }}>员工长期记忆</Typography.Title>
                    <Space>
                      {currentAgent ? <Tag color="blue">{memoryScopeLabel(form.memoryScope)}</Tag> : null}
                      <Tag color="purple">
                        {agentMemory?.candidateCount ?? agentMemoryCandidates.filter((item) => item.status === 'proposed').length} 待处理
                      </Tag>
                    </Space>
                  </div>

                  {memoryError ? <Alert type="error" showIcon message={memoryError} style={{ marginBottom: 16 }} /> : null}

                  {!currentAgent ? (
                    <Empty image={false} description="先保存员工，再治理其长期记忆。" />
                  ) : (
                    <>
                      <div className="studio-form-grid">
                        <div className="studio-form-field studio-form-field-span-2">
                          <TextArea
                            value={agentMemoryDraft}
                            onChange={(event) => setAgentMemoryDraft(event.target.value)}
                            rows={6}
                            placeholder="这里存放该员工稳定可复用的偏好、规范和工作习惯。"
                          />
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                            <Text type="secondary" style={{ fontSize: 12 }}>
                              {agentMemory?.updatedAt ? `更新于 ${formatDateTimeZh(agentMemory.updatedAt)}` : '未保存'}
                            </Text>
                          </div>
                        </div>
                      </div>

                      <div className="agent-drawer-bottom-actions" style={{ marginBottom: 24 }}>
                        <Button icon={<ReloadOutlined />} onClick={() => void loadAgentMemoryGovernance(currentAgent.agentId)} loading={loadingMemory}>
                          刷新
                        </Button>
                        <Button type="primary" icon={<SaveOutlined />} onClick={() => void handleSaveAgentMemory()} loading={savingMemory}>
                          保存记忆
                        </Button>
                        <Button onClick={() => navigate(`/studio/memory/agents/${currentAgent.agentId}`)}>
                          统一审计
                        </Button>
                      </div>

                      <div className="agent-section-header">
                        <Typography.Title level={5} style={{ margin: 0 }}>提交候选</Typography.Title>
                      </div>
                      <div className="studio-form-field">
                        <TextArea
                          value={agentCandidateDraft}
                          onChange={(event) => setAgentCandidateDraft(event.target.value)}
                          rows={3}
                          placeholder="先把可能有价值的稳定偏好提成候选，再决定是否应用到员工记忆。"
                        />
                      </div>
                      <div className="agent-drawer-bottom-actions" style={{ marginBottom: 24 }}>
                        <Button onClick={() => void handleCreateAgentMemoryCandidate()} loading={creatingMemoryCandidate}>
                          提交候选
                        </Button>
                      </div>

                      <div className="agent-section-header">
                        <Typography.Title level={5} style={{ margin: 0 }}>候选记录</Typography.Title>
                      </div>

                      {loadingMemory && agentMemoryCandidates.length === 0 ? (
                        <div className="center-box"><Spin /></div>
                      ) : agentMemoryCandidates.length === 0 ? (
                        <Empty image={false} description="暂无员工记忆候选" />
                      ) : (
                        <div className="studio-run-list">
                          {agentMemoryCandidates.map((candidate) => (
                            <div key={candidate.candidateId} className="studio-run-list-item" style={{ marginBottom: 12 }}>
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
                                <Text type="secondary" style={{ fontSize: 12 }}>
                                  {candidate.sourceKind} · {candidate.updatedAt ? formatDateTimeZh(candidate.updatedAt) : ''}
                                </Text>
                                {candidate.status === 'proposed' && (
                                  <Space wrap style={{ marginTop: 6 }}>
                                    <Button size="small" type="primary" onClick={() => void handleApplyAgentMemoryCandidate(candidate.candidateId)}>
                                      应用
                                    </Button>
                                    <Button size="small" danger onClick={() => void handleRejectAgentMemoryCandidate(candidate.candidateId)}>
                                      忽略
                                    </Button>
                                  </Space>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              ),
            },
            {
              key: 'test',
              label: '试运行',
              children: (
                <div className="agent-drawer-tab-body">
                  <div className="agent-section-header">
                    <Typography.Title level={5} style={{ margin: 0 }}>员工试运行</Typography.Title>
                    {currentAgent ? <DevOnly><Tag color="blue">{currentAgent.agentId}</Tag></DevOnly> : <Tag>未保存</Tag>}
                  </div>

                  <div className="studio-form-field">
                    <Text type="secondary">测试任务</Text>
                    <TextArea
                      value={testPrompt}
                      onChange={(event) => setTestPrompt(event.target.value)}
                      rows={4}
                      placeholder="输入测试任务"
                    />
                  </div>

                  <div className="agent-drawer-bottom-actions" style={{ marginBottom: 24 }}>
                    <Button
                      type="primary"
                      icon={<ExperimentOutlined />}
                      onClick={() => void handleTestRun()}
                      loading={testing}
                      disabled={!currentAgent}
                    >
                      开始试运行
                    </Button>
                    {currentAgent && (
                      <Button onClick={() => void loadRecentRuns(currentAgent.agentId)} loading={loadingRuns}>
                        刷新
                      </Button>
                    )}
                  </div>

                  {runError ? <Alert type="error" showIcon message={runError} style={{ marginBottom: 16 }} /> : null}

                  {lastResult && (
                    <div className="studio-run-result" style={{ marginBottom: 16 }}>
                      <Text type="secondary">最近一次返回摘要</Text>
                      <Paragraph className="studio-result-copy">{lastResult}</Paragraph>
                    </div>
                  )}

                  <div className="agent-section-header">
                    <Typography.Title level={5} style={{ margin: 0 }}>最近执行</Typography.Title>
                  </div>

                  {loadingRuns ? (
                    <div className="center-box"><Spin /></div>
                  ) : recentRuns.length === 0 ? (
                    <Empty image={false} description="暂无执行记录" />
                  ) : (
                    <div className="studio-run-list">
                      {recentRuns.map((run) => (
                        <div key={run.runId} className="studio-run-list-item" style={{ marginBottom: 12 }}>
                          <div className="studio-run-list-copy">
                            <div className="studio-run-list-head">
                              <Space wrap>
                                <strong>{run.label}</strong>
                                <Tag color={statusColor(run.status)}>{run.status}</Tag>
                              </Space>
                              <Text type="secondary" style={{ fontSize: 12 }}>{formatDateTimeZh(run.createdAt)}</Text>
                            </div>
                            <Paragraph className="studio-run-preview" ellipsis={{ rows: 2 }}>
                              {run.resultSummary?.content || run.taskPreview}
                            </Paragraph>
                            {run.lastErrorMessage && <Text type="danger">{run.lastErrorMessage}</Text>}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ),
            },
          ]}
        />
      </Drawer>
    </div>
  )
}
