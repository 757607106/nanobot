import type { ApiError } from '../../api'
import type { CapabilityType } from './types'

export function createEmptyAddModelDraft() {
  return {
    modelId: '',
    modelName: '',
    capabilityType: 'text_chat' as CapabilityType,
  }
}

export function createEmptyTestDraft() {
  return {
    apiKey: '',
    apiBase: '',
    model: '',
  }
}

export function getBindingRouteErrorMessage(error: unknown, action: '检测连接' | '获取模型列表') {
  if (error instanceof Error && 'statusCode' in error && (error as ApiError).statusCode === 404) {
    return `当前 Web 后端还没加载"${action}"接口，通常是 dev 模式下后端没有重启。请重启 nanobot Web 服务后再试。`
  }
  return error instanceof Error ? error.message : `${action}失败`
}

const EMBEDDING_KEYWORDS = ['embedding', 'embeddings', 'embed', 'bge', 'e5', 'gte', 'voyage']
const RERANK_KEYWORDS = ['rerank', 'reranker', 'bge-reranker', 'jina-reranker']
const MULTIMODAL_KEYWORDS = [
  'vision', 'vl', 'omni', 'qvq', 'pixtral',
  'gpt-4o', 'gpt-4-turbo',
  'claude-opus', 'claude-sonnet',
  'gemini-2', 'gemini-1.5', 'gemini-pro',
  'glm-4v',
  'qwen-vl', 'qwen2-vl', 'qwen2.5-vl',
  'step-1v', 'step-2v',
  'yi-vision',
  'internvl',
]

export function inferCapabilityType(modelId: string): CapabilityType {
  const normalized = modelId.trim().toLowerCase()
  if (RERANK_KEYWORDS.some((token) => normalized.includes(token))) {
    return 'rerank'
  }
  if (EMBEDDING_KEYWORDS.some((token) => normalized.includes(token))) {
    return 'embedding'
  }
  if (MULTIMODAL_KEYWORDS.some((token) => normalized.includes(token))) {
    return 'multimodal'
  }
  return 'text_chat'
}

export function capabilityLabel(type: CapabilityType) {
  if (type === 'embedding') return '向量嵌入'
  if (type === 'rerank') return '重排序'
  if (type === 'multimodal') return '多模态'
  return '文本对话'
}

export function hasCredentialMaterial(apiKey?: string | null, apiBase?: string | null) {
  return Boolean(String(apiKey || '').trim() || String(apiBase || '').trim())
}
