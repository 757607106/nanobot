import { startTransition, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  App,
  Checkbox,
  Button,
  Card,
  Descriptions,
  Empty,
  Input,
  InputNumber,
  List,
  Modal,
  Segmented,
  Select,
  Space,
  Spin,
  Statistic,
  Switch,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import {
  ApartmentOutlined,
  BranchesOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  FileSearchOutlined,
  FolderAddOutlined,
  InfoCircleOutlined,
  PlusOutlined,
  ReloadOutlined,
  RetweetOutlined,
  SaveOutlined,
  SearchOutlined,
  UploadOutlined,
} from '@ant-design/icons'
import { motion } from 'framer-motion'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { ApiError, api } from '../api'
import { formatDateTimeZh } from '../locale'
import type {
  KnowledgeBaseDefinition,
  KnowledgeBenchmark,
  KnowledgeBenchmarkDetail,
  KnowledgeDatabaseStats,
  KnowledgeDocument,
  KnowledgeFileDetail,
  KnowledgeEvaluationResult,
  KnowledgeEvaluationSummary,
  KnowledgeFileListResponse,
  KnowledgeGraphData,
  KnowledgeGraphStats,
  KnowledgeMindmapNode,
  KnowledgeQueryParams,
  KnowledgeQueryParamSchema,
  KnowledgeRetrieveResult,
  KnowledgeIngestJob,
} from '../types'
import { KnowledgeQueryTab } from './knowledge/KnowledgeQueryTab'
import { KnowledgeGraphTab } from './knowledge/KnowledgeGraphTab'
import { KnowledgeMindmapTab } from './knowledge/KnowledgeMindmapTab'
import { KnowledgeEvaluationTab } from './knowledge/KnowledgeEvaluationTab'
import { KnowledgeBenchmarksTab } from './knowledge/KnowledgeBenchmarksTab'
import { KnowledgeSettingsTab } from './knowledge/KnowledgeSettingsTab'
import { KnowledgeFileDetailModal } from './knowledge/KnowledgeFileDetailModal'
import { KnowledgeUploadModal } from './knowledge/KnowledgeUploadModal'

const { Paragraph, Text, Title } = Typography
const LIGHTRAG_DEFAULT_QUERY_PARAMS: KnowledgeQueryParams = {
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

const MILVUS_DEFAULT_QUERY_PARAMS: KnowledgeQueryParams = {
  mode: 'vector',
  topK: 10,
  chunkTopK: 12,
  responseType: 'Multiple Paragraphs',
  onlyNeedContext: false,
  onlyNeedPrompt: false,
  enableRerank: false,
  rerankModel: null,
  options: {
    search_mode: 'vector',
    similarity_threshold: 0,
    keyword_top_k: 50,
  },
}

function getDefaultQueryParams(kbType?: string): KnowledgeQueryParams {
  const source = kbType === 'milvus' ? MILVUS_DEFAULT_QUERY_PARAMS : LIGHTRAG_DEFAULT_QUERY_PARAMS
  return {
    ...source,
    options: { ...(source.options || {}) },
  }
}

const CHUNK_PRESET_OPTIONS = [
  { value: 'general', label: 'General', description: '通用分块，适合大多数普通文档。' },
  { value: 'qa', label: 'QA', description: '问答分块，适合 FAQ、题库、问答手册。' },
  { value: 'book', label: 'Book', description: '强化章节结构，适合教材、长手册。' },
  { value: 'laws', label: 'Laws', description: '法条层级分块，适合法规制度文本。' },
]

const LANGUAGE_OPTIONS = [
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

interface KnowledgeFormState {
  name: string
  description: string
  enabled: boolean
  kbType: string
  embedModelName: string
  llmModelName: string
  language: string
  chunkPresetId: string
  autoGenerateQuestions: boolean
  qaSeparator: string
  tagsText: string
}

interface KnowledgeIndexConfigState {
  chunkSize: number
  chunkOverlap: number
  chunkPresetId: string
  qaSeparator: string
}

interface KnowledgeTreeNode extends KnowledgeDocument {
  children?: KnowledgeTreeNode[]
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof ApiError) {
    return error.message
  }
  if (error instanceof Error && error.message) {
    return error.message
  }
  return fallback
}

function createKnowledgeFormState(kb?: KnowledgeBaseDefinition | null): KnowledgeFormState {
  return {
    name: kb?.name || '',
    description: kb?.description || '',
    enabled: kb?.enabled ?? true,
    kbType: kb?.kbType || 'lightrag',
    embedModelName: String(kb?.embedInfo?.modelName || kb?.embedInfo?.model || ''),
    llmModelName: String(kb?.llmInfo?.modelName || kb?.llmInfo?.model || ''),
    language: String(kb?.additionalParams?.language || 'Chinese'),
    chunkPresetId: String(kb?.additionalParams?.chunk_preset_id || 'general'),
    autoGenerateQuestions: Boolean(kb?.additionalParams?.auto_generate_questions || false),
    qaSeparator: String(kb?.additionalParams?.qa_separator || ''),
    tagsText: (kb?.tags || []).join(', '),
  }
}

function createIndexConfigState(kb?: KnowledgeBaseDefinition | null): KnowledgeIndexConfigState {
  return {
    chunkSize: Number(kb?.additionalParams?.chunk_size || 1000),
    chunkOverlap: Number(kb?.additionalParams?.chunk_overlap || 200),
    chunkPresetId: String(kb?.additionalParams?.chunk_preset_id || 'general'),
    qaSeparator: String(kb?.additionalParams?.qa_separator || ''),
  }
}

function parseTags(value: string) {
  return Array.from(
    new Set(
      value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  )
}

function statusColor(status: string) {
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

function statusLabel(status: string) {
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

function canParseKnowledgeFile(status: string) {
  return status === 'uploaded' || status === 'error_parsing'
}

function canIndexKnowledgeFile(status: string, allowReindex: boolean) {
  return status === 'parsed' || status === 'error_indexing' || (allowReindex && status === 'indexed')
}

function canDeleteKnowledgeFile(status: string) {
  return !['parsing', 'indexing', 'running', 'waiting', 'processing'].includes(status)
}

function formatStats(stats?: KnowledgeDatabaseStats | null) {
  if (!stats) {
    return '暂无文件'
  }
  return `${stats.fileCount} 文件 · ${stats.indexedCount} 已索引 · ${stats.folderCount} 文件夹`
}

function fileDepth(path: string) {
  return Math.max(0, path.split('/').filter(Boolean).length - 1)
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

function createEmptyListState(): KnowledgeFileListResponse {
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

function buildKnowledgeTree(items: KnowledgeDocument[], query: string): KnowledgeTreeNode[] {
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

function collectExpandedFolderKeys(nodes: KnowledgeTreeNode[]): string[] {
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

function isLightRagKnowledgeBase(kb?: KnowledgeBaseDefinition | null) {
  return (kb?.kbType || '').toLowerCase() === 'lightrag'
}

function isMilvusKnowledgeBase(kb?: KnowledgeBaseDefinition | null) {
  return (kb?.kbType || '').toLowerCase() === 'milvus'
}

function formatScorePercent(value?: number | null) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '--'
  }
  return `${(value * 100).toFixed(0)}%`
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

export default function KnowledgePage() {
  const { message } = App.useApp()
  const navigate = useNavigate()
  const location = useLocation()
  const { kbId } = useParams()
  const selectedKbId = kbId && kbId !== 'new' ? kbId : null
  const shouldOpenCreateModal = location.pathname.endsWith('/knowledge/new')
  const uploadInputRef = useRef<HTMLInputElement | null>(null)
  const benchmarkUploadInputRef = useRef<HTMLInputElement | null>(null)
  const detailGridRef = useRef<HTMLDivElement | null>(null)

  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBaseDefinition[]>([])
  const [currentKb, setCurrentKb] = useState<KnowledgeBaseDefinition | null>(null)
  const [filesState, setFilesState] = useState<KnowledgeFileListResponse>(createEmptyListState)
  const [jobs, setJobs] = useState<KnowledgeIngestJob[]>([])
  const [queryParams, setQueryParams] = useState<KnowledgeQueryParams>(() => getDefaultQueryParams())
  const [queryText, setQueryText] = useState('')
  const [queryResult, setQueryResult] = useState<KnowledgeRetrieveResult | null>(null)
  const [resultView, setResultView] = useState<'formatted' | 'raw'>('formatted')
  const [sampleQuestions, setSampleQuestions] = useState<string[]>([])
  const [mindmap, setMindmap] = useState<KnowledgeMindmapNode | null>(null)
  const [graphData, setGraphData] = useState<KnowledgeGraphData | null>(null)
  const [graphStats, setGraphStats] = useState<KnowledgeGraphStats | null>(null)
  const [benchmarks, setBenchmarks] = useState<KnowledgeBenchmark[]>([])
  const [benchmarkPreview, setBenchmarkPreview] = useState<KnowledgeBenchmarkDetail | null>(null)
  const [benchmarkPreviewLoading, setBenchmarkPreviewLoading] = useState(false)
  const [benchmarkPreviewPage, setBenchmarkPreviewPage] = useState(1)
  const [benchmarkPreviewPageSize, setBenchmarkPreviewPageSize] = useState(20)
  const [evaluationHistory, setEvaluationHistory] = useState<KnowledgeEvaluationSummary[]>([])
  const [evaluationResult, setEvaluationResult] = useState<KnowledgeEvaluationResult | null>(null)
  const [graphLabel, setGraphLabel] = useState('*')
  const [graphDepth, setGraphDepth] = useState(2)
  const [graphMaxNodes, setGraphMaxNodes] = useState(50)
  const [activeTab, setActiveTab] = useState('query')
  const [selectedFileIds, setSelectedFileIds] = useState<string[]>([])
  const [fileSearch, setFileSearch] = useState('')
  const [workspaceLoading, setWorkspaceLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [queryLoading, setQueryLoading] = useState(false)
  const [graphLoading, setGraphLoading] = useState(false)
  const [mindmapLoading, setMindmapLoading] = useState(false)
  const [benchmarkLoading, setBenchmarkLoading] = useState(false)
  const [evaluationLoading, setEvaluationLoading] = useState(false)
  const [savingKb, setSavingKb] = useState(false)
  const [creatingKb, setCreatingKb] = useState(false)
  const [generatingDescription, setGeneratingDescription] = useState(false)
  const [parsingFiles, setParsingFiles] = useState(false)
  const [indexingFiles, setIndexingFiles] = useState(false)
  const [uploadingFiles, setUploadingFiles] = useState(false)
  const [uploadingBenchmark, setUploadingBenchmark] = useState(false)
  const [generatingBenchmark, setGeneratingBenchmark] = useState(false)
  const [runningEvaluation, setRunningEvaluation] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [createModalOpen, setCreateModalOpen] = useState(shouldOpenCreateModal)
  const [folderModalOpen, setFolderModalOpen] = useState(false)
  const [urlModalOpen, setUrlModalOpen] = useState(false)
  const [moveModalOpen, setMoveModalOpen] = useState(false)
  const [indexConfigOpen, setIndexConfigOpen] = useState(false)
  const [queryConfigOpen, setQueryConfigOpen] = useState(false)
  const [benchmarkGenerateOpen, setBenchmarkGenerateOpen] = useState(false)
  const [benchmarkUploadOpen, setBenchmarkUploadOpen] = useState(false)
  const [evaluationResultOpen, setEvaluationResultOpen] = useState(false)
  const [fileDetailOpen, setFileDetailOpen] = useState(false)
  const [settingsModalOpen, setSettingsModalOpen] = useState(false)
  const [rightPanelVisible, setRightPanelVisible] = useState(true)
  const [leftPanelWidth, setLeftPanelWidth] = useState(52)
  const [isResizingPanels, setIsResizingPanels] = useState(false)
  const [formState, setFormState] = useState<KnowledgeFormState>(() => createKnowledgeFormState())
  const [indexConfig, setIndexConfig] = useState<KnowledgeIndexConfigState>(() => createIndexConfigState())
  const [folderName, setFolderName] = useState('')
  const [folderParentId, setFolderParentId] = useState<string | null>(null)
  const [urlValue, setUrlValue] = useState('')
  const [urlParentId, setUrlParentId] = useState<string | null>(null)
  const [sourceMode, setSourceMode] = useState<'file' | 'web_url' | 'faq_table'>('file')
  const [sourceTitle, setSourceTitle] = useState('')
  const [selectedUploadFiles, setSelectedUploadFiles] = useState<File[]>([])
  const [autoIndexAfterAdd, setAutoIndexAfterAdd] = useState(false)
  const [faqItems, setFaqItems] = useState<Array<{ question: string; answer: string }>>([{ question: '', answer: '' }])
  const [moveTargetParentId, setMoveTargetParentId] = useState<string | null>(null)
  const [moveTargetName, setMoveTargetName] = useState('')
  const [benchmarkUploadFile, setBenchmarkUploadFile] = useState<File | null>(null)
  const [benchmarkName, setBenchmarkName] = useState('')
  const [benchmarkDescription, setBenchmarkDescription] = useState('')
  const [benchmarkCount, setBenchmarkCount] = useState(10)
  const [selectedBenchmarkId, setSelectedBenchmarkId] = useState<string | null>(null)
  const [evaluationErrorOnly, setEvaluationErrorOnly] = useState(false)
  const [queryParamSchema, setQueryParamSchema] = useState<KnowledgeQueryParamSchema | null>(null)
  const [fileDetailLoading, setFileDetailLoading] = useState(false)
  const [fileDetail, setFileDetail] = useState<KnowledgeFileDetail | null>(null)
  const [expandedFileIds, setExpandedFileIds] = useState<string[]>([])

  const deferredFileSearch = useDeferredValue(fileSearch)

  useEffect(() => {
    void loadKnowledgeBases()
  }, [])

  useEffect(() => {
    setCreateModalOpen(shouldOpenCreateModal)
  }, [shouldOpenCreateModal])

  useEffect(() => {
    if (!selectedKbId) {
      setCurrentKb(null)
      setFormState(createKnowledgeFormState())
      setIndexConfig(createIndexConfigState())
      setFilesState(createEmptyListState())
      setJobs([])
      setQueryParams(getDefaultQueryParams())
      setQueryResult(null)
      setSampleQuestions([])
      setMindmap(null)
      setGraphData(null)
      setGraphStats(null)
      setBenchmarks([])
      setBenchmarkPreview(null)
      setEvaluationHistory([])
      setEvaluationResult(null)
      setSelectedFileIds([])
      setExpandedFileIds([])
      setFileDetail(null)
      setFileDetailOpen(false)
      setSettingsModalOpen(false)
      setRightPanelVisible(true)
      setLeftPanelWidth(52)
      return
    }
    void loadKnowledgeDetail(selectedKbId)
  }, [selectedKbId])

  useEffect(() => {
    if (!isResizingPanels) {
      return undefined
    }
    const handleMove = (event: MouseEvent) => {
      const rect = detailGridRef.current?.getBoundingClientRect()
      if (!rect || rect.width <= 0) {
        return
      }
      const nextWidth = ((event.clientX - rect.left) / rect.width) * 100
      setLeftPanelWidth(Math.max(28, Math.min(72, nextWidth)))
      if (!rightPanelVisible) {
        setRightPanelVisible(true)
      }
    }
    const handleUp = () => setIsResizingPanels(false)
    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
    return () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
    }
  }, [isResizingPanels, rightPanelVisible])

  useEffect(() => {
    if (activeTab === 'graph' && currentKb) {
      void loadGraph(currentKb.kbId)
    }
  }, [activeTab, currentKb, graphDepth, graphMaxNodes])

  const fileTreeData = useMemo(
    () => buildKnowledgeTree(filesState.items, deferredFileSearch),
    [deferredFileSearch, filesState.items],
  )
  const searchExpandedFileIds = useMemo(
    () => collectExpandedFolderKeys(fileTreeData),
    [fileTreeData],
  )

  const folderOptions = useMemo(
    () => filesState.items.filter((item) => item.isFolder).map((item) => ({
      label: item.path,
      value: item.fileId,
    })),
    [filesState.items],
  )

  const selectedFiles = useMemo(
    () => filesState.items.filter((item) => selectedFileIds.includes(item.fileId)),
    [filesState.items, selectedFileIds],
  )
  const selectedDocumentIds = useMemo(
    () => selectedFiles.filter((item) => !item.isFolder).map((item) => item.fileId),
    [selectedFiles],
  )
  const parseableSelectedFileIds = useMemo(
    () => selectedFiles.filter((item) => !item.isFolder && canParseKnowledgeFile(item.status)).map((item) => item.fileId),
    [selectedFiles],
  )
  const indexableSelectedFileIds = useMemo(
    () => selectedFiles
      .filter((item) => !item.isFolder && canIndexKnowledgeFile(item.status, !isLightRagKnowledgeBase(currentKb)))
      .map((item) => item.fileId),
    [currentKb, selectedFiles],
  )
  const pendingParseFileIds = useMemo(
    () => filesState.items.filter((item) => !item.isFolder && item.status === 'uploaded').map((item) => item.fileId),
    [filesState.items],
  )
  const pendingIndexFileIds = useMemo(() => {
    const isLightRag = isLightRagKnowledgeBase(currentKb)
    return filesState.items
      .filter((item) => {
        if (item.isFolder) return false
        if (isLightRag) {
          return item.status === 'parsed'
        }
        return item.status === 'parsed' || item.status === 'error_indexing'
      })
      .map((item) => item.fileId)
  }, [currentKb, filesState.items])

  const hasSelectedFiles = selectedFiles.length > 0
  const canParseSelectedDocuments = parseableSelectedFileIds.length > 0
  const canIndexSelectedDocuments = indexableSelectedFileIds.length > 0
  const hasSingleSelection = selectedFiles.length === 1
  const supportsChunkConfig = isMilvusKnowledgeBase(currentKb)
  const supportsDescriptionGeneration = Boolean(formState.name.trim())
  const pendingParseCount = pendingParseFileIds.length
  const pendingIndexCount = pendingIndexFileIds.length
  const showListPage = !selectedKbId

  async function loadKnowledgeBases() {
    try {
      setWorkspaceLoading(true)
      const items = await api.getKnowledgeBases()
      setKnowledgeBases(items)
      setError(null)
    } catch (loadError) {
      setError(getErrorMessage(loadError, '加载知识库列表失败'))
    } finally {
      setWorkspaceLoading(false)
    }
  }

  async function loadKnowledgeDetail(nextKbId: string) {
    try {
      setDetailLoading(true)
      const [kb, filePayload, jobPayload, querySchemaPayload, questionPayload, graphStatsPayload] = await Promise.all([
        api.getKnowledgeBase(nextKbId),
        api.getKnowledgeFiles(nextKbId),
        api.getKnowledgeJobs(nextKbId),
        api.getKnowledgeQueryParamSchema(nextKbId).catch(() => null),
        api.getKnowledgeSampleQuestions(nextKbId).catch(() => ({ questions: [] })),
        api.getKnowledgeGraphStats(nextKbId).catch(() => null),
      ])
      setCurrentKb(kb)
      setFormState(createKnowledgeFormState(kb))
      setIndexConfig(createIndexConfigState(kb))
      setFilesState(filePayload)
      setJobs(jobPayload)
      const defaultQueryParams = getDefaultQueryParams(kb.kbType)
      setQueryParams({
        ...defaultQueryParams,
        ...(kb.queryParams || {}),
        options: {
          ...(defaultQueryParams.options || {}),
          ...(kb.queryParams?.options || {}),
        },
      })
      setQueryParamSchema(querySchemaPayload)
      setSampleQuestions(questionPayload.questions || [])
      setGraphStats(graphStatsPayload)
      try {
        const mapPayload = await api.getKnowledgeMindmap(nextKbId)
        setMindmap(mapPayload.mindmap)
      } catch {
        setMindmap(null)
      }
      setActiveTab((previous) => {
        const isSwitchingKb = currentKb?.kbId !== kb.kbId
        if (isLightRagKnowledgeBase(kb)) {
          if (isSwitchingKb) {
            return 'graph'
          }
          return previous === 'evaluation' || previous === 'benchmarks' ? 'graph' : previous || 'graph'
        }
        if (previous === 'graph') {
          return 'query'
        }
        return previous || 'query'
      })
      if (isMilvusKnowledgeBase(kb)) {
        await loadBenchmarkState(nextKbId)
      } else {
        setBenchmarks([])
        setBenchmarkPreview(null)
        setEvaluationHistory([])
        setEvaluationResult(null)
        if (activeTab === 'evaluation' || activeTab === 'benchmarks') {
          setActiveTab('query')
        }
      }
      setError(null)
      setSelectedFileIds([])
      setExpandedFileIds([])
      setSettingsModalOpen(false)
      setRightPanelVisible(true)
    } catch (loadError) {
      setError(getErrorMessage(loadError, '加载知识库详情失败'))
    } finally {
      setDetailLoading(false)
    }
  }

  async function refreshDetail() {
    await loadKnowledgeBases()
    if (currentKb) {
      await loadKnowledgeDetail(currentKb.kbId)
    }
  }

  async function loadBenchmarkState(targetKbId: string) {
    try {
      setBenchmarkLoading(true)
      const [benchmarkItems, evaluationItems] = await Promise.all([
        api.getKnowledgeBenchmarks(targetKbId),
        api.getKnowledgeEvaluationHistory(targetKbId),
      ])
      setBenchmarks(benchmarkItems)
      setEvaluationHistory(evaluationItems)
      setSelectedBenchmarkId((previous) => previous || benchmarkItems[0]?.benchmarkId || null)
    } catch (loadError) {
      message.error(getErrorMessage(loadError, '加载评测数据失败'))
    } finally {
      setBenchmarkLoading(false)
    }
  }

  async function handleCreateKnowledgeBase() {
    try {
      setCreatingKb(true)
      const created = await api.createKnowledgeBase({
        name: formState.name.trim(),
        description: formState.description.trim(),
        enabled: formState.enabled,
        kbType: formState.kbType,
        embedInfo: { modelName: formState.embedModelName.trim() || null },
        llmInfo: { modelName: formState.llmModelName.trim() || null },
        additionalParams: {
          language: formState.language,
          chunk_preset_id: formState.chunkPresetId,
          auto_generate_questions: formState.autoGenerateQuestions,
          qa_separator: formState.qaSeparator.trim(),
        },
        tags: parseTags(formState.tagsText),
      })
      message.success('知识库已创建')
      setCreateModalOpen(false)
      setFormState(createKnowledgeFormState())
      setIndexConfig(createIndexConfigState())
      await loadKnowledgeBases()
      startTransition(() => navigate(`/knowledge/${created.kbId}`))
    } catch (createError) {
      message.error(getErrorMessage(createError, '创建知识库失败'))
    } finally {
      setCreatingKb(false)
    }
  }

  async function handleSaveKnowledgeBase() {
    if (!currentKb) return
    try {
      setSavingKb(true)
      const updated = await api.updateKnowledgeBase(currentKb.kbId, {
        name: formState.name.trim(),
        description: formState.description.trim(),
        enabled: formState.enabled,
        kbType: formState.kbType,
        embedInfo: { modelName: formState.embedModelName.trim() || null },
        llmInfo: { modelName: formState.llmModelName.trim() || null },
        additionalParams: {
          language: formState.language,
          chunk_preset_id: formState.chunkPresetId,
          auto_generate_questions: formState.autoGenerateQuestions,
          qa_separator: formState.qaSeparator.trim(),
        },
        tags: parseTags(formState.tagsText),
      })
      setCurrentKb(updated)
      message.success('知识库设置已保存')
      await loadKnowledgeBases()
    } catch (saveError) {
      message.error(getErrorMessage(saveError, '保存知识库设置失败'))
    } finally {
      setSavingKb(false)
    }
  }

  async function handleDeleteKnowledgeBase() {
    if (!currentKb) return
    Modal.confirm({
      title: `删除知识库「${currentKb.name}」`,
      content: '这会移除当前知识库的文件、索引和图谱数据，且不可恢复。',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        await api.deleteKnowledgeBase(currentKb.kbId)
        await loadKnowledgeBases()
        startTransition(() => navigate('/knowledge'))
        message.success('知识库已删除')
      },
    })
  }

  async function handleGenerateDescription() {
    if (!formState.name.trim()) {
      message.warning('请先填写知识库名称')
      return
    }
    try {
      setGeneratingDescription(true)
      const payload = await api.generateKnowledgeBaseDescription({
        kbId: currentKb?.kbId,
        name: formState.name.trim(),
        currentDescription: formState.description.trim(),
        fileList: filesState.items.filter((item) => !item.isFolder).map((item) => item.path),
      })
      setFormState((prev) => ({ ...prev, description: payload.description || prev.description }))
      message.success('描述已生成')
    } catch (descriptionError) {
      message.error(getErrorMessage(descriptionError, '生成知识库描述失败'))
    } finally {
      setGeneratingDescription(false)
    }
  }

  function resetAddFilesModal() {
    setUrlModalOpen(false)
    setSourceMode('file')
    setUrlValue('')
    setUrlParentId(null)
    setSourceTitle('')
    setSelectedUploadFiles([])
    setAutoIndexAfterAdd(false)
    setFaqItems([{ question: '', answer: '' }])
    if (uploadInputRef.current) {
      uploadInputRef.current.value = ''
    }
  }

  function triggerUpload() {
    uploadInputRef.current?.click()
  }

  function handleUploadChange(event: React.ChangeEvent<HTMLInputElement>) {
    const { files } = event.target
    setSelectedUploadFiles(files ? Array.from(files) : [])
  }

  async function waitForJobCompletion(kbIdValue: string, jobId: string, label: string) {
    for (let attempt = 0; attempt < 900; attempt += 1) {
      const items = await api.getKnowledgeJobs(kbIdValue)
      const current = items.find((item) => item.jobId === jobId)
      if (current?.status === 'succeeded') {
        return current
      }
      if (current?.status === 'failed') {
        throw new Error(`${label}任务失败`)
      }
      await sleep(500)
    }
    throw new Error(`${label}任务超时`)
  }

  async function maybeAutoIndexFiles(kbIdValue: string, fileIds: string[]) {
    if (!autoIndexAfterAdd || fileIds.length === 0) {
      return
    }
    const parsePayload = await api.parseKnowledgeFiles(kbIdValue, { fileIds })
    await waitForJobCompletion(kbIdValue, parsePayload.job.jobId, '解析')
    const indexPayload = await api.indexKnowledgeFiles(kbIdValue, {
      fileIds,
      params: supportsChunkConfig
        ? {
            chunkSize: indexConfig.chunkSize,
            chunkOverlap: indexConfig.chunkOverlap,
            chunkPresetId: indexConfig.chunkPresetId,
            qaSeparator: indexConfig.qaSeparator.trim() || undefined,
          }
        : {
            chunkPresetId: indexConfig.chunkPresetId,
          },
    })
    await waitForJobCompletion(kbIdValue, indexPayload.job.jobId, '入库')
  }

  async function handleSubmitAddFiles() {
    if (!currentKb) return
    const targetParentId = urlParentId || (hasSingleSelection && selectedFiles[0].isFolder ? selectedFiles[0].fileId : null)
    try {
      setUploadingFiles(true)
      let fileIds: string[] = []
      if (sourceMode === 'file') {
        if (selectedUploadFiles.length === 0) {
          message.warning('请先选择要上传的文件')
          return
        }
        const formData = new FormData()
        for (const file of selectedUploadFiles) {
          formData.append('file', file)
        }
        if (targetParentId) {
          formData.append('parentId', targetParentId)
        }
        const uploaded = await api.uploadKnowledgeFiles(currentKb.kbId, formData)
        fileIds = uploaded.items.filter((item) => !item.isFolder).map((item) => item.fileId)
      } else if (sourceMode === 'web_url') {
        if (!urlValue.trim()) {
          message.warning('请先输入 URL')
          return
        }
        const created = await api.addKnowledgeSource(currentKb.kbId, {
          sourceType: 'web_url',
          url: urlValue.trim(),
          title: sourceTitle.trim() || undefined,
          parentId: targetParentId,
        })
        fileIds = created.isFolder ? [] : [created.fileId]
      } else {
        const items = faqItems
          .map((item) => ({
            question: item.question.trim(),
            answer: item.answer.trim(),
          }))
          .filter((item) => item.question && item.answer)
        if (items.length === 0) {
          message.warning('请至少填写一条 FAQ 问答')
          return
        }
        const created = await api.addKnowledgeSource(currentKb.kbId, {
          sourceType: 'faq_table',
          title: sourceTitle.trim() || 'faq-table',
          parentId: targetParentId,
          items,
        })
        fileIds = created.isFolder ? [] : [created.fileId]
      }

      if (autoIndexAfterAdd && fileIds.length > 0) {
        await maybeAutoIndexFiles(currentKb.kbId, fileIds)
        message.success('内容已添加并自动入库')
      } else {
        message.success(sourceMode === 'file' ? '文件已添加' : '知识源已添加')
      }
      resetAddFilesModal()
      await loadKnowledgeDetail(currentKb.kbId)
      await loadKnowledgeBases()
    } catch (uploadError) {
      message.error(getErrorMessage(uploadError, '添加内容失败'))
    } finally {
      setUploadingFiles(false)
    }
  }

  async function handleCreateFolder() {
    if (!currentKb || !folderName.trim()) return
    try {
      await api.createKnowledgeFolder(currentKb.kbId, {
        name: folderName.trim(),
        parentId: folderParentId,
      })
      message.success('文件夹已创建')
      setFolderModalOpen(false)
      setFolderName('')
      setFolderParentId(null)
      await loadKnowledgeDetail(currentKb.kbId)
      await loadKnowledgeBases()
    } catch (folderError) {
      message.error(getErrorMessage(folderError, '创建文件夹失败'))
    }
  }

  async function handleParseSelected(targetFileIds: string[] = parseableSelectedFileIds, notifySkipped = true) {
    if (!currentKb) return
    if (targetFileIds.length === 0) {
      message.warning('请先选择要解析的文件')
      return
    }
    if (notifySkipped && selectedDocumentIds.length > targetFileIds.length) {
      message.warning('已跳过不可解析的文件，仅提交待解析或解析失败的文件')
    }
    try {
      setParsingFiles(true)
      await api.parseKnowledgeFiles(currentKb.kbId, { fileIds: targetFileIds })
      message.success('解析任务已提交')
      await loadKnowledgeDetail(currentKb.kbId)
    } catch (parseError) {
      message.error(getErrorMessage(parseError, '提交解析任务失败'))
    } finally {
      setParsingFiles(false)
    }
  }

  async function handleIndexSelected(targetFileIds: string[] = indexableSelectedFileIds, notifySkipped = true) {
    if (!currentKb) return
    if (targetFileIds.length === 0) {
      message.warning('请先选择要入库的文件')
      return
    }
    if (notifySkipped && selectedDocumentIds.length > targetFileIds.length) {
      message.warning('已跳过不可入库的文件，仅提交已解析或入库失败的文件')
    }
    try {
      setIndexingFiles(true)
      await api.indexKnowledgeFiles(currentKb.kbId, {
        fileIds: targetFileIds,
        params: supportsChunkConfig
          ? {
              chunkSize: indexConfig.chunkSize,
              chunkOverlap: indexConfig.chunkOverlap,
              chunkPresetId: indexConfig.chunkPresetId,
              qaSeparator: indexConfig.qaSeparator.trim() || undefined,
            }
          : {
              chunkPresetId: indexConfig.chunkPresetId,
            },
      })
      message.success('索引任务已提交')
      await loadKnowledgeDetail(currentKb.kbId)
      await loadKnowledgeBases()
    } catch (indexError) {
      message.error(getErrorMessage(indexError, '提交索引任务失败'))
    } finally {
      setIndexingFiles(false)
    }
  }

  async function handleDeleteSelectedFiles(targets: KnowledgeDocument[] = selectedFiles) {
    if (!currentKb || targets.length === 0) return
    Modal.confirm({
      title: `删除 ${targets.length} 个条目`,
      content: '文件夹会连同其子文件一起删除，已建立的知识索引也会一起移除。',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        await api.deleteKnowledgeFiles(currentKb.kbId, targets.map((item) => item.fileId))
        setSelectedFileIds([])
        await loadKnowledgeDetail(currentKb.kbId)
        await loadKnowledgeBases()
        message.success('已删除所选条目')
      },
    })
  }

  async function handleMoveSelectedFile() {
    if (!currentKb || !hasSingleSelection) return
    const target = selectedFiles[0]
    try {
      await api.moveKnowledgeFile(currentKb.kbId, {
        fileId: target.fileId,
        targetParentId: moveTargetParentId,
        filename: moveTargetName.trim() || target.filename,
      })
      setMoveModalOpen(false)
      setMoveTargetParentId(null)
      setMoveTargetName('')
      await loadKnowledgeDetail(currentKb.kbId)
      message.success('文件位置已更新')
    } catch (moveError) {
      message.error(getErrorMessage(moveError, '移动文件失败'))
    }
  }

  function openMoveModal() {
    if (!hasSingleSelection) return
    setMoveTargetParentId(selectedFiles[0].parentId || null)
    setMoveTargetName(selectedFiles[0].filename)
    setMoveModalOpen(true)
  }

  function toggleRightPanel() {
    setRightPanelVisible((previous) => !previous)
  }

  async function handleOpenFileDetail(target: KnowledgeDocument) {
    if (!currentKb || target.isFolder) return
    try {
      setFileDetailOpen(true)
      setFileDetailLoading(true)
      const detail = await api.getKnowledgeFileDetail(currentKb.kbId, target.fileId)
      setFileDetail(detail)
    } catch (detailError) {
      setFileDetailOpen(false)
      setFileDetail(null)
      message.error(getErrorMessage(detailError, '加载文件详情失败'))
    } finally {
      setFileDetailLoading(false)
    }
  }

  function updateQueryOption(key: string, value: unknown) {
    setQueryParams((prev) => ({
      ...prev,
      options: {
        ...(prev.options || {}),
        [key]: value,
      },
    }))
  }

  function getQueryConfigValue(key: string): unknown {
    switch (key) {
      case 'mode':
        return queryParams.mode
      case 'topK':
        return queryParams.topK
      case 'chunkTopK':
        return queryParams.chunkTopK
      case 'responseType':
        return queryParams.responseType
      case 'onlyNeedContext':
        return queryParams.onlyNeedContext
      case 'onlyNeedPrompt':
        return queryParams.onlyNeedPrompt
      case 'enableRerank':
        return queryParams.enableRerank
      default:
        return queryParams.options?.[key]
    }
  }

  function setQueryConfigValue(key: string, value: unknown) {
    switch (key) {
      case 'mode':
        setQueryParams((prev) => ({ ...prev, mode: String(value || prev.mode) }))
        return
      case 'topK':
        setQueryParams((prev) => ({ ...prev, topK: Number(value || prev.topK || 10) }))
        return
      case 'chunkTopK':
        setQueryParams((prev) => ({ ...prev, chunkTopK: Number(value || prev.chunkTopK || 12) }))
        return
      case 'responseType':
        setQueryParams((prev) => ({ ...prev, responseType: String(value || prev.responseType) }))
        return
      case 'onlyNeedContext':
        setQueryParams((prev) => ({ ...prev, onlyNeedContext: Boolean(value) }))
        return
      case 'onlyNeedPrompt':
        setQueryParams((prev) => ({ ...prev, onlyNeedPrompt: Boolean(value) }))
        return
      case 'enableRerank':
        setQueryParams((prev) => ({ ...prev, enableRerank: Boolean(value) }))
        return
      default:
        updateQueryOption(key, value)
    }
  }

  async function handleQuery(nextQuery?: string) {
    const query = (nextQuery ?? queryText).trim()
    if (!currentKb || !query) return
    try {
      setQueryLoading(true)
      const result = await api.queryKnowledgeBase(currentKb.kbId, {
        query,
        mode: queryParams.mode,
        topK: queryParams.topK,
        chunkTopK: queryParams.chunkTopK,
        enableRerank: queryParams.enableRerank,
        ...queryParams.options,
      })
      setQueryResult(result)
    } catch (queryError) {
      message.error(getErrorMessage(queryError, '知识库查询失败'))
    } finally {
      setQueryLoading(false)
    }
  }

  async function handleSaveQueryDefaults() {
    if (!currentKb) return
    try {
      const next = await api.updateKnowledgeQueryParams(currentKb.kbId, queryParams)
      setQueryParams(next)
      message.success('默认检索参数已保存')
    } catch (saveError) {
      message.error(getErrorMessage(saveError, '保存检索参数失败'))
    }
  }

  async function handleGenerateQuestions() {
    if (!currentKb) return
    try {
      const payload = await api.generateKnowledgeSampleQuestions(currentKb.kbId, 10)
      setSampleQuestions(payload.questions || [])
      message.success('示例问题已生成')
    } catch (generateError) {
      message.error(getErrorMessage(generateError, '生成示例问题失败'))
    }
  }

  async function handleGenerateMindmap() {
    if (!currentKb) return
    try {
      setMindmapLoading(true)
      const payload = await api.generateKnowledgeMindmap(currentKb.kbId)
      setMindmap(payload.mindmap)
      message.success('知识导图已生成')
    } catch (generateError) {
      message.error(getErrorMessage(generateError, '生成知识导图失败'))
    } finally {
      setMindmapLoading(false)
    }
  }

  async function loadGraph(targetKbId: string) {
    try {
      setGraphLoading(true)
      const [graph, stats] = await Promise.all([
        api.getKnowledgeGraph(targetKbId, {
          nodeLabel: graphLabel,
          maxDepth: graphDepth,
          maxNodes: graphMaxNodes,
        }),
        api.getKnowledgeGraphStats(targetKbId).catch(() => null),
      ])
      setGraphData(graph)
      setGraphStats(stats)
    } catch (graphError) {
      message.error(getErrorMessage(graphError, '加载知识图谱失败'))
    } finally {
      setGraphLoading(false)
    }
  }

  async function handleUploadBenchmark() {
    if (!currentKb || !benchmarkUploadFile) return
    try {
      setUploadingBenchmark(true)
      await api.uploadKnowledgeBenchmark(currentKb.kbId, {
        file: benchmarkUploadFile,
        name: benchmarkName.trim() || benchmarkUploadFile.name.replace(/\.jsonl$/i, ''),
        description: benchmarkDescription.trim(),
      })
      message.success('评估基准已上传')
      setBenchmarkUploadOpen(false)
      setBenchmarkUploadFile(null)
      setBenchmarkName('')
      setBenchmarkDescription('')
      await loadBenchmarkState(currentKb.kbId)
    } catch (uploadError) {
      message.error(getErrorMessage(uploadError, '上传评估基准失败'))
    } finally {
      setUploadingBenchmark(false)
    }
  }

  async function handleGenerateBenchmark() {
    if (!currentKb) return
    try {
      setGeneratingBenchmark(true)
      await api.generateKnowledgeBenchmark(currentKb.kbId, {
        count: benchmarkCount,
        name: benchmarkName.trim() || '自动生成评估基准',
        description: benchmarkDescription.trim(),
      })
      message.success('评估基准已生成')
      setBenchmarkGenerateOpen(false)
      setBenchmarkName('')
      setBenchmarkDescription('')
      setBenchmarkCount(10)
      await loadBenchmarkState(currentKb.kbId)
    } catch (generateError) {
      message.error(getErrorMessage(generateError, '生成评估基准失败'))
    } finally {
      setGeneratingBenchmark(false)
    }
  }

  async function handlePreviewBenchmark(benchmark: KnowledgeBenchmark, page = 1, pageSize = 20) {
    if (!currentKb) return
    try {
      setBenchmarkPreviewLoading(true)
      setBenchmarkPreviewPage(page)
      setBenchmarkPreviewPageSize(pageSize)
      const detail = await api.getKnowledgeBenchmarkDetail(currentKb.kbId, benchmark.benchmarkId, page, pageSize)
      setBenchmarkPreview(detail)
    } catch (previewError) {
      message.error(getErrorMessage(previewError, '加载评估基准详情失败'))
    } finally {
      setBenchmarkPreviewLoading(false)
    }
  }

  function handleDeleteBenchmark(benchmark: KnowledgeBenchmark) {
    if (!currentKb) return
    Modal.confirm({
      title: `删除评估基准「${benchmark.name}」`,
      content: '删除后该基准及其下载文件不可恢复。',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        await api.deleteKnowledgeBenchmark(currentKb.kbId, benchmark.benchmarkId)
        await loadBenchmarkState(currentKb.kbId)
        message.success('评估基准已删除')
      },
    })
  }

  async function handleRunEvaluation() {
    if (!currentKb || !selectedBenchmarkId) return
    try {
      setRunningEvaluation(true)
      const payload = await api.runKnowledgeEvaluation(currentKb.kbId, {
        benchmarkId: selectedBenchmarkId,
      })
      message.success(`评测任务已启动：${payload.taskId}`)
      await loadBenchmarkState(currentKb.kbId)
    } catch (runError) {
      message.error(getErrorMessage(runError, '启动评测失败'))
    } finally {
      setRunningEvaluation(false)
    }
  }

  async function handleViewEvaluationResult(taskId: string, errorOnly = false) {
    if (!currentKb) return
    try {
      setEvaluationLoading(true)
      const result = await api.getKnowledgeEvaluationResult(currentKb.kbId, taskId, {
        page: 1,
        pageSize: 20,
        errorOnly,
      })
      setEvaluationResult(result)
      setEvaluationErrorOnly(errorOnly)
      setEvaluationResultOpen(true)
    } catch (viewError) {
      message.error(getErrorMessage(viewError, '加载评测结果失败'))
    } finally {
      setEvaluationLoading(false)
    }
  }

  function handleDeleteEvaluationResult(taskId: string) {
    if (!currentKb) return
    Modal.confirm({
      title: '删除评测结果',
      content: '删除后历史记录不可恢复。',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        await api.deleteKnowledgeEvaluationResult(currentKb.kbId, taskId)
        await loadBenchmarkState(currentKb.kbId)
        if (evaluationResult?.taskId === taskId) {
          setEvaluationResult(null)
          setEvaluationResultOpen(false)
        }
        message.success('评测结果已删除')
      },
    })
  }

  const fileColumns: ColumnsType<KnowledgeTreeNode> = [
    {
      title: '名称',
      dataIndex: 'filename',
      key: 'filename',
      render: (_value, record) => (
        <div className="knowledge-file-cell">
          <span className={`knowledge-file-kind ${record.isFolder ? 'is-folder' : 'is-file'}`}>
            {record.isFolder ? 'DIR' : 'DOC'}
          </span>
          {record.isFolder ? (
            <Text>{record.filename}</Text>
          ) : (
            <button
              type="button"
              className="knowledge-file-link"
              onClick={() => void handleOpenFileDetail(record)}
            >
              {record.filename}
            </button>
          )}
        </div>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 120,
      render: (value: string) => <Tag color={statusColor(value)}>{statusLabel(value)}</Tag>,
    },
    {
      title: '类型',
      dataIndex: 'fileType',
      key: 'fileType',
      width: 120,
    },
    {
      title: '路径',
      dataIndex: 'path',
      key: 'path',
      ellipsis: true,
      render: (value: string) => <Text type="secondary">{value}</Text>,
    },
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      key: 'updatedAt',
      width: 160,
      render: (value?: string) => (value ? formatDateTimeZh(value) : '--'),
    },
    {
      title: '操作',
      key: 'actions',
      width: 180,
      render: (_value, record) => (
        <Space size={4}>
          {!record.isFolder ? (
            <>
              <Button
                size="small"
                icon={<FileSearchOutlined />}
                onClick={() => void handleOpenFileDetail(record)}
              />
              <Button
                size="small"
                icon={<DownloadOutlined />}
                onClick={() => window.open(api.downloadKnowledgeFileUrl(currentKb?.kbId || '', record.fileId, 'raw'), '_blank', 'noopener')}
              />
              {record.markdownFile ? (
                <Button
                  size="small"
                  icon={<FileSearchOutlined />}
                  onClick={() => window.open(api.downloadKnowledgeFileUrl(currentKb?.kbId || '', record.fileId, 'parsed'), '_blank', 'noopener')}
                />
              ) : null}
            </>
          ) : null}
          <Button
            size="small"
            danger
            icon={<DeleteOutlined />}
            disabled={!record.isFolder && !canDeleteKnowledgeFile(record.status)}
            onClick={() => void handleDeleteSelectedFiles([record])}
          />
        </Space>
      ),
    },
  ]

  const supportsGraph = isLightRagKnowledgeBase(currentKb)
  const supportsEvaluation = isMilvusKnowledgeBase(currentKb)

  const benchmarkColumns: ColumnsType<KnowledgeBenchmark> = [
    {
      title: '名称',
      dataIndex: 'name',
      key: 'name',
      render: (value: string, record) => (
        <div>
          <Text strong>{value}</Text>
          <div>
            <Text type="secondary">{record.description || '暂无描述'}</Text>
          </div>
        </div>
      ),
    },
    {
      title: '问题数',
      key: 'questionCount',
      width: 100,
      render: (_value, record) => record.questionCount || record.question_count || 0,
    },
    {
      title: '类型',
      key: 'flags',
      width: 180,
      render: (_value, record) => (
        <Space wrap size={4}>
          <Tag color={(record.hasGoldChunks || record.has_gold_chunks) ? 'blue' : 'default'}>检索黄金集</Tag>
          <Tag color={(record.hasGoldAnswers || record.has_gold_answers) ? 'green' : 'default'}>标准答案</Tag>
        </Space>
      ),
    },
    {
      title: '更新时间',
      key: 'updatedAt',
      width: 160,
      render: (_value, record) => {
        const value = record.updatedAt || record.updated_at || record.createdAt || record.created_at
        return value ? formatDateTimeZh(value) : '--'
      },
    },
    {
      title: '操作',
      key: 'actions',
      width: 220,
      render: (_value, record) => (
        <Space size={4}>
          <Button size="small" onClick={() => void handlePreviewBenchmark(record)}>预览</Button>
          <Button
            size="small"
            icon={<DownloadOutlined />}
            onClick={() => currentKb && window.open(api.downloadKnowledgeBenchmarkUrl(currentKb.kbId, record.benchmarkId), '_blank', 'noopener')}
          />
          <Button size="small" danger icon={<DeleteOutlined />} onClick={() => handleDeleteBenchmark(record)} />
        </Space>
      ),
    },
  ]

  const evaluationColumns: ColumnsType<KnowledgeEvaluationSummary> = [
    {
      title: '任务 ID',
      key: 'taskId',
      render: (_value, record) => <Text code>{record.taskId}</Text>,
    },
    {
      title: '基准',
      key: 'benchmarkId',
      render: (_value, record) => record.benchmarkId,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 120,
      render: (value: string) => <Tag color={statusColor(value)}>{statusLabel(value)}</Tag>,
    },
    {
      title: '总体评分',
      key: 'overallScore',
      width: 120,
      render: (_value, record) => formatScorePercent(record.overallScore ?? record.overall_score),
    },
    {
      title: '进度',
      key: 'progress',
      width: 120,
      render: (_value, record) => `${record.completedQuestions || record.completed_questions || 0}/${record.totalQuestions || record.total_questions || 0}`,
    },
    {
      title: '更新时间',
      key: 'updatedAt',
      width: 160,
      render: (_value, record) => {
        const value = record.updatedAt || record.updated_at || record.createdAt || record.created_at
        return value ? formatDateTimeZh(value) : '--'
      },
    },
    {
      title: '操作',
      key: 'actions',
      width: 180,
      render: (_value, record) => (
        <Space size={4}>
          <Button size="small" onClick={() => void handleViewEvaluationResult(record.taskId)}>
            查看
          </Button>
          <Button size="small" danger onClick={() => handleDeleteEvaluationResult(record.taskId)}>
            删除
          </Button>
        </Space>
      ),
    },
  ]

  const evaluationDetailColumns: ColumnsType<KnowledgeEvaluationResult['details'][number]> = [
    {
      title: '问题',
      dataIndex: 'query',
      key: 'query',
      render: (value: string) => <Paragraph style={{ marginBottom: 0 }}>{value}</Paragraph>,
    },
    {
      title: '答案评分',
      key: 'score',
      width: 120,
      render: (_value, record) => formatScorePercent(Number(record.metrics?.score ?? 0)),
    },
    {
      title: 'Recall@1',
      key: 'recall1',
      width: 120,
      render: (_value, record) => formatScorePercent(Number(record.metrics?.['recall@1'] ?? 0)),
    },
    {
      title: '生成答案',
      key: 'generatedAnswer',
      render: (_value, record) => (
        <Paragraph ellipsis={{ rows: 3 }} style={{ marginBottom: 0 }}>
          {record.generatedAnswer || record.generated_answer || '--'}
        </Paragraph>
      ),
    },
  ]

  const tabItems = [
    {
      key: 'query',
      label: '检索测试',
      children: (
        <KnowledgeQueryTab
          supportsEvaluation={supportsEvaluation}
          queryParams={queryParams}
          queryText={queryText}
          queryLoading={queryLoading}
          queryResult={queryResult}
          resultView={resultView}
          sampleQuestions={sampleQuestions}
          onModeChange={(value) =>
            setQueryParams((prev) => ({
              ...prev,
              mode: value,
              options: supportsEvaluation
                ? {
                    ...(prev.options || {}),
                    search_mode: value,
                  }
                : prev.options,
            }))
          }
          onTopKChange={(value) => setQueryParams((prev) => ({ ...prev, topK: value }))}
          onChunkTopKChange={(value) => setQueryParams((prev) => ({ ...prev, chunkTopK: value }))}
          onSearchModeChange={(value) => updateQueryOption('search_mode', value)}
          onSimilarityThresholdChange={(value) => updateQueryOption('similarity_threshold', value)}
          onEnableRerankChange={(checked) => setQueryParams((prev) => ({ ...prev, enableRerank: checked }))}
          onSaveQueryDefaults={() => void handleSaveQueryDefaults()}
          onGenerateQuestions={() => void handleGenerateQuestions()}
          onOpenQueryConfig={() => setQueryConfigOpen(true)}
          onResultViewChange={setResultView}
          onQueryTextChange={setQueryText}
          onQuery={(query) => void handleQuery(query)}
        />
      ),
    },
    ...(supportsGraph
      ? [
          {
            key: 'graph',
            label: '知识图谱',
            children: (
              <KnowledgeGraphTab
                graphLabel={graphLabel}
                graphDepth={graphDepth}
                graphMaxNodes={graphMaxNodes}
                graphLoading={graphLoading}
                graphData={graphData}
                graphStats={graphStats}
                onGraphLabelChange={setGraphLabel}
                onGraphDepthChange={setGraphDepth}
                onGraphMaxNodesChange={setGraphMaxNodes}
                onReload={() => currentKb && void loadGraph(currentKb.kbId)}
              />
            ),
          },
        ]
      : []),
    {
      key: 'mindmap',
      label: '知识导图',
      children: (
        <KnowledgeMindmapTab
          mindmapLoading={mindmapLoading}
          mindmap={mindmap}
          onRegenerate={() => void handleGenerateMindmap()}
        />
      ),
    },
    {
      key: 'evaluation',
      label: supportsEvaluation ? (
        'RAG 评测'
      ) : (
        <Tooltip title="仅支持 Milvus 类型的知识库">
          <Space size={4}>
            <span>RAG 评测</span>
            <InfoCircleOutlined />
          </Space>
        </Tooltip>
      ),
      disabled: !supportsEvaluation,
      children: (
        <KnowledgeEvaluationTab
          selectedBenchmarkId={selectedBenchmarkId}
          benchmarks={benchmarks}
          runningEvaluation={runningEvaluation}
          benchmarkLoading={benchmarkLoading}
          evaluationHistory={evaluationHistory}
          columns={evaluationColumns}
          onBenchmarkChange={setSelectedBenchmarkId}
          onRun={() => void handleRunEvaluation()}
          onRefresh={() => currentKb && void loadBenchmarkState(currentKb.kbId)}
        />
      ),
    },
    {
      key: 'benchmarks',
      label: supportsEvaluation ? (
        '评估基准'
      ) : (
        <Tooltip title="仅支持 Milvus 类型的知识库">
          <Space size={4}>
            <span>评估基准</span>
            <InfoCircleOutlined />
          </Space>
        </Tooltip>
      ),
      disabled: !supportsEvaluation,
      children: (
        <KnowledgeBenchmarksTab
          benchmarkLoading={benchmarkLoading}
          benchmarks={benchmarks}
          columns={benchmarkColumns}
          onOpenGenerate={() => {
            setBenchmarkName('自动生成评估基准')
            setBenchmarkDescription('')
            setBenchmarkCount(10)
            setBenchmarkGenerateOpen(true)
          }}
          onOpenUpload={() => setBenchmarkUploadOpen(true)}
          onRefresh={() => currentKb && void loadBenchmarkState(currentKb.kbId)}
        />
      ),
    },
  ]

  return (
    <div className="knowledge-workspace-page">
      <motion.div
        className={showListPage ? 'knowledge-list-shell' : 'knowledge-detail-shell'}
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28 }}
      >
        {showListPage ? (
          <>
            <div className="knowledge-page-hero">
              <div>
                <Title level={3} style={{ margin: 0 }}>文档知识库</Title>
                <Paragraph type="secondary" style={{ margin: '8px 0 0' }}>
                  参考 Yuxi-Know 的知识库列表页，先选库，再进入详情工作台处理文件、检索、图谱和评测。
                </Paragraph>
              </div>
              <Space>
                <Button icon={<ReloadOutlined />} onClick={() => void loadKnowledgeBases()} />
                <Button
                  type="primary"
                  icon={<PlusOutlined />}
                  onClick={() => {
                    setFormState(createKnowledgeFormState())
                    setIndexConfig(createIndexConfigState())
                    startTransition(() => navigate('/knowledge/new'))
                  }}
                >
                  新建知识库
                </Button>
              </Space>
            </div>

            {error ? <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} /> : null}

            <Card className="knowledge-sidebar-card" bodyStyle={{ padding: 0 }}>
              <div className="knowledge-sidebar-header">
                <Text strong>知识库列表</Text>
                <Tag>{knowledgeBases.length}</Tag>
              </div>
              {workspaceLoading ? (
                <div className="knowledge-loading-panel"><Spin /></div>
              ) : knowledgeBases.length === 0 ? (
                <div className="knowledge-loading-panel">
                  <Empty description="还没有知识库" />
                </div>
              ) : (
                <div className="knowledge-card-grid">
                  {knowledgeBases.map((item) => (
                    <motion.button
                      key={item.kbId}
                      type="button"
                      className="knowledge-sidebar-item"
                      whileHover={{ y: -2 }}
                      onClick={() => startTransition(() => navigate(`/knowledge/${item.kbId}`))}
                    >
                      <div className="knowledge-sidebar-item-top">
                        <Text strong>{item.name}</Text>
                        <Tag color={item.enabled ? 'green' : 'default'}>{item.kbType}</Tag>
                      </div>
                      <Paragraph ellipsis={{ rows: 2 }} type="secondary" style={{ marginBottom: 8 }}>
                        {item.description || '暂无描述'}
                      </Paragraph>
                      <Text type="secondary">{formatStats(item.stats)}</Text>
                    </motion.button>
                  ))}
                </div>
              )}
            </Card>
          </>
        ) : (
          <div className="knowledge-detail-panel is-full">
            {error ? (
              <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />
            ) : null}
            {detailLoading ? (
              <div className="knowledge-loading-panel is-large"><Spin size="large" /></div>
            ) : !currentKb ? (
              <Card className="knowledge-empty-card">
                <Empty
                  description="知识库不存在，或者尚未加载完成。"
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                />
              </Card>
            ) : (
              <>
                <Card className="knowledge-summary-card">
                  <div className="knowledge-summary-main">
                    <div>
                      <Space align="center" size={10} style={{ marginBottom: 8 }}>
                        <Button size="small" onClick={() => startTransition(() => navigate('/knowledge'))}>
                          返回列表
                        </Button>
                        <Tag color={currentKb.enabled ? 'green' : 'default'}>{currentKb.kbType}</Tag>
                      </Space>
                      <div className="knowledge-summary-title">
                        <Title level={3} style={{ margin: 0 }}>{currentKb.name}</Title>
                      </div>
                      <Paragraph type="secondary" style={{ marginBottom: 0 }}>
                        {currentKb.description || '当前知识库还没有描述。'}
                      </Paragraph>
                    </div>
                    <Space>
                      <Button icon={<ReloadOutlined />} onClick={() => void loadKnowledgeDetail(currentKb.kbId)} />
                      <Button icon={<EditOutlined />} onClick={() => setSettingsModalOpen(true)}>设置</Button>
                      <Button danger icon={<DeleteOutlined />} onClick={handleDeleteKnowledgeBase}>删除</Button>
                    </Space>
                  </div>
                  <div className="knowledge-stat-grid">
                    <Statistic title="文件数" value={filesState.stats.fileCount} />
                    <Statistic title="已索引" value={filesState.stats.indexedCount} />
                    <Statistic title="文件夹" value={filesState.stats.folderCount} />
                    <Statistic title="异常" value={filesState.stats.errorCount} />
                  </div>
                </Card>

                {pendingParseCount > 0 || pendingIndexCount > 0 ? (
                  <Card className="knowledge-summary-card knowledge-pending-card">
                    <Space wrap>
                      {pendingParseCount > 0 ? (
                        <Button type="link" icon={<FileSearchOutlined />} onClick={() => void handleParseSelected(pendingParseFileIds, false)}>
                          {pendingParseCount} 个文件待解析
                        </Button>
                      ) : null}
                      {pendingIndexCount > 0 ? (
                        <Button type="link" icon={<BranchesOutlined />} onClick={() => void handleIndexSelected(pendingIndexFileIds, false)}>
                          {pendingIndexCount} 个文件待入库
                        </Button>
                      ) : null}
                    </Space>
                  </Card>
                ) : null}

                <div ref={detailGridRef} className={`knowledge-detail-grid ${rightPanelVisible ? '' : 'is-single-panel'}`}>
                  <Card className="knowledge-files-card knowledge-detail-pane" style={{ width: rightPanelVisible ? `${leftPanelWidth}%` : '100%' }} title="文件树">
                    <div className="knowledge-files-toolbar">
                      <Input
                        prefix={<SearchOutlined />}
                        placeholder="搜索文件名或路径"
                        value={fileSearch}
                        onChange={(event) => setFileSearch(event.target.value)}
                      />
                      <Space wrap>
                        <Button type="primary" icon={<UploadOutlined />} loading={uploadingFiles} onClick={() => {
                          setUrlParentId(hasSingleSelection && selectedFiles[0].isFolder ? selectedFiles[0].fileId : null)
                          setUrlModalOpen(true)
                        }}>添加文件</Button>
                        <Button icon={<FolderAddOutlined />} onClick={() => setFolderModalOpen(true)}>新建文件夹</Button>
                      </Space>
                      <Space wrap>
                        <Button icon={<ApartmentOutlined />} onClick={toggleRightPanel}>
                          {rightPanelVisible ? '收起工作台' : '展开工作台'}
                        </Button>
                        <Button
                          icon={<RetweetOutlined />}
                          loading={parsingFiles}
                          disabled={!canParseSelectedDocuments}
                          onClick={() => void handleParseSelected()}
                        >
                          解析
                        </Button>
                        {supportsChunkConfig ? (
                          <Button onClick={() => setIndexConfigOpen(true)}>索引配置</Button>
                        ) : null}
                        <Button
                          icon={<BranchesOutlined />}
                          loading={indexingFiles}
                          type="primary"
                          disabled={!canIndexSelectedDocuments}
                          onClick={() => void handleIndexSelected()}
                        >
                          建索引
                        </Button>
                        <Button disabled={!hasSingleSelection} onClick={openMoveModal}>移动</Button>
                        <Button danger disabled={!hasSelectedFiles} onClick={() => void handleDeleteSelectedFiles()}>
                          删除
                        </Button>
                      </Space>
                    </div>

                    <Table<KnowledgeTreeNode>
                      rowKey="fileId"
                      size="small"
                      pagination={{ pageSize: 12, hideOnSinglePage: true }}
                      rowSelection={{
                        selectedRowKeys: selectedFileIds,
                        onChange: (keys) => setSelectedFileIds(keys as string[]),
                        getCheckboxProps: (record) => ({
                          disabled: !record.isFolder && !canDeleteKnowledgeFile(record.status),
                        }),
                      }}
                      expandable={{
                        expandedRowKeys: deferredFileSearch ? searchExpandedFileIds : expandedFileIds,
                        expandRowByClick: true,
                        rowExpandable: (record) => record.isFolder && (record.children || []).length > 0,
                        onExpandedRowsChange: (keys) => {
                          if (!deferredFileSearch) {
                            setExpandedFileIds(keys as string[])
                          }
                        },
                      }}
                      dataSource={fileTreeData}
                      columns={fileColumns}
                    />

                    <div className="knowledge-job-strip">
                      <Text strong>最近任务</Text>
                      <List
                        size="small"
                        dataSource={jobs.slice(0, 6)}
                        locale={{ emptyText: '暂无后台任务' }}
                        renderItem={(item) => (
                          <List.Item>
                            <Space size={8}>
                              <Tag color={statusColor(item.status)}>{statusLabel(item.status)}</Tag>
                              <Text>{item.jobKind}</Text>
                              <Text type="secondary">{item.targetFileIds.length} 个文件</Text>
                              <Text type="secondary">{item.updatedAt ? formatDateTimeZh(item.updatedAt) : '--'}</Text>
                            </Space>
                          </List.Item>
                        )}
                      />
                    </div>
                  </Card>

                  {rightPanelVisible ? (
                    <>
                      <div
                        className="knowledge-resize-handle"
                        onMouseDown={() => setIsResizingPanels(true)}
                        role="separator"
                        aria-orientation="vertical"
                      />
                      <Card className="knowledge-tabs-card knowledge-detail-pane" style={{ width: `${100 - leftPanelWidth}%` }}>
                        <Tabs
                          activeKey={activeTab}
                          onChange={setActiveTab}
                          items={tabItems}
                          tabBarExtraContent={
                            <Button size="small" onClick={() => setQueryConfigOpen(true)}>
                              检索配置
                            </Button>
                          }
                        />
                      </Card>
                    </>
                  ) : null}
                </div>
              </>
            )}
          </div>
        )}
      </motion.div>

      <Modal
        open={createModalOpen}
        title="新建知识库"
        onCancel={() => {
          setCreateModalOpen(false)
          if (shouldOpenCreateModal) {
            startTransition(() => navigate('/knowledge'))
          }
        }}
        onOk={() => void handleCreateKnowledgeBase()}
        okText="创建"
        confirmLoading={creatingKb}
      >
        <div className="knowledge-settings-grid">
          <div className="studio-form-field">
            <Text type="secondary">知识库类型</Text>
            <Select
              value={formState.kbType}
              options={[
                { value: 'lightrag', label: 'LightRAG' },
                { value: 'milvus', label: 'Milvus' },
              ]}
              onChange={(value) => setFormState((prev) => ({ ...prev, kbType: value }))}
            />
          </div>
          <div className="studio-form-field studio-form-field-span-2">
            <Text type="secondary">名称</Text>
            <Input value={formState.name} onChange={(event) => setFormState((prev) => ({ ...prev, name: event.target.value }))} />
          </div>
          <div className="studio-form-field studio-form-field-span-2">
            <Space align="center" style={{ justifyContent: 'space-between', width: '100%' }}>
              <Text type="secondary">描述</Text>
              <Button size="small" loading={generatingDescription} disabled={!supportsDescriptionGeneration} onClick={() => void handleGenerateDescription()}>
                AI 生成描述
              </Button>
            </Space>
            <Input.TextArea rows={4} value={formState.description} onChange={(event) => setFormState((prev) => ({ ...prev, description: event.target.value }))} />
          </div>
          <div className="studio-form-field">
            <Text type="secondary">Embedding 模型</Text>
            <Input value={formState.embedModelName} onChange={(event) => setFormState((prev) => ({ ...prev, embedModelName: event.target.value }))} />
          </div>
          <div className="studio-form-field">
            <Text type="secondary">LLM 模型</Text>
            <Input value={formState.llmModelName} onChange={(event) => setFormState((prev) => ({ ...prev, llmModelName: event.target.value }))} />
          </div>
          {formState.kbType === 'lightrag' ? (
            <div className="studio-form-field">
              <Text type="secondary">语言</Text>
              <Select
                value={formState.language}
                options={LANGUAGE_OPTIONS}
                onChange={(value) => setFormState((prev) => ({ ...prev, language: value }))}
              />
            </div>
          ) : null}
          <div className="studio-form-field">
            <Text type="secondary">分块策略</Text>
            <Select
              value={formState.chunkPresetId}
              options={CHUNK_PRESET_OPTIONS.map((item) => ({ label: item.label, value: item.value }))}
              onChange={(value) => setFormState((prev) => ({ ...prev, chunkPresetId: value }))}
            />
          </div>
          <div className="studio-form-field">
            <Text type="secondary">自动生成问题</Text>
            <Switch
              checked={formState.autoGenerateQuestions}
              onChange={(checked) => setFormState((prev) => ({ ...prev, autoGenerateQuestions: checked }))}
            />
          </div>
          {formState.kbType === 'milvus' ? (
            <div className="studio-form-field studio-form-field-span-2">
              <Text type="secondary">QA 分隔符</Text>
              <Input
                placeholder="例如：---FAQ---"
                value={formState.qaSeparator}
                onChange={(event) => setFormState((prev) => ({ ...prev, qaSeparator: event.target.value }))}
              />
            </div>
          ) : null}
        </div>
      </Modal>

      <Modal
        open={folderModalOpen}
        title="新建文件夹"
        onCancel={() => setFolderModalOpen(false)}
        onOk={() => void handleCreateFolder()}
        okText="创建"
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <Input placeholder="文件夹名称" value={folderName} onChange={(event) => setFolderName(event.target.value)} />
          <Select
            allowClear
            placeholder="父文件夹，可为空"
            value={folderParentId}
            options={folderOptions}
            onChange={(value) => setFolderParentId(value)}
          />
        </Space>
      </Modal>

      <KnowledgeUploadModal
        open={urlModalOpen}
        kb={currentKb}
        folderOptions={folderOptions}
        supportsChunkConfig={supportsChunkConfig}
        defaultParentId={urlParentId}
        onClose={() => setUrlModalOpen(false)}
        onSuccess={() => refreshDetail()}
      />

      <Modal
        open={moveModalOpen}
        title="移动文件"
        onCancel={() => setMoveModalOpen(false)}
        onOk={() => void handleMoveSelectedFile()}
        okText="保存"
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <Input value={moveTargetName} onChange={(event) => setMoveTargetName(event.target.value)} placeholder="新的名称" />
          <Select
            allowClear
            placeholder="目标文件夹，可为空表示根目录"
            value={moveTargetParentId}
            options={folderOptions.filter((item) => item.value !== selectedFiles[0]?.fileId)}
            onChange={(value) => setMoveTargetParentId(value)}
          />
        </Space>
      </Modal>

      <Modal
        open={indexConfigOpen}
        title="索引配置"
        onCancel={() => setIndexConfigOpen(false)}
        onOk={() => setIndexConfigOpen(false)}
        okText="保存配置"
      >
        <div className="knowledge-settings-grid">
          <div className="studio-form-field">
            <Text type="secondary">分块策略</Text>
            <Select
              value={indexConfig.chunkPresetId}
              options={CHUNK_PRESET_OPTIONS.map((item) => ({ label: item.label, value: item.value }))}
              onChange={(value) => setIndexConfig((prev) => ({ ...prev, chunkPresetId: value }))}
            />
          </div>
          {supportsChunkConfig ? (
            <>
              <div className="studio-form-field">
                <Text type="secondary">Chunk Size</Text>
                <InputNumber
                  min={200}
                  max={8000}
                  style={{ width: '100%' }}
                  value={indexConfig.chunkSize}
                  onChange={(value) => setIndexConfig((prev) => ({ ...prev, chunkSize: Number(value || 1000) }))}
                />
              </div>
              <div className="studio-form-field">
                <Text type="secondary">Chunk Overlap</Text>
                <InputNumber
                  min={0}
                  max={4000}
                  style={{ width: '100%' }}
                  value={indexConfig.chunkOverlap}
                  onChange={(value) => setIndexConfig((prev) => ({ ...prev, chunkOverlap: Number(value || 0) }))}
                />
              </div>
              <div className="studio-form-field studio-form-field-span-2">
                <Text type="secondary">QA 分隔符</Text>
                <Input
                  placeholder="例如：---FAQ---"
                  value={indexConfig.qaSeparator}
                  onChange={(event) => setIndexConfig((prev) => ({ ...prev, qaSeparator: event.target.value }))}
                />
              </div>
            </>
          ) : null}
        </div>
      </Modal>

      <Modal
        open={queryConfigOpen}
        title="检索配置"
        onCancel={() => setQueryConfigOpen(false)}
        onOk={() => {
          setQueryConfigOpen(false)
          void handleSaveQueryDefaults()
        }}
        okText="保存"
      >
        {queryParamSchema ? (
          <div className="knowledge-settings-grid">
            {queryParamSchema.options.map((option) => (
              <div
                key={option.key}
                className={`studio-form-field ${option.type === 'boolean' ? '' : 'studio-form-field-span-2'}`}
              >
                <Text type="secondary">{option.label}</Text>
                {option.type === 'select' ? (
                  <Select
                    value={String(getQueryConfigValue(option.key) ?? option.default ?? '')}
                    options={(option.options || []).map((item) => ({ label: item.label, value: item.value }))}
                    onChange={(value) => setQueryConfigValue(option.key, value)}
                  />
                ) : option.type === 'number' ? (
                  <InputNumber
                    style={{ width: '100%' }}
                    min={option.min}
                    max={option.max}
                    step={option.step}
                    value={Number(getQueryConfigValue(option.key) ?? option.default ?? 0)}
                    onChange={(value) => setQueryConfigValue(option.key, Number(value ?? option.default ?? 0))}
                  />
                ) : (
                  <Switch
                    checked={Boolean(getQueryConfigValue(option.key) ?? option.default ?? false)}
                    onChange={(checked) => setQueryConfigValue(option.key, checked)}
                  />
                )}
                {option.description ? (
                  <Text type="secondary" style={{ display: 'block' }}>{option.description}</Text>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <Empty description="当前知识库没有额外检索配置" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        )}
      </Modal>

      <Modal
        open={settingsModalOpen}
        title={currentKb ? `知识库设置 · ${currentKb.name}` : '知识库设置'}
        onCancel={() => setSettingsModalOpen(false)}
        footer={null}
        width={860}
      >
        <KnowledgeSettingsTab
          isLightRag={isLightRagKnowledgeBase(currentKb)}
          isMilvus={isMilvusKnowledgeBase(currentKb)}
          formState={formState}
          chunkPresetOptions={CHUNK_PRESET_OPTIONS.map((item) => ({ label: item.label, value: item.value }))}
          languageOptions={LANGUAGE_OPTIONS}
          generatingDescription={generatingDescription}
          supportsDescriptionGeneration={supportsDescriptionGeneration}
          savingKb={savingKb}
          onFormStateChange={setFormState}
          onGenerateDescription={() => void handleGenerateDescription()}
          onSave={() => void handleSaveKnowledgeBase()}
        />
      </Modal>

      <Modal
        open={benchmarkUploadOpen}
        title="上传评估基准"
        onCancel={() => {
          setBenchmarkUploadOpen(false)
          setBenchmarkUploadFile(null)
          setBenchmarkName('')
          setBenchmarkDescription('')
        }}
        onOk={() => void handleUploadBenchmark()}
        okText="上传"
        confirmLoading={uploadingBenchmark}
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <Input
            placeholder="基准名称"
            value={benchmarkName}
            onChange={(event) => setBenchmarkName(event.target.value)}
          />
          <Input.TextArea
            rows={3}
            placeholder="基准描述"
            value={benchmarkDescription}
            onChange={(event) => setBenchmarkDescription(event.target.value)}
          />
          <Button onClick={() => benchmarkUploadInputRef.current?.click()}>
            {benchmarkUploadFile ? `已选择：${benchmarkUploadFile.name}` : '选择 JSONL 文件'}
          </Button>
          <input
            ref={benchmarkUploadInputRef}
            type="file"
            accept=".jsonl"
            style={{ display: 'none' }}
            onChange={(event) => setBenchmarkUploadFile(event.target.files?.[0] || null)}
          />
        </Space>
      </Modal>

      <Modal
        open={benchmarkGenerateOpen}
        title="生成评估基准"
        onCancel={() => setBenchmarkGenerateOpen(false)}
        onOk={() => void handleGenerateBenchmark()}
        okText="生成"
        confirmLoading={generatingBenchmark}
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <Input
            placeholder="基准名称"
            value={benchmarkName}
            onChange={(event) => setBenchmarkName(event.target.value)}
          />
          <Input.TextArea
            rows={3}
            placeholder="基准描述"
            value={benchmarkDescription}
            onChange={(event) => setBenchmarkDescription(event.target.value)}
          />
          <InputNumber
            min={1}
            max={50}
            style={{ width: '100%' }}
            value={benchmarkCount}
            onChange={(value) => setBenchmarkCount(Number(value || 10))}
            addonBefore="题目数"
          />
        </Space>
      </Modal>

      <Modal
        open={!!benchmarkPreview}
        title={benchmarkPreview ? `评估基准预览 · ${benchmarkPreview.name}` : '评估基准预览'}
        onCancel={() => {
          setBenchmarkPreview(null)
          setBenchmarkPreviewPage(1)
          setBenchmarkPreviewPageSize(20)
        }}
        footer={null}
        width={960}
      >
        {benchmarkPreview ? (
          <Space direction="vertical" style={{ width: '100%' }}>
            <Descriptions size="small" bordered column={3}>
              <Descriptions.Item label="问题数">{benchmarkPreview.questionCount || benchmarkPreview.question_count || 0}</Descriptions.Item>
              <Descriptions.Item label="黄金检索集">
                {(benchmarkPreview.hasGoldChunks || benchmarkPreview.has_gold_chunks) ? '有' : '无'}
              </Descriptions.Item>
              <Descriptions.Item label="标准答案">
                {(benchmarkPreview.hasGoldAnswers || benchmarkPreview.has_gold_answers) ? '有' : '无'}
              </Descriptions.Item>
            </Descriptions>
            <Table
              rowKey={(_record, index) => `benchmark-preview-${index}`}
              size="small"
              loading={benchmarkPreviewLoading}
              dataSource={benchmarkPreview.questions}
              pagination={{
                current: benchmarkPreviewPage,
                pageSize: benchmarkPreviewPageSize,
                total:
                  benchmarkPreview.pagination?.total
                  || benchmarkPreview.pagination?.totalQuestions
                  || benchmarkPreview.pagination?.total_questions
                  || benchmarkPreview.questionCount
                  || benchmarkPreview.question_count
                  || 0,
                onChange: (page, pageSize) => {
                  if (benchmarkPreview) {
                    void handlePreviewBenchmark(benchmarkPreview, page, pageSize)
                  }
                },
              }}
              columns={[
                {
                  title: '问题',
                  dataIndex: 'query',
                  key: 'query',
                  render: (value: string) => <Paragraph style={{ marginBottom: 0 }}>{value}</Paragraph>,
                },
                {
                  title: '标准答案',
                  key: 'goldAnswer',
                  render: (_value, record) => (
                    <Paragraph ellipsis={{ rows: 3 }} style={{ marginBottom: 0 }}>
                      {record.goldAnswer || record.gold_answer || '--'}
                    </Paragraph>
                  ),
                },
                {
                  title: '黄金 Chunk',
                  key: 'goldChunkIds',
                  render: (_value, record) =>
                    (record.goldChunkIds || record.gold_chunk_ids || []).join(', ') || '--',
                },
              ]}
            />
          </Space>
        ) : null}
      </Modal>

      <Modal
        open={evaluationResultOpen}
        title={evaluationResult ? `评测结果 · ${evaluationResult.taskId}` : '评测结果'}
        onCancel={() => setEvaluationResultOpen(false)}
        footer={null}
        width={1200}
      >
        {evaluationLoading ? (
          <div className="knowledge-loading-panel"><Spin /></div>
        ) : evaluationResult ? (
          <Space direction="vertical" style={{ width: '100%' }}>
            <Descriptions size="small" bordered column={4}>
              <Descriptions.Item label="状态">
                <Tag color={statusColor(evaluationResult.status)}>{statusLabel(evaluationResult.status)}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="总体评分">{formatScorePercent(evaluationResult.overallScore ?? evaluationResult.overall_score)}</Descriptions.Item>
              <Descriptions.Item label="进度">
                {evaluationResult.completedQuestions || evaluationResult.completed_questions || 0}/
                {evaluationResult.totalQuestions || evaluationResult.total_questions || 0}
              </Descriptions.Item>
              <Descriptions.Item label="更新时间">
                {(evaluationResult.updatedAt || evaluationResult.updated_at)
                  ? formatDateTimeZh(evaluationResult.updatedAt || evaluationResult.updated_at || '')
                  : '--'}
              </Descriptions.Item>
            </Descriptions>
            <Card size="small" title="聚合指标">
              <div className="knowledge-metadata-list">
                {Object.entries(evaluationResult.metrics || {}).map(([key, value]) => (
                  <div key={key} className="knowledge-metadata-item">
                    <Text type="secondary">{key}</Text>
                    <span>{typeof value === 'number' ? formatScorePercent(value) : String(value)}</span>
                  </div>
                ))}
              </div>
            </Card>
            <div className="knowledge-query-topbar">
              <Space wrap>
                <Button onClick={() => evaluationResult && void handleViewEvaluationResult(evaluationResult.taskId, !evaluationErrorOnly)}>
                  {evaluationErrorOnly ? '查看全部' : '仅查看异常'}
                </Button>
              </Space>
            </div>
            <Table
              rowKey="rowId"
              size="small"
              pagination={false}
              dataSource={evaluationResult.details}
              columns={evaluationDetailColumns}
            />
          </Space>
        ) : (
          <Empty description="还没有评测结果" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        )}
      </Modal>

      <KnowledgeFileDetailModal
        kbId={currentKb?.kbId || null}
        open={fileDetailOpen}
        loading={fileDetailLoading}
        detail={fileDetail}
        onClose={() => setFileDetailOpen(false)}
      />
    </div>
  )
}
