import { providerCategoryLabels } from './configMeta'
import { getModelSuggestions } from './modelCatalog'
import type { ConfigData, ConfigMeta, ModelBinding, ProviderConfig, ProviderMeta } from './types'

export function resolveBindingCapabilityType(binding: Pick<ModelBinding, 'capabilityType' | 'model' | 'label'> | undefined) {
  const normalized = `${binding?.model || ''} ${binding?.label || ''}`.trim().toLowerCase()
  if (['embedding', 'embeddings', 'embed', 'bge', 'e5', 'gte', 'voyage'].some((token) => normalized.includes(token))) {
    return 'embedding' as const
  }
  if (['rerank', 'reranker', 'bge-reranker', 'jina-reranker'].some((token) => normalized.includes(token))) {
    return 'rerank' as const
  }
  if (binding?.capabilityType === 'multimodal') {
    return 'multimodal' as const
  }
  return (binding?.capabilityType ?? 'text_chat') as 'text_chat' | 'embedding' | 'multimodal' | 'rerank'
}

export function providerCategoryOrder(meta: ProviderMeta) {
  const order = ['standard', 'gateway', 'local', 'direct', 'oauth']
  return order.indexOf(meta.category)
}

export function buildProviderConfig(meta?: ProviderMeta): ProviderConfig {
  return {
    apiKey: '',
    apiBase: meta?.defaultApiBase ?? null,
    extraHeaders: {},
  }
}

export function buildModelBinding(
  providerName: string,
  meta?: ProviderMeta,
  overrides?: Partial<ModelBinding>,
): ModelBinding {
  return {
    provider: providerName,
    label: overrides?.label ?? meta?.label ?? providerName,
    model: overrides?.model ?? null,
    capabilityType: overrides?.capabilityType ?? 'text_chat',
    apiKey: overrides?.apiKey ?? '',
    apiBase: overrides?.apiBase ?? meta?.defaultApiBase ?? null,
    extraHeaders: overrides?.extraHeaders ?? {},
  }
}

export function getProviderMeta(meta: ConfigMeta | null, providerName: string): ProviderMeta | null {
  if (!meta) {
    return null
  }
  return meta.providers.find((item) => item.name === providerName) ?? null
}

function hasProviderMaterial(config: ProviderConfig | ModelBinding | undefined) {
  if (!config) {
    return false
  }
  return Boolean(
    String(config.apiKey || '').trim()
    || String(config.apiBase || '').trim()
    || (config.extraHeaders && Object.keys(config.extraHeaders).length > 0),
  )
}

function hasTextValue(value: string | null | undefined) {
  return Boolean(String(value || '').trim())
}

function hasHeadersValue(headers: Record<string, string> | null | undefined) {
  return Boolean(headers && Object.keys(headers).length > 0)
}

function projectProviderConfigs(
  bindings: Record<string, ModelBinding>,
  current: Record<string, ProviderConfig>,
  preferredBindingName?: string | null,
) {
  const projected = { ...current }
  const providerNames = Array.from(new Set(Object.values(bindings).map((binding) => binding.provider)))

  for (const providerName of providerNames) {
    const preferred = preferredBindingName && bindings[preferredBindingName]?.provider === providerName
      ? bindings[preferredBindingName]
      : bindings[providerName]
        || Object.values(bindings).find((binding) => binding.provider === providerName)

    if (!preferred) {
      continue
    }

    const currentProvider = current[providerName]
    projected[providerName] = {
      apiKey: hasTextValue(currentProvider?.apiKey) ? currentProvider?.apiKey || '' : preferred.apiKey,
      apiBase: hasTextValue(currentProvider?.apiBase) ? currentProvider?.apiBase ?? null : preferred.apiBase ?? null,
      extraHeaders: hasHeadersValue(currentProvider?.extraHeaders) ? currentProvider?.extraHeaders ?? {} : preferred.extraHeaders ?? {},
    }
  }
  return projected
}

export function getAllModelBindings(config: ConfigData, meta: ConfigMeta | null): Record<string, ModelBinding> {
  const explicitBindings = config.modelBindings ?? {}
  if (Object.keys(explicitBindings).length > 0) {
    return explicitBindings
  }

  const activeProvider = String(config.agents.defaults.provider || '').trim()
  const activeModel = String(config.agents.defaults.model || '').trim() || null
  const synthesized: Record<string, ModelBinding> = {}
  for (const [providerName, providerConfig] of Object.entries(config.providers ?? {})) {
    if (!hasProviderMaterial(providerConfig) && activeProvider !== providerName) {
      continue
    }
    synthesized[providerName] = buildModelBinding(
      providerName,
      getProviderMeta(meta, providerName) ?? undefined,
      {
        label: getProviderMeta(meta, providerName)?.label ?? providerName,
        model: activeProvider === providerName ? activeModel : null,
        apiKey: providerConfig.apiKey,
        apiBase: providerConfig.apiBase ?? null,
        extraHeaders: providerConfig.extraHeaders ?? {},
      },
    )
  }
  return synthesized
}

