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
import { getModelSuggestions } from '../modelCatalog'
import {
  getAllModelBindings,
  getBindingOptions,
  getPreferredProvider,
  getProviderOptions,
  inferProviderFromModel,
  modelMatchesProvider,
} from '../modelConfig'
import { interactiveLift, interactiveTap, shellSpring } from '../motionTokens'
import PageHero from '../components/PageHero'
import { formatDateTimeZh } from '../locale'
import type {
  AgentDefinition,
  AgentDefinitionMutationInput,
  AgentRunSummary,
  AgentTemplateTool,
  ConfigData,
  ConfigMeta,
  InstalledSkill,
  KnowledgeBaseDefinition,
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
  }
}

function agentToForm(agent: AgentDefinition): AgentFormState {
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
    model: form.model.trim() || null,
    binding: form.binding.trim() || null,
    provider: form.provider.trim() || null,
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
  const [lastResult, setLastResult] = useState<string | null>(null)
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
  const [globalConfig, setGlobalConfig] = useState<ConfigData | null>(null)
  const [globalConfigMeta, setGlobalConfigMeta] = useState<ConfigMeta | null>(null)
  const [capabilityTab, setCapabilityTab] = useState('tools')

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
      setLastResult(null)
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

  const agentProviderOptions = useMemo(
    () => getProviderOptions(globalConfigMeta),
    [globalConfigMeta],
  )
  const agentBindingOptions = useMemo(
    () => (globalConfig && globalConfigMeta ? getBindingOptions(globalConfig, globalConfigMeta) : []),
    [globalConfig, globalConfigMeta],
  )
  const availableBindings = useMemo(
    () => (globalConfig ? getAllModelBindings(globalConfig, globalConfigMeta) : {}),
    [globalConfig, globalConfigMeta],
  )

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

      if (bindingConfig?.model && !currentModel) {
        nextModel = bindingConfig.model
      } else if (nextProvider && currentModel && !modelMatchesProvider(globalConfigMeta, nextProvider, currentModel)) {
        nextModel = bindingConfig?.model || getModelSuggestions(nextProvider)[0] || current.model
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
      return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={emptyText} />
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
          <div className="stat-card-icon" style={{ background: 'var(--ant-color-primary-bg)', color: 'var(--ant-color-primary)' }}>
            <TeamOutlined />
          </div>
          <div className="stat-card-copy">
            <div className="stat-card-metric">{agents.length}</div>
            <div className="stat-card-label">员工总数</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-card-icon" style={{ background: 'var(--ant-color-success-bg)', color: 'var(--ant-color-success)' }}>
            <CheckCircleOutlined />
          </div>
          <div className="stat-card-copy">
            <div className="stat-card-metric">{enabledCount}</div>
            <div className="stat-card-label">启用中</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-card-icon" style={{ background: 'var(--ant-color-warning-bg)', color: 'var(--ant-color-warning)' }}>
            <ClockCircleOutlined />
          </div>
          <div className="stat-card-copy">
            <div className="stat-card-metric">{recentRuns.length}</div>
            <div className="stat-card-label">最近执行</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-card-icon" style={{ background: 'var(--ant-color-info-bg)', color: 'var(--ant-color-info)' }}>
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
          <Text type="secondary">查看和管理您的数字员工，点击卡片进行详细配置。</Text>
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
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="还没有创建 AI 员工"
          className="page-card"
        >
          <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/studio/agents/new')}>
            创建第一个员工
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
                  <div className="id-badge-team">
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
                <Text type="secondary">标签</Text>
                <Select
                  mode="tags"
                  value={form.tags}
                  onChange={(value) => updateForm('tags', value)}
                  placeholder="例如：法务、研究、评审"
                />
              </div>

              <div className="studio-form-field">
                <Text type="secondary">模型绑定</Text>
                <Select
                  allowClear
                  value={form.binding || undefined}
                  onChange={(value) => updateBinding(value ?? '')}
                  options={agentBindingOptions}
                  placeholder="优先使用指定绑定"
                />
              </div>

              <div className="studio-form-field">
                <Text type="secondary">供应商绑定</Text>
                <Select
                  allowClear
                  value={form.provider || undefined}
                  onChange={(value) => updateProvider(value ?? '')}
                  options={agentProviderOptions}
                  placeholder="留空则按模型自动判断"
                />
              </div>

              <div className="studio-form-field">
                <Text type="secondary">模型</Text>
                <AutoComplete
                  value={form.model}
                  onChange={(value) => updateForm('model', value)}
                  options={modelSuggestions}
                  placeholder="留空则使用默认模型"
                  allowClear
                  filterOption={(input, option) =>
                    (option?.value ?? '').toLowerCase().includes(input.toLowerCase())
                  }
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
              <Tabs
                activeKey={capabilityTab}
                onChange={setCapabilityTab}
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
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="这个员工还没有执行记录。" />
            ) : (
              <div className="studio-run-list">
                {recentRuns.map((run) => (
                  <div key={run.runId} className="studio-run-list-item" style={{ marginBottom: '12px' }}>
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
