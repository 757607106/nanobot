import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  App,
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
  SearchOutlined,
  TeamOutlined,
  AppstoreOutlined,
  ClockCircleOutlined,
  CheckCircleOutlined,
} from '@ant-design/icons'
import { motion } from 'framer-motion'
import { useNavigate, useParams } from 'react-router-dom'
import { api, ApiError } from '../api'
import DevOnly from '../components/DevOnly'
import { useDevMode } from '../devMode'
import { interactiveLift, interactiveTap, shellSpring } from '../motionTokens'
import PageHero from '../components/PageHero'
import { formatDateTimeZh } from '../locale'
import type {
  AgentDefinition,
  AgentDefinitionMutationInput,
  AgentRunSummary,
  AgentTestRunResult,
  AgentTemplateTool,
  InstalledSkill,
  KnowledgeBaseDefinition,
  McpServerEntry,
  ModelDefaults,
  ModelProvider,
  ModelSelection,
} from '../types'

const { Text, Paragraph } = Typography
const { TextArea } = Input

interface AgentFormState {
  name: string
  description: string
  systemPrompt: string
  rulesText: string
  model: string
  chatModelSelection: ModelSelection | null
  backend: string
  enabled: boolean
  toolAllowlist: string[]
  mcpServerIds: string[]
  skillIds: string[]
  knowledgeBindingIds: string[]
  tags: string[]
  memoryScope: string
}

type CapabilityTabKey = 'tools' | 'skills' | 'mcp' | 'knowledge'

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
    chatModelSelection: null,
    backend: '',
    enabled: true,
    toolAllowlist: [],
    mcpServerIds: [],
    skillIds: [],
    knowledgeBindingIds: [],
    tags: [],
    memoryScope: 'agent_profile',
  }
}

