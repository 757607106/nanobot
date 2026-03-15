import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  App,
  Button,
  Card,
  Empty,
  Input,
  List,
  Select,
  Space,
  Spin,
  Switch,
  Tag,
  Typography,
} from 'antd'
import {
  CopyOutlined,
  DeleteOutlined,
  ExperimentOutlined,
  PlusOutlined,
  ReloadOutlined,
  RobotOutlined,
  SaveOutlined,
} from '@ant-design/icons'
import { useNavigate, useParams } from 'react-router-dom'
import { api, ApiError } from '../api'
import PageHero from '../components/PageHero'
import { formatDateTimeZh } from '../locale'
import type {
  AgentDefinition,
  AgentDefinitionMutationInput,
  AgentRunSummary,
  AgentTemplateTool,
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

  useEffect(() => {
    void loadWorkspace()
  }, [])

  useEffect(() => {
    if (loadingWorkspace) {
      return
    }
    if (!agentId && agents[0]) {
      navigate(`/studio/agents/${agents[0].agentId}`, { replace: true })
      return
    }
    if (!selectedAgentId) {
      setCurrentAgent(null)
      setRecentRuns([])
      setLastResult(null)
      setForm(createEmptyForm())
      return
    }
    void loadAgentDetail(selectedAgentId)
    void loadRecentRuns(selectedAgentId)
  }, [agentId, agents, loadingWorkspace, navigate, selectedAgentId])

  const enabledCount = useMemo(() => agents.filter((item) => item.enabled).length, [agents])

  const toolOptions = useMemo(() => {
    const map = new Map(validTools.map((item) => [item.name, item.description]))
    for (const toolName of form.toolAllowlist) {
      if (!map.has(toolName)) {
        map.set(toolName, '当前定义中的工具')
      }
    }
    return Array.from(map.entries()).map(([value, description]) => ({
      value,
      label: value,
      description,
    }))
  }, [form.toolAllowlist, validTools])

  const skillOptions = useMemo(() => {
    const map = new Map(skills.map((item) => [item.id, item.description || item.name]))
    for (const skillId of form.skillIds) {
      if (!map.has(skillId)) {
        map.set(skillId, '当前定义中的技能')
      }
    }
    return Array.from(map.entries()).map(([value, description]) => ({
      value,
      label: value,
      description,
    }))
  }, [form.skillIds, skills])

  const mcpOptions = useMemo(() => {
    const map = new Map(mcpServers.map((item) => [item.name, item.displayName || item.name]))
    for (const serverId of form.mcpServerIds) {
      if (!map.has(serverId)) {
        map.set(serverId, serverId)
      }
    }
    return Array.from(map.entries()).map(([value, label]) => ({ value, label }))
  }, [form.mcpServerIds, mcpServers])

  const knowledgeOptions = useMemo(() => {
    const map = new Map(
      knowledgeBases.map((item) => [
        item.kbId,
        {
          label: item.name,
          description: item.description || '知识库',
        },
      ]),
    )
    for (const kbId of form.knowledgeBindingIds) {
      if (!map.has(kbId)) {
        map.set(kbId, {
          label: kbId,
          description: '当前定义中的知识库绑定',
        })
      }
    }
    return Array.from(map.entries()).map(([value, meta]) => ({
      value,
      label: `${meta.label} · ${meta.description}`,
    }))
  }, [form.knowledgeBindingIds, knowledgeBases])

  async function loadWorkspace() {
    try {
      setLoadingWorkspace(true)
      const [agentList, toolCatalog, skillList, mcpRegistry, kbList] = await Promise.all([
        api.getAgents(),
        api.getValidTemplateTools(),
        api.getInstalledSkills(),
        api.getMcpServers(),
        api.getKnowledgeBases(true),
      ])
      setAgents(agentList)
      setValidTools(toolCatalog)
      setSkills(skillList)
      setMcpServers(mcpRegistry.items)
      setKnowledgeBases(kbList)
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

  async function handleSave() {
    const payload = toPayload(form)
    if (!payload.name) {
      setError('Agent 名称不能为空。')
      return
    }
    if (!payload.systemPrompt) {
      setError('System Prompt 不能为空。')
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
      <PageHero
        className="page-hero-compact studio-hero"
        eyebrow="P1 Agent 最小闭环"
        title="数字员工 Agents"
        description="先把单个 Agent 做成可创建、可绑定、可测试运行的闭环。Teams、知识库治理和团队时间线会在后续阶段接进来。"
        stats={[
          { label: '已创建 Agents', value: agents.length },
          { label: '启用中', value: enabledCount },
          { label: '最近运行', value: recentRuns.length },
          { label: '已挂载知识库', value: knowledgeBases.length },
        ]}
        badges={[
          <Tag key="scope" color="processing">tools / MCP / skills 已接 test-run</Tag>,
          <Tag key="rag" color="success">知识库绑定已接 agent test-run</Tag>,
        ]}
        actions={(
          <Space wrap>
            <Button icon={<ReloadOutlined />} onClick={() => void loadWorkspace()} loading={loadingWorkspace}>
              刷新
            </Button>
            <Button onClick={() => navigate('/studio/templates')}>查看模板</Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/studio/agents/new')}>
              新建 Agent
            </Button>
          </Space>
        )}
      />

      {error ? <Alert type="error" showIcon message={error} /> : null}

      <div className="page-grid studio-agents-grid">
        <Card className="config-panel-card studio-agent-list-card">
          <div className="config-card-header">
            <div className="page-section-title">
              <Typography.Title level={4}>Agent Catalog</Typography.Title>
              <Text type="secondary">选择已有数字员工，或者创建新的执行单元。</Text>
            </div>
            <Tag color="blue">{agents.length}</Tag>
          </div>

          {agents.length === 0 ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="当前还没有可复用 Agent。"
            >
              <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/studio/agents/new')}>
                创建第一个 Agent
              </Button>
            </Empty>
          ) : (
            <List
              className="studio-agent-list"
              dataSource={agents}
              renderItem={(item) => (
                <List.Item
                  className={`studio-agent-list-item ${selectedAgentId === item.agentId ? 'is-active' : ''}`}
                  onClick={() => navigate(`/studio/agents/${item.agentId}`)}
                >
                  <div className="studio-agent-list-copy">
                    <div className="studio-agent-list-head">
                      <Space size={8}>
                        <RobotOutlined />
                        <strong>{item.name}</strong>
                      </Space>
                      <Tag color={item.enabled ? 'success' : 'default'}>{item.enabled ? '启用' : '停用'}</Tag>
                    </div>
                    <Text type="secondary">{item.description || '暂未补充说明。'}</Text>
                    <div className="studio-agent-list-meta">
                      <Tag>{item.model || '使用实例默认模型'}</Tag>
                      <Tag>{item.toolAllowlist.length} tools</Tag>
                      <Tag>{item.skillIds.length} skills</Tag>
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
                <Typography.Title level={4}>{currentAgent ? 'Agent Detail' : 'New Agent'}</Typography.Title>
                <Text type="secondary">保存角色、模型、能力边界和记忆策略。</Text>
              </div>
              {currentAgent?.sourceTemplateName ? <Tag color="purple">模板：{currentAgent.sourceTemplateName}</Tag> : null}
            </div>

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
                <Text type="secondary">模型覆盖</Text>
                <Input
                  value={form.model}
                  onChange={(event) => updateForm('model', event.target.value)}
                  placeholder="留空则使用实例默认模型"
                />
              </div>

              <div className="studio-form-field">
                <Text type="secondary">Backend</Text>
                <Input
                  value={form.backend}
                  onChange={(event) => updateForm('backend', event.target.value)}
                  placeholder="可选，例如 claude_code"
                />
              </div>

              <div className="studio-form-field studio-form-field-span-2">
                <Text type="secondary">描述</Text>
                <TextArea
                  value={form.description}
                  onChange={(event) => updateForm('description', event.target.value)}
                  rows={3}
                  placeholder="说明它负责什么、擅长什么、输出给谁。"
                />
              </div>

              <div className="studio-form-field studio-form-field-span-2">
                <Text type="secondary">System Prompt</Text>
                <TextArea
                  value={form.systemPrompt}
                  onChange={(event) => updateForm('systemPrompt', event.target.value)}
                  rows={8}
                  placeholder="定义该 Agent 的角色、任务边界和输出方式。"
                />
              </div>

              <div className="studio-form-field studio-form-field-span-2">
                <Text type="secondary">运行规则</Text>
                <TextArea
                  value={form.rulesText}
                  onChange={(event) => updateForm('rulesText', event.target.value)}
                  rows={4}
                  placeholder="每行一条。"
                />
              </div>

              <div className="studio-form-field">
                <Text type="secondary">Tools</Text>
                <Select
                  mode="multiple"
                  value={form.toolAllowlist}
                  onChange={(value) => updateForm('toolAllowlist', value)}
                  options={toolOptions.map((item) => ({
                    value: item.value,
                    label: `${item.label} · ${item.description}`,
                  }))}
                  placeholder="选择允许使用的内置工具"
                />
              </div>

              <div className="studio-form-field">
                <Text type="secondary">MCP</Text>
                <Select
                  mode="multiple"
                  value={form.mcpServerIds}
                  onChange={(value) => updateForm('mcpServerIds', value)}
                  options={mcpOptions}
                  placeholder="选择可挂载的 MCP Server"
                />
              </div>

              <div className="studio-form-field">
                <Text type="secondary">Skills</Text>
                <Select
                  mode="multiple"
                  value={form.skillIds}
                  onChange={(value) => updateForm('skillIds', value)}
                  options={skillOptions.map((item) => ({
                    value: item.value,
                    label: `${item.label} · ${item.description}`,
                  }))}
                  placeholder="选择要注入上下文的技能"
                />
              </div>

              <div className="studio-form-field">
                <Text type="secondary">Memory Scope</Text>
                <Select
                  value={form.memoryScope}
                  onChange={(value) => updateForm('memoryScope', value)}
                  options={[
                    { value: 'agent_profile', label: 'agent_profile' },
                    { value: 'team_shared', label: 'team_shared' },
                    { value: 'workspace_shared', label: 'workspace_shared' },
                  ]}
                />
              </div>

              <div className="studio-form-field studio-form-field-span-2">
                <Text type="secondary">Knowledge Bindings</Text>
                <Select
                  mode="multiple"
                  value={form.knowledgeBindingIds}
                  onChange={(value) => updateForm('knowledgeBindingIds', value)}
                  options={knowledgeOptions}
                  placeholder="选择该 Agent 可读取的知识库"
                />
              </div>

              <div className="studio-form-field">
                <Text type="secondary">Tags</Text>
                <Select
                  mode="tags"
                  value={form.tags}
                  onChange={(value) => updateForm('tags', value)}
                  placeholder="例如 legal, research, reviewer"
                />
              </div>

              <div className="studio-form-field studio-form-switch-field">
                <Text type="secondary">启用状态</Text>
                <Switch checked={form.enabled} onChange={(checked) => updateForm('enabled', checked)} />
              </div>
            </div>

            <Alert
              className="studio-inline-alert"
              type="info"
              showIcon
              message="当前版本的知识库绑定已可在 agent test-run 中触发真实检索；知识库页面、team binding 和更完整的检索治理会继续在 T59 后续阶段补齐。"
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
                  保存 Agent
                </Button>
              </Space>
            </div>
          </Card>

          <Card className="config-panel-card studio-agent-run-card">
            <div className="config-card-header">
              <div className="page-section-title">
                <Typography.Title level={4}>Agent Test Run</Typography.Title>
                <Text type="secondary">真实验证当前 Agent 的 prompt、model、tools、MCP、skills 和知识库检索装配。</Text>
              </div>
              {currentAgent ? <Tag color="blue">{currentAgent.agentId}</Tag> : <Tag>未保存</Tag>}
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
                  发起测试运行
                </Button>
                {currentAgent ? (
                  <Button onClick={() => void loadRecentRuns(currentAgent.agentId)} loading={loadingRuns}>
                    刷新最近运行
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
              <Typography.Title level={5}>Recent Runs</Typography.Title>
            </div>

            {loadingRuns ? (
              <div className="center-box">
                <Spin />
              </div>
            ) : recentRuns.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有该 Agent 的运行记录。" />
            ) : (
              <List
                className="studio-run-list"
                dataSource={recentRuns}
                renderItem={(run) => (
                  <List.Item className="studio-run-list-item">
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
