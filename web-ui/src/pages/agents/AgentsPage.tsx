import { useEffect, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { api } from '../../api'
import type {
  AgentDefinition,
  AgentMemorySnapshot,
  AgentTemplateTool,
  ConfigData,
  ConfigMeta,
  InstalledSkill,
  KnowledgeBaseDefinition,
  MemoryCandidate,
  McpServerEntry,
  AgentTemplate,
} from '../../types'
import AgentDetail from './AgentDetail'
import AgentList from './AgentList'
import type { AgentFormState } from './types'
import { agentToForm, createEmptyForm, getErrorMessage, toPayload } from './utils'
import { getAllModelBindings } from '../../modelConfig'
import { useToast } from '../../toast'

export default function AgentsPage() {
  const message = useToast()
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
  const [form, setForm] = useState<AgentFormState>(() => createEmptyForm())
  const [agentTemplates, setAgentTemplates] = useState<AgentTemplate[]>([])
  const [globalConfig, setGlobalConfig] = useState<ConfigData | null>(null)
  const [globalConfigMeta, setGlobalConfigMeta] = useState<ConfigMeta | null>(null)
  const [loadingWorkspace, setLoadingWorkspace] = useState(true)
  const [loadingDetail, setLoadingDetail] = useState(() => Boolean(selectedAgentId) && !isCreateRoute)
  const [loadingMemory, setLoadingMemory] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [copying, setCopying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [memoryError, setMemoryError] = useState<string | null>(null)
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
      setForm(createEmptyForm())
      return
    }

    if (!selectedAgentId) {
      setDetailRequestAgentId(null)
      setLoadingDetail(false)
      setCurrentAgent(null)
      setAgentMemory(null)
      setAgentMemoryCandidates([])
      return
    }

    setDetailRequestAgentId(selectedAgentId)
    setLoadingDetail(true)
    setCurrentAgent(null)
    setForm(createEmptyForm())
    setAgentMemory(null)
    setAgentMemoryCandidates([])
    setMemoryError(null)
    void loadAgentDetail(selectedAgentId)
    void loadAgentMemoryGovernance(selectedAgentId)
  }, [isCreateRoute, loadingWorkspace, selectedAgentId])

  // Removed automatic redirect to detail view to support the Master Grid view.

  async function loadWorkspace() {
    try {
      setLoadingWorkspace(true)
      const [agentList, toolCatalog, skillList, mcpRegistry, kbList, tplList, configResult, metaResult] = await Promise.all([
        api.getAgents(),
        api.getValidTemplateTools(),
        api.getInstalledSkills(),
        api.getMcpServers(),
        api.getKnowledgeBases(true),
        api.getAgentTemplates(),
        api.getConfig().catch(() => null),
        api.getConfigMeta().catch(() => null),
      ])
      setAgents(agentList)
      setValidTools(toolCatalog)
      setSkills(skillList)
      setMcpServers(mcpRegistry.items)
      setKnowledgeBases(kbList)
      setAgentTemplates(tplList.filter(t => t.enabled))
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
      setError(getErrorMessage(loadError, '加载员工详情失败'))
    } finally {
      setLoadingDetail(false)
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

  function applyTemplate(templateName: string) {
    const tpl = agentTemplates.find(t => t.name === templateName)
    if (!tpl) return
    setForm(prev => ({
      ...prev,
      name: prev.name || `${tpl.name}的副本`,
      description: tpl.description || prev.description,
      systemPrompt: tpl.systemPrompt || prev.systemPrompt,
      model: tpl.model || prev.model,
      toolAllowlist: tpl.tools || [],
      skillIds: tpl.skills || [],
    }))
    message.success(`已应用蓝图: ${templateName}`)
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
    try {
      setSaving(true)
      setError(null)
      const saved = currentAgent
        ? await api.updateAgent(currentAgent.agentId, payload)
        : await api.createAgent(payload)
      message.success(currentAgent ? '员工已更新' : '员工已创建')
      await loadWorkspace()
      navigate(`/studio/agents/${saved.agentId}`, { replace: true })
      await loadAgentDetail(saved.agentId)
      await loadAgentMemoryGovernance(saved.agentId)
    } catch (saveError) {
      const nextError = getErrorMessage(saveError, '保存员工失败')
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
      message.success('员工已删除')
      const remaining = agents.filter((item) => item.agentId !== currentAgent.agentId)
      await loadWorkspace()
      if (remaining[0]) {
        navigate(`/studio/agents/${remaining[0].agentId}`, { replace: true })
      } else {
        navigate('/studio/agents', { replace: true })
      }
    } catch (deleteError) {
      const nextError = getErrorMessage(deleteError, '删除员工失败')
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
      message.success('员工已复制')
      await loadWorkspace()
      navigate(`/studio/agents/${copied.agentId}`, { replace: true })
    } catch (copyError) {
      const nextError = getErrorMessage(copyError, '复制员工失败')
      setError(nextError)
      message.error(nextError)
    } finally {
      setCopying(false)
    }
  }

  async function handleSaveAgentMemory(agentId: string, content: string) {
    try {
      const snapshot = await api.updateAgentMemory(agentId, content)
      setAgentMemory(snapshot)
      message.success('员工记忆已保存')
      await loadAgentMemoryGovernance(agentId)
    } catch (saveError) {
      const nextError = getErrorMessage(saveError, '保存员工记忆失败')
      setMemoryError(nextError)
      message.error(nextError)
    }
  }

  async function handleCreateAgentMemoryCandidate(agentId: string, content: string) {
    if (!content.trim()) {
      setMemoryError('请输入候选记忆内容。')
      return
    }
    try {
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
      {isCreateRoute || selectedAgentId ? (
        <div style={{ flex: 1, overflow: 'auto', background: 'var(--nb-body-bg)' }}>
          <AgentDetail
            isCreateRoute={isCreateRoute}
            selectedAgentId={selectedAgentId}
            currentAgent={currentAgent}
            form={form}
            agentMemory={agentMemory}
            agentMemoryCandidates={agentMemoryCandidates}
            validTools={validTools}
            skills={skills}
            mcpServers={mcpServers}
            agentTemplates={agentTemplates}
            knowledgeBases={knowledgeBases}
            globalConfig={globalConfig}
            globalConfigMeta={globalConfigMeta}
            loadingDetail={loadingDetail}
            loadingMemory={loadingMemory}
            saving={saving}
            copying={copying}
            deleting={deleting}
            error={error}
            memoryError={memoryError}
            detailRequestAgentId={detailRequestAgentId}
            onUpdateForm={updateForm}
            onApplyTemplate={applyTemplate}
            onToggleArrayItem={toggleArrayItem}
            onSave={handleSave}
            onCopy={handleCopy}
            onDelete={handleDelete}
            onRefreshMemory={loadAgentMemoryGovernance}
            onSaveMemory={handleSaveAgentMemory}
            onCreateCandidate={handleCreateAgentMemoryCandidate}
            onApplyCandidate={handleApplyAgentMemoryCandidate}
            onRejectCandidate={handleRejectAgentMemoryCandidate}
          />
        </div>
      ) : (
        <div style={{ flex: 1, overflow: 'auto', padding: '0 0 24px', background: 'var(--nb-body-bg)' }}>
          <AgentList
            agents={agents}
            loadingWorkspace={loadingWorkspace}
            error={error}
            selectedAgentId={selectedAgentId}
            onRefresh={loadWorkspace}
          />
        </div>
      )}
    </div>
  )
}
