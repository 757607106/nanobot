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
  McpServerEntry,
  AgentTemplate,
} from '../../types'
import AgentDetail from './AgentDetail'
import AgentList from './AgentList'
import type { AgentFormState } from './types'
import { agentToForm, createEmptyForm, getErrorMessage, toPayload } from './utils'
import { getAllModelBindings } from '../../modelConfig'
import { useToast } from '../../toast'
import { theme, Flex } from 'antd'

export default function AgentsPage() {
  const message = useToast()
  const { token } = theme.useToken()
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
      setForm(createEmptyForm())
      return
    }

    if (!selectedAgentId) {
      setDetailRequestAgentId(null)
      setLoadingDetail(false)
      setCurrentAgent(null)
      setAgentMemory(null)
      return
    }

    setDetailRequestAgentId(selectedAgentId)
    setLoadingDetail(true)
    setCurrentAgent(null)
    setForm(createEmptyForm())
    setAgentMemory(null)
    setMemoryError(null)
    void loadAgentDetail(selectedAgentId)
    void loadAgentMemory(selectedAgentId)
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

  async function loadAgentMemory(nextAgentId: string) {
    try {
      setLoadingMemory(true)
      const snapshot = await api.getAgentMemory(nextAgentId)
      setAgentMemory(snapshot)
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
      await loadAgentMemory(saved.agentId)
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

  async function handleSaveAgentMemory(agentId: string, files: Record<string, string>) {
    try {
      const snapshot = await api.updateAgentMemory(agentId, files)
      setAgentMemory(snapshot)
      message.success('长期记忆已保存')
    } catch (saveError) {
      const nextError = getErrorMessage(saveError, '保存员工记忆失败')
      setMemoryError(nextError)
      message.error(nextError)
    }
  }

  return (
    <Flex vertical style={{ height: '100%' }}>
      {isCreateRoute || selectedAgentId ? (
        <div style={{ flex: 1, overflow: 'auto', background: token.colorBgLayout }}>
          <AgentDetail
            isCreateRoute={isCreateRoute}
            selectedAgentId={selectedAgentId}
            currentAgent={currentAgent}
            form={form}
            agentMemory={agentMemory}
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
            onRefreshMemory={loadAgentMemory}
            onSaveMemory={handleSaveAgentMemory}
          />
        </div>
      ) : (
        <div style={{ flex: 1, overflow: 'auto', padding: `0 0 ${token.marginLG}px`, background: token.colorBgLayout }}>
          <AgentList
            agents={agents}
            loadingWorkspace={loadingWorkspace}
            error={error}
            selectedAgentId={selectedAgentId}
            onRefresh={loadWorkspace}
          />
        </div>
      )}
    </Flex>
  )
}
