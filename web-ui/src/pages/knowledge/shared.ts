import { ApiError } from '../../api'
import type {
  KnowledgeBaseDefinition,
  KnowledgeDatabaseStats,
  KnowledgeDocument,
  KnowledgeFileListResponse,
  KnowledgeQueryParams,
} from '../../types'

export const KNOWLEDGE_ARCHITECTURE_LABEL = 'LightRAG'
export const DEFAULT_KNOWLEDGE_CHUNK_SIZE = 1000
export const DEFAULT_KNOWLEDGE_CHUNK_OVERLAP = 200

export const DEFAULT_QUERY_PARAMS: KnowledgeQueryParams = {
  mode: 'mix',
  topK: 10,
  chunkTopK: 12,
  responseType: 'Multiple Paragraphs',
  onlyNeedContext: true,
  onlyNeedPrompt: false,
  enableRerank: false,
  rerankModel: null,
  options: {},
}

export const CHUNK_PRESET_OPTIONS = [
  { value: 'general', label: 'General', description: '通用分块，适合大多数普通文档。' },
  { value: 'qa', label: 'QA', description: '问答分块，适合 FAQ、题库、问答手册。' },
  { value: 'book', label: 'Book', description: '强化章节结构，适合教材、长手册。' },
  { value: 'laws', label: 'Laws', description: '法条层级分块，适合法规制度文本。' },
]

export const LANGUAGE_OPTIONS = [
  { value: 'Chinese', label: '中文 Chinese' },
  { value: 'English', label: '英语 English' },
  { value: 'Japanese', label: '日语 Japanese' },
  { value: 'Korean', label: '韩语 Korean' },
  { value: 'German', label: '德语 German' },
  { value: 'French', label: '法语 French' },
  { value: 'Spanish', label: '西班牙语 Spanish' },
  { value: 'Portuguese', label: '葡萄牙语 Portuguese' },
  { value: 'Russian', label: '俄语 Russian' },
  { value: 'Arabic', label: '阿拉伯语 Arabic' },
  { value: 'Hindi', label: '印地语 Hindi' },
]

export interface KnowledgeFormState {
  name: string
  description: string
  enabled: boolean
  embedBindingName: string
  embedModelName: string
  llmBindingName: string
  llmModelName: string
  language: string
  chunkPresetId: string
  autoGenerateQuestions: boolean
  qaSeparator: string
  tagsText: string
}

interface KnowledgeModelDefaults {
  embedBindingName?: string
  embedModelName?: string
  llmBindingName?: string
  llmModelName?: string
}

function readKnowledgeModelValue(
  info: Record<string, unknown> | null | undefined,
  ...keys: string[]
) {
  for (const key of keys) {
    const value = info?.[key]
    if (typeof value === 'string' && value.trim()) {
      return value.trim()
    }
  }
  return ''
}

export interface KnowledgeIndexConfigState {
  chunkSize: number
  chunkOverlap: number
  chunkPresetId: string
  qaSeparator: string
}

export interface KnowledgeTreeNode extends KnowledgeDocument {
  children?: KnowledgeTreeNode[]
}

export function getDefaultQueryParams(): KnowledgeQueryParams {
  return {
    ...DEFAULT_QUERY_PARAMS,
    options: { ...(DEFAULT_QUERY_PARAMS.options || {}) },
  }
}

export function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof ApiError) {
    return error.message
  }
  if (error instanceof Error && error.message) {
    return error.message
  }
  return fallback
}

export function createKnowledgeFormState(
  kb?: KnowledgeBaseDefinition | null,
  defaults?: KnowledgeModelDefaults,
): KnowledgeFormState {
  const embedInfo = (kb?.embedInfo || null) as Record<string, unknown> | null
  const llmInfo = (kb?.llmInfo || null) as Record<string, unknown> | null
  return {
    name: kb?.name || '',
    description: kb?.description || '',
    enabled: kb?.enabled ?? true,
    embedBindingName: readKnowledgeModelValue(embedInfo, 'bindingName', 'binding_name') || String(defaults?.embedBindingName || ''),
    embedModelName: readKnowledgeModelValue(embedInfo, 'modelName', 'model_name', 'model') || String(defaults?.embedModelName || ''),
    llmBindingName: readKnowledgeModelValue(llmInfo, 'bindingName', 'binding_name') || String(defaults?.llmBindingName || ''),
    llmModelName: readKnowledgeModelValue(llmInfo, 'modelName', 'model_name', 'model') || String(defaults?.llmModelName || ''),
    language: String(kb?.additionalParams?.language || 'Chinese'),
    chunkPresetId: String(kb?.additionalParams?.chunk_preset_id || 'general'),
    autoGenerateQuestions: Boolean(kb?.additionalParams?.auto_generate_questions || false),
    qaSeparator: String(kb?.additionalParams?.qa_separator || ''),
    tagsText: (kb?.tags || []).join(', '),
  }
}

export function createIndexConfigState(kb?: KnowledgeBaseDefinition | null): KnowledgeIndexConfigState {
  return {
    chunkSize: Number(kb?.additionalParams?.chunk_size || DEFAULT_KNOWLEDGE_CHUNK_SIZE),
    chunkOverlap: Number(kb?.additionalParams?.chunk_overlap || DEFAULT_KNOWLEDGE_CHUNK_OVERLAP),
    chunkPresetId: String(kb?.additionalParams?.chunk_preset_id || 'general'),
    qaSeparator: String(kb?.additionalParams?.qa_separator || ''),
  }
}

