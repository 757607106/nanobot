import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import {
  Alert,
  App,
  Button,
  Card,
  Empty,
  Input,
  InputNumber,
  Select,
  Space,
  Spin,
  Tag,
  Typography,
} from 'antd'
import {
  ArrowRightOutlined,
  CopyOutlined,
  DeleteOutlined,
  PlusOutlined,
  ReloadOutlined,
  RobotOutlined,
  SaveOutlined,
  SettingOutlined,
} from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { ApiError, api } from '../api'
import { MotionGroup, MotionPanel } from '../components/MotionSurface'
import PageHero from '../components/PageHero'
import { providerCategoryLabels, providerDescriptions } from '../configMeta'
import { getModelSuggestions } from '../modelCatalog'
import {
  buildModelBinding,
  createBindingId,
  ensureProviderSelection,
  getAllModelBindings,
  getBindingOptions,
  getPreferredBinding,
  getProviderMeta,
  getProviderOptions,
  inferProviderFromModel,
  modelMatchesProvider,
  normalizeModelConfig,
  providerCategoryOrder,
  updateBindingFieldValue,
  updateBindingValue,
} from '../modelConfig'
import type {
  AgentDefinition,
  ConfigData,
  ConfigMeta,
  ModelBinding,
  ModelBindingModelsResult,
  ModelBindingTestResult,
  ProviderMeta,
} from '../types'

const { Text, Paragraph } = Typography

type WorkspaceMode = 'bindings' | 'agents'

type BindingPreset = {
  key: string
  label: string
  caption: string
  bindingName: string
  bindingLabel: string
  providerName: string
  model: string
  apiBase?: string | null
}

type BindingEntry = {
  bindingName: string
  binding: ModelBinding
  meta: ProviderMeta
  configured: boolean
  description: string
  endpointLabel: string
  suggestions: string[]
}

const bindingPresets: BindingPreset[] = [
  {
    key: 'deepseek-official',
    label: 'DeepSeek 官方',
    caption: '直接接入 DeepSeek 官方托管模型',
    bindingName: 'deepseek',
    bindingLabel: 'DeepSeek 官方',
    providerName: 'deepseek',
    model: 'deepseek-chat',
  },
  {
    key: 'dashscope-compatible',
    label: '阿里百炼兼容',
    caption: '快速切到百炼 OpenAI 兼容地址',
    bindingName: 'dashscope-compatible',
    bindingLabel: '百炼兼容',
    providerName: 'dashscope',
    model: 'qwen-max',
    apiBase: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  },
  {
    key: 'volcengine-doubao',
    label: '豆包按量',
    caption: '火山引擎 Ark 按量接入豆包模型',
    bindingName: 'doubao-primary',
    bindingLabel: '豆包主账号',
    providerName: 'volcengine',
    model: 'doubao-1-5-pro-32k-250115',
  },
  {
    key: 'moonshot-cn',
    label: 'Kimi 国内',
    caption: 'Moonshot 中国区常用接入地址',
    bindingName: 'kimi-cn',
    bindingLabel: 'Kimi 国内',
    providerName: 'moonshot',
    model: 'kimi-k2.5',
    apiBase: 'https://api.moonshot.cn/v1',
  },
  {
    key: 'zhipu-standard',
    label: '智谱标准',
    caption: '标准 GLM / 智谱模型接入',
    bindingName: 'zhipu-standard',
    bindingLabel: '智谱标准',
    providerName: 'zhipu',
    model: 'glm-4.5',
  },
  {
    key: 'zhipu-coding',
    label: '智谱 Coding',
    caption: '切到智谱 Coding Plan 地址',
    bindingName: 'zhipu-coding',
    bindingLabel: '智谱 Coding',
    providerName: 'zhipu',
    model: 'glm-4.5',
    apiBase: 'https://open.bigmodel.cn/api/coding/paas/v4',
  },
]

function isBindingConfigured(providerMeta: ProviderMeta, binding: ModelBinding) {
  if (providerMeta.isOauth) {
    return true
  }
  if (providerMeta.isLocal) {
    return Boolean((binding.apiBase || providerMeta.defaultApiBase || '').trim())
  }
  return Boolean((binding.apiKey || '').trim() || (binding.apiBase || '').trim())
}

function getBindingStatus(providerMeta: ProviderMeta, binding: ModelBinding) {
  if (providerMeta.isOauth) {
    return { label: 'OAuth', color: 'blue' as const }
  }
  if (providerMeta.isLocal) {
    return isBindingConfigured(providerMeta, binding)
      ? { label: '本地已连接', color: 'green' as const }
      : { label: '待填写地址', color: 'default' as const }
  }
  return isBindingConfigured(providerMeta, binding)
    ? { label: '已配置', color: 'green' as const }
    : { label: '待配置', color: 'default' as const }
}

function getEndpointLabel(providerMeta: ProviderMeta, binding: ModelBinding) {
  return binding.apiBase?.trim() || providerMeta.defaultApiBase || '使用供应商默认地址'
}

function buildDefaultBindingConfig(
  current: ConfigData,
  bindingName: string,
  meta: ConfigMeta | null,
  options?: { keepCurrentModel?: boolean; model?: string },
) {
  const bindings = getAllModelBindings(current, meta)
  const binding = bindings[bindingName]
  if (!binding) {
    return current
  }

  const next = ensureProviderSelection(current, binding.provider, meta, {
    keepExistingModel: options?.keepCurrentModel ?? true,
    bindingName,
    label: binding.label || bindingName,
  })

  return {
    ...next,
    agents: {
      ...next.agents,
      defaults: {
        ...next.agents.defaults,
        binding: bindingName,
        provider: binding.provider,
        model: options?.model ?? next.agents.defaults.model,
      },
    },
    modelBindings: {
      ...(next.modelBindings ?? {}),
      [bindingName]: {
        ...(next.modelBindings?.[bindingName] ?? binding),
        model: options?.model ?? next.agents.defaults.model,
      },
    },
  }
}

function getBindingRouteErrorMessage(error: unknown, action: '检测连接' | '获取模型列表') {
  if (error instanceof ApiError && error.statusCode === 404) {
    return `当前 Web 后端还没加载“${action}”接口，通常是 dev 模式下后端没有重启。请重启 nanobot Web 服务后再试。`
  }
  return error instanceof Error ? error.message : `${action}失败`
}

