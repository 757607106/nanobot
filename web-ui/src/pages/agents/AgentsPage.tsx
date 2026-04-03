import { useEffect, useState } from 'react'
import { App, Flex, Splitter } from 'antd'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { api } from '../../api'
import type {
  AgentDefinition,
  AgentMemorySnapshot,
  AgentRunSummary,
  AgentTemplateTool,
  ConfigData,
  ConfigMeta,
  InstalledSkill,
  KnowledgeBaseDefinition,
  MemoryCandidate,
  McpServerEntry,
} from '../../types'
import AgentDetail from './AgentDetail'
import AgentList from './AgentList'
import type { AgentFormState } from './types'
import { agentToForm, createEmptyForm, getErrorMessage, toPayload } from './utils'
import { getAllModelBindings } from '../../modelConfig'

export default function AgentsPage() {
  const { message } = App.useApp()
  const location = useLocation()
  const navigate = useNavigate()
  const { agentId } = useParams()
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
  const [globalConfig, setGlobalConfig] = useState<ConfigData | null>(null)
  const [globalConfigMeta, setGlobalConfigMeta] = useState<ConfigMeta | null>(null)
  const [loadingWorkspace, setLoadingWorkspace] = useState(true)
  const [loadingDetail, setLoadingDetail] = useState(() => Boolean(selectedAgentId) && !isCreateRoute)
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
  const [detailRequestAgentId, setDetailRequestAgentId] = useState<string | null>(selectedAgentId)

  useEffect(() => {
    void loadWorkspace()
  }, [])

  useEffect(() => {
    if (loadingWorkspace) return

    if (isCreateRoute) {
      setDetailRequestAgentId(null)
      setLoadingDetail(false)
      setCurrentAgent(null)
      setAgentMemory(null)
      setAgentMemoryCandidates([])
      setRecentRuns([])
      setForm(createEmptyForm())
      return
    }

    if (!selectedAgentId) {
      setDetailRequestAgentId(null)
      setLoadingDetail(false)
      setCurrentAgent(null)
      setAgentMemory(null)
      setAgentMemoryCandidates([])
      setRecentRuns([])
      return
    }

    setDetailRequestAgentId(selectedAgentId)
    setLoadingDetail(true)
    setCurrentAgent(null)
    setForm(createEmptyForm())
    setAgentMemory(null)
    setAgentMemoryCandidates([])
    setRecentRuns([])
    setMemoryError(null)
    setRunError(null)
    void loadAgentDetail(selectedAgentId)
    void loadAgentMemoryGovernance(selectedAgentId)
    void loadRecentRuns(selectedAgentId)
  }, [isCreateRoute, loadingWorkspace, selectedAgentId])

  useEffect(() => {
    if (loadingWorkspace || isCreateRoute || selectedAgentId || agents.length === 0) {
      return
    }
    navigate(`/studio/agents/${agents[0].agentId}`, { replace: true })
  }, [agents, isCreateRoute, loadingWorkspace, navigate, selectedAgentId])

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

  function toggleArrayItem(
    key: 'toolAllowlist' | 'skillIds' | 'mcpServerIds' | 'knowledgeBindingIds',
    item: string,
  ) {
    setForm((prev) => ({
      ...prev,
      [key]: prev[key].includes(item) ? prev[key].filter((value) => value !== item) : [...prev[key], item],
    }))
  }

  async function handleSave() {
    let payload: ReturnType<typeof toPayload>
    try {
      const availableBindings = globalConfig ? getAllModelBindings(globalConfig, globalConfigMeta) : {}
      payload = toPayload(form, availableBindings)
    } catch {
      const nextError = '产物保留策略无效'
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
    if (!currentAgent) return
    try {
      setDeleting(true)
      await api.deleteAgent(currentAgent.agentId)
      message.success('Agent 已删除')
      const remaining = agents.filter((item) => item.agentId !== currentAgent.agentId)
      await loadWorkspace()
      if (remaining[0]) {
        navigate(`/studio/agents/${remaining[0].agentId}`, { replace: true })
      } else {
        navigate('/studio/agents', { replace: true })
      }
    } catch (deleteError) {
      const nextError = getErrorMessage(deleteError, '删除 Agent 失败')
      setError(nextError)
      message.error(nextError)
    } finally {
      setDeleting(false)
    }
  }

  async function handleCopy() {
    if (!currentAgent) return
    try {
      setCopying(true)
      const copied = await api.copyAgent(currentAgent.agentId)
      message.success('Agent 已复制')
      await loadWorkspace()
      navigate(`/studio/agents/${copied.agentId}`, { replace: true })
    } catch (copyError) {
      const nextError = getErrorMessage(copyError, '复制 Agent 失败')
      setError(nextError)
      message.error(nextError)
    } finally {
      setCopying(false)
    }
  }

  async function handleTestRun(agentId: string, prompt: string): Promise<string> {
    if (!prompt.trim()) {
      setRunError('请输入测试任务。')
      throw new Error('请输入测试任务。')
    }
    try {
      setTesting(true)
      const result = await api.testRunAgent(agentId, prompt.trim())
      const resultText = result.assistantMessage?.content || result.run.resultSummary?.content || '本次运行未返回可显示摘要。'
      if (result.knowledgeHits.length > 0) {
        message.success(`试运行已完成，并命中 ${result.knowledgeHits.length} 条知识证据`)
      } else {
        message.success('试运行已完成')
      }
      await loadRecentRuns(agentId)
      setRunError(null)
      return resultText
    } catch (testError) {
      const errorMsg = getErrorMessage(testError, '试运行失败')
      setRunError(errorMsg)
      message.error(errorMsg)
      throw testError
    } finally {
      setTesting(false)
    }
  }

  async function handleSaveAgentMemory(agentId: string, content: string) {
    try {
      setSavingMemory(true)
      const snapshot = await api.updateAgentMemory(agentId, content)
      setAgentMemory(snapshot)
      message.success('员工记忆已保存')
      await loadAgentMemoryGovernance(agentId)
    } catch (saveError) {
      const nextError = getErrorMessage(saveError, '保存员工记忆失败')
      setMemoryError(nextError)
      message.error(nextError)
    } finally {
      setSavingMemory(false)
    }
  }

  async function handleCreateAgentMemoryCandidate(agentId: string, content: string) {
    if (!content.trim()) {
      setMemoryError('请输入候选记忆内容。')
      return
    }
    try {
      setCreatingMemoryCandidate(true)
      await api.createAgentMemoryCandidate(agentId, {
        content: content.trim(),
        sourceKind: 'manual_note',
      })
      message.success('员工记忆候选已提交')
      await loadAgentMemoryGovernance(agentId)
    } catch (createError) {
      const nextError = getErrorMessage(createError, '提交员工记忆候选失败')
      setMemoryError(nextError)
      message.error(nextError)
    } finally {
      setCreatingMemoryCandidate(false)
    }
  }

  async function handleApplyAgentMemoryCandidate(agentId: string, candidateId: string) {
    try {
      await api.applyMemoryCandidate(candidateId)
      message.success('候选已应用到员工记忆')
      await loadAgentMemoryGovernance(agentId)
    } catch (applyError) {
      const nextError = getErrorMessage(applyError, '应用员工记忆候选失败')
      setMemoryError(nextError)
      message.error(nextError)
    }
  }

  async function handleRejectAgentMemoryCandidate(agentId: string, candidateId: string) {
    try {
      await api.rejectMemoryCandidate(candidateId)
      message.success('候选已忽略')
      await loadAgentMemoryGovernance(agentId)
    } catch (rejectError) {
      const nextError = getErrorMessage(rejectError, '忽略员工记忆候选失败')
      setMemoryError(nextError)
      message.error(nextError)
    }
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Splitter className="console-workspace-splitter flex-1">
        <Splitter.Panel defaultSize={260} min={220} max={360}>
          <div style={{ height: '100%', overflow: 'auto', padding: '0 0 24px' }}>
            <AgentList
              agents={agents}
              loadingWorkspace={loadingWorkspace}
              error={error}
              selectedAgentId={selectedAgentId}
              onRefresh={loadWorkspace}
            />
          </div>
        </Splitter.Panel>

        <Splitter.Panel min={400}>
          <div style={{ height: '100%', overflow: 'auto' }}>
            <AgentDetail
              isCreateRoute={isCreateRoute}
              selectedAgentId={selectedAgentId}
              currentAgent={currentAgent}
              form={form}
              agentMemory={agentMemory}
              agentMemoryCandidates={agentMemoryCandidates}
              recentRuns={recentRuns}
              validTools={validTools}
              skills={skills}
              mcpServers={mcpServers}
              knowledgeBases={knowledgeBases}
              globalConfig={globalConfig}
              globalConfigMeta={globalConfigMeta}
              loadingDetail={loadingDetail}
              loadingMemory={loadingMemory}
              loadingRuns={loadingRuns}
              saving={saving}
              copying={copying}
              deleting={deleting}
              error={error}
              memoryError={memoryError}
              runError={runError}
              detailRequestAgentId={detailRequestAgentId}
              onUpdateForm={updateForm}
              onToggleArrayItem={toggleArrayItem}
              onSave={handleSave}
              onCopy={handleCopy}
              onDelete={handleDelete}
              onRefreshWorkspace={loadWorkspace}
              onRefreshMemory={loadAgentMemoryGovernance}
              onSaveMemory={handleSaveAgentMemory}
              onCreateCandidate={handleCreateAgentMemoryCandidate}
              onApplyCandidate={handleApplyAgentMemoryCandidate}
              onRejectCandidate={handleRejectAgentMemoryCandidate}
              onTestRun={handleTestRun}
              onRefreshRuns={loadRecentRuns}
            />
          </div>
        </Splitter.Panel>
      </Splitter>
    </div>
  )
}
