import { providerCategoryLabels } from './configMeta'
import { getModelSuggestions } from './modelCatalog'
import type { ConfigData, ConfigMeta, ProviderConfig, ProviderMeta } from './types'

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

export function getProviderMeta(meta: ConfigMeta | null, providerName: string): ProviderMeta | null {
  if (!meta) {
    return null
  }
  return meta.providers.find((item) => item.name === providerName) ?? null
}

export function getPreferredProvider(config: ConfigData, meta: ConfigMeta) {
  const configured = String(config.agents.defaults.provider || '').trim()
  if (configured && configured !== 'auto' && meta.providers.some((item) => item.name === configured)) {
    return configured
  }
  if (meta.providers.some((item) => item.name === meta.resolvedProvider)) {
    return meta.resolvedProvider
  }
  return meta.providers.find((item) => !item.isOauth)?.name ?? meta.providers[0]?.name ?? 'openrouter'
}

export function normalizeModelConfig(config: ConfigData, meta: ConfigMeta) {
  const provider = getPreferredProvider(config, meta)
  const providerMeta = getProviderMeta(meta, provider)
  return {
    ...config,
    agents: {
      ...config.agents,
      defaults: {
        ...config.agents.defaults,
        provider,
      },
    },
    providers: {
      ...config.providers,
      [provider]: config.providers[provider] ?? buildProviderConfig(providerMeta ?? undefined),
    },
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

export function ensureProviderSelection(
  config: ConfigData,
  providerName: string,
  meta: ConfigMeta | null,
  options?: { keepExistingModel?: boolean },
) {
  const providerMeta = getProviderMeta(meta, providerName)
  const currentModel = String(config.agents.defaults.model || '').trim()
  const nextModel = options?.keepExistingModel === false && currentModel
    ? currentModel
    : currentModel || getModelSuggestions(providerName)[0] || ''

  return {
    ...config,
    agents: {
      ...config.agents,
      defaults: {
        ...config.agents.defaults,
        provider: providerName,
        model: nextModel,
      },
    },
    providers: {
      ...config.providers,
      [providerName]: config.providers[providerName] ?? buildProviderConfig(providerMeta ?? undefined),
    },
  }
}

export function updateProviderFieldValue(
  config: ConfigData,
  providerName: string,
  providerMeta: ProviderMeta | null,
  field: 'apiKey' | 'apiBase',
  value: string,
) {
  return {
    ...config,
    providers: {
      ...config.providers,
      [providerName]: {
        ...(config.providers[providerName] ?? buildProviderConfig(providerMeta ?? undefined)),
        [field]: field === 'apiBase' ? (value.trim() ? value : null) : value,
      },
    },
  }
}