export function getPreferredProvider(config: ConfigData, meta: ConfigMeta) {
  const bindings = getAllModelBindings(config, meta)
  const configuredBinding = String(config.agents.defaults.binding || '').trim()
  if (configuredBinding && bindings[configuredBinding]?.provider) {
    return bindings[configuredBinding].provider
  }

  const configuredProvider = String(config.agents.defaults.provider || '').trim()
  if (configuredProvider && configuredProvider !== 'auto' && meta.providers.some((item) => item.name === configuredProvider)) {
    return configuredProvider
  }

  const resolvedBinding = String(meta.resolvedBinding || '').trim()
  if (resolvedBinding && bindings[resolvedBinding]?.provider) {
    return bindings[resolvedBinding].provider
  }

  if (meta.providers.some((item) => item.name === meta.resolvedProvider)) {
    return meta.resolvedProvider
  }

  return meta.providers.find((item) => !item.isOauth)?.name ?? meta.providers[0]?.name ?? 'openrouter'
}

export function getPreferredBinding(config: ConfigData, meta: ConfigMeta) {
  const bindings = getAllModelBindings(config, meta)
  const configuredBinding = String(config.agents.defaults.binding || '').trim()
  if (configuredBinding && bindings[configuredBinding]) {
    return configuredBinding
  }

  const resolvedBinding = String(meta.resolvedBinding || '').trim()
  if (resolvedBinding && bindings[resolvedBinding]) {
    return resolvedBinding
  }

  const provider = getPreferredProvider(config, meta)
  const providerMatch = Object.entries(bindings).find(([bindingName, binding]) => (
    binding.provider === provider && bindingName === provider
  )) ?? Object.entries(bindings).find(([, binding]) => binding.provider === provider)

  if (providerMatch) {
    return providerMatch[0]
  }

  return Object.keys(bindings)[0] ?? provider
}

export function normalizeModelConfig(config: ConfigData, meta: ConfigMeta) {
  const bindings = getAllModelBindings(config, meta)
  const binding = Object.keys(bindings).length > 0 ? getPreferredBinding(config, meta) : null
  const provider = binding && bindings[binding]
    ? bindings[binding].provider
    : getPreferredProvider(config, meta)

  return {
    ...config,
    agents: {
      ...config.agents,
      defaults: {
        ...config.agents.defaults,
        binding,
        provider,
      },
    },
    providers: projectProviderConfigs(bindings, config.providers, binding),
    modelBindings: bindings,
  }
}

export function getProviderOptions(meta: ConfigMeta | null) {
  return (meta?.providers ?? [])
    .slice()
    .sort((left, right) => {
      const orderDiff = providerCategoryOrder(left) - providerCategoryOrder(right)
      if (orderDiff !== 0) {
        return orderDiff
      }
      return left.label.localeCompare(right.label)
    })
    .map((provider) => ({
      value: provider.name,
      label: `${provider.label} · ${providerCategoryLabels[provider.category]}`,
    }))
}

export function getBindingOptions(
  config: ConfigData,
  meta: ConfigMeta | null,
  capabilityTypes?: ModelBinding['capabilityType'] | Array<ModelBinding['capabilityType']>,
) {
  if (!meta) {
    return []
  }
  const bindings = getAllModelBindings(config, meta)
  const allowedTypes = capabilityTypes
    ? new Set(Array.isArray(capabilityTypes) ? capabilityTypes : [capabilityTypes])
    : null
  return Object.entries(bindings)
    .filter(([, binding]) => {
      if (!allowedTypes) {
        return true
      }
      return allowedTypes.has(resolveBindingCapabilityType(binding))
    })
    .slice()
    .sort((left, right) => {
      const leftMeta = getProviderMeta(meta, left[1].provider)
      const rightMeta = getProviderMeta(meta, right[1].provider)
      const leftOrder = leftMeta ? providerCategoryOrder(leftMeta) : 99
      const rightOrder = rightMeta ? providerCategoryOrder(rightMeta) : 99
      if (leftOrder !== rightOrder) {
        return leftOrder - rightOrder
      }
      return (left[1].label || left[0]).localeCompare(right[1].label || right[0])
    })
    .map(([bindingName, binding]) => {
      const providerMeta = getProviderMeta(meta, binding.provider)
      const capabilityType = resolveBindingCapabilityType(binding)
      const typeLabel = capabilityType === 'embedding' ? '[向量嵌入]' : capabilityType === 'multimodal' ? '[多模态]' : '[文本对话]';
      return {
        value: bindingName,
        label: `${typeLabel} ${binding.label || bindingName} · ${providerMeta?.label || binding.provider}`,
      }
    })
}

export function createBindingId(base: string, existingBindings: Record<string, ModelBinding>) {
  const normalized = base
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'binding'

  let candidate = normalized
  let counter = 2
  while (existingBindings[candidate]) {
    candidate = `${normalized}-${counter}`
    counter += 1
  }
  return candidate
}

