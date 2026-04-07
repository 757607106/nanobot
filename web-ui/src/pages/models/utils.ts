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

export function inferCapabilityType(modelId: string): CapabilityType {
  const normalized = modelId.trim().toLowerCase()
  if (['embedding', 'embeddings', 'embed', 'bge', 'e5', 'gte', 'voyage'].some((token) => normalized.includes(token))) {
    return 'embedding'
  }
  if (['rerank', 'reranker', 'bge-reranker', 'jina-reranker'].some((token) => normalized.includes(token))) {
    return 'rerank'
  }
  if (['vision', 'vl', 'omni', 'gpt-4o', 'qvq'].some((token) => normalized.includes(token))) {
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
