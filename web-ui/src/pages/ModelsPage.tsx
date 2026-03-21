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

const { Text } = Typography

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

type ProviderIconAsset = {
  src?: string
  fallback: string
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

const providerIcons: Record<string, ProviderIconAsset> = {
  anthropic: { src: '/provider-logos/Anthropic.png', fallback: '🟠' },
  openai: { src: '/provider-logos/openai.png', fallback: '🟢' },
  openrouter: { fallback: '🔵' },
  deepseek: { src: '/provider-logos/DeepSeek.png', fallback: '🐋' },
  volcengine: { src: '/provider-logos/volcengine-color.png', fallback: '🌋' },
  volcengine_coding_plan: { src: '/provider-logos/volcengine-color.png', fallback: '🌋' },
  groq: { fallback: '⚡' },
  zhipu: { src: '/provider-logos/qingyan-color.png', fallback: '🧠' },
  dashscope: { src: encodeURI('/provider-logos/百炼.png'), fallback: '☁️' },
  vllm: { fallback: '🖥️' },
  ollama: { src: '/provider-logos/ollama.png', fallback: '🦙' },
  gemini: { src: '/provider-logos/Gemini.png', fallback: '💎' },
  moonshot: { fallback: '🌙' },
  minimax: { fallback: '🔮' },
  aihubmix: { fallback: '🎛️' },
  azure_openai: { src: '/provider-logos/openai.png', fallback: '🪟' },
  siliconflow: { src: '/provider-logos/stability-color.png', fallback: '🫧' },
  openai_codex: { src: '/provider-logos/codex-color.png', fallback: '⌘' },
  custom: { fallback: '⚙️' },
}

function renderProviderIcon(providerName: string, className?: string) {
  const icon = providerIcons[providerName] ?? { fallback: '🤖' }
  const nextClassName = ['models-provider-emoji', className, icon.src ? 'has-image' : '']
    .filter(Boolean)
    .join(' ')

  return (
    <span className={nextClassName} aria-hidden="true">
      {icon.src ? <img className="models-provider-icon-image" src={icon.src} alt="" /> : icon.fallback}
    </span>
  )
}

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
  const [expandedProviderName, setExpandedProviderName] = useState('')

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
  const defaultBindingOptions = useMemo(
    () => (config && configMeta ? getBindingOptions(config, configMeta) : []),
    [config, configMeta],
  )
  const providerOptions = useMemo(() => getProviderOptions(configMeta), [configMeta])
  const defaultModelSuggestions = useMemo(
    () => getModelSuggestions(defaultBinding?.provider || '', config?.agents.defaults.model),
    [config?.agents.defaults.model, defaultBinding?.provider],
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

  const availablePresets = useMemo(() => {
    return bindingPresets.filter((preset) => getProviderMeta(configMeta, preset.providerName))
  }, [configMeta])

  const providerRows = useMemo(() => {
    if (!configMeta) {
      return [] as Array<{
        meta: ProviderMeta
        items: BindingEntry[]
        configured: boolean
        statusLabel: string
        statusColor: 'green' | 'default'
        presets: BindingPreset[]
      }>
    }

    const query = deferredBindingQuery.trim().toLowerCase()

    return [...configMeta.providers]
      .sort((left, right) => {
        const orderDiff = providerCategoryOrder(left) - providerCategoryOrder(right)
        if (orderDiff !== 0) {
          return orderDiff
        }
        return left.label.localeCompare(right.label)
      })
      .map((meta) => {
        const items = bindingEntries.filter((entry) => entry.meta.name === meta.name)
        const configured = items.some((entry) => entry.configured)
        return {
          meta,
          items,
          configured,
          statusLabel: configured ? '已配置' : '未配置',
          statusColor: configured ? 'green' as const : 'default' as const,
          presets: availablePresets.filter((preset) => preset.providerName === meta.name),
        }
      })
      .filter((row) => {
        if (!query) {
          return true
        }
        const haystack = [
          row.meta.name,
          row.meta.label,
          providerDescriptions[row.meta.name] || '',
          ...row.meta.keywords,
          ...row.items.flatMap((item) => [
            item.bindingName,
            item.binding.label,
            item.binding.model,
            item.endpointLabel,
          ]),
        ].join(' ').toLowerCase()
        return haystack.includes(query)
      })
  }, [availablePresets, bindingEntries, configMeta, deferredBindingQuery])

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
      setExpandedProviderName((current) => current || getAllModelBindings(normalized, metaResult)[getPreferredBinding(normalized, metaResult)]?.provider || '')
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

  function toggleProvider(providerName: string) {
    setExpandedProviderName((current) => {
      const next = current === providerName ? '' : providerName
      if (next && bindings[selectedBindingName]?.provider !== providerName) {
        const nextBinding = bindingEntries.find((entry) => entry.meta.name === providerName)
        setSelectedBindingName(nextBinding?.bindingName || '')
      }
      return next
    })
  }

  function focusBinding(bindingName: string) {
    if (!bindings[bindingName]) {
      return
    }
    setSelectedBindingName(bindingName)
    setExpandedProviderName(bindings[bindingName].provider)
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
    setExpandedProviderName(nextProvider)
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
    setExpandedProviderName(binding.provider)
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
      if (expandedProviderName && !Object.values(nextBindings).some((binding) => binding.provider === expandedProviderName)) {
        setExpandedProviderName('')
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
    setExpandedProviderName(preset.providerName)
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

  async function testBinding(bindingName: string) {
    const binding = bindings[bindingName]
    const providerMeta = getProviderMeta(configMeta, binding?.provider || '')
    if (!binding || !providerMeta) {
      return
    }
    const effectiveModel = binding.model || config?.agents.defaults.model || ''
    try {
      setTestingBindingName(bindingName)
      const result = await api.testModelBinding({
        bindingName,
        label: binding.label || bindingName,
        provider: binding.provider,
        model: effectiveModel,
        apiKey: binding.apiKey || '',
        apiBase: binding.apiBase || null,
        extraHeaders: binding.extraHeaders || {},
      })
      setBindingTestResults((current) => ({ ...current, [bindingName]: result }))
      message[result.ok ? 'success' : 'error'](`${result.label || bindingName} ${result.ok ? '检测通过' : '检测失败'}`)
    } catch (error) {
      const fallback: ModelBindingTestResult = {
        ok: false,
        provider: binding.provider,
        model: effectiveModel,
        bindingName,
        label: binding.label || bindingName,
        latencyMs: 0,
        finishReason: 'error',
        message: getBindingRouteErrorMessage(error, '检测连接'),
        responsePreview: null,
        usage: {},
      }
      setBindingTestResults((current) => ({ ...current, [bindingName]: fallback }))
      message.error(getBindingRouteErrorMessage(error, '检测连接'))
    } finally {
      setTestingBindingName('')
    }
  }

  async function fetchBindingModels(bindingName: string) {
    const binding = bindings[bindingName]
    const providerMeta = getProviderMeta(configMeta, binding?.provider || '')
    if (!binding || !providerMeta) {
      return
    }

    try {
      setFetchingModelsBindingName(bindingName)
      const result = await api.fetchModelBindingModels({
        bindingName,
        label: binding.label || bindingName,
        provider: binding.provider,
        apiKey: binding.apiKey || '',
        apiBase: binding.apiBase || null,
      })
      setBindingModelResults((current) => ({ ...current, [bindingName]: result }))
      if (!String(binding.model || '').trim() && result.models[0]) {
        updateConfig((current) => updateBindingFieldValue(
          current,
          bindingName,
          providerMeta,
          'model',
          result.models[0],
        ))
      }
      message.success(result.message)
    } catch (error) {
      clearBindingModelResult(bindingName)
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

  const heroTitle = workspaceMode === 'bindings' ? '模型供应商' : '自定义 Agent 工作台'
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
  return (
    <div className="page-stack">
      <PageHero
        className="page-hero-compact studio-hero"
        title={heroTitle}
        actions={heroActions}
      />

      <div className="models-mode-tabs">
        <button
          type="button"
          className={`models-mode-tab${workspaceMode === 'bindings' ? ' is-active' : ''}`}
          onClick={() => setWorkspaceMode('bindings')}
        >
          <SettingOutlined />
          <span>模型供应商</span>
        </button>
        <button
          type="button"
          className={`models-mode-tab${workspaceMode === 'agents' ? ' is-active' : ''}`}
          onClick={() => setWorkspaceMode('agents')}
        >
          <RobotOutlined />
          <span>Agent 覆盖</span>
        </button>
      </div>

      {workspaceMode === 'bindings' ? (
        <MotionGroup className="page-stack">
          <MotionPanel hover={false}>
            <Card className="config-panel-card models-default-runtime-card">
              <div className="config-card-header">
                <div className="page-section-title">
                  <Typography.Title level={4}>默认运行</Typography.Title>
                </div>
                <Tag color="blue">平台级</Tag>
              </div>

              <div className="models-provider-preview-shell">
                <div className="models-provider-preview-brand">
                  {renderProviderIcon(defaultBindingMeta?.name || defaultBinding?.provider || '', 'models-provider-emoji-large')}
                  <div className="models-provider-preview-copy">
                    <strong>{defaultBinding?.label || '尚未设置默认 binding'}</strong>
                    <span>{defaultBindingMeta ? defaultBindingMeta.label : '未设置默认 binding'}</span>
                  </div>
                </div>
                <div className="models-provider-preview-stats">
                  <div className="models-provider-preview-stat">
                    <span>默认模型</span>
                    <strong>{config.agents.defaults.model || '待选择'}</strong>
                  </div>
                  <div className="models-provider-preview-stat">
                    <span>Agent 覆盖</span>
                    <strong>{agentOverrideCount}</strong>
                  </div>
                </div>
              </div>

              {defaultModelMismatch && defaultBindingMeta ? (
                <Alert
                  showIcon
                  type="warning"
                  message="默认绑定与模型关键字不一致"
                  description={`当前默认绑定是 ${defaultBindingMeta.label}，但模型更像 ${getProviderMeta(configMeta, defaultModelProviderName || '')?.label || '其他供应商'}。这类错配会让运行时拿错密钥。`}
                />
              ) : null}

              <div className="models-editor-grid">
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
            </Card>
          </MotionPanel>

          <MotionPanel hover={false}>
            <div className="models-provider-list-shell">
              <div className="models-provider-list-header">
                <div>
                  <Typography.Title level={4}>模型供应商</Typography.Title>
                </div>
                <div className="models-directory-toolbar">
                  <Input
                    value={bindingQuery}
                    placeholder="搜索供应商、binding、模型..."
                    onChange={(event) => setBindingQuery(event.target.value)}
                  />
                  <Button icon={<PlusOutlined />} onClick={() => addBinding(defaultBinding?.provider)}>
                    新增绑定
                  </Button>
                </div>
              </div>

              <div className="models-provider-accordion">
                {providerRows.map((providerRow) => {
                  const isExpanded = expandedProviderName === providerRow.meta.name
                  const activeEntry = providerRow.items.find((item) => item.bindingName === selectedBindingName) ?? providerRow.items[0] ?? null
                  const activeModelResult = activeEntry ? bindingModelResults[activeEntry.bindingName] : null
                  const activeTestResult = activeEntry ? bindingTestResults[activeEntry.bindingName] : null
                  const activeSuggestions = activeEntry
                    ? Array.from(new Set([
                        activeEntry.binding.model || '',
                        ...(activeModelResult?.models ?? []),
                        ...getModelSuggestions(activeEntry.meta.name, activeEntry.binding.model || null),
                      ].map((item) => String(item || '').trim()).filter(Boolean)))
                    : []

                  return (
                    <div className={`models-provider-row${isExpanded ? ' is-expanded' : ''}`} key={providerRow.meta.name}>
                      <button
                        type="button"
                        className="models-provider-row-head"
                        onClick={() => toggleProvider(providerRow.meta.name)}
                      >
                        <div className="models-provider-row-main">
                          {renderProviderIcon(providerRow.meta.name, 'models-provider-row-emoji')}
                          <span className="models-provider-row-name">{providerRow.meta.label}</span>
                        </div>
                        <div className="models-provider-row-side">
                          <span className={`models-provider-status${providerRow.configured ? ' is-configured' : ''}`}>
                            {providerRow.statusLabel}
                          </span>
                          <span className={`models-provider-chevron${isExpanded ? ' is-open' : ''}`}>›</span>
                        </div>
                      </button>

                      {isExpanded ? (
                        <div className="models-provider-row-body">
                          <div className="models-provider-row-intro">
                            <div className="models-provider-row-intro-copy">
                              <strong>{providerDescriptions[providerRow.meta.name] || providerRow.meta.label}</strong>
                              <span>{providerRow.items.length > 0 ? `${providerRow.items.length} 个 binding` : '未配置 binding'}</span>
                            </div>
                            <div className="models-editor-badge-row">
                              <Tag>{providerCategoryLabels[providerRow.meta.category]}</Tag>
                              {defaultBinding?.provider === providerRow.meta.name ? <Tag color="blue">当前默认供应商</Tag> : null}
                              <Tag>{providerRow.items.length} 个 binding</Tag>
                            </div>
                          </div>

                          {providerRow.presets.length > 0 ? (
                            <div className="models-form-section">
                              <div className="models-form-section-head">
                                <strong>快速预设</strong>
                              </div>
                              <div className="models-preset-grid">
                                {providerRow.presets.map((preset) => (
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
                            </div>
                          ) : null}

                          {providerRow.items.length === 0 ? (
                            <div className="models-provider-empty-state">
                              <Button type="primary" icon={<PlusOutlined />} onClick={() => addBinding(providerRow.meta.name)}>
                                创建第一条绑定
                              </Button>
                            </div>
                          ) : (
                            <>
                              <div className="models-provider-binding-tabs">
                                {providerRow.items.map((item) => {
                                  const itemStatus = getBindingStatus(item.meta, item.binding)
                                  return (
                                    <button
                                      key={item.bindingName}
                                      type="button"
                                      className={`models-provider-binding-tab${activeEntry?.bindingName === item.bindingName ? ' is-active' : ''}`}
                                      onClick={() => focusBinding(item.bindingName)}
                                    >
                                      <strong>{item.binding.label || item.bindingName}</strong>
                                      <span>{itemStatus.label}</span>
                                    </button>
                                  )
                                })}
                                <button
                                  type="button"
                                  className="models-provider-binding-tab is-create"
                                  onClick={() => addBinding(providerRow.meta.name)}
                                >
                                  <strong>新增实例</strong>
                                  <span>添加同供应商新 binding</span>
                                </button>
                              </div>

                              {activeEntry ? (
                                <>
                                  <div className="models-status-strip">
                                    <div className="models-status-chip">
                                      <span>绑定名称</span>
                                      <strong>{activeEntry.binding.label || activeEntry.bindingName}</strong>
                                    </div>
                                    <div className="models-status-chip">
                                      <span>服务地址</span>
                                      <strong>{getEndpointLabel(activeEntry.meta, activeEntry.binding)}</strong>
                                    </div>
                                    <div className="models-status-chip">
                                      <span>默认模型</span>
                                      <strong>{activeEntry.binding.model || '待填写'}</strong>
                                    </div>
                                  </div>

                                  <div className="models-form-section">
                                    <div className="models-form-section-head">
                                      <strong>基础信息</strong>
                                    </div>
                                    <div className="models-editor-grid">
                                      <div className="config-field-block">
                                        <div className="config-field-label-row">
                                          <Text>绑定名称</Text>
                                        </div>
                                        <Input
                                          value={activeEntry.binding.label || ''}
                                          placeholder={activeEntry.bindingName}
                                          onChange={(event) => updateBindingField(activeEntry.bindingName, 'label', event.target.value)}
                                        />
                                      </div>
                                      <div className="config-field-block">
                                        <div className="config-field-label-row">
                                          <Text>所属供应商</Text>
                                        </div>
                                        <Select
                                          value={activeEntry.binding.provider}
                                          options={providerOptions}
                                          style={{ width: '100%' }}
                                          onChange={(value) => updateBindingProvider(activeEntry.bindingName, value)}
                                        />
                                      </div>
                                    </div>
                                  </div>

                                  <div className="models-form-section">
                                    <div className="models-form-section-head">
                                      <strong>模型与发现</strong>
                                    </div>
                                    <div className="config-field-block">
                                      <div className="config-field-label-row">
                                        <Text>绑定默认模型</Text>
                                        {!activeEntry.meta.isOauth ? (
                                          <Button
                                            size="small"
                                            icon={<ReloadOutlined />}
                                            loading={fetchingModelsBindingName === activeEntry.bindingName}
                                            onClick={() => void fetchBindingModels(activeEntry.bindingName)}
                                          >
                                            {activeModelResult ? '刷新模型' : '获取模型'}
                                          </Button>
                                        ) : null}
                                      </div>
                                      <Input
                                        value={activeEntry.binding.model || ''}
                                        placeholder={activeEntry.suggestions[0] || '例如 deepseek-chat / qwen-max / glm-4.5'}
                                        onChange={(event) => updateBindingField(activeEntry.bindingName, 'model', event.target.value)}
                                      />
                                    </div>

                                    <div className="models-suggestion-list">
                                      {activeSuggestions.length > 0 ? (
                                        activeSuggestions.map((model) => (
                                          <Button
                                            key={model}
                                            type={activeEntry.binding.model === model ? 'primary' : 'default'}
                                            onClick={() => updateBindingField(activeEntry.bindingName, 'model', model)}
                                          >
                                            {model}
                                          </Button>
                                        ))
                                      ) : (
                                        <Text type="secondary">可手动输入模型。</Text>
                                      )}
                                    </div>

                                    {activeModelResult ? (
                                      <Text type="secondary">{activeModelResult.message}</Text>
                                    ) : null}
                                  </div>

                                  {activeEntry.meta.isOauth ? (
                                    <Alert
                                      showIcon
                                      type="info"
                                      message="该供应商走 OAuth"
                                    />
                                  ) : (
                                    <div className="models-form-section">
                                      <div className="models-form-section-head">
                                        <strong>认证与地址</strong>
                                      </div>
                                      <div className="models-editor-grid">
                                        <div className="config-field-block">
                                          <div className="config-field-label-row">
                                            <Text>访问密钥</Text>
                                          </div>
                                          <Input.Password
                                            value={activeEntry.binding.apiKey ?? ''}
                                            placeholder={activeEntry.meta.isLocal ? '本地供应商通常可留空' : '请输入访问密钥'}
                                            onChange={(event) => updateBindingField(activeEntry.bindingName, 'apiKey', event.target.value)}
                                          />
                                        </div>
                                        <div className="config-field-block">
                                          <div className="config-field-label-row">
                                            <Text>服务地址</Text>
                                            {activeEntry.meta.defaultApiBase ? <Tag>默认地址</Tag> : null}
                                          </div>
                                          <Input
                                            value={activeEntry.binding.apiBase ?? ''}
                                            placeholder={activeEntry.meta.defaultApiBase ?? '留空时使用供应商默认地址'}
                                            onChange={(event) => updateBindingField(activeEntry.bindingName, 'apiBase', event.target.value)}
                                          />
                                          {activeEntry.meta.defaultApiBase ? (
                                            <Space wrap>
                                              <Button onClick={() => updateBindingField(activeEntry.bindingName, 'apiBase', activeEntry.meta.defaultApiBase || '')}>
                                                使用默认地址
                                              </Button>
                                              <Text type="secondary">{activeEntry.meta.defaultApiBase}</Text>
                                            </Space>
                                          ) : null}
                                        </div>
                                      </div>
                                    </div>
                                  )}

                                  <div className="models-inline-actions">
                                    {activeEntry.bindingName !== defaultBindingName ? (
                                      <Button
                                        onClick={() => applyDefaultBinding(activeEntry.bindingName, {
                                          keepCurrentModel: modelMatchesProvider(configMeta, activeEntry.binding.provider, config.agents.defaults.model),
                                          model: activeEntry.binding.model || config.agents.defaults.model,
                                        })}
                                      >
                                        设为全局默认绑定
                                      </Button>
                                    ) : null}
                                    {!activeEntry.meta.isOauth ? (
                                      <Button
                                        type="primary"
                                        loading={testingBindingName === activeEntry.bindingName}
                                        disabled={!activeEntry.binding.provider || !(activeEntry.binding.model || config.agents.defaults.model)}
                                        onClick={() => void testBinding(activeEntry.bindingName)}
                                      >
                                        检测连接
                                      </Button>
                                    ) : null}
                                    <Button icon={<CopyOutlined />} onClick={() => copyBinding(activeEntry.bindingName)}>
                                      复制绑定
                                    </Button>
                                    <Button icon={<SaveOutlined />} onClick={() => void saveCurrentConfig()} loading={saving}>
                                      保存配置
                                    </Button>
                                    <Button danger icon={<DeleteOutlined />} onClick={() => deleteBinding(activeEntry.bindingName)}>
                                      删除绑定
                                    </Button>
                                  </div>

                                  {activeTestResult ? (
                                    <Alert
                                      showIcon
                                      type={activeTestResult.ok ? 'success' : 'error'}
                                      message={`${activeTestResult.message} · ${activeTestResult.latencyMs} ms`}
                                      description={[
                                        `供应商: ${activeTestResult.provider}`,
                                        `模型: ${activeTestResult.model}`,
                                        activeTestResult.responsePreview ? `响应: ${activeTestResult.responsePreview}` : null,
                                      ].filter(Boolean).join(' | ')}
                                    />
                                  ) : null}
                                </>
                              ) : null}
                            </>
                          )}
                        </div>
                      ) : null}
                    </div>
                  )
                })}
              </div>
            </div>
          </MotionPanel>
        </MotionGroup>
      ) : (
        <div className="page-grid models-page-grid">
          <MotionGroup className="page-stack">
            <MotionPanel hover={false}>
              <Card className="config-panel-card">
                <div className="config-card-header">
                  <div className="page-section-title">
                    <Typography.Title level={4}>自定义 Agent 总览</Typography.Title>
                  </div>
                  <Tag color={agentOverrideCount > 0 ? 'gold' : 'green'}>
                    {agentOverrideCount} 个自定义
                  </Tag>
                </div>

                <Alert
                  showIcon
                  type="info"
                  message="平台配置和角色配置已经拆开"
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
                      <Text type="secondary">还有 {inheritedAgents.length - 10} 个 Agent。</Text>
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