export function ensureProviderSelection(
  config: ConfigData,
  providerName: string,
  meta: ConfigMeta | null,
  options?: {
    keepExistingModel?: boolean
    bindingName?: string
    label?: string
  },
) {
  const providerMeta = getProviderMeta(meta, providerName)
  const bindings = getAllModelBindings(config, meta)
  const requestedBinding = options?.bindingName
    || (
      String(config.agents.defaults.binding || '').trim()
      && bindings[String(config.agents.defaults.binding || '').trim()]?.provider === providerName
        ? String(config.agents.defaults.binding || '').trim()
        : providerName
    )
  const currentModel = String(config.agents.defaults.model || '').trim()
  const keepExistingModel = options?.keepExistingModel ?? true
  const nextModel = keepExistingModel && currentModel
    ? currentModel
    : getModelSuggestions(providerName)[0] || currentModel || ''
  const existingBinding = bindings[requestedBinding]
  const nextBindings = {
    ...bindings,
    [requestedBinding]: existingBinding ?? buildModelBinding(providerName, providerMeta ?? undefined, {
      label: options?.label ?? providerMeta?.label ?? requestedBinding,
      model: nextModel || null,
    }),
  }

  nextBindings[requestedBinding] = {
    ...nextBindings[requestedBinding],
    provider: providerName,
    label: options?.label ?? nextBindings[requestedBinding].label ?? providerMeta?.label ?? requestedBinding,
    model: nextModel || nextBindings[requestedBinding].model || null,
  }

  return {
    ...config,
    agents: {
      ...config.agents,
      defaults: {
        ...config.agents.defaults,
        binding: requestedBinding,
        provider: providerName,
        model: nextModel,
      },
    },
    providers: projectProviderConfigs(nextBindings, config.providers, requestedBinding),
    modelBindings: nextBindings,
  }
}

export function inferProviderFromModel(meta: ConfigMeta | null, model: string | null | undefined) {
  if (!meta) {
    return null
  }

  const value = String(model || '').trim().toLowerCase()
  if (!value) {
    return null
  }

  const normalized = value.replace(/-/g, '_')
  const prefix = normalized.split('/', 1)[0]

  for (const provider of meta.providers) {
    if (prefix === provider.name) {
      return provider.name
    }
  }

  for (const provider of meta.providers) {
    if (provider.keywords.some((keyword) => normalized.includes(keyword.toLowerCase().replace(/-/g, '_')))) {
      return provider.name
    }
  }

  return null
}

export function modelMatchesProvider(
  meta: ConfigMeta | null,
  providerName: string,
  model: string | null | undefined,
) {
  const inferred = inferProviderFromModel(meta, model)
  if (!inferred) {
    return true
  }
  return inferred === providerName
}

export function updateBindingValue(
  config: ConfigData,
  bindingName: string,
  providerMeta: ProviderMeta | null,
  patch: Partial<ModelBinding>,
) {
  const bindings = getAllModelBindings(config, null)
  const currentBinding = bindings[bindingName]
  const providerName = patch.provider ?? currentBinding?.provider ?? providerMeta?.name ?? ''
  const nextBindings = {
    ...bindings,
    [bindingName]: {
      ...(currentBinding ?? buildModelBinding(providerName, providerMeta ?? undefined)),
      ...patch,
      provider: providerName,
      apiBase: patch.apiBase !== undefined ? patch.apiBase : (currentBinding?.apiBase ?? providerMeta?.defaultApiBase ?? null),
    },
  }

  return {
    ...config,
    providers: projectProviderConfigs(nextBindings, config.providers, config.agents.defaults.binding ?? null),
    modelBindings: nextBindings,
  }
}

export function updateBindingFieldValue(
  config: ConfigData,
  bindingName: string,
  providerMeta: ProviderMeta | null,
  field: 'apiKey' | 'apiBase' | 'model' | 'label',
  value: string,
) {
  return updateBindingValue(config, bindingName, providerMeta, {
    [field]: field === 'apiBase'
      ? (value.trim() ? value : null)
      : field === 'model' || field === 'label'
        ? (value.trim() || null)
        : value,
  })
}

export function updateProviderFieldValue(
  config: ConfigData,
  providerName: string,
  providerMeta: ProviderMeta | null,
  field: 'apiKey' | 'apiBase',
  value: string,
) {
  const normalizedValue = field === 'apiBase'
    ? (value.trim() ? value : null)
    : value
  const bindings = getAllModelBindings(config, null)
  const activeBindingName = String(config.agents.defaults.binding || '').trim()
  const targetBindingName = (
    activeBindingName && bindings[activeBindingName]?.provider === providerName
      ? activeBindingName
      : bindings[providerName]?.provider === providerName
        ? providerName
        : Object.entries(bindings).find(([, binding]) => binding.provider === providerName)?.[0]
  ) ?? null

  return {
    ...config,
    providers: {
      ...config.providers,
      [providerName]: {
        ...(config.providers[providerName] ?? buildProviderConfig(providerMeta ?? undefined)),
        [field]: normalizedValue,
      },
    },
    modelBindings: targetBindingName
      ? {
          ...bindings,
          [targetBindingName]: {
            ...bindings[targetBindingName],
            [field]: normalizedValue,
          },
        }
      : config.modelBindings,
  }
}
