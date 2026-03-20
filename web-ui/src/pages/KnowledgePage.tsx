import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  App,
  Badge,
  Button,
  Card,
  Col,
  Descriptions,
  Divider,
  Drawer,
  Empty,
  Input,
  InputNumber,
  List,
  Popconfirm,
  Row,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Tabs,
  Tooltip,
  Typography,
  Upload,
} from 'antd'
import type { TableProps } from 'antd'
import {
  CloudSyncOutlined,
  CloudUploadOutlined,
  DeleteOutlined,
  ExperimentOutlined,
  GlobalOutlined,
  InboxOutlined,
  PlusOutlined,
  ReloadOutlined,
  SaveOutlined,
  SearchOutlined,
  QuestionCircleOutlined,
} from '@ant-design/icons'
import { useNavigate, useParams } from 'react-router-dom'
import { api, ApiError } from '../api'
import { MotionPanel } from '../components/MotionSurface'
import PageHero from '../components/PageHero'
import { formatDateTimeZh } from '../locale'
import type {
  KnowledgeBaseDefinition,
  KnowledgeBaseMutationInput,
  KnowledgeDocument,
  KnowledgeHit,
  KnowledgeIngestJob,
  KnowledgeSource,
  ModelDefaults,
  ModelProvider,
  ModelSelection,
} from '../types'

const { Text, Paragraph, Title } = Typography
const { TextArea } = Input
const { Dragger } = Upload

type SourceMode = 'file' | 'url' | 'faq'
type ModelCapability = 'embedding' | 'reranker'

interface KnowledgeFormState {
  name: string
  description: string
  enabled: boolean
  tags: string[]
  mode: string
  topK: number
  chunkTopK: number
  chunkSize: number
  chunkOverlap: number
  kbBackend: 'sqlite' | 'milvus' | string
  autoIndexAfterParse: boolean
  vectorCollection: string
  embeddingModelSelection: ModelSelection | null
  rerankerModelSelection: ModelSelection | null
}

interface SourceEditorState {
  title: string
  enabled: boolean
  url: string
  faqItemsText: string
}

interface FaqDraftItem {
  question: string
  answer: string
}

function createSelection(capability: ModelCapability, provider: ModelProvider | null): ModelSelection | null {
  if (!provider) {
    return null
  }
  const modelName = provider.defaultModel || provider.models[0] || ''
  if (!modelName) {
    return null
  }
  return {
    providerId: provider.providerId,
    modelName,
    capability,
    providerName: provider.providerType,
    displayName: provider.displayName,
    baseUrl: provider.baseUrl ?? null,
    apiKeyEnv: provider.apiKeyEnv ?? null,
    qualifiedModelName: modelName,
  }
}

function selectionLabel(selection?: ModelSelection | null) {
  if (!selection) {
    return '未配置'
  }
  return `${selection.displayName || selection.providerId}/${selection.modelName}`
}

function createEmptyForm(defaults?: ModelDefaults | null): KnowledgeFormState {
  return {
    name: '',
    description: '',
    enabled: true,
    tags: [],
    mode: 'hybrid',
    topK: 8,
    chunkTopK: 20,
    chunkSize: 800,
    chunkOverlap: 120,
    kbBackend: 'sqlite',
    autoIndexAfterParse: true,
    vectorCollection: '',
    embeddingModelSelection: defaults?.defaultEmbedding ?? null,
    rerankerModelSelection: defaults?.defaultReranker ?? null,
  }
}

function createEmptySourceEditor(): SourceEditorState {
  return {
    title: '',
    enabled: true,
    url: '',
    faqItemsText: '[]',
  }
}

function kbToForm(kb: KnowledgeBaseDefinition): KnowledgeFormState {
  return {
    name: kb.name,
    description: kb.description,
    enabled: kb.enabled,
    tags: [...kb.tags],
    mode: kb.retrievalProfile.mode,
    topK: kb.retrievalProfile.topK,
    chunkTopK: kb.retrievalProfile.chunkTopK,
    chunkSize: kb.retrievalProfile.chunkSize,
    chunkOverlap: kb.retrievalProfile.chunkOverlap,
    kbBackend: kb.kbBackend || 'sqlite',
    autoIndexAfterParse: kb.autoIndexAfterParse ?? true,
    vectorCollection: kb.vectorCollection || '',
    embeddingModelSelection: kb.embeddingModelSelection ?? null,
    rerankerModelSelection: kb.rerankerModelSelection ?? null,
  }
}

function sourceToEditor(source: KnowledgeSource): SourceEditorState {
  const config = source.config || {}
  const faqItems = Array.isArray(config.items) ? config.items : []
  return {
    title: source.title,
    enabled: source.enabled,
    url: String(config.url || source.sourceUri || ''),
    faqItemsText: source.sourceType === 'faq_table' ? JSON.stringify(faqItems, null, 2) : '[]',
  }
}

function toPayload(form: KnowledgeFormState): KnowledgeBaseMutationInput {
  return {
    name: form.name.trim(),
    description: form.description.trim(),
    enabled: form.enabled,
    tags: [...form.tags],
    retrievalProfile: {
      mode: form.mode,
      topK: form.topK,
      chunkTopK: form.chunkTopK,
      chunkSize: form.chunkSize,
      chunkOverlap: form.chunkOverlap,
      citationRequired: true,
      rerankEnabled: Boolean(form.rerankerModelSelection),
      metadataFilters: {},
    },
    kbBackend: form.kbBackend,
    autoIndexAfterParse: form.autoIndexAfterParse,
    vectorCollection: form.vectorCollection.trim() || null,
    embeddingModelSelection: form.embeddingModelSelection,
    rerankerModelSelection: form.rerankerModelSelection,
  }
}

function parseJsonObject<T>(raw: string, fallback: T): T {
  const trimmed = raw.trim()
  if (!trimmed) {
    return fallback
  }
  return JSON.parse(trimmed) as T
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

function statusBadgeStatus(status: string) {
  if (status === 'indexed' || status === 'succeeded') {
    return 'success'
  }
  if (status.startsWith('error') || status === 'failed') {
    return 'error'
  }
  if (status === 'indexing' || status === 'running' || status === 'parsing') {
    return 'processing'
  }
  return 'default'
}

function statusLabel(status: string) {
  switch (status) {
    case 'indexed':
      return '已索引'
    case 'parsed':
      return '已解析'
    case 'parsing':
      return '解析中'
    case 'indexing':
      return '索引中'
    case 'error_parsing':
      return '解析失败'
    case 'error_indexing':
      return '索引失败'
    case 'uploaded':
      return '已上传'
    default:
      return status
  }
}

function isPendingParse(status: string) {
  return ['uploaded', 'parsing'].includes(status)
}

function isPendingIndex(status: string) {
  return ['parsed', 'indexing'].includes(status)
}

function isActiveJobStatus(status: string) {
  return ['queued', 'running'].includes(status)
}

function modelSelectionSummary(selection?: ModelSelection | null) {
  if (!selection) {
    return '未配置'
  }
  return `${selection.displayName || selection.providerId} · ${selection.modelName}`
}

function splitTags(raw: string) {
  return raw
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean)
}