export function buildKnowledgeAdditionalParams(
  existing: Record<string, unknown> | null | undefined,
  formState: KnowledgeFormState,
  indexConfig: KnowledgeIndexConfigState,
) {
  const chunkSize = Math.max(200, Number(indexConfig.chunkSize || DEFAULT_KNOWLEDGE_CHUNK_SIZE))
  const chunkOverlap = Math.min(
    Math.max(0, Number(indexConfig.chunkOverlap || 0)),
    Math.max(0, chunkSize - 1),
  )
  const next: Record<string, unknown> = {
    ...(existing || {}),
    language: formState.language,
    chunk_preset_id: formState.chunkPresetId,
    chunk_size: chunkSize,
    chunk_overlap: chunkOverlap,
    auto_generate_questions: formState.autoGenerateQuestions,
  }
  const qaSeparator = formState.qaSeparator.trim()
  if (qaSeparator) {
    next.qa_separator = qaSeparator
  } else {
    delete next.qa_separator
  }
  return next
}

export function parseTags(value: string) {
  return Array.from(
    new Set(
      value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  )
}

export function statusColor(status: string) {
  switch (status) {
    case 'indexed':
    case 'completed':
    case 'succeeded':
      return 'success'
    case 'parsed':
    case 'running':
    case 'indexing':
    case 'parsing':
      return 'processing'
    case 'error_parsing':
    case 'error_indexing':
    case 'failed':
      return 'error'
    case 'uploaded':
      return 'warning'
    default:
      return 'default'
  }
}

export function statusLabel(status: string) {
  const labels: Record<string, string> = {
    uploaded: '待解析',
    parsing: '解析中',
    parsed: '已解析',
    indexing: '索引中',
    indexed: '已索引',
    folder: '文件夹',
    error_parsing: '解析失败',
    error_indexing: '索引失败',
    queued: '排队中',
    running: '运行中',
    completed: '已完成',
    succeeded: '已完成',
    failed: '失败',
  }
  return labels[status] || status
}

export function canParseKnowledgeFile(status: string) {
  return status === 'uploaded' || status === 'error_parsing'
}

export function canIndexKnowledgeFile(status: string, allowReindex: boolean) {
  return status === 'parsed' || status === 'error_indexing' || (allowReindex && status === 'indexed')
}

export function canDeleteKnowledgeFile(status: string) {
  return !['parsing', 'indexing', 'running', 'waiting', 'processing'].includes(status)
}

export function formatStats(stats?: KnowledgeDatabaseStats | null) {
  if (!stats) {
    return '暂无文件'
  }
  return `${stats.fileCount} 文件 · ${stats.indexedCount} 已索引 · ${stats.folderCount} 文件夹`
}

function matchFile(file: KnowledgeDocument, query: string) {
  if (!query) return true
  const lower = query.toLowerCase()
  return (
    file.filename.toLowerCase().includes(lower)
    || file.path.toLowerCase().includes(lower)
    || String(file.fileType || '').toLowerCase().includes(lower)
  )
}

export function createEmptyListState(): KnowledgeFileListResponse {
  return {
    items: [],
    stats: {
      totalCount: 0,
      folderCount: 0,
      fileCount: 0,
      indexedCount: 0,
      parsedCount: 0,
      errorCount: 0,
    },
  }
}

function sortKnowledgeNodes(left: KnowledgeDocument, right: KnowledgeDocument) {
  if (left.isFolder !== right.isFolder) {
    return left.isFolder ? -1 : 1
  }
  return left.filename.localeCompare(right.filename, 'zh-Hans-CN')
}

export function buildKnowledgeTree(items: KnowledgeDocument[], query: string): KnowledgeTreeNode[] {
  const nodes = new Map<string, KnowledgeTreeNode>(
    items
      .slice()
      .sort(sortKnowledgeNodes)
      .map((item) => [item.fileId, { ...item, children: [] }]),
  )

  const roots: KnowledgeTreeNode[] = []
  for (const item of items.slice().sort(sortKnowledgeNodes)) {
    const node = nodes.get(item.fileId)
    if (!node) continue
    if (item.parentId && nodes.has(item.parentId)) {
      nodes.get(item.parentId)?.children?.push(node)
    } else {
      roots.push(node)
    }
  }

  if (!query) {
    return roots
  }

  const visit = (node: KnowledgeTreeNode): KnowledgeTreeNode | null => {
    const children = (node.children || [])
      .map(visit)
      .filter((item): item is KnowledgeTreeNode => item !== null)
    if (!matchFile(node, query) && children.length === 0) {
      return null
    }
    return {
      ...node,
      children,
    }
  }

  return roots
    .map(visit)
    .filter((item): item is KnowledgeTreeNode => item !== null)
}

export function collectExpandedFolderKeys(nodes: KnowledgeTreeNode[]): string[] {
  const result: string[] = []
  const walk = (items: KnowledgeTreeNode[]) => {
    for (const item of items) {
      if (item.isFolder && (item.children || []).length > 0) {
        result.push(item.fileId)
        walk(item.children || [])
      }
    }
  }
  walk(nodes)
  return result
}

export function formatScorePercent(value?: number | null) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '--'
  }
  return `${(value * 100).toFixed(0)}%`
}

export function buildIndexParams(
  chunkPresetId: string,
  chunkSize: number,
  chunkOverlap: number,
  qaSeparator: string,
) {
  return {
    chunkPresetId,
    chunkSize,
    chunkOverlap,
    qaSeparator: qaSeparator.trim() || undefined,
  }
}
