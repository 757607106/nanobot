import type { CapabilityType } from './types'

export const CAPABILITY_OPTIONS: { label: string; value: CapabilityType }[] = [
  { label: '文本对话', value: 'text_chat' },
  { label: '向量嵌入', value: 'embedding' },
  { label: '多模态', value: 'multimodal' },
  { label: '重排序', value: 'rerank' },
]

export const CAPABILITY_TABS = [{ label: '全部', value: 'all' }, ...CAPABILITY_OPTIONS] as const

export function capabilityColor(type: CapabilityType) {
  if (type === 'embedding') return 'gold'
  if (type === 'rerank') return 'cyan'
  if (type === 'multimodal') return 'purple'
  return 'blue'
}

