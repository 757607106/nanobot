import type { ModelBinding } from '../../types'

export type CapabilityType = 'text_chat' | 'embedding' | 'multimodal'

export type AddModelDraft = {
  modelId: string
  modelName: string
  capabilityType: CapabilityType
}

export type TestDraft = {
  apiKey: string
  apiBase: string
  model: string
}

export type BindingRow = ModelBinding & {
  bindingName: string
  capabilityType: CapabilityType
}

export type ProviderIconAsset = {
  src?: string
  fallback: string
}

export type ProviderCardItem = {
  name: string
  label: string
  configured: boolean
  defaultProvider: boolean
  bindingsCount: number
}