function agentToForm(agent: AgentDefinition): AgentFormState {
  return {
    name: agent.name,
    description: agent.description,
    systemPrompt: agent.systemPrompt,
    rulesText: agent.rules.join('\n'),
    model: agent.model || '',
    chatModelSelection: agent.chatModelSelection || null,
    backend: agent.backend || '',
    enabled: agent.enabled,
    toolAllowlist: [...agent.toolAllowlist],
    mcpServerIds: [...agent.mcpServerIds],
    skillIds: [...agent.skillIds],
    knowledgeBindingIds: [...agent.knowledgeBindingIds],
    tags: [...agent.tags],
    memoryScope: agent.memoryScope || 'agent_profile',
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

function toPayload(form: AgentFormState): AgentDefinitionMutationInput {
  return {
    name: form.name.trim(),
    description: form.description.trim(),
    systemPrompt: form.systemPrompt.trim(),
    rules: parseRules(form.rulesText),
    model: form.chatModelSelection?.modelName || form.model.trim() || null,
    chatModelSelection: form.chatModelSelection,
    backend: form.backend.trim() || null,
    enabled: form.enabled,
    toolAllowlist: [...form.toolAllowlist],
    mcpServerIds: [...form.mcpServerIds],
    skillIds: [...form.skillIds],
    knowledgeBindingIds: [...form.knowledgeBindingIds],
    tags: [...form.tags],
    memoryScope: form.memoryScope,
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

function buildModelSelection(provider: ModelProvider, modelName: string): ModelSelection {
  const selectedModel = modelName.trim() || provider.defaultModel || provider.models[0] || ''
  return {
    providerId: provider.providerId,
    modelName: selectedModel,
    capability: 'chat',
    providerName: provider.providerType,
    displayName: provider.displayName,
    baseUrl: provider.baseUrl ?? null,
    apiKeyEnv: provider.apiKeyEnv ?? null,
    qualifiedModelName: selectedModel,
  }
}

function formatModelSelection(selection: ModelSelection | null | undefined) {
  if (!selection) {
    return '跟随系统默认'
  }
  return `${selection.displayName || selection.providerId} / ${selection.modelName}`
}

function formatBindingNames(values: string[], fallback = '未绑定') {
  return values.length > 0 ? values.join('、') : fallback
}

function summarizeAgentHealth(agent: AgentDefinition, knowledgeBases: KnowledgeBaseDefinition[], mcpServers: McpServerEntry[]) {
  const staleKbCount = knowledgeBases.filter((kb) => agent.knowledgeBindingIds.includes(kb.kbId) && (kb.reindexRequired || kb.legacyConfig)).length
  const degradedMcpCount = mcpServers.filter((server) => agent.mcpServerIds.includes(server.name) && (!server.enabled || server.status !== 'ready')).length
  const orphanKbCount = agent.knowledgeBindingIds.filter((kbId) => !knowledgeBases.some((kb) => kb.kbId === kbId)).length
  const orphanMcpCount = agent.mcpServerIds.filter((serverId) => !mcpServers.some((server) => server.name === serverId)).length
  return {
    staleKbCount,
    degradedMcpCount,
    orphanKbCount,
    orphanMcpCount,
    hasAttention: staleKbCount > 0 || degradedMcpCount > 0 || orphanKbCount > 0 || orphanMcpCount > 0,
  }
}

export default function AgentsPage() {
  const { message } = App.useApp()
  const navigate = useNavigate()
  const { agentId } = useParams()
  const { devMode } = useDevMode()
  const selectedAgentId = agentId && agentId !== 'new' ? agentId : null

  const [agents, setAgents] = useState<AgentDefinition[]>([])
  const [validTools, setValidTools] = useState<AgentTemplateTool[]>([])
  const [skills, setSkills] = useState<InstalledSkill[]>([])
  const [mcpServers, setMcpServers] = useState<McpServerEntry[]>([])
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBaseDefinition[]>([])
  const [currentAgent, setCurrentAgent] = useState<AgentDefinition | null>(null)
  const [recentRuns, setRecentRuns] = useState<AgentRunSummary[]>([])
  const [form, setForm] = useState<AgentFormState>(() => createEmptyForm())
  const [testPrompt, setTestPrompt] = useState('请基于当前配置，给我一个可执行的任务处理方案。')
  const [lastRunResult, setLastRunResult] = useState<AgentTestRunResult | null>(null)
  const [loadingWorkspace, setLoadingWorkspace] = useState(true)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [loadingRuns, setLoadingRuns] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [copying, setCopying] = useState(false)
  const [testing, setTesting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [runError, setRunError] = useState<string | null>(null)
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)
  const [modelProviders, setModelProviders] = useState<ModelProvider[]>([])
  const [modelDefaults, setModelDefaults] = useState<ModelDefaults | null>(null)
  const [capabilityTab, setCapabilityTab] = useState('tools')
  const [agentQuery, setAgentQuery] = useState('')
  const [agentCatalogFilter, setAgentCatalogFilter] = useState<'all' | 'enabled' | 'disabled' | 'attention' | 'healthy'>('all')
  const [capabilityQuery, setCapabilityQuery] = useState<Record<CapabilityTabKey, string>>({
    tools: '',
    skills: '',
    mcp: '',
    knowledge: '',
  })
  const [capabilityFilter, setCapabilityFilter] = useState<Record<CapabilityTabKey, 'all' | 'selected' | 'orphan'>>({
    tools: 'all',
    skills: 'all',
    mcp: 'all',
    knowledge: 'all',
  })

  useEffect(() => {
    void loadWorkspace()
  }, [])

  useEffect(() => {
    if (loadingWorkspace) {
      return
    }
    if (!selectedAgentId) {
      setCurrentAgent(null)
      setRecentRuns([])
      setLastRunResult(null)
      setForm(createEmptyForm())
      setIsDrawerOpen(agentId === 'new')
      return
    }
    void loadAgentDetail(selectedAgentId)
    void loadRecentRuns(selectedAgentId)
    setIsDrawerOpen(true)
  }, [agentId, agents, loadingWorkspace, selectedAgentId])

  const handleCloseDrawer = () => {
    setIsDrawerOpen(false)
    navigate('/studio/agents')
  }

  const enabledCount = useMemo(() => agents.filter((item) => item.enabled).length, [agents])

  const chatProviders = useMemo(
    () => modelProviders.filter((item) => item.enabled && item.capabilities.includes('chat')),
    [modelProviders],
  )

  const defaultChatSelection = modelDefaults?.defaultChat ?? null
  const currentChatProvider = useMemo(
    () =>
      chatProviders.find((item) => item.providerId === form.chatModelSelection?.providerId)
      || chatProviders.find((item) => item.providerId === defaultChatSelection?.providerId)
      || null,
    [chatProviders, defaultChatSelection, form.chatModelSelection?.providerId],
  )

  const chatModelSuggestions = useMemo(() => currentChatProvider?.models || [], [currentChatProvider])
  const effectiveChatSelection = form.chatModelSelection || defaultChatSelection

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

  const selectedKnowledgeEntries = useMemo(
    () => knowledgeBases.filter((item) => form.knowledgeBindingIds.includes(item.kbId)),
    [form.knowledgeBindingIds, knowledgeBases],
  )
  const staleKnowledgeEntries = useMemo(
    () => selectedKnowledgeEntries.filter((item) => item.reindexRequired || item.legacyConfig),
    [selectedKnowledgeEntries],
  )
  const selectedMcpEntries = useMemo(
    () => mcpServers.filter((item) => form.mcpServerIds.includes(item.name)),
    [form.mcpServerIds, mcpServers],
  )
  const degradedMcpEntries = useMemo(
    () => selectedMcpEntries.filter((item) => !item.enabled || item.status !== 'ready'),
    [selectedMcpEntries],
  )
  const orphanKnowledgeBindingIds = useMemo(
    () => form.knowledgeBindingIds.filter((kbId) => !knowledgeBases.some((item) => item.kbId === kbId)),
    [form.knowledgeBindingIds, knowledgeBases],
  )
  const orphanMcpServerIds = useMemo(
    () => form.mcpServerIds.filter((serverId) => !mcpServers.some((item) => item.name === serverId)),
    [form.mcpServerIds, mcpServers],
  )
  const runtimeWarnings = useMemo(() => {
    const warnings: string[] = []
    if (!effectiveChatSelection) {
      warnings.push('当前没有显式模型绑定，将跟随系统默认模型。')
    }
    if (staleKnowledgeEntries.length > 0) {
      warnings.push(`有 ${staleKnowledgeEntries.length} 个知识库需要重建索引后再用于稳定召回。`)
    }
    if (degradedMcpEntries.length > 0) {
      warnings.push(`有 ${degradedMcpEntries.length} 个 MCP 连接当前不可用或已停用。`)
    }
    if (orphanKnowledgeBindingIds.length > 0 || orphanMcpServerIds.length > 0) {
      warnings.push('存在找不到原始资源的绑定项，建议及时清理。')
    }
    if (form.toolAllowlist.length === 0 && form.mcpServerIds.length === 0 && form.knowledgeBindingIds.length === 0) {
      warnings.push('当前 Agent 还没有分配工具、MCP 或知识库，试运行时会偏向纯对话模式。')
    }
    return warnings
  }, [
    degradedMcpEntries.length,
    effectiveChatSelection,
    form.knowledgeBindingIds.length,
    form.mcpServerIds.length,
    form.toolAllowlist.length,
    orphanKnowledgeBindingIds.length,
    orphanMcpServerIds.length,
    staleKnowledgeEntries.length,
  ])

  const filteredAgents = useMemo(() => {
    const query = agentQuery.trim().toLowerCase()
    return agents.filter((agent) => {
      const health = summarizeAgentHealth(agent, knowledgeBases, mcpServers)
      const matchesQuery =
        !query
        || agent.name.toLowerCase().includes(query)
        || agent.description.toLowerCase().includes(query)
        || agent.tags.some((tag) => tag.toLowerCase().includes(query))

      const matchesFilter =
        agentCatalogFilter === 'all'
        || (agentCatalogFilter === 'enabled' && agent.enabled)
        || (agentCatalogFilter === 'disabled' && !agent.enabled)
        || (agentCatalogFilter === 'attention' && health.hasAttention)
        || (agentCatalogFilter === 'healthy' && !health.hasAttention)

      return matchesQuery && matchesFilter
    })
  }, [agentCatalogFilter, agentQuery, agents, knowledgeBases, mcpServers])

  async function loadWorkspace() {
    try {
      setLoadingWorkspace(true)
      const [agentList, toolCatalog, skillList, mcpRegistry, kbList, configResult, metaResult] = await Promise.all([
        api.getAgents(),
        api.getValidTemplateTools(),
        api.getInstalledSkills(),
        api.getMcpServers(),
        api.getKnowledgeBases(true),
        api.getModelProviders().catch(() => []),
        api.getModelDefaults().catch(() => null),
      ])
      setAgents(agentList)
      setValidTools(toolCatalog)
      setSkills(skillList)
      setMcpServers(mcpRegistry.items)
      setKnowledgeBases(kbList)
      setModelProviders(configResult)
      setModelDefaults(metaResult)
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
      setLastRunResult(null)
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

  function updateForm<K extends keyof AgentFormState>(key: K, value: AgentFormState[K]) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  function toggleArrayItem(key: 'toolAllowlist' | 'skillIds' | 'mcpServerIds' | 'knowledgeBindingIds', item: string) {
    setForm((prev) => ({
      ...prev,
      [key]: prev[key].includes(item) ? prev[key].filter((v) => v !== item) : [...prev[key], item],
    }))
  }

  function updateChatProvider(providerId?: string) {
    const provider = chatProviders.find((item) => item.providerId === providerId)
    setForm((prev) => ({
      ...prev,
      chatModelSelection: provider ? buildModelSelection(provider, provider.defaultModel || provider.models[0] || '') : null,
      model: provider ? (provider.defaultModel || provider.models[0] || '') : '',
    }))
  }

  function updateChatModel(modelName: string) {
    setForm((prev) => {
      if (!prev.chatModelSelection && !currentChatProvider) {
        return { ...prev, model: modelName }
      }
      const baseProvider = chatProviders.find((item) => item.providerId === prev.chatModelSelection?.providerId) || currentChatProvider
      if (!baseProvider) {
        return { ...prev, model: modelName }
      }
      return {
        ...prev,
        model: modelName,
        chatModelSelection: buildModelSelection(baseProvider, modelName),
      }
    })
  }

  function renderCapabilityCards(
    tabKey: CapabilityTabKey,
    items: Array<{ key: string; name: string; description: string; isOrphan?: boolean }>,
    selectedKeys: string[],
    onToggle: (key: string) => void,
    emptyText: string,
    onClearAll: () => void,
    onRemoveOrphans: () => void,
  ) {
    const query = capabilityQuery[tabKey].trim().toLowerCase()
    const mode = capabilityFilter[tabKey]
    const filteredItems = items.filter((item) => {
      const matchesQuery =
        !query
        || item.name.toLowerCase().includes(query)
        || item.description.toLowerCase().includes(query)
      const isSelected = selectedKeys.includes(item.key)
      const matchesMode =
        mode === 'all'
        || (mode === 'selected' && isSelected)
        || (mode === 'orphan' && Boolean(item.isOrphan))
      return matchesQuery && matchesMode
    })
    const hasSelected = selectedKeys.length > 0
    const hasSelectedOrphans = selectedKeys.some((key) => items.some((item) => item.key === key && item.isOrphan))

    if (items.length === 0) {
      return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={emptyText} />
    }
    return (
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Space wrap style={{ width: '100%' }}>
          <Input
            allowClear
            prefix={<SearchOutlined />}
            placeholder="搜索当前能力资源"
            value={capabilityQuery[tabKey]}
            onChange={(event) => setCapabilityQuery((current) => ({ ...current, [tabKey]: event.target.value }))}
            style={{ minWidth: 240, flex: '1 1 280px' }}
          />
          <Select
            value={capabilityFilter[tabKey]}
            onChange={(value) => setCapabilityFilter((current) => ({ ...current, [tabKey]: value }))}
            style={{ minWidth: 160 }}
            options={[
              { value: 'all', label: '全部' },
              { value: 'selected', label: '仅看已选' },
              { value: 'orphan', label: '仅看失联' },
            ]}
          />
          <Button onClick={onClearAll} disabled={!hasSelected}>
            清空本类
          </Button>
          <Button onClick={onRemoveOrphans} disabled={!hasSelectedOrphans}>
            移除失联项
          </Button>
        </Space>

        {filteredItems.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前筛选条件下没有资源。" />
        ) : (
          <div className="capability-card-grid">
            {filteredItems.map((item) => {
          const isSelected = selectedKeys.includes(item.key)
          return (
            <button
              type="button"
              key={item.key}
              className={`capability-card${isSelected ? ' is-selected' : ''}${item.isOrphan ? ' is-orphan' : ''}`}
              onClick={() => onToggle(item.key)}
              aria-pressed={isSelected}
            >
              {isSelected && <CheckCircleOutlined className="capability-card-check" />}
              <div className="capability-card-name">{item.name}</div>
              <div className="capability-card-desc">{item.description}</div>
            </button>
          )
        })}
          </div>
        )}
      </Space>
    )
  }

  async function handleSave() {
    const payload = toPayload(form)
    if (!payload.name) {
      setError('员工名称不能为空。')
      return
    }
    if (!payload.systemPrompt) {
      setError('角色说明不能为空。')
      return
    }
    if (!(payload.rules || []).length) {
      setError('至少需要一条运行规则。')
      return
    }
    try {
      setSaving(true)
      const saved = currentAgent
        ? await api.updateAgent(currentAgent.agentId, payload)
        : await api.createAgent(payload)
      message.success(currentAgent ? 'Agent 已更新' : 'Agent 已创建')
      await loadWorkspace()
      navigate(`/studio/agents/${saved.agentId}`, { replace: true })
      await loadAgentDetail(saved.agentId)
      await loadRecentRuns(saved.agentId)
    } catch (saveError) {
      setError(getErrorMessage(saveError, '保存 Agent 失败'))
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
      setLastRunResult(result)
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

  if (loadingWorkspace && agents.length === 0 && !selectedAgentId) {
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
        eyebrow="数字员工工作台"
        title="Agent Studio"
        description="把角色说明、模型绑定、MCP、知识库和试运行收束在同一个工作台里，方便你快速审查一个 Agent 的生效配置。"
        badges={[
          currentAgent ? <Tag key="focus" color="blue">聚焦：{currentAgent.name}</Tag> : <Tag key="focus">浏览模式</Tag>,
          staleKnowledgeEntries.length > 0 ? <Tag key="stale" color="warning">待修复知识库 {staleKnowledgeEntries.length}</Tag> : null,
          degradedMcpEntries.length > 0 ? <Tag key="mcp" color="error">异常 MCP {degradedMcpEntries.length}</Tag> : null,
        ].filter(Boolean)}
        actions={(
          <Space wrap>
            <Button icon={<ReloadOutlined />} onClick={() => void loadWorkspace()} loading={loadingWorkspace}>
              刷新
            </Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/studio/agents/new')}>
              创建新员工
            </Button>
          </Space>
        )}
        stats={[
          { label: '员工总数', value: agents.length },
          { label: '启用中', value: enabledCount },
          { label: '最近执行', value: recentRuns.length },
          { label: '可用知识库', value: knowledgeBases.length },
        ]}
      />

      {error ? <Alert type="error" showIcon message={error} style={{ marginBottom: '16px' }} /> : null}

      {agents.length === 0 && !loadingWorkspace ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="还没有创建 AI 员工"
          className="page-card"
        >
          <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/studio/agents/new')}>
            创建第一个员工
          </Button>
        </Empty>
      ) : (
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Card className="config-panel-card">
            <div className="config-card-header">
              <div className="page-section-title">
                <Typography.Title level={4}>员工目录</Typography.Title>
                <Text type="secondary">按名称、标签和绑定健康快速筛出需要处理的 Agent。</Text>
              </div>
              <Tag>{filteredAgents.length}/{agents.length} 个员工</Tag>
            </div>

            <Space wrap style={{ width: '100%' }}>
              <Input
                allowClear
                prefix={<SearchOutlined />}
                placeholder="搜索员工名称、描述或标签"
                value={agentQuery}
                onChange={(event) => setAgentQuery(event.target.value)}
                style={{ minWidth: 280, flex: '1 1 320px' }}
              />
              <Select
                value={agentCatalogFilter}
                onChange={(value) => setAgentCatalogFilter(value)}
                style={{ minWidth: 180 }}
                options={[
                  { value: 'all', label: '全部员工' },
                  { value: 'enabled', label: '仅启用中' },
                  { value: 'disabled', label: '仅停用' },
                  { value: 'attention', label: '需要关注' },
                  { value: 'healthy', label: '绑定稳定' },
                ]}
              />
              <Button
                onClick={() => {
                  setAgentQuery('')
                  setAgentCatalogFilter('all')
                }}
              >
                清空筛选
              </Button>
            </Space>
          </Card>

          {filteredAgents.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前筛选条件下没有匹配的员工。" className="page-card" />
          ) : (
            <div className="studio-grid-layout">
              {filteredAgents.map((item) => {
                const health = summarizeAgentHealth(item, knowledgeBases, mcpServers)
                const cardWarnings: string[] = []
                if (health.staleKbCount > 0) {
                  cardWarnings.push(`知识库待重建 ${health.staleKbCount}`)
                }
                if (health.degradedMcpCount > 0) {
                  cardWarnings.push(`MCP 异常 ${health.degradedMcpCount}`)
                }
                if (health.orphanKbCount > 0 || health.orphanMcpCount > 0) {
                  cardWarnings.push('存在失联绑定')
                }

                return (
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
                        <div className="id-badge-team">
                          {item.tags[0]}
                        </div>
                      )}
                    </div>

                    <Space wrap size={6} style={{ marginBottom: 12 }}>
                      <Tag color={item.chatModelSelection ? 'blue' : 'default'}>
                        {item.chatModelSelection ? '自定义模型' : '默认模型'}
                      </Tag>
                      <Tag color="purple">知识库 {item.knowledgeBindingIds.length}</Tag>
                      <Tag color="gold">MCP {item.mcpServerIds.length}</Tag>
                      {cardWarnings.length > 0 ? <Tag color="warning">需关注 {cardWarnings.length}</Tag> : <Tag color="success">绑定稳定</Tag>}
                    </Space>

                    {cardWarnings.length > 0 ? (
                      <Alert
                        style={{ marginBottom: 12 }}
                        type="warning"
                        showIcon
                        message={cardWarnings.join('；')}
                      />
                    ) : null}

                    <div className="id-badge-stats">
                      <div className="id-badge-stat-item">
                        <span className="id-badge-stat-label">模型</span>
                        <span className="id-badge-stat-value">{item.chatModelSelection ? '自定义' : '默认'}</span>
                      </div>
                      <div className="id-badge-stat-item">
                        <span className="id-badge-stat-label">知识库</span>
                        <span className="id-badge-stat-value">{item.knowledgeBindingIds.length}</span>
                      </div>
                      <div className="id-badge-stat-item">
                        <span className="id-badge-stat-label">MCP</span>
                        <span className="id-badge-stat-value">{item.mcpServerIds.length}</span>
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
                )
              })}
            </div>
          )}
        </Space>
      )}

      <Drawer
        title={currentAgent ? '员工设置' : '新建员工'}
        width={680}
        onClose={handleCloseDrawer}
        open={isDrawerOpen}
        styles={{ body: { padding: 0 } }}
        extra={
          <Space>
            {currentAgent && (
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
          <Card bordered={false} className="config-panel-card" loading={loadingDetail}>
            {currentAgent?.sourceTemplateName ? <Tag color="purple" style={{ marginBottom: '16px' }}>来自模板：{currentAgent.sourceTemplateName}</Tag> : null}

            <div className="config-card-header">
              <div className="page-section-title">
                <Typography.Title level={4}>运行时快照</Typography.Title>
                <Text type="secondary">先确认当前模型、资源绑定和风险提示，再继续编辑或试运行。</Text>
              </div>
              {currentAgent ? <Tag color="blue">{currentAgent.agentId}</Tag> : <Tag>未保存</Tag>}
            </div>

            <div className="page-meta-grid mcp-meta-grid" style={{ marginBottom: 16 }}>
              <div className="page-meta-card">
                <span>生效模型</span>
                <strong>{formatModelSelection(effectiveChatSelection)}</strong>
              </div>
              <div className="page-meta-card">
                <span>知识库</span>
                <strong>{form.knowledgeBindingIds.length}</strong>
              </div>
              <div className="page-meta-card">
                <span>MCP</span>
                <strong>{form.mcpServerIds.length}</strong>
              </div>
              <div className="page-meta-card">
                <span>记忆范围</span>
                <strong>{form.memoryScope}</strong>
              </div>
            </div>

            <Space wrap style={{ marginBottom: 12 }}>
              <Tag color="blue">{formatModelSelection(effectiveChatSelection)}</Tag>
              <Tag color="purple">知识库 {form.knowledgeBindingIds.length}</Tag>
              <Tag color="gold">MCP {form.mcpServerIds.length}</Tag>
              <Tag color="green">技能 {form.skillIds.length}</Tag>
              <Tag>工具 {form.toolAllowlist.length}</Tag>
            </Space>

            <Paragraph type="secondary" style={{ marginBottom: 8 }}>
              知识库：{formatBindingNames(selectedKnowledgeEntries.map((item) => item.name))}
            </Paragraph>
            <Paragraph type="secondary" style={{ marginBottom: 8 }}>
              MCP：{formatBindingNames(selectedMcpEntries.map((item) => item.displayName || item.name))}
            </Paragraph>
            <Paragraph type="secondary" style={{ marginBottom: 16 }}>
              技能：{formatBindingNames(form.skillIds)}
            </Paragraph>

            {runtimeWarnings.length > 0 ? (
              <Space direction="vertical" size={12} style={{ width: '100%', marginBottom: 16 }}>
                {runtimeWarnings.map((warning, index) => (
                  <Alert key={`${warning}-${index}`} type="warning" showIcon message={warning} />
                ))}
              </Space>
            ) : null}

            <div className="studio-form-grid">
              <div className="studio-form-field studio-form-field-span-2">
                <Text type="secondary">名称</Text>
                <Input
                  value={form.name}
                  onChange={(event) => updateForm('name', event.target.value)}
                  placeholder="例如：法务研究员、产品分析员"
                />
              </div>

              <div className="studio-form-field">
                <Text type="secondary">Chat Provider</Text>
                <Select
                  value={form.chatModelSelection?.providerId}
                  onChange={(value) => updateChatProvider(value)}
                  placeholder="留空则跟随系统默认"
                  allowClear
                  options={chatProviders.map((provider) => ({
                    value: provider.providerId,
                    label: `${provider.displayName} · ${provider.providerType}`,
                  }))}
                />
              </div>

              <div className="studio-form-field">
                <Text type="secondary">模型名</Text>
                <Input
                  value={form.chatModelSelection?.modelName || form.model}
                  onChange={(event) => updateChatModel(event.target.value)}
                  placeholder={defaultChatSelection?.modelName || '留空则跟随默认模型'}
                />
              </div>

              <div className="studio-form-field studio-form-field-span-2">
                <Text type="secondary">模型策略</Text>
                <Alert
                  type={form.chatModelSelection ? 'success' : 'info'}
                  showIcon
                  message={form.chatModelSelection ? '当前 Agent 使用自定义模型绑定' : '当前 Agent 跟随系统默认模型'}
                  description={`生效选择：${formatModelSelection(effectiveChatSelection)}`}
                />
                {chatModelSuggestions.length > 0 ? (
                  <Space wrap style={{ marginTop: 12 }}>
                    {chatModelSuggestions.map((model) => (
                      <Button key={model} size="small" onClick={() => updateChatModel(model)}>
                        {model}
                      </Button>
                    ))}
                  </Space>
                ) : null}
              </div>

              <div className="studio-form-field">
                <Text type="secondary">标签</Text>
                <Select
                  mode="tags"
                  value={form.tags}
                  onChange={(value) => updateForm('tags', value)}
                  placeholder="例如：法务、研究、评审"
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
                  placeholder="说明它负责什么、擅长什么、输出给谁。"
                />
              </div>

              <div className="studio-form-field studio-form-field-span-2">
                <Text type="secondary">角色说明</Text>
                <TextArea
                  value={form.systemPrompt}
                  onChange={(event) => updateForm('systemPrompt', event.target.value)}
                  rows={8}
                  placeholder="定义这个员工的角色定位、职责边界和输出风格。"
                />
              </div>

              <div className="studio-form-field studio-form-field-span-2">
                <Text type="secondary">工作规则</Text>
                <TextArea
                  value={form.rulesText}
                  onChange={(event) => updateForm('rulesText', event.target.value)}
                  rows={4}
                  placeholder="每行一条工作规则，例如：先确认任务范围再动手"
                />
              </div>
            </div>

            <div style={{ marginTop: 16 }}>
              <div style={{ marginBottom: 12 }}>
                <Typography.Title level={5} style={{ marginBottom: 4 }}>能力配置</Typography.Title>
                <Text type="secondary">为这个员工分配工具、技能和外部资源。</Text>
              </div>
              {staleKnowledgeEntries.length > 0 || degradedMcpEntries.length > 0 || orphanKnowledgeBindingIds.length > 0 || orphanMcpServerIds.length > 0 ? (
                <Alert
                  className="studio-inline-alert"
                  type="warning"
                  showIcon
                  message="当前绑定里有需要关注的项"
                  description={[
                    staleKnowledgeEntries.length > 0 ? `待重建知识库：${formatBindingNames(staleKnowledgeEntries.map((item) => item.name), '')}` : '',
                    degradedMcpEntries.length > 0 ? `异常 MCP：${formatBindingNames(degradedMcpEntries.map((item) => item.displayName || item.name), '')}` : '',
                    orphanKnowledgeBindingIds.length > 0 ? `孤儿知识库绑定：${formatBindingNames(orphanKnowledgeBindingIds, '')}` : '',
                    orphanMcpServerIds.length > 0 ? `孤儿 MCP 绑定：${formatBindingNames(orphanMcpServerIds, '')}` : '',
                  ].filter(Boolean).join('；')}
                />
              ) : null}
              <Tabs
                className="console-tabs"
                activeKey={capabilityTab}
                onChange={setCapabilityTab}
                items={[
                  {
                    key: 'tools',
                    label: `工具 (${form.toolAllowlist.length})`,
                    children: renderCapabilityCards(
                      'tools',
                      toolCardItems,
                      form.toolAllowlist,
                      (key) => toggleArrayItem('toolAllowlist', key),
                      '暂无可用内置工具',
                      () => updateForm('toolAllowlist', []),
                      () => updateForm('toolAllowlist', form.toolAllowlist.filter((key) => !toolCardItems.some((item) => item.key === key && item.isOrphan))),
                    ),
                  },
                  {
                    key: 'skills',
                    label: `技能 (${form.skillIds.length})`,
                    children: renderCapabilityCards(
                      'skills',
                      skillCardItems,
                      form.skillIds,
                      (key) => toggleArrayItem('skillIds', key),
                      '暂无已安装技能',
                      () => updateForm('skillIds', []),
                      () => updateForm('skillIds', form.skillIds.filter((key) => !skillCardItems.some((item) => item.key === key && item.isOrphan))),
                    ),
                  },
                  {
                    key: 'mcp',
                    label: `${devMode ? 'MCP 服务' : '连接'} (${form.mcpServerIds.length})`,
                    children: renderCapabilityCards(
                      'mcp',
                      mcpCardItems,
                      form.mcpServerIds,
                      (key) => toggleArrayItem('mcpServerIds', key),
                      '暂无可用连接',
                      () => updateForm('mcpServerIds', []),
                      () => updateForm('mcpServerIds', form.mcpServerIds.filter((key) => !mcpCardItems.some((item) => item.key === key && item.isOrphan))),
                    ),
                  },
                  {
                    key: 'knowledge',
                    label: `知识库 (${form.knowledgeBindingIds.length})`,
                    children: renderCapabilityCards(
                      'knowledge',
                      knowledgeCardItems,
                      form.knowledgeBindingIds,
                      (key) => toggleArrayItem('knowledgeBindingIds', key),
                      '暂无可用知识库',
                      () => updateForm('knowledgeBindingIds', []),
                      () => updateForm('knowledgeBindingIds', form.knowledgeBindingIds.filter((key) => !knowledgeCardItems.some((item) => item.key === key && item.isOrphan))),
                    ),
                  },
                ]}
              />
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
                        <Text type="secondary">记忆范围</Text>
                        <Select
                          value={form.memoryScope}
                          onChange={(value) => updateForm('memoryScope', value)}
                          options={[
                            { value: 'agent_profile', label: '仅员工自身' },
                            { value: 'team_shared', label: '团队共享' },
                            { value: 'workspace_shared', label: '工作区共享' },
                          ]}
                        />
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

            <Alert
              className="studio-inline-alert"
              type="info"
              showIcon
              message="试运行会使用员工的完整配置真实执行任务，帮助你验证员工效果。"
            />

            <div className="studio-form-actions">
              <Space wrap>
                <Button type="primary" icon={<ExperimentOutlined />} onClick={() => void handleTestRun()} loading={testing} disabled={!currentAgent}>
                  试运行
                </Button>
                <Button icon={<CopyOutlined />} onClick={() => void handleCopy()} disabled={!currentAgent} loading={copying}>
                  复制
                </Button>
                <Button icon={<DeleteOutlined />} danger onClick={() => void handleDelete()} disabled={!currentAgent} loading={deleting}>
                  删除
                </Button>
                <Button type="primary" icon={<SaveOutlined />} onClick={() => void handleSave()} loading={saving}>
                  保存员工
                </Button>
              </Space>
            </div>
          </Card>

          <Card className="config-panel-card studio-agent-run-card">
            <div className="config-card-header">
              <div className="page-section-title">
                <Typography.Title level={4}>员工试运行</Typography.Title>
                <Text type="secondary">给当前员工一个真实任务，确认它的角色说明、能力绑定和知识库是否按预期工作。</Text>
              </div>
              {currentAgent ? <DevOnly><Tag color="blue">{currentAgent.agentId}</Tag></DevOnly> : <Tag>未保存</Tag>}
            </div>

            {!currentAgent ? (
              <Alert type="info" showIcon message="请先保存员工" description="当前还没有持久化 Agent，保存后才能执行真实试运行。" />
            ) : null}

            <div className="studio-form-field">
              <Text type="secondary">测试任务</Text>
              <TextArea
                value={testPrompt}
                onChange={(event) => setTestPrompt(event.target.value)}
                rows={4}
                placeholder="给这个 Agent 一个明确任务，验证它是否能按预期工作。"
              />
            </div>

            <div className="studio-form-actions">
              <Space wrap>
                <Button
                  type="primary"
                  icon={<ExperimentOutlined />}
                  onClick={() => void handleTestRun()}
                  loading={testing}
                  disabled={!currentAgent}
                >
                  开始试运行
                </Button>
                {currentAgent ? (
                  <Button onClick={() => void loadRecentRuns(currentAgent.agentId)} loading={loadingRuns}>
                    刷新最近执行
                  </Button>
                ) : null}
              </Space>
            </div>

            {runError ? <Alert type="error" showIcon message={runError} /> : null}
          </Card>

          <Card className="config-panel-card">
            <div className="config-card-header">
              <div className="page-section-title">
                <Typography.Title level={4}>本次绑定与证据</Typography.Title>
                <Text type="secondary">把试运行时真正生效的模型、绑定项和知识证据集中展示出来。</Text>
              </div>
              <Tag color="purple">{lastRunResult ? '已生成' : '等待试运行'}</Tag>
            </div>

            {lastRunResult ? (
              <div className="studio-run-result">
                <Text type="secondary">最近一次返回摘要</Text>
                <Paragraph className="studio-result-copy">
                  {lastRunResult.assistantMessage?.content || lastRunResult.run.resultSummary?.content || '本次运行未返回可显示摘要。'}
                </Paragraph>
                <Space wrap style={{ marginBottom: 12 }}>
                  <Tag color="blue">{lastRunResult.resolvedModel || '默认模型'}</Tag>
                  <Tag color="purple">知识命中 {lastRunResult.knowledgeHits.length}</Tag>
                  <Tag color="gold">MCP {lastRunResult.appliedBindings.mcpServerIds.length}</Tag>
                  <Tag color="green">工具 {lastRunResult.appliedBindings.toolAllowlist.length}</Tag>
                </Space>
                <Space wrap style={{ marginBottom: 12 }}>
                  <Button size="small" onClick={() => navigate(`/studio/runs/${lastRunResult.run.runId}`)}>
                    查看执行详情
                  </Button>
                  <Button size="small" onClick={() => setTestPrompt(lastRunResult.run.taskPreview || testPrompt)}>
                    复用本次任务
                  </Button>
                  <Button size="small" onClick={() => navigate('/studio/runs')}>
                    查看全部执行
                  </Button>
                </Space>
                {lastRunResult.appliedBindings.chatModelSelection ? (
                  <Paragraph type="secondary" style={{ marginBottom: 8 }}>
                    实际模型：
                    {(lastRunResult.appliedBindings.chatModelSelection.displayName
                      || lastRunResult.appliedBindings.chatModelSelection.providerId)}
                    {' / '}
                    {lastRunResult.appliedBindings.chatModelSelection.modelName}
                  </Paragraph>
                ) : null}
                <Paragraph type="secondary" style={{ marginBottom: 8 }}>
                  绑定知识库：{formatBindingNames(lastRunResult.appliedBindings.knowledgeBindingIds)}
                </Paragraph>
                <Paragraph type="secondary" style={{ marginBottom: 8 }}>
                  启用 MCP：{formatBindingNames(lastRunResult.appliedBindings.mcpServerIds)}
                </Paragraph>
                <Paragraph type="secondary" style={{ marginBottom: 8 }}>
                  工具白名单：{formatBindingNames(lastRunResult.appliedBindings.toolAllowlist)}
                </Paragraph>
                {lastRunResult.assistantMessage?.citations?.length ? (
                  <Paragraph type="secondary" style={{ marginBottom: 8 }}>
                    引用来源：{lastRunResult.assistantMessage.citations.map((item) => item.title || item.docId).join('、')}
                  </Paragraph>
                ) : null}
                {lastRunResult.knowledgeHits.length > 0 ? (
                  <div className="page-stack" style={{ gap: 8 }}>
                    {lastRunResult.knowledgeHits.slice(0, 3).map((hit) => (
                      <Card key={hit.chunkId} size="small" className="surface-card">
                        <Space direction="vertical" size={4} style={{ width: '100%' }}>
                          <Space wrap>
                            <Tag color="cyan">{hit.kbName}</Tag>
                            <Tag>{hit.title}</Tag>
                            <Text type="secondary">score {hit.score.toFixed(3)}</Text>
                          </Space>
                          <Text>{hit.preview}</Text>
                        </Space>
                      </Card>
                    ))}
                  </div>
                ) : (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="本次没有返回知识证据。" />
                )}
              </div>
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="完成一次试运行后，这里会显示本次绑定与证据。" />
            )}
          </Card>

          <Card className="config-panel-card">
            <div className="studio-runs-header">
              <Typography.Title level={5}>最近执行</Typography.Title>
              <Button size="small" onClick={() => navigate('/studio/runs')}>
                查看全部执行
              </Button>
            </div>

            {loadingRuns ? (
              <div className="center-box">
                <Spin />
              </div>
            ) : recentRuns.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="这个员工还没有执行记录。" />
            ) : (
              <div className="studio-run-list">
                {recentRuns.map((run) => (
                  <div
                    key={run.runId}
                    className="studio-run-list-item"
                    style={{ marginBottom: '12px', cursor: 'pointer' }}
                    onClick={() => navigate(`/studio/runs/${run.runId}`)}
                  >
                    <div className="studio-run-list-copy">
                      <div className="studio-run-list-head">
                        <Space wrap>
                          <strong>{run.label}</strong>
                          <Tag color={statusColor(run.status)}>{run.status}</Tag>
                        </Space>
                        <Text type="secondary">{formatDateTimeZh(run.createdAt)}</Text>
                      </div>
                      <Paragraph className="studio-run-preview" ellipsis={{ rows: 2 }}>
                        {run.resultSummary?.content || run.taskPreview}
                      </Paragraph>
                      {run.lastErrorMessage ? (
                        <Text type="danger">{run.lastErrorMessage}</Text>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </Drawer>
    </div>
  )
}