export default function KnowledgePage() {
  const { message, modal } = App.useApp()
  const navigate = useNavigate()
  const { kbId } = useParams()
  const selectedKbId = kbId && kbId !== 'new' ? kbId : null
  const isCreatingKb = kbId === 'new'

  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBaseDefinition[]>([])
  const [modelProviders, setModelProviders] = useState<ModelProvider[]>([])
  const [modelDefaults, setModelDefaults] = useState<ModelDefaults | null>(null)
  const [currentKb, setCurrentKb] = useState<KnowledgeBaseDefinition | null>(null)
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([])
  const [sources, setSources] = useState<KnowledgeSource[]>([])
  const [jobs, setJobs] = useState<KnowledgeIngestJob[]>([])
  const [form, setForm] = useState<KnowledgeFormState>(() => createEmptyForm())
  const [sourceEditor, setSourceEditor] = useState<SourceEditorState>(() => createEmptySourceEditor())
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null)
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [urlInput, setUrlInput] = useState('')
  const [faqTitle, setFaqTitle] = useState('')
  const [faqQuestion, setFaqQuestion] = useState('')
  const [faqAnswer, setFaqAnswer] = useState('')
  const [faqItems, setFaqItems] = useState<FaqDraftItem[]>([])
  const [kbQuery, setKbQuery] = useState('')
  const [documentQuery, setDocumentQuery] = useState('')
  const [documentStatusFilter, setDocumentStatusFilter] = useState('all')
  const [selectedDocIds, setSelectedDocIds] = useState<string[]>([])
  const [retrieveQuery, setRetrieveQuery] = useState('restart the worker')
  const [retrieveHits, setRetrieveHits] = useState<KnowledgeHit[]>([])
  const [retrieveMode, setRetrieveMode] = useState('hybrid')
  const [retrieveEffectiveMode, setRetrieveEffectiveMode] = useState<string | null>(null)
  const [retrieveStaleKbIds, setRetrieveStaleKbIds] = useState<string[]>([])
  const [workbenchTab, setWorkbenchTab] = useState('retrieve')
  const [uploadDrawerOpen, setUploadDrawerOpen] = useState(false)
  const [uploadMode, setUploadMode] = useState<SourceMode>('file')
  const [loadingWorkspace, setLoadingWorkspace] = useState(true)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savingSource, setSavingSource] = useState(false)
  const [deletingSource, setDeletingSource] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [ingesting, setIngesting] = useState(false)
  const [parsingTarget, setParsingTarget] = useState<string | 'all' | null>(null)
  const [indexingTarget, setIndexingTarget] = useState<string | 'all' | null>(null)
  const [reindexingTarget, setReindexingTarget] = useState<string | 'all' | null>(null)
  const [retrieving, setRetrieving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [retrieveError, setRetrieveError] = useState<string | null>(null)
  const [submissionLabel, setSubmissionLabel] = useState<string | null>(null)
  const [lastSubmittedDocIds, setLastSubmittedDocIds] = useState<string[]>([])
  const [lastSubmittedJobIds, setLastSubmittedJobIds] = useState<string[]>([])
  const submissionPollRef = useRef<number | null>(null)

  useEffect(() => {
    void loadWorkspace()
  }, [])

  useEffect(() => {
    if (loadingWorkspace) {
      return
    }
    if (!kbId && knowledgeBases[0]) {
      navigate(`/studio/knowledge/${knowledgeBases[0].kbId}`, { replace: true })
      return
    }
    if (!selectedKbId) {
      setCurrentKb(null)
      setDocuments([])
      setSources([])
      setSelectedSourceId(null)
      setSourceEditor(createEmptySourceEditor())
      setJobs([])
      setSelectedDocIds([])
      setRetrieveHits([])
      setRetrieveStaleKbIds([])
      setForm(createEmptyForm(modelDefaults))
      return
    }
    void loadKnowledgeDetail(selectedKbId)
  }, [kbId, knowledgeBases, loadingWorkspace, navigate, selectedKbId])

  useEffect(() => {
    if (!currentKb || !selectedSourceId) {
      return
    }
    const selected = sources.find((item) => item.sourceId === selectedSourceId)
    if (selected) {
      setSourceEditor(sourceToEditor(selected))
    }
  }, [currentKb, selectedSourceId, sources])

  const selectedSource = useMemo(
    () => sources.find((item) => item.sourceId === selectedSourceId) ?? null,
    [selectedSourceId, sources],
  )

  const pendingParseCount = useMemo(
    () => documents.filter((item) => isPendingParse(item.docStatus)).length,
    [documents],
  )
  const pendingIndexCount = useMemo(
    () => documents.filter((item) => isPendingIndex(item.docStatus)).length,
    [documents],
  )
  const activeJobCount = useMemo(
    () => jobs.filter((item) => isActiveJobStatus(item.status)).length,
    [jobs],
  )
  const enabledSourceCount = useMemo(
    () => sources.filter((item) => item.enabled).length,
    [sources],
  )
  const filteredKnowledgeBases = useMemo(() => {
    const query = kbQuery.trim().toLowerCase()
    if (!query) {
      return knowledgeBases
    }
    return knowledgeBases.filter((item) => {
      return item.name.toLowerCase().includes(query)
        || item.description.toLowerCase().includes(query)
        || item.tags.some((tag) => tag.toLowerCase().includes(query))
        || item.kbId.toLowerCase().includes(query)
    })
  }, [kbQuery, knowledgeBases])
  const retrieveStaleKbNames = useMemo(
    () => retrieveStaleKbIds.map((id) => knowledgeBases.find((item) => item.kbId === id)?.name || id),
    [knowledgeBases, retrieveStaleKbIds],
  )
  const trackedJobs = useMemo(
    () => jobs.filter((item) => lastSubmittedJobIds.includes(item.jobId)),
    [jobs, lastSubmittedJobIds],
  )
  const activeTrackedJobs = useMemo(
    () => trackedJobs.filter((item) => isActiveJobStatus(item.status)),
    [trackedJobs],
  )
  const failedTrackedJobs = useMemo(
    () => trackedJobs.filter((item) => item.status === 'failed' || item.status.startsWith('error')),
    [trackedJobs],
  )

  useEffect(() => {
    if (!currentKb && !isCreatingKb) {
      return
    }
    if (selectedSourceId && sources.some((item) => item.sourceId === selectedSourceId)) {
      return
    }
    setSelectedSourceId(sources[0]?.sourceId ?? null)
  }, [currentKb, isCreatingKb, selectedSourceId, sources])

  useEffect(() => {
    if (!currentKb || !currentKb.kbBackend || currentKb.kbBackend === 'sqlite') {
      return
    }
    if (!currentKb.vectorCollection && currentKb.kbBackend === 'milvus') {
      setForm((state) => ({
        ...state,
        vectorCollection: `${currentKb.kbId}-chunks`,
      }))
    }
  }, [currentKb])

  useEffect(() => () => {
    if (submissionPollRef.current) {
      window.clearTimeout(submissionPollRef.current)
    }
  }, [])

  async function loadWorkspace() {
    try {
      setLoadingWorkspace(true)
      const [kbList, providers, defaults] = await Promise.all([
        api.getKnowledgeBases(),
        api.getModelProviders(),
        api.getModelDefaults(),
      ])
      setKnowledgeBases(kbList)
      setModelProviders(providers)
      setModelDefaults(defaults)
      setError(null)
      if (!selectedKbId) {
        setForm(createEmptyForm(defaults))
      }
    } catch (loadError) {
      setError(getErrorMessage(loadError, '加载知识库列表失败'))
    } finally {
      setLoadingWorkspace(false)
    }
  }

  async function loadKnowledgeDetail(nextKbId: string) {
    try {
      setLoadingDetail(true)
      const [kb, docs, sourceList, jobList] = await Promise.all([
        api.getKnowledgeBase(nextKbId),
        api.getKnowledgeDocuments(nextKbId),
        api.getKnowledgeSources(nextKbId),
        api.getKnowledgeJobs(nextKbId),
      ])
      setCurrentKb(kb)
      setDocuments(docs)
      setSources(sourceList)
      setJobs(jobList)
      setForm(kbToForm(kb))
      setRetrieveMode(kb.retrievalProfile.mode)
      setRetrieveStaleKbIds([])
      setSelectedSourceId((current) => {
        if (current && sourceList.some((item) => item.sourceId === current)) {
          return current
        }
        return sourceList[0]?.sourceId ?? null
      })
      setError(null)
      return { kb, docs, sourceList, jobList }
    } catch (loadError) {
      setError(getErrorMessage(loadError, '加载知识库详情失败'))
      return null
    } finally {
      setLoadingDetail(false)
    }
  }

  function focusSubmission(docIds: string[], jobIds: string[], label: string) {
    setSubmissionLabel(label)
    setLastSubmittedDocIds(docIds)
    setLastSubmittedJobIds(jobIds)
    setWorkbenchTab('documents')
    setSelectedDocIds(docIds)
  }

  async function pollSubmission(nextKbId: string, trackedJobIds: string[], remaining = 8) {
    if (submissionPollRef.current) {
      window.clearTimeout(submissionPollRef.current)
      submissionPollRef.current = null
    }
    if (trackedJobIds.length === 0 || remaining <= 0) {
      return
    }
    submissionPollRef.current = window.setTimeout(() => {
      void (async () => {
        const detail = await loadKnowledgeDetail(nextKbId)
        const relevantJobs = detail?.jobList.filter((item) => trackedJobIds.includes(item.jobId)) || []
        if (relevantJobs.some((item) => isActiveJobStatus(item.status))) {
          void pollSubmission(nextKbId, trackedJobIds, remaining - 1)
        }
      })()
    }, 1500)
  }

  async function handleSave() {
    const payload = toPayload(form)
    if (!payload.name) {
      setError('知识库名称不能为空。')
      return
    }
    try {
      setSaving(true)
      const saved = currentKb
        ? await api.updateKnowledgeBase(currentKb.kbId, payload)
        : await api.createKnowledgeBase(payload)
      message.success(currentKb ? '知识库已更新' : '知识库已创建')
      if (saved.reindexRequired) {
        message.warning('当前知识库索引已失效，请尽快触发重建索引。')
      }
      await loadWorkspace()
      navigate(`/studio/knowledge/${saved.kbId}`, { replace: true })
      await loadKnowledgeDetail(saved.kbId)
    } catch (saveError) {
      setError(getErrorMessage(saveError, '保存知识库失败'))
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!currentKb) {
      return
    }
    try {
      setDeleting(true)
      await api.deleteKnowledgeBase(currentKb.kbId)
      message.success('知识库已删除')
      const remaining = knowledgeBases.filter((item) => item.kbId !== currentKb.kbId)
      await loadWorkspace()
      if (remaining[0]) {
        navigate(`/studio/knowledge/${remaining[0].kbId}`, { replace: true })
      } else {
        navigate('/studio/knowledge/new', { replace: true })
      }
    } catch (deleteError) {
      setError(getErrorMessage(deleteError, '删除知识库失败'))
    } finally {
      setDeleting(false)
    }
  }

  function openUploadDrawer(mode: SourceMode) {
    setUploadMode(mode)
    setUploadDrawerOpen(true)
    if (mode === 'faq') {
      setFaqTitle(currentKb?.name ? `${currentKb.name} FAQ` : '知识库 FAQ')
      setFaqItems([])
      setFaqQuestion('')
      setFaqAnswer('')
    }
  }

  function closeUploadDrawer() {
    setUploadDrawerOpen(false)
    setSelectedFiles([])
    setUrlInput('')
    setFaqTitle('')
    setFaqQuestion('')
    setFaqAnswer('')
    setFaqItems([])
    setUploadMode('file')
  }

  async function handleUploadFiles(fileList: File[]) {
    if (!currentKb) return
    try {
      setIngesting(true)
      const formData = new FormData()
      fileList.forEach((file) => formData.append('file', file))
      const result = await api.uploadKnowledgeDocuments(currentKb.kbId, formData)
      message.success(`已提交 ${fileList.length} 个文件，后台正在入库`)
      focusSubmission(
        result.documents.map((item) => item.docId),
        result.jobs.map((item) => item.jobId),
        `${fileList.length} 个文件`,
      )
      closeUploadDrawer()
      await loadKnowledgeDetail(currentKb.kbId)
      void pollSubmission(currentKb.kbId, result.jobs.map((item) => item.jobId))
    } catch (ingestError) {
      setError(getErrorMessage(ingestError, '上传知识文档失败'))
    } finally {
      setIngesting(false)
    }
  }

  async function handleIngestUrl() {
    if (!currentKb) return
    if (!urlInput.trim()) {
      setError('请输入要接入的单个 URL。')
      return
    }
    try {
      setIngesting(true)
      const result = await api.addKnowledgeSource(currentKb.kbId, {
        sourceType: 'web_url',
        url: urlInput.trim(),
        title: currentKb.name,
      })
      message.success('URL 已提交，后台正在抓取和入库')
      focusSubmission(
        result.documents.map((item) => item.docId),
        result.jobs.map((item) => item.jobId),
        'URL 抓取任务',
      )
      closeUploadDrawer()
      await loadKnowledgeDetail(currentKb.kbId)
      void pollSubmission(currentKb.kbId, result.jobs.map((item) => item.jobId))
    } catch (ingestError) {
      setError(getErrorMessage(ingestError, '接入 URL 失败'))
    } finally {
      setIngesting(false)
    }
  }

  async function handleIngestFaq() {
    if (!currentKb) return
    if (faqItems.length === 0) {
      setError('请至少添加一条 FAQ。')
      return
    }
    try {
      setIngesting(true)
      const result = await api.addKnowledgeSource(currentKb.kbId, {
        sourceType: 'faq_table',
        title: faqTitle.trim() || `${currentKb.name} FAQ`,
        items: faqItems,
      })
      message.success('FAQ 已提交，后台正在入库')
      focusSubmission(
        result.documents.map((item) => item.docId),
        result.jobs.map((item) => item.jobId),
        `FAQ ${result.documents.length} 条`,
      )
      closeUploadDrawer()
      await loadKnowledgeDetail(currentKb.kbId)
      void pollSubmission(currentKb.kbId, result.jobs.map((item) => item.jobId))
    } catch (ingestError) {
      setError(getErrorMessage(ingestError, '接入 FAQ 失败'))
    } finally {
      setIngesting(false)
    }
  }

  function updateForm<K extends keyof KnowledgeFormState>(key: K, value: KnowledgeFormState[K]) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  function updateSelection(capability: ModelCapability, providerId?: string | null) {
    const provider = modelProviders.find((item) => item.providerId === providerId)
    const selection = createSelection(capability, provider ?? null)
    setForm((current) => ({
      ...current,
      [capability === 'embedding' ? 'embeddingModelSelection' : 'rerankerModelSelection']: selection,
    }))
  }

  function updateSelectionModel(capability: ModelCapability, modelName: string) {
    setForm((current) => {
      const key = capability === 'embedding' ? 'embeddingModelSelection' : 'rerankerModelSelection'
      const currentSelection = current[key]
      if (!currentSelection) {
        return current
      }
      return {
        ...current,
        [key]: {
          ...currentSelection,
          modelName,
          qualifiedModelName: modelName,
        },
      }
    })
  }

  async function handleSaveSource() {
    if (!currentKb || !selectedSource) {
      return
    }
    try {
      setSavingSource(true)
      const payload: { title?: string; enabled?: boolean; url?: string; items?: FaqDraftItem[] } = {
        title: sourceEditor.title.trim() || selectedSource.title,
        enabled: sourceEditor.enabled,
      }
      if (selectedSource.sourceType === 'web_url') {
        payload.url = sourceEditor.url.trim()
      }
      if (selectedSource.sourceType === 'faq_table') {
        payload.items = parseJsonObject<FaqDraftItem[]>(sourceEditor.faqItemsText, [])
      }
      await api.updateKnowledgeSource(currentKb.kbId, selectedSource.sourceId, payload)
      message.success('来源已更新')
      await loadKnowledgeDetail(currentKb.kbId)
    } catch (saveError) {
      setError(getErrorMessage(saveError, '保存来源失败'))
    } finally {
      setSavingSource(false)
    }
  }

  async function handleSyncSource(sourceId: string) {
    if (!currentKb) {
      return
    }
    try {
      setReindexingTarget(sourceId)
      await api.syncKnowledgeSource(currentKb.kbId, sourceId)
      message.success('已触发来源同步')
      await loadKnowledgeDetail(currentKb.kbId)
    } catch (syncError) {
      setError(getErrorMessage(syncError, '同步来源失败'))
    } finally {
      setReindexingTarget(null)
    }
  }

  async function handleDeleteSource(sourceId: string) {
    if (!currentKb) {
      return
    }
    try {
      setDeletingSource(true)
      await api.deleteKnowledgeSource(currentKb.kbId, sourceId)
      message.success('来源已删除')
      await loadKnowledgeDetail(currentKb.kbId)
    } catch (deleteError) {
      message.error(getErrorMessage(deleteError, '删除来源失败'))
    } finally {
      setDeletingSource(false)
    }
  }

  async function handleRetrieve() {
    if (!currentKb) return
    if (!retrieveQuery.trim()) {
      setRetrieveError('请输入检索问题。')
      return
    }
    try {
      setRetrieving(true)
      const result = await api.retrieveKnowledgeBase(currentKb.kbId, {
        query: retrieveQuery.trim(),
        mode: retrieveMode,
        limit: 8,
      })
      setRetrieveHits(result.hits)
      setRetrieveMode(result.requestedMode)
      setRetrieveEffectiveMode(result.effectiveMode)
      setRetrieveStaleKbIds(result.staleKnowledgeBaseIds || [])
      setRetrieveError(null)
    } catch (retrieveErrorValue) {
      setRetrieveStaleKbIds([])
      setRetrieveError(getErrorMessage(retrieveErrorValue, '检索测试失败'))
    } finally {
      setRetrieving(false)
    }
  }

  async function handleDeleteDocument(docId: string) {
    if (!currentKb) return
    try {
      await api.deleteKnowledgeDocument(currentKb.kbId, docId)
      message.success('文档已删除')
      await loadKnowledgeDetail(currentKb.kbId)
    } catch (deleteError) {
      setError(getErrorMessage(deleteError, '删除文档失败'))
    }
  }

  async function handleDeleteDocuments(docIds: string[]) {
    if (!currentKb || docIds.length === 0) {
      return
    }
    try {
      await api.deleteKnowledgeDocuments(currentKb.kbId, docIds)
      message.success(`已删除 ${docIds.length} 个文档`)
      setSelectedDocIds([])
      await loadKnowledgeDetail(currentKb.kbId)
    } catch (deleteError) {
      setError(getErrorMessage(deleteError, '批量删除文档失败'))
    }
  }

  function collectPendingDocIds(kind: 'parse' | 'index', docIds: string[]) {
    const requested = docIds.length > 0 ? new Set(docIds) : null
    return documents
      .filter((item) => (requested ? requested.has(item.docId) : true))
      .filter((item) => (kind === 'parse' ? isPendingParse(item.docStatus) : isPendingIndex(item.docStatus)))
      .map((item) => item.docId)
  }

  async function handleParse(docIds: string[]) {
    if (!currentKb) {
      return
    }
    const targetIds = collectPendingDocIds('parse', docIds)
    if (targetIds.length === 0) {
      message.info(docIds.length > 0 ? '选中的文档里没有待解析项。' : '当前没有待解析文档。')
      return
    }
    try {
      setParsingTarget(docIds.length > 0 ? targetIds[0] : 'all')
      const result = await api.parseKnowledgeDocuments(currentKb.kbId, { docIds: targetIds })
      message.success(`已完成 ${result.documents.length} 个文档的解析`)
      await loadKnowledgeDetail(currentKb.kbId)
    } catch (parseError) {
      setError(getErrorMessage(parseError, '提交解析任务失败'))
    } finally {
      setParsingTarget(null)
    }
  }

  async function handleIndex(docIds: string[]) {
    if (!currentKb) {
      return
    }
    const targetIds = collectPendingDocIds('index', docIds)
    if (targetIds.length === 0) {
      message.info(docIds.length > 0 ? '选中的文档里没有待入库项。' : '当前没有待入库文档。')
      return
    }
    try {
      setIndexingTarget(docIds.length > 0 ? targetIds[0] : 'all')
      const result = await api.indexKnowledgeDocuments(currentKb.kbId, { docIds: targetIds })
      message.success(`已完成 ${result.documents.length} 个文档的入库`)
      await loadKnowledgeDetail(currentKb.kbId)
    } catch (indexError) {
      setError(getErrorMessage(indexError, '提交入库任务失败'))
    } finally {
      setIndexingTarget(null)
    }
  }

  async function handleReindex(docIds: string[]) {
    if (!currentKb) return
    try {
      setReindexingTarget(docIds.length === 0 ? 'all' : docIds[0] || 'all')
      await api.reindexKnowledgeBase(currentKb.kbId, { docIds })
      message.success(`已提交 ${docIds.length || documents.length} 个文档的重建任务`)
      await loadKnowledgeDetail(currentKb.kbId)
    } catch (reindexError) {
      setError(getErrorMessage(reindexError, '提交重建索引失败'))
    } finally {
      setReindexingTarget(null)
    }
  }

  const documentColumns: TableProps<KnowledgeDocument>['columns'] = [
    {
      title: '文档名称',
      dataIndex: 'title',
      key: 'title',
      render: (text, record) => (
        <Space direction="vertical" size={0}>
          <Text strong>{text || record.fileName}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>{record.fileName}</Text>
        </Space>
      ),
    },
    {
      title: '类型',
      dataIndex: 'sourceType',
      key: 'sourceType',
      width: 120,
      render: (text) => (
        <Tag color={text === 'file' ? 'geekblue' : text === 'web_url' ? 'cyan' : 'purple'}>
          {text === 'file' ? '文件' : text === 'web_url' ? '网页' : text === 'faq_table' ? 'FAQ' : text}
        </Tag>
      ),
    },
    {
      title: '状态',
      key: 'status',
      width: 120,
      render: (_, record) => <Badge status={statusBadgeStatus(record.docStatus)} text={statusLabel(record.docStatus)} />,
    },
    {
      title: '诊断',
      key: 'diagnostics',
      width: 240,
      render: (_, record) => (
        <Space direction="vertical" size={2}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            Chunk {record.chunkCount} · Parser {record.parserName || '--'}
          </Text>
          {record.errorSummary ? (
            <Text type="danger" style={{ fontSize: 12 }}>
              {record.errorSummary}
            </Text>
          ) : (
            <Text type="secondary" style={{ fontSize: 12 }}>
              {record.sourceUri || record.filePath || '--'}
            </Text>
          )}
        </Space>
      ),
    },
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      key: 'updatedAt',
      width: 180,
      render: (text) => <Text type="secondary">{formatDateTimeZh(text)}</Text>,
    },
    {
      title: '操作',
      key: 'action',
      width: 220,
      render: (_, record) => (
        <Space>
          {isPendingParse(record.docStatus) ? (
            <Tooltip title="开始解析">
              <Button
                size="small"
                loading={parsingTarget === record.docId}
                onClick={() => void handleParse([record.docId])}
              >
                解析
              </Button>
            </Tooltip>
          ) : null}
          {isPendingIndex(record.docStatus) ? (
            <Tooltip title="开始入库">
              <Button
                size="small"
                loading={indexingTarget === record.docId}
                onClick={() => void handleIndex([record.docId])}
              >
                入库
              </Button>
            </Tooltip>
          ) : null}
          <Tooltip title="重新索引">
            <Button
              size="small"
              icon={<ReloadOutlined />}
              loading={reindexingTarget === record.docId}
              onClick={() => void handleReindex([record.docId])}
            />
          </Tooltip>
          <Popconfirm title="确认删除？" onConfirm={() => void handleDeleteDocument(record.docId)}>
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ]

  function renderModelSelectionEditor(
    capability: ModelCapability,
    selection: ModelSelection | null,
    onProviderChange: (providerId?: string | null) => void,
    onModelChange: (modelName: string) => void,
  ) {
    const eligibleProviders = modelProviders.filter(
      (provider) => provider.enabled && provider.capabilities.includes(capability),
    )
    const currentProvider = selection
      ? modelProviders.find((provider) => provider.providerId === selection.providerId) ?? null
      : null
    const modelOptions = currentProvider?.models?.length ? currentProvider.models : []

    return (
      <div className="studio-form-grid">
        <div className="studio-form-field">
          <Text type="secondary">Provider</Text>
          <Select
            allowClear
            value={selection?.providerId}
            placeholder="选择 provider"
            options={eligibleProviders.map((provider) => ({
              label: `${provider.displayName} · ${provider.providerType}`,
              value: provider.providerId,
            }))}
            onChange={(value) => onProviderChange(value)}
          />
        </div>
        <div className="studio-form-field">
          <Text type="secondary">模型名</Text>
          <Input
            value={selection?.modelName || ''}
            placeholder={currentProvider?.defaultModel || currentProvider?.models[0] || '手动输入模型名'}
            onChange={(event) => onModelChange(event.target.value)}
          />
        </div>
        <div className="studio-form-field">
          <Text type="secondary">当前选择</Text>
          <Input value={modelSelectionSummary(selection)} readOnly />
        </div>
        {modelOptions.length > 0 ? (
          <div className="models-suggestion-list" style={{ gridColumn: '1 / -1' }}>
            {modelOptions.map((item) => (
              <Button key={item} size="small" onClick={() => onModelChange(item)}>
                {item}
              </Button>
            ))}
          </div>
        ) : null}
      </div>
    )
  }

  function renderRightBanners() {
    const items: JSX.Element[] = []
    if (currentKb) {
      if (currentKb.reindexRequired) {
        const isLegacyMigration = currentKb.reindexReason === 'legacy_config_migration_required' || currentKb.legacyConfig
        items.push(
          <Alert
            key="reindex"
            type="warning"
            showIcon
            message="当前知识库需要重建索引"
            description={
              isLegacyMigration
                ? '这是一个旧版知识库配置。请绑定 embedding 模型、切换到 Milvus，并完成一次全量重建后再继续使用语义召回。'
                : 'Embedding 模型、Milvus 后端或 Collection 已变更。为避免继续命中旧向量，语义召回会自动降级，建议立即重建全部文档索引。'
            }
            action={(
              <Button size="small" type="primary" onClick={() => void handleReindex([])} loading={reindexingTarget === 'all'}>
                重建全部索引
              </Button>
            )}
          />,
        )
      }
      if (pendingParseCount > 0) {
        items.push(
          <Alert
            key="parse"
            type="info"
            showIcon
            message={`待解析 ${pendingParseCount} 个文档`}
            description="文件和来源已经接入，但还没进入解析阶段。"
            action={(
              <Button size="small" type="primary" onClick={() => void handleParse([])} loading={parsingTarget === 'all'}>
                开始解析
              </Button>
            )}
          />,
        )
      }
      if (pendingIndexCount > 0) {
        items.push(
          <Alert
            key="index"
            type="warning"
            showIcon
            message={`待入库 ${pendingIndexCount} 个文档`}
            description="解析完成后还需要入 Milvus 或当前后端索引。"
            action={(
              <Button size="small" type="primary" onClick={() => void handleIndex([])} loading={indexingTarget === 'all'}>
                开始入库
              </Button>
            )}
          />,
        )
      }
      if (activeJobCount > 0) {
        items.push(
          <Alert
            key="job"
            type="success"
            showIcon
            message={`${activeJobCount} 个任务正在处理`}
            description="系统会持续刷新任务和文档状态。"
          />,
        )
      }
      if ((currentKb.kbBackend || 'sqlite') !== 'milvus') {
        items.push(
          <Alert
            key="backend"
            type="warning"
            showIcon
            message="当前知识库仍在非 Milvus 后端"
            description="如果要使用向量召回闭环，建议切换到 Milvus 并配置 embedding 模型。"
          />,
        )
      }
      if (currentKb.kbBackend === 'milvus') {
        items.push(
          <Alert
            key="milvus"
            type="success"
            showIcon
            message="Milvus 向量后端已启用"
            description={`Collection: ${currentKb.vectorCollection || '未命名'} · Embedding: ${modelSelectionSummary(currentKb.embeddingModelSelection)}`}
          />,
        )
      }
    }
    return <Space direction="vertical" size={12} style={{ width: '100%' }}>{items}</Space>
  }

  function renderQueueCard() {
    return (
      <MotionPanel hover={false}>
        <Card className="config-panel-card" title="处理队列" extra={<Tag color="blue">上传 → 解析 → 入库 → 检索</Tag>}>
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <div className="page-meta-grid mcp-meta-grid">
              <div className="page-meta-card">
                <span>待解析</span>
                <strong>{pendingParseCount}</strong>
              </div>
              <div className="page-meta-card">
                <span>待入库</span>
                <strong>{pendingIndexCount}</strong>
              </div>
              <div className="page-meta-card">
                <span>处理中任务</span>
                <strong>{activeJobCount}</strong>
              </div>
              <div className="page-meta-card">
                <span>索引状态</span>
                <strong>{currentKb?.reindexRequired ? '待重建' : '最新'}</strong>
              </div>
            </div>
            {lastSubmittedDocIds.length > 0 ? (
              <Alert
                type={failedTrackedJobs.length > 0 ? 'error' : activeTrackedJobs.length > 0 ? 'info' : 'success'}
                showIcon
                message={`最近一次提交：${submissionLabel || '知识导入任务'}`}
                description={
                  failedTrackedJobs.length > 0
                    ? `这批任务里有 ${failedTrackedJobs.length} 个失败项，建议切到“文档与任务”查看诊断。`
                    : activeTrackedJobs.length > 0
                      ? `当前仍有 ${activeTrackedJobs.length} 个任务在处理，这批文档会持续自动刷新。`
                      : `这批文档已结束处理，当前聚焦 ${lastSubmittedDocIds.length} 个提交项。`
                }
              />
            ) : null}
            <Space wrap>
              <Button onClick={() => void handleParse([])} loading={parsingTarget === 'all'} disabled={pendingParseCount === 0}>
                解析待处理
              </Button>
              <Button onClick={() => void handleIndex([])} loading={indexingTarget === 'all'} disabled={pendingIndexCount === 0}>
                入库待处理
              </Button>
              <Button type="primary" icon={<ReloadOutlined />} onClick={() => void handleReindex([])} loading={reindexingTarget === 'all'} disabled={!currentKb}>
                全量重建
              </Button>
            </Space>
          </Space>
        </Card>
      </MotionPanel>
    )
  }

  function renderRetrievePanel() {
    return (
      <MotionPanel hover={false}>
        <Card className="config-panel-card" title="检索测试" extra={<Tag color="blue">{retrieveEffectiveMode || retrieveMode}</Tag>}>
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Space.Compact style={{ width: '100%' }}>
              <Input
                size="large"
                prefix={<SearchOutlined />}
                placeholder="输入问题测试检索效果..."
                value={retrieveQuery}
                onChange={(e) => setRetrieveQuery(e.target.value)}
                onPressEnter={() => void handleRetrieve()}
              />
              <Button type="primary" size="large" icon={<ExperimentOutlined />} onClick={() => void handleRetrieve()} loading={retrieving}>
                检索
              </Button>
            </Space.Compact>

            <Space wrap>
              <Select
                value={retrieveMode}
                onChange={setRetrieveMode}
                options={[
                  { label: '标准 (Keyword)', value: 'keyword' },
                  { label: '平衡 (Hybrid)', value: 'hybrid' },
                  { label: '深度 (Semantic)', value: 'semantic' },
                ]}
                style={{ minWidth: 180 }}
              />
              <Tag>{retrieveHits.length} hits</Tag>
            </Space>

            {retrieveError ? <Alert type="error" showIcon message={retrieveError} /> : null}
            {!retrieveError && retrieveEffectiveMode && retrieveEffectiveMode !== retrieveMode ? (
              <Alert
                type="info"
                showIcon
                message={`检索模式已自动切换为 ${retrieveEffectiveMode}`}
                description="当前知识库状态或绑定配置导致系统使用了更稳妥的实际检索模式。"
              />
            ) : null}
            {retrieveStaleKbNames.length > 0 ? (
              <Alert
                type="warning"
                showIcon
                message="有知识库仍处于待重建索引状态"
                description={`本次检索涉及：${retrieveStaleKbNames.join('、')}。建议先完成重建，再验证语义召回效果。`}
              />
            ) : null}

            {retrieveHits.length > 0 ? (
              <List
                itemLayout="vertical"
                dataSource={retrieveHits}
                renderItem={(item) => (
                  <List.Item style={{ padding: 16, borderRadius: 14, background: 'var(--nb-card-subtle-bg)', marginBottom: 12 }}>
                    <Space direction="vertical" size={8} style={{ width: '100%' }}>
                      <Space wrap>
                        <Tag color="blue">{item.score.toFixed(4)}</Tag>
                        <Tag color="purple">{item.kbName}</Tag>
                        <Text strong>{String(item.metadata?.title || item.title || '未命名文档')}</Text>
                        {item.citation?.sourceType ? <Tag>{item.citation.sourceType}</Tag> : null}
                        {item.citation?.fileName ? <Tag>{item.citation.fileName}</Tag> : null}
                      </Space>
                      <Paragraph ellipsis={{ rows: 3, expandable: true }}>
                        {item.content}
                      </Paragraph>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        Doc ID: {item.docId}
                        {item.citation?.sourceUri ? ` · ${item.citation.sourceUri}` : ''}
                      </Text>
                    </Space>
                  </List.Item>
                )}
              />
            ) : (
              <Empty description="输入问题后即可看到召回结果" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            )}
          </Space>
        </Card>
      </MotionPanel>
    )
  }

  function renderConfigPanel() {
    return (
      <MotionPanel hover={false}>
        <Card className="config-panel-card" title="知识库配置" extra={<Tag color="geekblue">{currentKb?.enabled ? '启用中' : isCreatingKb ? '新建模式' : '未选择'}</Tag>}>
          <div className="studio-form-grid">
            <div className="studio-form-field">
              <Text type="secondary">名称</Text>
              <Input value={form.name} onChange={(e) => updateForm('name', e.target.value)} />
            </div>
            <div className="studio-form-field">
              <Text type="secondary">标签</Text>
              <Input
                value={form.tags.join('\n')}
                onChange={(e) => updateForm('tags', splitTags(e.target.value))}
                placeholder="每行一个标签"
              />
            </div>
            <div className="studio-form-field" style={{ gridColumn: '1 / -1' }}>
              <Text type="secondary">描述</Text>
              <TextArea value={form.description} onChange={(e) => updateForm('description', e.target.value)} rows={3} />
            </div>
            <div className="studio-form-field">
              <Text type="secondary">检索模式</Text>
              <Select
                value={form.mode}
                onChange={(value) => updateForm('mode', value)}
                options={[
                  { label: '标准 (Keyword)', value: 'keyword' },
                  { label: '平衡 (Hybrid)', value: 'hybrid' },
                  { label: '深度 (Semantic)', value: 'semantic' },
                ]}
              />
            </div>
            <div className="studio-form-field">
              <Text type="secondary">知识库后端</Text>
              <Select
                value={form.kbBackend}
                onChange={(value) => updateForm('kbBackend', value)}
                options={[
                  { label: 'SQLite', value: 'sqlite' },
                  { label: 'Milvus', value: 'milvus' },
                ]}
              />
            </div>
            <div className="studio-form-field">
              <Text type="secondary">Vector Collection</Text>
              <Input value={form.vectorCollection} onChange={(e) => updateForm('vectorCollection', e.target.value)} placeholder="例如 kb-docs" />
            </div>
            <div className="studio-form-field">
              <Text type="secondary">自动入库</Text>
              <Select
                value={form.autoIndexAfterParse ? 'enabled' : 'disabled'}
                onChange={(value) => updateForm('autoIndexAfterParse', value === 'enabled')}
                options={[
                  { label: '自动入库', value: 'enabled' },
                  { label: '仅解析', value: 'disabled' },
                ]}
              />
            </div>
            <div className="studio-form-field">
              <Text type="secondary">Chunk Size</Text>
              <InputNumber value={form.chunkSize} min={100} onChange={(value) => updateForm('chunkSize', value || 800)} style={{ width: '100%' }} />
            </div>
            <div className="studio-form-field">
              <Text type="secondary">Chunk Overlap</Text>
              <InputNumber value={form.chunkOverlap} min={0} onChange={(value) => updateForm('chunkOverlap', value || 0)} style={{ width: '100%' }} />
            </div>
            <div className="studio-form-field">
              <Text type="secondary">Top K</Text>
              <InputNumber value={form.topK} min={1} onChange={(value) => updateForm('topK', value || 8)} style={{ width: '100%' }} />
            </div>
            <div className="studio-form-field">
              <Text type="secondary">Chunk Top K</Text>
              <InputNumber value={form.chunkTopK} min={1} onChange={(value) => updateForm('chunkTopK', value || 20)} style={{ width: '100%' }} />
            </div>
            <div className="studio-form-field" style={{ gridColumn: '1 / -1' }}>
              <Text type="secondary">Embedding 模型</Text>
              {renderModelSelectionEditor(
                'embedding',
                form.embeddingModelSelection,
                (providerId) => updateSelection('embedding', providerId),
                (modelName) => updateSelectionModel('embedding', modelName),
              )}
            </div>
            <div className="studio-form-field" style={{ gridColumn: '1 / -1' }}>
              <Text type="secondary">Reranker 模型</Text>
              {renderModelSelectionEditor(
                'reranker',
                form.rerankerModelSelection,
                (providerId) => updateSelection('reranker', providerId),
                (modelName) => updateSelectionModel('reranker', modelName),
              )}
            </div>
          </div>

          <Divider />

          <Space wrap>
            <Button type="primary" icon={<SaveOutlined />} onClick={() => void handleSave()} loading={saving}>
              保存配置
            </Button>
            {currentKb && (
              <Popconfirm title="确定删除此知识库？" onConfirm={() => void handleDelete()} okButtonProps={{ danger: true }}>
                <Button danger icon={<DeleteOutlined />} loading={deleting}>
                  删除
                </Button>
              </Popconfirm>
            )}
          </Space>
        </Card>
      </MotionPanel>
    )
  }

  function renderDocumentsPanel() {
    return (
      <MotionPanel hover={false}>
        <Card className="config-panel-card" title="文档管理" extra={<Tag>{documents.length} 个文档</Tag>}>
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            {lastSubmittedDocIds.length > 0 ? (
              <Alert
                type="info"
                showIcon
                message="当前表格已聚焦最近一次提交的文档"
                description={`已选中 ${selectedDocIds.length} 个文档${submissionLabel ? `，来源：${submissionLabel}` : ''}。`}
              />
            ) : null}
            <Space wrap>
              <Button type="primary" icon={<CloudUploadOutlined />} onClick={() => openUploadDrawer('file')}>
                添加文件
              </Button>
              <Button icon={<GlobalOutlined />} onClick={() => openUploadDrawer('url')}>
                接入 URL
              </Button>
              <Button icon={<QuestionCircleOutlined />} onClick={() => openUploadDrawer('faq')}>
                接入 FAQ
              </Button>
              <Button icon={<ReloadOutlined />} onClick={() => void loadKnowledgeDetail(selectedKbId || currentKb?.kbId || '')} loading={loadingDetail}>
                刷新详情
              </Button>
            </Space>

            <Space wrap>
              <Select
                value={documentStatusFilter}
                onChange={setDocumentStatusFilter}
                style={{ minWidth: 180 }}
                options={[
                  { label: '全部状态', value: 'all' },
                  { label: '仅已上传', value: 'uploaded' },
                  { label: '仅解析中', value: 'parsing' },
                  { label: '仅已解析', value: 'parsed' },
                  { label: '仅索引中', value: 'indexing' },
                  { label: '仅已索引', value: 'indexed' },
                  { label: '解析失败', value: 'error_parsing' },
                  { label: '入库失败', value: 'error_indexing' },
                ]}
              />
              <Input
                prefix={<SearchOutlined />}
                placeholder="按文档名或文件名过滤"
                value={documentQuery}
                onChange={(e) => setDocumentQuery(e.target.value)}
                style={{ maxWidth: 320 }}
              />
              <Button
                onClick={() => {
                  setDocumentQuery('')
                  setDocumentStatusFilter('all')
                  setSelectedDocIds([])
                }}
              >
                清空筛选
              </Button>
            </Space>

            <Table
              dataSource={documents.filter((item) => {
                const matchStatus = documentStatusFilter === 'all' || item.docStatus === documentStatusFilter
                const query = documentQuery.trim().toLowerCase()
                const matchQuery =
                  !query ||
                  item.title.toLowerCase().includes(query) ||
                  (item.fileName || '').toLowerCase().includes(query) ||
                  (item.sourceUri || '').toLowerCase().includes(query)
                return matchStatus && matchQuery
              })}
              columns={documentColumns}
              rowKey="docId"
              loading={loadingDetail}
              pagination={{ pageSize: 10 }}
              rowSelection={{
                selectedRowKeys: selectedDocIds,
                onChange: (keys) => setSelectedDocIds(keys as string[]),
              }}
            />

            {selectedDocIds.length > 0 ? (
              <Space wrap>
                <Button loading={parsingTarget !== null && parsingTarget !== 'all'} onClick={() => void handleParse(selectedDocIds)}>
                  解析选中文档
                </Button>
                <Button loading={indexingTarget !== null && indexingTarget !== 'all'} onClick={() => void handleIndex(selectedDocIds)}>
                  入库选中文档
                </Button>
                <Button icon={<ReloadOutlined />} loading={reindexingTarget === 'all'} onClick={() => void handleReindex(selectedDocIds)}>
                  重建选中文档
                </Button>
                <Button icon={<DeleteOutlined />} danger onClick={() => void handleDeleteDocuments(selectedDocIds)}>
                  批量删除
                </Button>
              </Space>
            ) : null}
          </Space>
        </Card>
      </MotionPanel>
    )
  }

  function renderOverviewPanel() {
    return (
      <MotionPanel hover={false}>
        <Card className="config-panel-card" title="任务与概览">
          <Descriptions column={2} bordered size="small">
            <Descriptions.Item label="知识库状态">{currentKb?.enabled ? '启用' : '停用'}</Descriptions.Item>
            <Descriptions.Item label="索引状态">
              {currentKb?.reindexRequired ? (
                <Tag color="warning">待重建</Tag>
              ) : (
                <Tag color="success">最新</Tag>
              )}
            </Descriptions.Item>
            <Descriptions.Item label="检索模式">{currentKb?.retrievalProfile.mode || 'hybrid'}</Descriptions.Item>
            <Descriptions.Item label="文档数量">{documents.length}</Descriptions.Item>
            <Descriptions.Item label="来源数量">{sources.length}</Descriptions.Item>
            <Descriptions.Item label="Embedding">{modelSelectionSummary(currentKb?.embeddingModelSelection)}</Descriptions.Item>
            <Descriptions.Item label="Reranker">{modelSelectionSummary(currentKb?.rerankerModelSelection)}</Descriptions.Item>
            <Descriptions.Item label="后端">{currentKb?.kbBackend || 'sqlite'}</Descriptions.Item>
            <Descriptions.Item label="Collection">{currentKb?.vectorCollection || '--'}</Descriptions.Item>
          </Descriptions>
          <Divider />
          {jobs.length > 0 ? (
            <List
              size="small"
              header={<Text strong>最近任务</Text>}
              dataSource={jobs.slice(0, 6)}
              renderItem={(job) => (
                <List.Item>
                  <Space direction="vertical" size={2} style={{ width: '100%' }}>
                    <Space wrap>
                      <Tag color={statusBadgeStatus(job.status) === 'success' ? 'success' : statusBadgeStatus(job.status) === 'error' ? 'error' : 'processing'}>
                        {job.status}
                      </Tag>
                      <Text type="secondary">{job.docId}</Text>
                      <Text type="secondary">track {job.trackId}</Text>
                    </Space>
                    {job.errorSummary ? <Text type="danger">{job.errorSummary}</Text> : null}
                    <Text type="secondary">{formatDateTimeZh(job.updatedAt || job.createdAt)}</Text>
                  </Space>
                </List.Item>
              )}
            />
          ) : (
            <Empty description="还没有任务记录" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          )}
        </Card>
      </MotionPanel>
    )
  }

  function renderWorkbenchPlaceholder(title: string, description: string) {
    return (
      <MotionPanel hover={false}>
        <Card className="config-panel-card" title={title} extra={<Tag>暂未开放</Tag>}>
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Alert type="info" showIcon message={title} description={description} />
            <Button disabled block>
              即将支持
            </Button>
          </Space>
        </Card>
      </MotionPanel>
    )
  }

  function renderSourceEditor() {
    if (!selectedSource) {
      return <Empty description="先从左侧选择一个来源" image={Empty.PRESENTED_IMAGE_SIMPLE} />
    }
    return (
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Descriptions size="small" column={1}>
          <Descriptions.Item label="来源类型">
            <Tag color={selectedSource.sourceType === 'file' ? 'geekblue' : selectedSource.sourceType === 'web_url' ? 'cyan' : 'purple'}>
              {selectedSource.sourceType === 'file' ? '文件' : selectedSource.sourceType === 'web_url' ? '网页' : 'FAQ'}
            </Tag>
          </Descriptions.Item>
          <Descriptions.Item label="同步支持">
            {selectedSource.syncSupported ? '支持' : '不支持'}
          </Descriptions.Item>
          <Descriptions.Item label="文档数">{selectedSource.docCount}</Descriptions.Item>
          <Descriptions.Item label="最近同步">{selectedSource.lastSyncedAt ? formatDateTimeZh(selectedSource.lastSyncedAt) : '--'}</Descriptions.Item>
        </Descriptions>
        <div className="studio-form-grid">
          <div className="studio-form-field">
            <Text type="secondary">标题</Text>
            <Input value={sourceEditor.title} onChange={(e) => setSourceEditor((current) => ({ ...current, title: e.target.value }))} />
          </div>
          <div className="studio-form-field">
            <Text type="secondary">启用</Text>
            <Select
              value={sourceEditor.enabled ? 'enabled' : 'disabled'}
              onChange={(value) => setSourceEditor((current) => ({ ...current, enabled: value === 'enabled' }))}
              options={[
                { label: '启用', value: 'enabled' },
                { label: '停用', value: 'disabled' },
              ]}
            />
          </div>
          {selectedSource.sourceType === 'web_url' ? (
            <div className="studio-form-field" style={{ gridColumn: '1 / -1' }}>
              <Text type="secondary">URL</Text>
              <Input prefix={<GlobalOutlined />} value={sourceEditor.url} onChange={(e) => setSourceEditor((current) => ({ ...current, url: e.target.value }))} />
            </div>
          ) : null}
          {selectedSource.sourceType === 'faq_table' ? (
            <div className="studio-form-field" style={{ gridColumn: '1 / -1' }}>
              <Text type="secondary">FAQ Items JSON</Text>
              <TextArea
                rows={8}
                value={sourceEditor.faqItemsText}
                onChange={(e) => setSourceEditor((current) => ({ ...current, faqItemsText: e.target.value }))}
              />
            </div>
          ) : null}
        </div>
        <Space wrap>
          <Button type="primary" icon={<SaveOutlined />} loading={savingSource} onClick={() => void handleSaveSource()}>
            保存来源
          </Button>
          {selectedSource.syncSupported ? (
            <Button
              icon={<CloudSyncOutlined />}
              loading={reindexingTarget === selectedSource.sourceId}
              onClick={() => void handleSyncSource(selectedSource.sourceId)}
            >
              同步来源
            </Button>
          ) : null}
          <Button
            danger
            icon={<DeleteOutlined />}
            loading={deletingSource}
            onClick={() => {
              modal.confirm({
                title: '确定删除这个来源吗？',
                content: '删除来源会同时移除它关联的知识文档和索引数据。',
                okText: '删除',
                cancelText: '取消',
                okButtonProps: { danger: true },
                onOk: async () => {
                  await handleDeleteSource(selectedSource.sourceId)
                },
              })
            }}
          >
            删除来源
          </Button>
        </Space>
      </Space>
    )
  }

  function renderUploadDrawerContent() {
    if (uploadMode === 'file') {
      return (
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Dragger
            name="file"
            multiple
            showUploadList={false}
            customRequest={({ onSuccess }) => {
              setTimeout(() => onSuccess?.('ok'), 0)
            }}
            onChange={(info) => {
              if (info.file.status !== 'uploading') {
                setSelectedFiles((curr) => [...curr, info.file.originFileObj as File])
              }
            }}
            style={{ padding: 24 }}
          >
            <p className="ant-upload-drag-icon">
              <InboxOutlined style={{ color: 'var(--nb-primary)' }} />
            </p>
            <p className="ant-upload-text">点击或拖拽文件到此区域</p>
            <p className="ant-upload-hint">支持 PDF、Markdown、TXT、DOCX 等常见格式</p>
          </Dragger>
          {selectedFiles.length > 0 ? (
            <List
              size="small"
              header={<Text strong>已选择 {selectedFiles.length} 个文件</Text>}
              dataSource={selectedFiles}
              renderItem={(file, index) => (
                <List.Item
                  actions={[
                    <Button
                      key="remove"
                      type="text"
                      danger
                      icon={<DeleteOutlined />}
                      onClick={() => setSelectedFiles((curr) => curr.filter((_, i) => i !== index))}
                    />,
                  ]}
                >
                  <Text ellipsis>{file.name}</Text>
                </List.Item>
              )}
            />
          ) : null}
          <Button type="primary" block icon={<CloudUploadOutlined />} onClick={() => void handleUploadFiles(selectedFiles)} loading={ingesting} disabled={selectedFiles.length === 0}>
            开始上传
          </Button>
        </Space>
      )
    }

    if (uploadMode === 'url') {
      return (
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Alert
            type="info"
            showIcon
            message="URL 接入"
            description="输入单个网页地址，系统会自动抓取并生成可检索文档。"
          />
          <Input
            prefix={<GlobalOutlined />}
            placeholder="https://example.com/page"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
          />
          <Button type="primary" block onClick={() => void handleIngestUrl()} loading={ingesting}>
            开始抓取
          </Button>
        </Space>
      )
    }

    return (
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Alert
          type="info"
          showIcon
          message="FAQ 接入"
          description="把常见问答整理成结构化 FAQ，再交给知识库进行解析与入库。"
        />
        <div className="studio-form-grid">
          <div className="studio-form-field">
            <Text type="secondary">FAQ 标题</Text>
            <Input value={faqTitle} onChange={(e) => setFaqTitle(e.target.value)} placeholder="例如 常见问题" />
          </div>
          <div className="studio-form-field">
            <Text type="secondary">问题</Text>
            <Input value={faqQuestion} onChange={(e) => setFaqQuestion(e.target.value)} placeholder="输入问题" />
          </div>
          <div className="studio-form-field" style={{ gridColumn: '1 / -1' }}>
            <Text type="secondary">答案</Text>
            <TextArea value={faqAnswer} onChange={(e) => setFaqAnswer(e.target.value)} rows={4} placeholder="输入答案" />
          </div>
        </div>
        <Space wrap>
          <Button
            icon={<PlusOutlined />}
            onClick={() => {
              if (!faqQuestion.trim() || !faqAnswer.trim()) {
                setError('请先填写 FAQ 问题和答案。')
                return
              }
              setFaqItems((current) => [...current, { question: faqQuestion.trim(), answer: faqAnswer.trim() }])
              setFaqQuestion('')
              setFaqAnswer('')
            }}
          >
            添加条目
          </Button>
          <Button danger onClick={() => setFaqItems([])} disabled={faqItems.length === 0}>
            清空条目
          </Button>
        </Space>
        <List
          size="small"
          dataSource={faqItems}
          locale={{ emptyText: '还没有 FAQ 条目' }}
          renderItem={(item, index) => (
            <List.Item
              actions={[
                <Button key="delete" type="text" danger icon={<DeleteOutlined />} onClick={() => setFaqItems((curr) => curr.filter((_, i) => i !== index))} />,
              ]}
            >
              <div style={{ width: '100%' }}>
                <Text strong>{item.question}</Text>
                <Paragraph style={{ marginBottom: 0 }} ellipsis={{ rows: 2 }}>
                  {item.answer}
                </Paragraph>
              </div>
            </List.Item>
          )}
        />
        <Button type="primary" block icon={<QuestionCircleOutlined />} onClick={() => void handleIngestFaq()} loading={ingesting} disabled={faqItems.length === 0}>
          提交 FAQ
        </Button>
      </Space>
    )
  }

  if (loadingWorkspace && knowledgeBases.length === 0 && !selectedKbId && !isCreatingKb) {
    return (
      <div className="page-card center-box">
        <Spin />
      </div>
    )
  }

  const kbStats = [
    { label: '知识库', value: knowledgeBases.length },
    { label: '来源', value: sources.length },
    { label: '待解析', value: pendingParseCount },
    { label: '待入库', value: pendingIndexCount },
  ]

  const heroBadges = [
    <Tag key="backend" color={currentKb?.kbBackend === 'milvus' ? 'success' : 'gold'}>
      {currentKb?.kbBackend || 'sqlite'}
    </Tag>,
    currentKb?.reindexRequired ? <Tag key="reindex" color="warning">待重建索引</Tag> : null,
    currentKb?.legacyConfig ? <Tag key="legacy" color="orange">Legacy</Tag> : null,
    currentKb?.autoIndexAfterParse === false ? <Tag key="manual-index" color="orange">手动入库</Tag> : <Tag key="auto-index" color="blue">自动入库</Tag>,
    currentKb?.vectorCollection ? <Tag key="collection">{currentKb.vectorCollection}</Tag> : null,
    currentKb?.embeddingModelSelection ? <Tag key="embedding" color="cyan">Embedding 已绑定</Tag> : null,
    sources.length > 0 ? <Tag key="sources">来源 {sources.length}</Tag> : null,
  ].filter(Boolean)

  return (
    <div className="page-stack">
      <PageHero
        className="page-hero-compact studio-hero"
        eyebrow="企业知识库"
        title="知识库工作台"
        description="把文件、URL、FAQ 和检索测试收束到一个闭环里，尽量对齐 Yuxi-Know 的知识库工作流。"
        stats={kbStats}
        badges={heroBadges}
        actions={(
          <Space wrap>
            <Button icon={<ReloadOutlined />} onClick={() => void loadWorkspace()} loading={loadingWorkspace}>
              刷新
            </Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/studio/knowledge/new')}>
              新建
            </Button>
          </Space>
        )}
      />

      {error ? <Alert type="error" showIcon message={error} style={{ margin: '0 var(--nb-layout-gutter)' }} /> : null}

      <div className="page-content-wrapper" style={{ padding: '0 var(--nb-layout-gutter)' }}>
        <Row gutter={[24, 24]} align="top">
          <Col xs={24} lg={7}>
            <Space direction="vertical" size={24} style={{ width: '100%' }}>
              <Card className="page-card" bordered={false} title="知识库列表" extra={<Tag>{filteredKnowledgeBases.length}/{knowledgeBases.length} 个</Tag>}>
                <Space direction="vertical" size={12} style={{ width: '100%' }}>
                  <Input
                    allowClear
                    prefix={<SearchOutlined />}
                    placeholder="搜索知识库名称、描述、标签"
                    value={kbQuery}
                    onChange={(event) => setKbQuery(event.target.value)}
                  />

                  {knowledgeBases.length === 0 ? (
                    <Empty description="暂无知识库" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                  ) : (
                    <List
                      className="studio-knowledge-list"
                      dataSource={filteredKnowledgeBases}
                      renderItem={(item) => (
                        <List.Item
                          className={`studio-knowledge-list-item${selectedKbId === item.kbId ? ' is-active' : ''}`}
                          onClick={() => navigate(`/studio/knowledge/${item.kbId}`)}
                        >
                          <Space direction="vertical" size={4} style={{ width: '100%' }} className="studio-knowledge-list-copy">
                            <Space align="center" style={{ width: '100%', justifyContent: 'space-between' }}>
                              <Text strong>{item.name}</Text>
                              <Badge status={item.enabled ? 'success' : 'default'} />
                            </Space>
                            <Text type="secondary" ellipsis style={{ fontSize: 12 }}>
                              {item.description || '暂无描述'}
                            </Text>
                            <Space wrap size={6}>
                              <Tag color={item.kbBackend === 'milvus' ? 'success' : 'default'}>
                                {item.kbBackend || 'sqlite'}
                              </Tag>
                              <Tag color={item.autoIndexAfterParse === false ? 'orange' : 'blue'}>
                                {item.autoIndexAfterParse === false ? '手动入库' : '自动入库'}
                              </Tag>
                              {item.reindexRequired ? <Tag color="warning">待重建</Tag> : null}
                              {item.legacyConfig ? <Tag color="orange">Legacy</Tag> : null}
                            </Space>
                          </Space>
                        </List.Item>
                      )}
                    />
                  )}
                </Space>
              </Card>

              <Card
                className="page-card"
                bordered={false}
                title="来源管理"
                extra={<Tag color="geekblue">{enabledSourceCount}/{sources.length || 0} 启用</Tag>}
              >
                <Space direction="vertical" size={12} style={{ width: '100%' }}>
                  <Space wrap>
                    <Button icon={<CloudUploadOutlined />} type="primary" onClick={() => openUploadDrawer('file')}>
                      文件
                    </Button>
                    <Button icon={<GlobalOutlined />} onClick={() => openUploadDrawer('url')}>
                      URL
                    </Button>
                    <Button icon={<QuestionCircleOutlined />} onClick={() => openUploadDrawer('faq')}>
                      FAQ
                    </Button>
                  </Space>

                  {sources.length === 0 ? (
                    <Empty description="暂无来源" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                  ) : (
                    <List
                      className="studio-knowledge-list"
                      size="small"
                      dataSource={sources}
                      renderItem={(item) => (
                        <List.Item
                          className={`studio-knowledge-list-item${selectedSourceId === item.sourceId ? ' is-active' : ''}`}
                          onClick={() => setSelectedSourceId(item.sourceId)}
                          actions={[
                            item.syncSupported ? (
                              <Button
                                key="sync"
                                type="text"
                                icon={<CloudSyncOutlined />}
                                loading={reindexingTarget === item.sourceId}
                                onClick={(event) => {
                                  event.stopPropagation()
                                  void handleSyncSource(item.sourceId)
                                }}
                              />
                            ) : null,
                          ].filter(Boolean)}
                        >
                          <Space direction="vertical" size={2} style={{ width: '100%' }} className="studio-knowledge-list-copy">
                            <Space align="center" style={{ width: '100%', justifyContent: 'space-between' }}>
                              <Text strong ellipsis>{item.title}</Text>
                              <Tag color={item.sourceType === 'file' ? 'geekblue' : item.sourceType === 'web_url' ? 'cyan' : 'purple'}>
                                {item.sourceType === 'file' ? '文件' : item.sourceType === 'web_url' ? '网页' : 'FAQ'}
                              </Tag>
                            </Space>
                            <Text type="secondary" ellipsis style={{ fontSize: 12 }}>
                              {item.sourceUri || item.latestDocument?.title || '未设置地址'}
                            </Text>
                            <Space wrap size={6}>
                              <Tag color={item.enabled ? 'success' : 'default'}>{item.enabled ? '启用' : '停用'}</Tag>
                              <Tag>{item.docCount} 文档</Tag>
                              {item.lastSyncedAt ? <Tag>同步 {formatDateTimeZh(item.lastSyncedAt)}</Tag> : null}
                            </Space>
                          </Space>
                        </List.Item>
                      )}
                    />
                  )}

                  <Divider />
                  <div>
                    <Text strong>当前来源详情</Text>
                    <div style={{ marginTop: 12 }}>{renderSourceEditor()}</div>
                  </div>
                </Space>
              </Card>

              <Card className="page-card" bordered={false} title="快捷入口">
                <Space direction="vertical" size={8}>
                  <Text type="secondary">文件、URL、FAQ 三种接入方式都在这里。</Text>
                  <Text type="secondary">先接入来源，再在右侧完成检索验证和配置调整。</Text>
                </Space>
              </Card>
            </Space>
          </Col>

          <Col xs={24} lg={17}>
            <Space direction="vertical" size={24} style={{ width: '100%' }}>
              {renderRightBanners()}
              {renderQueueCard()}

              <Card className="config-panel-card" title="工作台分区" extra={<Tag color="geekblue">Studio</Tag>}>
                <Tabs
                  className="console-tabs"
                  activeKey={workbenchTab}
                  onChange={setWorkbenchTab}
                  items={[
                    {
                      key: 'retrieve',
                      label: `检索测试 (${retrieveHits.length})`,
                      children: renderRetrievePanel(),
                    },
                    {
                      key: 'documents',
                      label: `文档与任务 (${documents.length})`,
                      children: (
                        <Space direction="vertical" size={24} style={{ width: '100%' }}>
                          {renderDocumentsPanel()}
                          {renderOverviewPanel()}
                        </Space>
                      ),
                    },
                    {
                      key: 'config',
                      label: `配置 ${currentKb?.enabled ? '' : '(草稿)'}`.trim(),
                      children: renderConfigPanel(),
                    },
                    {
                      key: 'graph',
                      label: '知识图谱',
                      children: renderWorkbenchPlaceholder('知识图谱', '预留知识图谱与知识导图区域，后续会接入更强的结构化关系视图。'),
                    },
                    {
                      key: 'evaluation',
                      label: 'RAG 评估',
                      children: renderWorkbenchPlaceholder('RAG 评估', '预留召回质量、引用完整性和答案可追溯性的评估看板。'),
                    },
                    {
                      key: 'benchmark',
                      label: '评估基准',
                      children: renderWorkbenchPlaceholder('评估基准', '预留评测集、回归基线和知识库版本对比能力。'),
                    },
                  ]}
                />
              </Card>
            </Space>
          </Col>
        </Row>
      </div>

      <Drawer
        title={
          uploadMode === 'file'
            ? '添加文件'
            : uploadMode === 'url'
              ? '接入 URL'
              : '接入 FAQ'
        }
        open={uploadDrawerOpen}
        onClose={closeUploadDrawer}
        width={640}
        destroyOnClose
        extra={(
          <Space>
            <Button onClick={closeUploadDrawer}>取消</Button>
            {uploadMode === 'file' ? (
              <Button type="primary" icon={<CloudUploadOutlined />} loading={ingesting} disabled={selectedFiles.length === 0} onClick={() => void handleUploadFiles(selectedFiles)}>
                上传
              </Button>
            ) : uploadMode === 'url' ? (
              <Button type="primary" icon={<GlobalOutlined />} loading={ingesting} onClick={() => void handleIngestUrl()}>
                提交
              </Button>
            ) : (
              <Button type="primary" icon={<QuestionCircleOutlined />} loading={ingesting} disabled={faqItems.length === 0} onClick={() => void handleIngestFaq()}>
                提交
              </Button>
            )}
          </Space>
        )}
      >
        {renderUploadDrawerContent()}
      </Drawer>

    </div>
  )
}