export default function ModelsPage() {
  const { message } = App.useApp()
  const navigate = useNavigate()
  const [config, setConfig] = useState<ConfigData | null>(null)
  const [configMeta, setConfigMeta] = useState<ConfigMeta | null>(null)
  const [agents, setAgents] = useState<AgentDefinition[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>('bindings')
  const [fetchingModelsBindingName, setFetchingModelsBindingName] = useState('')
  const [testingBindingName, setTestingBindingName] = useState('')
  const [bindingModelResults, setBindingModelResults] = useState<Record<string, ModelBindingModelsResult>>({})
  const [bindingTestResults, setBindingTestResults] = useState<Record<string, ModelBindingTestResult>>({})
  const [bindingQuery, setBindingQuery] = useState('')
  const [selectedBindingName, setSelectedBindingName] = useState('')

  const deferredBindingQuery = useDeferredValue(bindingQuery)
  const bindings = useMemo(
    () => (config ? getAllModelBindings(config, configMeta) : {}),
    [config, configMeta],
  )

  useEffect(() => {
    void loadModels()
  }, [])

  const defaultBindingName = config && configMeta ? getPreferredBinding(config, configMeta) : ''
  const defaultBinding = defaultBindingName ? bindings[defaultBindingName] : null
  const defaultBindingMeta = getProviderMeta(configMeta, defaultBinding?.provider || '')
  const activeBindingName = selectedBindingName || defaultBindingName
  const selectedBinding = activeBindingName ? bindings[activeBindingName] : null
  const selectedBindingMeta = getProviderMeta(configMeta, selectedBinding?.provider || '')
  const defaultBindingOptions = useMemo(
    () => (config && configMeta ? getBindingOptions(config, configMeta) : []),
    [config, configMeta],
  )
  const providerOptions = useMemo(() => getProviderOptions(configMeta), [configMeta])
  const defaultModelSuggestions = useMemo(
    () => getModelSuggestions(defaultBinding?.provider || '', config?.agents.defaults.model),
    [config?.agents.defaults.model, defaultBinding?.provider],
  )
  const selectedBindingSuggestions = useMemo(
    () => {
      const values = new Set<string>()
      const remoteModels = activeBindingName ? bindingModelResults[activeBindingName]?.models ?? [] : []
      for (const candidate of [selectedBinding?.model || null, ...remoteModels, ...getModelSuggestions(selectedBinding?.provider || '', selectedBinding?.model || null)]) {
        const value = String(candidate || '').trim()
        if (value) {
          values.add(value)
        }
      }
      return Array.from(values)
    },
    [activeBindingName, bindingModelResults, selectedBinding?.model, selectedBinding?.provider],
  )
  const defaultModelProviderName = useMemo(
    () => inferProviderFromModel(configMeta, config?.agents.defaults.model),
    [configMeta, config?.agents.defaults.model],
  )
  const defaultModelMismatch = useMemo(
    () => (defaultBinding ? !modelMatchesProvider(configMeta, defaultBinding.provider, config?.agents.defaults.model) : false),
    [config?.agents.defaults.model, configMeta, defaultBinding],
  )

  const bindingEntries = useMemo(() => {
    if (!configMeta) {
      return [] as BindingEntry[]
    }

    const entries = Object.entries(bindings)
      .map(([bindingName, binding]) => {
        const providerMeta = getProviderMeta(configMeta, binding.provider)
        if (!providerMeta) {
          return null
        }
        return {
          bindingName,
          binding,
          meta: providerMeta,
          configured: isBindingConfigured(providerMeta, binding),
          description: providerDescriptions[providerMeta.name] || providerMeta.label,
          endpointLabel: getEndpointLabel(providerMeta, binding),
          suggestions: getModelSuggestions(providerMeta.name),
        }
      })
      .filter((entry): entry is BindingEntry => Boolean(entry))
      .sort((left, right) => {
        const orderDiff = providerCategoryOrder(left.meta) - providerCategoryOrder(right.meta)
        if (orderDiff !== 0) {
          return orderDiff
        }
        return (left.binding.label || left.bindingName).localeCompare(right.binding.label || right.bindingName)
      })

    const query = deferredBindingQuery.trim().toLowerCase()
    if (!query) {
      return entries
    }

    return entries.filter((entry) => {
      const searchIndex = [
        entry.bindingName,
        entry.binding.label,
        entry.binding.provider,
        entry.meta.label,
        entry.description,
        entry.endpointLabel,
        entry.binding.model,
        ...entry.meta.keywords,
      ].join(' ').toLowerCase()
      return searchIndex.includes(query)
    })
  }, [bindings, configMeta, deferredBindingQuery])

  const bindingGroups = useMemo(() => {
    const groups = new Map<ProviderMeta['category'], BindingEntry[]>()
    for (const entry of bindingEntries) {
      const items = groups.get(entry.meta.category) ?? []
      items.push(entry)
      groups.set(entry.meta.category, items)
    }
    return Array.from(groups.entries())
  }, [bindingEntries])

  const availablePresets = useMemo(() => {
    return bindingPresets.filter((preset) => getProviderMeta(configMeta, preset.providerName))
  }, [configMeta])

  const configuredBindingsCount = useMemo(
    () => bindingEntries.filter((entry) => entry.configured).length,
    [bindingEntries],
  )

  const agentCoverage = useMemo(() => {
    if (!configMeta || !config || !defaultBindingMeta) {
      return []
    }

    return agents
      .map((agent) => {
        const customModel = String(agent.model || '').trim()
        const bindingName = String(agent.binding || '').trim()
        const explicitProvider = String(agent.provider || '').trim()
        const boundBinding = bindingName ? bindings[bindingName] : null
        const resolvedProviderName = boundBinding?.provider
          || explicitProvider
          || (customModel ? inferProviderFromModel(configMeta, customModel) || defaultBinding?.provider || '' : defaultBinding?.provider || '')
        const resolvedProviderMeta = getProviderMeta(configMeta, resolvedProviderName) ?? defaultBindingMeta
        const isModelOverride = Boolean(customModel)
        const isBindingOverride = Boolean(boundBinding)
        const isProviderOverride = Boolean(explicitProvider)
        const isOverride = isModelOverride || isBindingOverride || isProviderOverride
        let attentionReason: string | null = null

        if (isModelOverride && !isBindingOverride && !isProviderOverride) {
          attentionReason = '只覆盖了模型名，连接仍然复用全局默认绑定。'
        } else if (isProviderOverride && !isBindingOverride) {
          attentionReason = '指定了供应商，但没有独立 binding，密钥和地址仍跟全局走。'
        }

        return {
          agentId: agent.agentId,
          name: agent.name,
          model: customModel || config.agents.defaults.model,
          isModelOverride,
          isBindingOverride,
          isProviderOverride,
          isOverride,
          attentionReason,
          bindingName: boundBinding ? bindingName : null,
          bindingLabel: boundBinding?.label || null,
          providerLabel: resolvedProviderMeta.label,
          connectionModeLabel: isBindingOverride
            ? '独立 binding'
            : isProviderOverride
              ? '指定供应商'
              : isModelOverride
                ? '仅覆盖模型'
                : '继承全局',
        }
      })
      .sort((left, right) => {
        if (left.isOverride !== right.isOverride) {
          return left.isOverride ? -1 : 1
        }
        return left.name.localeCompare(right.name)
      })
  }, [agents, bindings, config, configMeta, defaultBinding, defaultBindingMeta])

  const agentOverrideCount = agentCoverage.filter((item) => item.isOverride).length
  const agentAttentionItems = useMemo(
    () => agentCoverage.filter((item) => item.attentionReason),
    [agentCoverage],
  )
  const inheritedAgents = useMemo(
    () => agentCoverage.filter((item) => !item.isOverride),
    [agentCoverage],
  )

  async function loadModels() {
    try {
      setLoading(true)
      const [configResult, metaResult, agentResult] = await Promise.all([
        api.getConfig(),
        api.getConfigMeta(),
        api.getAgents().catch(() => []),
      ])
      const normalized = normalizeModelConfig(configResult, metaResult)
      setConfig(normalized)
      setConfigMeta(metaResult)
      setAgents(agentResult)
      setSelectedBindingName((current) => (
        current && getAllModelBindings(normalized, metaResult)[current]
          ? current
          : getPreferredBinding(normalized, metaResult)
      ))
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载模型配置失败')
    } finally {
      setLoading(false)
    }
  }

  function updateConfig(mutator: (draft: ConfigData) => ConfigData) {
    setConfig((current) => (current ? mutator(current) : current))
  }

  function clearBindingTestResult(bindingName: string) {
    setBindingTestResults((current) => {
      if (!current[bindingName]) {
        return current
      }
      const next = { ...current }
      delete next[bindingName]
      return next
    })
  }

  function clearBindingModelResult(bindingName: string) {
    setBindingModelResults((current) => {
      if (!current[bindingName]) {
        return current
      }
      const next = { ...current }
      delete next[bindingName]
      return next
    })
  }

  function updateDefaultModel(value: string) {
    updateConfig((current) => {
      const bindingName = String(current.agents.defaults.binding || '').trim()
      const currentBindings = getAllModelBindings(current, configMeta)
      let next = {
        ...current,
        agents: {
          ...current.agents,
          defaults: {
            ...current.agents.defaults,
            model: value,
          },
        },
      }
      if (bindingName && currentBindings[bindingName]) {
        next = updateBindingValue(next, bindingName, getProviderMeta(configMeta, currentBindings[bindingName]?.provider || ''), { model: value.trim() || null })
      }
      return next
    })
  }

  function updateDefaults(path: keyof ConfigData['agents']['defaults'], value: unknown) {
    updateConfig((current) => ({
      ...current,
      agents: {
        ...current.agents,
        defaults: {
          ...current.agents.defaults,
          [path]: value,
        },
      },
    }))
  }

  function openAgentDetail(agentId: string) {
    navigate(`/studio/agents/${agentId}`)
  }

  function focusBinding(bindingName: string) {
    if (!bindings[bindingName]) {
      return
    }
    setSelectedBindingName(bindingName)
  }

  function applyDefaultBinding(bindingName: string, options?: { keepCurrentModel?: boolean; model?: string }) {
    updateConfig((current) => buildDefaultBindingConfig(current, bindingName, configMeta, options))
  }

  function updateBindingField(bindingName: string, field: 'apiKey' | 'apiBase' | 'model' | 'label', value: string) {
    clearBindingTestResult(bindingName)
    if (field === 'apiKey' || field === 'apiBase') {
      clearBindingModelResult(bindingName)
    }
    updateConfig((current) => {
      const currentBindings = getAllModelBindings(current, configMeta)
      return updateBindingFieldValue(current, bindingName, getProviderMeta(configMeta, currentBindings[bindingName]?.provider || ''), field, value)
    })
  }

  function updateBindingProvider(bindingName: string, providerName: string) {
    const providerMeta = getProviderMeta(configMeta, providerName)
    clearBindingTestResult(bindingName)
    clearBindingModelResult(bindingName)
    updateConfig((current) => {
      const currentBindings = getAllModelBindings(current, configMeta)
      const nextModel = modelMatchesProvider(configMeta, providerName, currentBindings[bindingName]?.model)
        ? currentBindings[bindingName]?.model || null
        : getModelSuggestions(providerName)[0] || null
      let next: ConfigData = updateBindingValue(current, bindingName, providerMeta, {
        provider: providerName,
        model: nextModel,
        apiBase: currentBindings[bindingName]?.apiBase ?? providerMeta?.defaultApiBase ?? null,
      })
      if (bindingName === defaultBindingName) {
        next = buildDefaultBindingConfig(next, bindingName, configMeta, {
          keepCurrentModel: modelMatchesProvider(configMeta, providerName, next.agents.defaults.model),
          model: modelMatchesProvider(configMeta, providerName, next.agents.defaults.model)
            ? next.agents.defaults.model
            : getModelSuggestions(providerName)[0] || '',
        })
      }
      return next
    })
  }

  function addBinding(providerName?: string) {
    if (!config) {
      return
    }
    const nextProvider = providerName || defaultBinding?.provider || configMeta?.providers.find((item) => !item.isOauth)?.name || 'deepseek'
    const providerMeta = getProviderMeta(configMeta, nextProvider)
    const nextBindings = getAllModelBindings(config, configMeta)
    const bindingName = createBindingId(nextProvider, nextBindings)
    const bindingLabel = `${providerMeta?.label || nextProvider} ${Object.keys(nextBindings).length + 1}`

    updateConfig((current) => {
      const next = updateBindingValue(current, bindingName, providerMeta, buildModelBinding(nextProvider, providerMeta ?? undefined, {
        label: bindingLabel,
        model: getModelSuggestions(nextProvider)[0] || null,
      }))
      return next
    })
    setSelectedBindingName(bindingName)
  }

  function copyBinding(bindingName: string) {
    if (!config) {
      return
    }
    const binding = bindings[bindingName]
    if (!binding) {
      return
    }
    const nextBindings = getAllModelBindings(config, configMeta)
    const nextName = createBindingId(`${bindingName}-copy`, nextBindings)
    updateConfig((current) => updateBindingValue(current, nextName, getProviderMeta(configMeta, binding.provider), {
      ...binding,
      label: `${binding.label || bindingName} 副本`,
    }))
    setSelectedBindingName(nextName)
  }

  function deleteBinding(bindingName: string) {
    clearBindingModelResult(bindingName)
    clearBindingTestResult(bindingName)
    updateConfig((current) => {
      const nextBindings = { ...(current.modelBindings ?? {}) }
      delete nextBindings[bindingName]
      const remainingNames = Object.keys(nextBindings)
      const nextSelected = remainingNames[0] || ''
      if (selectedBindingName === bindingName) {
        setSelectedBindingName(nextSelected)
      }

      const nextDefaults: ConfigData['agents']['defaults'] = { ...current.agents.defaults }
      if (nextDefaults.binding === bindingName) {
        nextDefaults.binding = nextSelected || null
        if (nextSelected && nextBindings[nextSelected]) {
          nextDefaults.provider = nextBindings[nextSelected].provider
          nextDefaults.model = nextBindings[nextSelected].model || nextDefaults.model
        } else {
          nextDefaults.provider = 'auto'
        }
      }

      return {
        ...current,
        agents: {
          ...current.agents,
          defaults: nextDefaults,
        },
        modelBindings: nextBindings,
      }
    })
  }

  function applyPreset(preset: BindingPreset) {
    setSelectedBindingName(preset.bindingName)
    clearBindingModelResult(preset.bindingName)
    clearBindingTestResult(preset.bindingName)
    updateConfig((current) => {
      let next: ConfigData = ensureProviderSelection(current, preset.providerName, configMeta, {
        keepExistingModel: false,
        bindingName: preset.bindingName,
        label: preset.bindingLabel,
      })
      next = updateBindingValue(next, preset.bindingName, getProviderMeta(configMeta, preset.providerName), {
        label: preset.bindingLabel,
        model: preset.model,
        apiBase: preset.apiBase ?? next.modelBindings?.[preset.bindingName]?.apiBase ?? null,
      })
      return buildDefaultBindingConfig(next, preset.bindingName, configMeta, {
        keepCurrentModel: false,
        model: preset.model,
      })
    })
  }

  async function saveCurrentConfig() {
    if (!config) {
      return
    }
    try {
      setSaving(true)
      const [saved, meta, agentResult] = await Promise.all([
        api.updateConfig(config),
        api.getConfigMeta(),
        api.getAgents().catch(() => agents),
      ])
      const normalized = normalizeModelConfig(saved, meta)
      setConfig(normalized)
      setConfigMeta(meta)
      setAgents(agentResult)
      setSelectedBindingName((current) => (
        current && getAllModelBindings(normalized, meta)[current]
          ? current
          : getPreferredBinding(normalized, meta)
      ))
      message.success('模型绑定配置已保存')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '保存模型配置失败')
    } finally {
      setSaving(false)
    }
  }

  async function testCurrentBinding() {
    if (!selectedBinding || !selectedBindingMeta || !activeBindingName) {
      return
    }
    const effectiveModel = selectedBinding.model || config?.agents.defaults.model || ''
    try {
      setTestingBindingName(activeBindingName)
      const result = await api.testModelBinding({
        bindingName: activeBindingName,
        label: selectedBinding.label || activeBindingName,
        provider: selectedBinding.provider,
        model: effectiveModel,
        apiKey: selectedBinding.apiKey || '',
        apiBase: selectedBinding.apiBase || null,
        extraHeaders: selectedBinding.extraHeaders || {},
      })
      setBindingTestResults((current) => ({ ...current, [activeBindingName]: result }))
      message[result.ok ? 'success' : 'error'](`${result.label || activeBindingName} ${result.ok ? '检测通过' : '检测失败'}`)
    } catch (error) {
      const fallback: ModelBindingTestResult = {
        ok: false,
        provider: selectedBinding.provider,
        model: effectiveModel,
        bindingName: activeBindingName,
        label: selectedBinding.label || activeBindingName,
        latencyMs: 0,
        finishReason: 'error',
        message: getBindingRouteErrorMessage(error, '检测连接'),
        responsePreview: null,
        usage: {},
      }
      setBindingTestResults((current) => ({ ...current, [activeBindingName]: fallback }))
      message.error(getBindingRouteErrorMessage(error, '检测连接'))
    } finally {
      setTestingBindingName('')
    }
  }

  async function fetchCurrentBindingModels() {
    if (!selectedBinding || !selectedBindingMeta || !activeBindingName) {
      return
    }

    try {
      setFetchingModelsBindingName(activeBindingName)
      const result = await api.fetchModelBindingModels({
        bindingName: activeBindingName,
        label: selectedBinding.label || activeBindingName,
        provider: selectedBinding.provider,
        apiKey: selectedBinding.apiKey || '',
        apiBase: selectedBinding.apiBase || null,
      })
      setBindingModelResults((current) => ({ ...current, [activeBindingName]: result }))
      if (!String(selectedBinding.model || '').trim() && result.models[0]) {
        updateConfig((current) => updateBindingFieldValue(
          current,
          activeBindingName,
          getProviderMeta(configMeta, selectedBinding.provider),
          'model',
          result.models[0],
        ))
      }
      message.success(result.message)
    } catch (error) {
      clearBindingModelResult(activeBindingName)
      message.error(getBindingRouteErrorMessage(error, '获取模型列表'))
    } finally {
      setFetchingModelsBindingName('')
    }
  }

  if (loading) {
    return (
      <div className="center-box page-card">
        <Spin />
      </div>
    )
  }

  if (!config || !configMeta) {
    return <Empty description="当前无法读取模型绑定配置" className="page-card" />
  }

  const selectedStatus = selectedBinding && selectedBindingMeta
    ? getBindingStatus(selectedBindingMeta, selectedBinding)
    : null
  const selectedModelResult = activeBindingName ? bindingModelResults[activeBindingName] : null
  const selectedTestResult = activeBindingName ? bindingTestResults[activeBindingName] : null
  const heroTitle = workspaceMode === 'bindings' ? '模型配置工作台' : '自定义 Agent 工作台'
  const heroDescription = workspaceMode === 'bindings'
    ? '先把全局默认、供应商连接和模型检测配稳，再把差异化能力留给 Agent 页面处理。'
    : '这里只看 Agent 的模型覆盖和连接差异，避免把平台配置和角色定制搅在一起。'
  const heroActions = (
    <Space wrap>
      <Button icon={<ReloadOutlined />} onClick={() => void loadModels()}>
        刷新
      </Button>
      {workspaceMode === 'bindings' ? (
        <Button icon={<PlusOutlined />} onClick={() => addBinding()}>
          新增绑定
        </Button>
      ) : (
        <Button icon={<RobotOutlined />} onClick={() => navigate('/studio/agents')}>
          前往 Agent 页面
        </Button>
      )}
      {workspaceMode === 'agents' ? (
        <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/studio/agents/new')}>
          新增 Agent
        </Button>
      ) : null}
      <Button
        type={workspaceMode === 'bindings' ? 'primary' : 'default'}
        icon={<SaveOutlined />}
        loading={saving}
        onClick={() => void saveCurrentConfig()}
      >
        保存全部
      </Button>
    </Space>
  )
  const heroBadges = workspaceMode === 'bindings'
    ? [
        defaultBinding ? <Tag key="default-binding">{defaultBinding.label || defaultBindingName}</Tag> : null,
        defaultModelMismatch ? <Tag key="mismatch" color="warning">默认绑定与模型存在错配风险</Tag> : null,
      ].filter(Boolean)
    : [
        <Tag key="agent-overrides" color={agentOverrideCount > 0 ? 'gold' : 'green'}>
          {agentOverrideCount} 个 Agent 覆盖
        </Tag>,
        agentAttentionItems.length > 0
          ? <Tag key="agent-attention" color="warning">{agentAttentionItems.length} 个待关注</Tag>
          : null,
      ].filter(Boolean)
  const heroStats = workspaceMode === 'bindings'
    ? [
        { label: '已配置绑定', value: configuredBindingsCount },
        { label: '默认绑定', value: defaultBinding?.label || '未设置' },
        { label: '默认模型', value: config.agents.defaults.model || '待选择' },
        { label: 'Agent 覆盖', value: agentOverrideCount },
      ]
    : [
        { label: '自定义 Agent', value: agentOverrideCount },
        { label: '继承全局', value: inheritedAgents.length },
        { label: '需要关注', value: agentAttentionItems.length },
        { label: '默认绑定', value: defaultBinding?.label || '未设置' },
      ]

  return (
    <div className="page-stack">
      <PageHero
        className="page-hero-compact studio-hero"
        eyebrow="AI 模型"
        title={heroTitle}
        description={heroDescription}
        badges={heroBadges}
        actions={heroActions}
        stats={heroStats}
      />

      <MotionGroup className="page-stack">
        <MotionPanel hover={false}>
          <Card className="config-panel-card models-workspace-card">
            <div className="config-card-header">
              <div className="page-section-title">
                <Typography.Title level={4}>工作台切换</Typography.Title>
                <Text type="secondary">把平台级模型连接和 Agent 个性化调优拆开处理，才不会在一个页面里同时做两种决策。</Text>
              </div>
              <Tag color={workspaceMode === 'bindings' ? 'blue' : 'gold'}>
                {workspaceMode === 'bindings' ? '模型配置' : '自定义 Agent'}
              </Tag>
            </div>

            <div className="models-workspace-switch">
              <button
                type="button"
                className={`models-workspace-button${workspaceMode === 'bindings' ? ' is-active' : ''}`}
                onClick={() => setWorkspaceMode('bindings')}
              >
                <span className="models-workspace-icon"><SettingOutlined /></span>
                <strong>模型配置</strong>
                <span>全局默认、供应商 binding、预设、检测连接和模型拉取都留在这里。</span>
              </button>
              <button
                type="button"
                className={`models-workspace-button${workspaceMode === 'agents' ? ' is-active' : ''}`}
                onClick={() => setWorkspaceMode('agents')}
              >
                <span className="models-workspace-icon"><RobotOutlined /></span>
                <strong>自定义 Agent</strong>
                <span>只看哪些 Agent 覆盖了模型或连接，并且一键跳去 Agent 页面继续编辑。</span>
              </button>
            </div>

            <Paragraph className="models-helper-copy">
              推荐流程：先在“模型配置”里把默认运行和供应商连接配稳，再按需进入“自定义 Agent”做角色差异化。
            </Paragraph>
          </Card>
        </MotionPanel>
      </MotionGroup>

      {workspaceMode === 'bindings' ? (
        <div className="page-grid models-page-grid">
          <MotionGroup className="page-stack">
            <MotionPanel hover={false}>
              <Card className="config-panel-card">
                <div className="config-card-header">
                  <div className="page-section-title">
                    <Typography.Title level={4}>默认运行</Typography.Title>
                    <Text type="secondary">新会话和未显式覆盖的 Agent 都继承这里。</Text>
                  </div>
                  <Tag color="blue">平台级</Tag>
                </div>

                {defaultModelMismatch && defaultBindingMeta ? (
                  <Alert
                    showIcon
                    type="warning"
                    message="默认绑定与模型关键字不一致"
                    description={`当前默认绑定是 ${defaultBindingMeta.label}，但模型更像 ${getProviderMeta(configMeta, defaultModelProviderName || '')?.label || '其他供应商'}。这类错配会让运行时拿错密钥。`}
                  />
                ) : null}

                <div className="config-field-block">
                  <div className="config-field-label-row">
                    <Text>默认绑定</Text>
                  </div>
                  <Select
                    value={defaultBindingName || undefined}
                    options={defaultBindingOptions}
                    style={{ width: '100%' }}
                    placeholder="先创建一个模型绑定"
                    onChange={(value) => applyDefaultBinding(value, {
                      keepCurrentModel: modelMatchesProvider(configMeta, bindings[value]?.provider || '', config.agents.defaults.model),
                    })}
                  />
                  <Text type="secondary">{defaultBindingMeta ? (providerDescriptions[defaultBindingMeta.name] || defaultBindingMeta.label) : '默认绑定会决定全局模型、密钥和地址。'}</Text>
                </div>

                <div className="config-field-block">
                  <div className="config-field-label-row">
                    <Text>默认模型</Text>
                  </div>
                  <Input
                    value={config.agents.defaults.model}
                    placeholder={defaultModelSuggestions[0] || '例如 deepseek-chat / qwen-max / glm-4.5'}
                    onChange={(event) => updateDefaultModel(event.target.value)}
                  />
                </div>

                <div className="models-suggestion-list">
                  {defaultModelSuggestions.map((model) => (
                    <Button
                      key={model}
                      type={config.agents.defaults.model === model ? 'primary' : 'default'}
                      onClick={() => updateDefaultModel(model)}
                    >
                      {model}
                    </Button>
                  ))}
                </div>

                <div className="models-settings-grid">
                  <div className="config-field-block">
                    <div className="config-field-label-row">
                      <Text>创意程度</Text>
                    </div>
                    <InputNumber
                      min={0}
                      max={2}
                      step={0.1}
                      value={config.agents.defaults.temperature}
                      style={{ width: '100%' }}
                      onChange={(value) => updateDefaults('temperature', value ?? 0)}
                    />
                  </div>

                  <div className="config-field-block">
                    <div className="config-field-label-row">
                      <Text>思考深度</Text>
                    </div>
                    <Select
                      allowClear
                      value={config.agents.defaults.reasoningEffort ?? undefined}
                      options={[
                        { label: '低', value: 'low' },
                        { label: '中', value: 'medium' },
                        { label: '高', value: 'high' },
                      ]}
                      style={{ width: '100%' }}
                      onChange={(value) => updateDefaults('reasoningEffort', value ?? null)}
                    />
                  </div>

                  <div className="config-field-block">
                    <div className="config-field-label-row">
                      <Text>最大回复长度</Text>
                    </div>
                    <InputNumber
                      min={1}
                      value={config.agents.defaults.maxTokens}
                      style={{ width: '100%' }}
                      onChange={(value) => updateDefaults('maxTokens', value ?? 1)}
                    />
                  </div>

                  <div className="config-field-block">
                    <div className="config-field-label-row">
                      <Text>对话记忆窗口</Text>
                    </div>
                    <InputNumber
                      min={1}
                      value={config.agents.defaults.contextWindowTokens}
                      style={{ width: '100%' }}
                      onChange={(value) => updateDefaults('contextWindowTokens', value ?? 1)}
                    />
                  </div>
                </div>

                <Paragraph className="models-helper-copy">
                  默认运行会优先使用 `binding`，同一云厂商也可以并存多个账号和地址实例。
                </Paragraph>
              </Card>
            </MotionPanel>

            <MotionPanel hover={false}>
              <Card className="config-panel-card">
                <div className="config-card-header">
                  <div className="page-section-title">
                    <Typography.Title level={4}>快速预设</Typography.Title>
                    <Text type="secondary">常见中国厂商场景一键带出模型和地址，减少首配步骤。</Text>
                  </div>
                  <Tag color="cyan">{availablePresets.length} 个可用预设</Tag>
                </div>

                {availablePresets.length === 0 ? (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前实例没有可套用的快捷预设" />
                ) : (
                  <div className="models-preset-grid">
                    {availablePresets.map((preset) => (
                      <button
                        key={preset.key}
                        type="button"
                        className="models-preset-button"
                        onClick={() => applyPreset(preset)}
                      >
                        <strong>{preset.label}</strong>
                        <span>{preset.caption}</span>
                        <small>{preset.model}</small>
                      </button>
                    ))}
                  </div>
                )}
              </Card>
            </MotionPanel>

            <MotionPanel hover={false}>
              <Card className="config-panel-card">
                <div className="config-card-header">
                  <div className="page-section-title">
                    <Typography.Title level={4}>binding 目录</Typography.Title>
                    <Text type="secondary">先选中一个连接实例，再去右侧编辑它的密钥、地址和模型。</Text>
                  </div>
                  <Tag>{configuredBindingsCount} / {bindingEntries.length} 已配置</Tag>
                </div>

                <div className="models-directory-toolbar">
                  <Input
                    value={bindingQuery}
                    placeholder="搜索百炼、豆包、DeepSeek、Kimi、GLM..."
                    onChange={(event) => setBindingQuery(event.target.value)}
                  />
                  <Button icon={<PlusOutlined />} onClick={() => addBinding(selectedBinding?.provider || defaultBinding?.provider)}>
                    新增同类绑定
                  </Button>
                </div>

                {bindingGroups.length === 0 ? (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有任何 binding，先点“新增绑定”创建一个。" />
                ) : (
                  <div className="models-provider-sections">
                    {bindingGroups.map(([category, items]) => (
                      <div className="models-provider-section" key={category}>
                        <div className="models-provider-section-head">
                          <Text strong>{providerCategoryLabels[category]}</Text>
                          <Text type="secondary">{items.length} 个</Text>
                        </div>
                        <div className="models-provider-list">
                          {items.map((entry) => {
                            const status = getBindingStatus(entry.meta, entry.binding)
                            const isActive = entry.bindingName === activeBindingName

                            return (
                              <button
                                key={entry.bindingName}
                                type="button"
                                className={`models-binding-item${isActive ? ' is-active' : ''}`}
                                onClick={() => focusBinding(entry.bindingName)}
                              >
                                <div className="models-binding-head">
                                  <div>
                                    <strong>{entry.binding.label || entry.bindingName}</strong>
                                    <p>{entry.meta.label} · {entry.description}</p>
                                  </div>
                                  <Tag color={status.color}>{status.label}</Tag>
                                </div>

                                <div className="models-binding-meta">
                                  {entry.bindingName === defaultBindingName ? <Tag color="blue">默认绑定</Tag> : null}
                                  <Tag>{entry.suggestions.length || '自定义'} 个建议</Tag>
                                  <Tag>{entry.endpointLabel}</Tag>
                                </div>
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </MotionPanel>
          </MotionGroup>

          <MotionGroup className="page-stack">
            <MotionPanel hover={false}>
              <Card className="config-panel-card">
                <div className="config-card-header">
                  <div className="page-section-title">
                    <Typography.Title level={4}>连接编辑器</Typography.Title>
                    <Text type="secondary">{selectedBindingMeta ? (providerDescriptions[selectedBindingMeta.name] || selectedBindingMeta.label) : '请选择一个 binding 查看详情'}</Text>
                  </div>
                  <Space wrap>
                    {selectedBindingMeta ? <Tag>{providerCategoryLabels[selectedBindingMeta.category]}</Tag> : null}
                    {activeBindingName && activeBindingName === defaultBindingName ? <Tag color="blue">当前默认</Tag> : null}
                    {selectedBindingMeta?.supportsPromptCaching ? <Tag color="cyan">支持提示词缓存</Tag> : null}
                    {selectedStatus ? <Tag color={selectedStatus.color}>{selectedStatus.label}</Tag> : null}
                  </Space>
                </div>

                {!selectedBinding || !selectedBindingMeta ? (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="从左侧选择一个 binding，或先新增一个。" />
                ) : (
                  <>
                    <div className="models-status-strip">
                      <div className="models-status-chip">
                        <span>供应商</span>
                        <strong>{selectedBindingMeta.label}</strong>
                      </div>
                      <div className="models-status-chip">
                        <span>服务地址</span>
                        <strong>{getEndpointLabel(selectedBindingMeta, selectedBinding)}</strong>
                      </div>
                    </div>

                    <div className="config-field-block">
                      <div className="config-field-label-row">
                        <Text>绑定名称</Text>
                      </div>
                      <Input
                        value={selectedBinding.label || ''}
                        placeholder={activeBindingName}
                        onChange={(event) => updateBindingField(activeBindingName, 'label', event.target.value)}
                      />
                    </div>

                    <div className="config-field-block">
                      <div className="config-field-label-row">
                        <Text>所属供应商</Text>
                      </div>
                      <Select
                        value={selectedBinding.provider}
                        options={providerOptions}
                        style={{ width: '100%' }}
                        onChange={(value) => updateBindingProvider(activeBindingName, value)}
                      />
                    </div>

                    <div className="config-field-block">
                      <div className="config-field-label-row">
                        <Text>绑定默认模型</Text>
                        {!selectedBindingMeta.isOauth ? (
                          <Button
                            size="small"
                            icon={<ReloadOutlined />}
                            loading={fetchingModelsBindingName === activeBindingName}
                            onClick={() => void fetchCurrentBindingModels()}
                          >
                            {selectedModelResult ? '刷新模型' : '获取模型'}
                          </Button>
                        ) : null}
                      </div>
                      <Input
                        value={selectedBinding.model || ''}
                        placeholder={selectedBindingSuggestions[0] || '例如 deepseek-chat / qwen-max / glm-4.5'}
                        onChange={(event) => updateBindingField(activeBindingName, 'model', event.target.value)}
                      />
                    </div>

                    {selectedModelResult ? (
                      <Paragraph className="models-helper-copy">
                        {selectedModelResult.message}，下方展示的是当前 API Key 和 API 地址返回的模型 ID。
                      </Paragraph>
                    ) : null}

                    <div className="models-suggestion-list">
                      {selectedBindingSuggestions.length > 0 ? (
                        selectedBindingSuggestions.map((model) => (
                          <Button
                            key={model}
                            type={selectedBinding.model === model ? 'primary' : 'default'}
                            onClick={() => updateBindingField(activeBindingName, 'model', model)}
                          >
                            {model}
                          </Button>
                        ))
                      ) : (
                        <Text type="secondary">当前供应商没有预置模型目录，可以直接手动输入。</Text>
                      )}
                    </div>

                    {selectedBindingMeta.isOauth ? (
                      <Alert
                        showIcon
                        type="info"
                        message="该供应商走 OAuth"
                        description="这类连接不在当前页面录入 API Key，仍通过外部登录流程完成认证。"
                      />
                    ) : (
                      <>
                        <div className="config-field-block">
                          <div className="config-field-label-row">
                            <Text>访问密钥</Text>
                          </div>
                          <Input.Password
                            value={selectedBinding.apiKey ?? ''}
                            placeholder={selectedBindingMeta.isLocal ? '本地供应商通常可留空' : '请输入访问密钥'}
                            onChange={(event) => updateBindingField(activeBindingName, 'apiKey', event.target.value)}
                          />
                        </div>

                        <div className="config-field-block">
                          <div className="config-field-label-row">
                            <Text>服务地址</Text>
                            {selectedBindingMeta.defaultApiBase ? <Tag>默认地址</Tag> : null}
                          </div>
                          <Input
                            value={selectedBinding.apiBase ?? ''}
                            placeholder={selectedBindingMeta.defaultApiBase ?? '留空时使用供应商默认地址'}
                            onChange={(event) => updateBindingField(activeBindingName, 'apiBase', event.target.value)}
                          />
                          <Text type="secondary">
                            支持直接粘贴完整接口地址，例如 `.../chat/completions`，保存和检测时会自动归一化成可用的 API Base。
                          </Text>
                          {selectedBindingMeta.defaultApiBase ? (
                            <Space wrap>
                              <Button onClick={() => updateBindingField(activeBindingName, 'apiBase', selectedBindingMeta.defaultApiBase || '')}>
                                使用默认地址
                              </Button>
                              <Text type="secondary">{selectedBindingMeta.defaultApiBase}</Text>
                            </Space>
                          ) : null}
                        </div>
                      </>
                    )}

                    <div className="models-inline-actions">
                      {activeBindingName !== defaultBindingName ? (
                        <Button
                          onClick={() => applyDefaultBinding(activeBindingName, {
                            keepCurrentModel: modelMatchesProvider(configMeta, selectedBinding.provider, config.agents.defaults.model),
                            model: selectedBinding.model || config.agents.defaults.model,
                          })}
                        >
                          设为全局默认绑定
                        </Button>
                      ) : null}
                      {!selectedBindingMeta.isOauth ? (
                        <Button
                          type="primary"
                          loading={testingBindingName === activeBindingName}
                          disabled={!selectedBinding.provider || !(selectedBinding.model || config.agents.defaults.model)}
                          onClick={() => void testCurrentBinding()}
                        >
                          检测连接
                        </Button>
                      ) : null}
                      <Button icon={<CopyOutlined />} onClick={() => copyBinding(activeBindingName)}>
                        复制绑定
                      </Button>
                      <Button danger icon={<DeleteOutlined />} onClick={() => deleteBinding(activeBindingName)}>
                        删除绑定
                      </Button>
                    </div>

                    {selectedTestResult ? (
                      <Alert
                        showIcon
                        type={selectedTestResult.ok ? 'success' : 'error'}
                        message={`${selectedTestResult.message} · ${selectedTestResult.latencyMs} ms`}
                        description={[
                          `供应商: ${selectedTestResult.provider}`,
                          `模型: ${selectedTestResult.model}`,
                          selectedTestResult.responsePreview ? `响应: ${selectedTestResult.responsePreview}` : null,
                        ].filter(Boolean).join(' | ')}
                      />
                    ) : (
                      <Paragraph className="models-helper-copy">
                        检测会直接用当前表单里的 API Key、API Base 和模型发起一次最小请求，适合验证百炼、豆包、DeepSeek、Kimi、智谱以及各类 OpenAI 兼容网关。
                      </Paragraph>
                    )}
                  </>
                )}
              </Card>
            </MotionPanel>
          </MotionGroup>
        </div>
      ) : (
        <div className="page-grid models-page-grid">
          <MotionGroup className="page-stack">
            <MotionPanel hover={false}>
              <Card className="config-panel-card">
                <div className="config-card-header">
                  <div className="page-section-title">
                    <Typography.Title level={4}>自定义 Agent 总览</Typography.Title>
                    <Text type="secondary">这一屏只回答两件事：哪些 Agent 覆盖了默认模型，哪些配置值得你回去修。</Text>
                  </div>
                  <Tag color={agentOverrideCount > 0 ? 'gold' : 'green'}>
                    {agentOverrideCount} 个自定义
                  </Tag>
                </div>

                <Alert
                  showIcon
                  type="info"
                  message="平台配置和角色配置已经拆开"
                  description="Models 页面只负责默认 binding 和供应商连接；Agent 页面只负责个体覆盖。如果 Agent 同时配置 binding 和 model，会先使用 binding 的连接，再用模型覆盖默认模型。"
                />

                <div className="models-agent-kpi-grid">
                  <div className="models-kpi-card">
                    <span>默认绑定</span>
                    <strong>{defaultBinding?.label || '未设置'}</strong>
                    <small>{config.agents.defaults.model || '待选择默认模型'}</small>
                  </div>
                  <div className="models-kpi-card">
                    <span>自定义 Agent</span>
                    <strong>{agentOverrideCount}</strong>
                    <small>包含 binding / provider / model 覆盖</small>
                  </div>
                  <div className="models-kpi-card">
                    <span>需要关注</span>
                    <strong>{agentAttentionItems.length}</strong>
                    <small>优先检查只改模型、不改连接的 Agent</small>
                  </div>
                </div>

                <div className="models-inline-actions">
                  <Button type="primary" icon={<RobotOutlined />} onClick={() => navigate('/studio/agents')}>
                    前往 Agent 页面
                  </Button>
                  <Button icon={<PlusOutlined />} onClick={() => navigate('/studio/agents/new')}>
                    新增 Agent
                  </Button>
                </div>
              </Card>
            </MotionPanel>

            <MotionPanel hover={false}>
              <Card className="config-panel-card">
                <div className="config-card-header">
                  <div className="page-section-title">
                    <Typography.Title level={4}>需要关注</Typography.Title>
                    <Text type="secondary">这些 Agent 已经偏离全局策略，但连接归属还不够清晰。</Text>
                  </div>
                  <Tag color={agentAttentionItems.length > 0 ? 'warning' : 'green'}>
                    {agentAttentionItems.length > 0 ? `${agentAttentionItems.length} 个待关注` : '已清空'}
                  </Tag>
                </div>

                {agentAttentionItems.length === 0 ? (
                  <Alert
                    showIcon
                    type="success"
                    message="目前没有需要优先处理的 Agent 覆盖"
                    description="所有自定义 Agent 都有比较明确的连接归属，或者它们正在完整继承全局默认配置。"
                  />
                ) : (
                  <div className="models-agent-list">
                    {agentAttentionItems.map((agent) => (
                      <div className="models-agent-row" key={agent.agentId}>
                        <div>
                          <strong>{agent.name}</strong>
                          <p>{agent.model}</p>
                          <Text type="secondary">{agent.attentionReason}</Text>
                        </div>
                        <div className="models-agent-meta">
                          <Tag color="warning">{agent.connectionModeLabel}</Tag>
                          <Tag>{agent.providerLabel}</Tag>
                          <Button type="link" icon={<ArrowRightOutlined />} onClick={() => openAgentDetail(agent.agentId)}>
                            打开 Agent
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </MotionPanel>
          </MotionGroup>

          <MotionGroup className="page-stack">
            <MotionPanel hover={false}>
              <Card className="config-panel-card">
                <div className="config-card-header">
                  <div className="page-section-title">
                    <Typography.Title level={4}>已自定义 Agent</Typography.Title>
                    <Text type="secondary">这里列出所有显式覆盖了 binding、provider 或 model 的 Agent。</Text>
                  </div>
                  <Tag color={agentOverrideCount > 0 ? 'gold' : 'default'}>{agentOverrideCount} 个</Tag>
                </div>

                {agentOverrideCount === 0 ? (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前还没有 Agent 覆盖全局模型策略" />
                ) : (
                  <div className="models-agent-list">
                    {agentCoverage.filter((agent) => agent.isOverride).map((agent) => (
                      <div className="models-agent-row" key={agent.agentId}>
                        <div>
                          <strong>{agent.name}</strong>
                          <p>{agent.model}</p>
                        </div>
                        <div className="models-agent-meta">
                          <Tag color="gold">{agent.connectionModeLabel}</Tag>
                          {agent.bindingLabel ? <Tag color="cyan">{agent.bindingLabel}</Tag> : null}
                          {agent.isProviderOverride ? <Tag color="purple">指定供应商</Tag> : null}
                          {agent.isModelOverride ? <Tag color="blue">自定义模型</Tag> : null}
                          <Tag>{agent.providerLabel}</Tag>
                          <Button type="link" icon={<ArrowRightOutlined />} onClick={() => openAgentDetail(agent.agentId)}>
                            打开 Agent
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </MotionPanel>

            <MotionPanel hover={false}>
              <Card className="config-panel-card">
                <div className="config-card-header">
                  <div className="page-section-title">
                    <Typography.Title level={4}>继承全局的 Agent</Typography.Title>
                    <Text type="secondary">这些 Agent 会直接跟着默认 binding 和默认模型走，不需要在这里反复确认。</Text>
                  </div>
                  <Tag color="blue">{inheritedAgents.length} 个</Tag>
                </div>

                {inheritedAgents.length === 0 ? (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前所有 Agent 都做了不同程度的覆盖" />
                ) : (
                  <>
                    <div className="models-agent-chip-list">
                      {inheritedAgents.slice(0, 10).map((agent) => (
                        <button
                          key={agent.agentId}
                          type="button"
                          className="models-agent-chip"
                          onClick={() => openAgentDetail(agent.agentId)}
                        >
                          <strong>{agent.name}</strong>
                          <span>{defaultBinding?.label || '继承全局默认'}</span>
                        </button>
                      ))}
                    </div>
                    {inheritedAgents.length > 10 ? (
                      <Paragraph className="models-helper-copy">
                        还有 {inheritedAgents.length - 10} 个 Agent 正在完整继承全局配置，进入 Agent 页面可以继续查看。
                      </Paragraph>
                    ) : null}
                  </>
                )}
              </Card>
            </MotionPanel>
          </MotionGroup>
        </div>
      )}
    </div>
  )
}
