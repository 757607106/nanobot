import { startTransition, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { ErrorBoundary } from '../../components/ErrorBoundary'
import { Button, Flex, Input, InputNumber, Modal, Select, Space, Splitter, Switch, Typography, theme } from 'antd'
import {
  BranchesOutlined,
  DatabaseOutlined,
  DeleteOutlined,
  FileSearchOutlined,
  FileTextOutlined,
  PlusOutlined,
  ReloadOutlined,
} from '@ant-design/icons'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { api } from '../../api'
import MetricCard from '../../components/console/MetricCard'
import PageHeader from '../../components/console/PageHeader'
import { getAllModelBindings, normalizeModelConfig, resolveBindingCapabilityType } from '../../modelConfig'
import type {
  ConfigData,
  ConfigMeta,
  KnowledgeBaseDefinition,
  KnowledgeBenchmark,
  KnowledgeBenchmarkDetail,
  KnowledgeDocument,
  KnowledgeEvaluationResult,
  KnowledgeEvaluationSummary,
  KnowledgeFileDetail,
  KnowledgeFileListResponse,
  KnowledgeGraphData,
  KnowledgeGraphStats,
  KnowledgeMindmapNode,
  KnowledgeQueryParams,
  KnowledgeQueryParamSchema,
  KnowledgeRetrieveResult,
  KnowledgeIngestJob,
  ModelBinding,
} from '../../types'
import {
  CHUNK_PRESET_OPTIONS,
  LANGUAGE_OPTIONS,
  KNOWLEDGE_ARCHITECTURE_LABEL,
  buildKnowledgeAdditionalParams,
  canDeleteKnowledgeFile,
  canIndexKnowledgeFile,
  canParseKnowledgeFile,
  createEmptyListState,
  createIndexConfigState,
  createKnowledgeFormState,
  getDefaultQueryParams,
  getErrorMessage,
  parseTags,
  type KnowledgeFormState,
  type KnowledgeIndexConfigState,
} from './shared'
import { KnowledgeBenchmarkPreviewModal } from './KnowledgeBenchmarkPreviewModal'
import { KnowledgeEvaluationResultModal } from './KnowledgeEvaluationResultModal'
import { KnowledgeFileDetailModal } from './KnowledgeFileDetailModal'
import { KnowledgeUploadModal } from './KnowledgeUploadModal'
import {
  buildKnowledgeBenchmarkColumns,
  buildKnowledgeEvaluationColumns,
} from './columns'
import KnowledgeList from './KnowledgeList'
import KnowledgeWorkspace from './KnowledgeWorkspace'
import { KnowledgeProvider } from './KnowledgeContext'
import type { KnowledgeContextValue } from './KnowledgeContext'
import './knowledge.css'
import { useToast } from '../../toast'

export default function KnowledgePage() {
  const message = useToast()
  const navigate = useNavigate()
  const location = useLocation()
  const { kbId } = useParams()
  const { token } = theme.useToken()
  const selectedKbId = kbId && kbId !== 'new' ? kbId : null
  const shouldOpenCreateModal = location.pathname.endsWith('/knowledge/new')
  const benchmarkUploadInputRef = useRef<HTMLInputElement | null>(null)

  // ─── Core data ───
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBaseDefinition[]>([])
  const [modelConfig, setModelConfig] = useState<ConfigData | null>(null)
  const [configMeta, setConfigMeta] = useState<ConfigMeta | null>(null)
  const [currentKb, setCurrentKb] = useState<KnowledgeBaseDefinition | null>(null)
  const [filesState, setFilesState] = useState<KnowledgeFileListResponse>(createEmptyListState)
  const [jobs, setJobs] = useState<KnowledgeIngestJob[]>([])
  const [activeTab, setActiveTab] = useState('files')
  const [selectedFileIds, setSelectedFileIds] = useState<string[]>([])
  const [fileSearch, setFileSearch] = useState('')
  const [knowledgeSearch, setKnowledgeSearch] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [formState, setFormState] = useState<KnowledgeFormState>(() => createKnowledgeFormState())
  const [indexConfig, setIndexConfig] = useState<KnowledgeIndexConfigState>(() => createIndexConfigState())

  // ─── Query state ───
  const [queryParams, setQueryParams] = useState<KnowledgeQueryParams>(() => getDefaultQueryParams())
  const [queryText, setQueryText] = useState('')
  const [queryResult, setQueryResult] = useState<KnowledgeRetrieveResult | null>(null)
  const [resultView, setResultView] = useState<'formatted' | 'raw'>('formatted')
  const [sampleQuestions, setSampleQuestions] = useState<string[]>([])
  const [queryParamSchema, setQueryParamSchema] = useState<KnowledgeQueryParamSchema | null>(null)

  // ─── Visualization ───
  const [mindmap, setMindmap] = useState<KnowledgeMindmapNode | null>(null)
  const [graphData, setGraphData] = useState<KnowledgeGraphData | null>(null)
  const [graphStats, setGraphStats] = useState<KnowledgeGraphStats | null>(null)
  const [graphConfig, setGraphConfig] = useState({ label: '*', depth: 2, maxNodes: 50 })

  // ─── Benchmark & evaluation ───
  const [benchmarks, setBenchmarks] = useState<KnowledgeBenchmark[]>([])
  const [benchmarkPreview, setBenchmarkPreview] = useState<KnowledgeBenchmarkDetail | null>(null)
  const [benchmarkPreviewPage, setBenchmarkPreviewPage] = useState(1)
  const [benchmarkPreviewPageSize, setBenchmarkPreviewPageSize] = useState(20)
  const [evaluationHistory, setEvaluationHistory] = useState<KnowledgeEvaluationSummary[]>([])
  const [evaluationResult, setEvaluationResult] = useState<KnowledgeEvaluationResult | null>(null)
  const [evaluationErrorOnly, setEvaluationErrorOnly] = useState(false)
  const [selectedBenchmarkId, setSelectedBenchmarkId] = useState<string | null>(null)
  const [fileDetail, setFileDetail] = useState<KnowledgeFileDetail | null>(null)
  const [urlParentId, setUrlParentId] = useState<string | null>(null)

  // ─── Loading states ───
  const [loading, setLoading] = useState({
    workspace: true,
    detail: false,
    query: false,
    graph: false,
    mindmap: false,
    benchmark: false,
    evaluation: false,
    saving: false,
    creating: false,
    generatingDescription: false,
    parsing: false,
    indexing: false,
    uploadingBenchmark: false,
    generatingBenchmark: false,
    runningEvaluation: false,
    fileDetail: false,
    benchmarkPreview: false,
  })
  function setLoadingField(field: keyof typeof loading, value: boolean) {
    setLoading((prev) => ({ ...prev, [field]: value }))
  }

  // ─── Modal states ───
  const [modals, setModals] = useState({
    create: shouldOpenCreateModal,
    folder: false,
    url: false,
    move: false,
    indexConfig: false,
    queryConfig: false,
    benchmarkGenerate: false,
    benchmarkUpload: false,
    evaluationResult: false,
    fileDetail: false,
  })
  function openModal(name: keyof typeof modals) {
    setModals((prev) => ({ ...prev, [name]: true }))
  }
  function closeModal(name: keyof typeof modals) {
    setModals((prev) => ({ ...prev, [name]: false }))
  }

  // ─── Form states ───
  const [folderForm, setFolderForm] = useState({ name: '', parentId: null as string | null })
  const [moveForm, setMoveForm] = useState({ targetParentId: null as string | null, targetName: '' })
  const [benchmarkUploadForm, setBenchmarkUploadForm] = useState({
    name: '', description: '', file: null as File | null,
  })
  const [benchmarkGenerateForm, setBenchmarkGenerateForm] = useState({
    name: '自动生成评估基准', description: '', count: 10,
  })

  // ─── Form reset helpers ───
  function resetFolderForm() {
    setFolderForm({ name: '', parentId: null })
  }
  function resetMoveForm() {
    setMoveForm({ targetParentId: null, targetName: '' })
  }
  function resetBenchmarkUploadForm() {
    setBenchmarkUploadForm({ name: '', description: '', file: null })
  }
  function resetBenchmarkGenerateForm() {
    setBenchmarkGenerateForm({ name: '自动生成评估基准', description: '', count: 10 })
  }

  const deferredFileSearch = useDeferredValue(fileSearch)
  const modelBindings = useMemo(
    () => (modelConfig && configMeta ? getAllModelBindings(modelConfig, configMeta) : {}),
    [modelConfig, configMeta],
  )

  function getBindingModel(bindingName: string) {
    return String(modelBindings[bindingName]?.model || '').trim()
  }

  function buildKnowledgeBindingOptions(capability: 'embedding' | 'llm' | 'rerank') {
    return Object.entries(modelBindings)
      .filter(([, binding]) => {
        const resolved = resolveBindingCapabilityType(binding)
        if (capability === 'embedding') {
          return resolved === 'embedding'
        }
        if (capability === 'rerank') {
          return resolved === 'rerank'
        }
        return resolved === 'text_chat' || resolved === 'multimodal'
      })
      .map(([bindingName, binding]) => ({
        value: bindingName,
        label: String(binding.model || bindingName).trim() || bindingName,
      }))
      .sort((left, right) => left.label.localeCompare(right.label))
  }

  const embeddingBindingOptions = useMemo(
    () => buildKnowledgeBindingOptions('embedding'),
    [modelBindings],
  )
  const llmBindingOptions = useMemo(
    () => buildKnowledgeBindingOptions('llm'),
    [modelBindings],
  )
  const rerankBindingOptions = useMemo(
    () => buildKnowledgeBindingOptions('rerank'),
    [modelBindings],
  )
  const multimodalBindingOptions = useMemo(
    () => Object.entries(modelBindings)
      .filter(([, binding]) => {
        const resolved = resolveBindingCapabilityType(binding)
        return resolved === 'multimodal'
      })
      .map(([bindingName, binding]) => ({
        value: bindingName,
        label: String(binding.model || bindingName).trim() || bindingName,
      }))
      .sort((left, right) => left.label.localeCompare(right.label)),
    [modelBindings],
  )
  const defaultEmbeddingBindingName = useMemo(
    () => String(modelConfig?.rag?.embeddingBinding || '').trim() || embeddingBindingOptions[0]?.value || '',
    [modelConfig, embeddingBindingOptions],
  )
  const defaultLlmBindingName = useMemo(
    () => String(modelConfig?.rag?.llmBinding || '').trim() || llmBindingOptions[0]?.value || '',
    [modelConfig, llmBindingOptions],
  )
  const defaultRerankBindingName = useMemo(
    () => String(modelConfig?.rag?.rerankBinding || '').trim() || '',
    [modelConfig],
  )
  const defaultVisionBindingName = useMemo(
    () => String(modelConfig?.rag?.visionBinding || '').trim() || multimodalBindingOptions[0]?.value || '',
    [modelConfig, multimodalBindingOptions],
  )

  function findBindingNameByModel(modelName: string, capability: 'embedding' | 'text_chat' | 'multimodal') {
    const target = String(modelName || '').trim()
    if (!target) {
      return ''
    }
    const matched = Object.entries(modelBindings).find(([, binding]) => (
      String(binding.model || '').trim() === target
      && resolveBindingCapabilityType(binding) === capability
    ))
    return matched?.[0] || ''
  }

  function createKnowledgeForm(kb?: KnowledgeBaseDefinition | null) {
    return createKnowledgeFormState(kb, {
      embedBindingName: defaultEmbeddingBindingName,
      embedModelName: getBindingModel(defaultEmbeddingBindingName),
      llmBindingName: defaultLlmBindingName,
      llmModelName: getBindingModel(defaultLlmBindingName),
      rerankBindingName: defaultRerankBindingName,
      rerankModelName: getBindingModel(defaultRerankBindingName),
      visionBindingName: defaultVisionBindingName,
      visionModelName: getBindingModel(defaultVisionBindingName),
    })
  }

  useEffect(() => {
    void loadKnowledgeBases()
    void loadModelConfig()
  }, [])

  useEffect(() => {
    setModals((prev) => ({ ...prev, create: shouldOpenCreateModal }))
  }, [shouldOpenCreateModal])

  useEffect(() => {
    if (!selectedKbId) {
      setCurrentKb(null)
      setFormState(createKnowledgeForm())
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
      setFileDetail(null)
      closeModal('fileDetail')
      setActiveTab('files')
      return
    }
    setActiveTab('files')
    void loadKnowledgeDetail(selectedKbId)
  }, [selectedKbId, defaultEmbeddingBindingName, defaultLlmBindingName, defaultRerankBindingName, defaultVisionBindingName])



  useEffect(() => {
    if (activeTab === 'graph' && currentKb) {
      void loadGraph(currentKb.kbId)
    }
  }, [activeTab, currentKb, graphConfig.depth, graphConfig.maxNodes])

  useEffect(() => {
    if (activeTab === 'mindmap' && currentKb && !mindmap && !loading.mindmap) {
      void loadMindmap(currentKb.kbId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, currentKb])

  useEffect(() => {
    if (Object.keys(modelBindings).length === 0) {
      return
    }
    setFormState((prev) => {
      let nextEmbedBindingName = prev.embedBindingName
      let nextLlmBindingName = prev.llmBindingName

      if (!nextEmbedBindingName && prev.embedModelName) {
        nextEmbedBindingName = findBindingNameByModel(prev.embedModelName, 'embedding')
      }
      if (!nextLlmBindingName && prev.llmModelName) {
        nextLlmBindingName = findBindingNameByModel(prev.llmModelName, 'text_chat')
          || findBindingNameByModel(prev.llmModelName, 'multimodal')
      }
      if (!nextEmbedBindingName) {
        nextEmbedBindingName = defaultEmbeddingBindingName
      }
      if (!nextLlmBindingName) {
        nextLlmBindingName = defaultLlmBindingName
      }

      const nextEmbedModelName = getBindingModel(nextEmbedBindingName) || prev.embedModelName
      const nextLlmModelName = getBindingModel(nextLlmBindingName) || prev.llmModelName
      if (
        nextEmbedBindingName === prev.embedBindingName
        && nextEmbedModelName === prev.embedModelName
        && nextLlmBindingName === prev.llmBindingName
        && nextLlmModelName === prev.llmModelName
      ) {
        return prev
      }
      return {
        ...prev,
        embedBindingName: nextEmbedBindingName,
        embedModelName: nextEmbedModelName,
        llmBindingName: nextLlmBindingName,
        llmModelName: nextLlmModelName,
      }
    })
  }, [
    defaultEmbeddingBindingName,
    defaultLlmBindingName,
    formState.embedBindingName,
    formState.embedModelName,
    formState.llmBindingName,
    formState.llmModelName,
    modelBindings,
  ])

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
      .filter((item) => !item.isFolder && canIndexKnowledgeFile(item.status, true))
      .map((item) => item.fileId),
    [selectedFiles],
  )
  const pendingParseFileIds = useMemo(
    () => filesState.items.filter((item) => !item.isFolder && item.status === 'uploaded').map((item) => item.fileId),
    [filesState.items],
  )
  const pendingIndexFileIds = useMemo(() => {
    return filesState.items
      .filter((item) => {
        if (item.isFolder) return false
        return item.status === 'parsed' || item.status === 'error_indexing'
      })
      .map((item) => item.fileId)
  }, [filesState.items])

  const hasSelectedFiles = selectedFiles.length > 0
  const canParseSelectedDocuments = parseableSelectedFileIds.length > 0
  const canIndexSelectedDocuments = indexableSelectedFileIds.length > 0
  const hasSingleSelection = selectedFiles.length === 1
  const pendingParseCount = pendingParseFileIds.length
  const pendingIndexCount = pendingIndexFileIds.length
  const visibleKnowledgeBases = useMemo(() => {
    const query = knowledgeSearch.trim().toLowerCase()
    if (!query) {
      return knowledgeBases
    }
    return knowledgeBases.filter((item) => (
      item.name.toLowerCase().includes(query)
      || item.description.toLowerCase().includes(query)
      || item.kbId.toLowerCase().includes(query)
      || item.tags.some((tag) => tag.toLowerCase().includes(query))
    ))
  }, [knowledgeBases, knowledgeSearch])
  const visibleFiles = useMemo(() => {
    const query = deferredFileSearch.trim().toLowerCase()
    const filtered = query
      ? filesState.items.filter((item) => (
          item.filename.toLowerCase().includes(query)
          || item.path.toLowerCase().includes(query)
          || item.title.toLowerCase().includes(query)
        ))
      : filesState.items

    return filtered.slice().sort((left, right) => {
      if (left.isFolder !== right.isFolder) {
        return left.isFolder ? -1 : 1
      }
      return left.path.localeCompare(right.path)
    })
  }, [deferredFileSearch, filesState.items])
  const aggregateStats = useMemo(() => {
    return knowledgeBases.reduce((current, item) => ({
      knowledgeBaseCount: current.knowledgeBaseCount + 1,
      fileCount: current.fileCount + (item.stats?.fileCount || 0),
      indexedCount: current.indexedCount + (item.stats?.indexedCount || 0),
      errorCount: current.errorCount + (item.stats?.errorCount || 0),
      enabledCount: current.enabledCount + (item.enabled ? 1 : 0),
    }), {
      knowledgeBaseCount: 0,
      fileCount: 0,
      indexedCount: 0,
      errorCount: 0,
      enabledCount: 0,
    })
  }, [knowledgeBases])

  async function loadModelConfig() {
    try {
      const [configResult, metaResult] = await Promise.all([
        api.getConfig(),
        api.getConfigMeta(),
      ])
      setModelConfig(normalizeModelConfig(configResult, metaResult))
      setConfigMeta(metaResult)
    } catch (loadError) {
      message.error(getErrorMessage(loadError, '加载知识库模型配置失败'))
    }
  }

  async function loadKnowledgeBases() {
    try {
      setLoadingField('workspace', true)
      const items = await api.getKnowledgeBases()
      setKnowledgeBases(items)
      setError(null)
    } catch (loadError) {
      setError(getErrorMessage(loadError, '加载知识库列表失败'))
    } finally {
      setLoadingField('workspace', false)
    }
  }

  async function loadKnowledgeDetail(nextKbId: string) {
    try {
      setLoadingField('detail', true)
      const [kb, filePayload, jobPayload, querySchemaPayload, questionPayload, graphStatsPayload] = await Promise.all([
        api.getKnowledgeBase(nextKbId),
        api.getKnowledgeFiles(nextKbId),
        api.getKnowledgeJobs(nextKbId),
        api.getKnowledgeQueryParamSchema(nextKbId).catch(() => null),
        api.getKnowledgeSampleQuestions(nextKbId).catch(() => ({ questions: [] })),
        api.getKnowledgeGraphStats(nextKbId).catch(() => null),
      ])
      setCurrentKb(kb)
      setFormState(createKnowledgeForm(kb))
      setIndexConfig(createIndexConfigState(kb))
      setFilesState(filePayload)
      setJobs(jobPayload)
      const defaultQueryParams = getDefaultQueryParams()
      setQueryParams({
        ...defaultQueryParams,
        ...(kb.query_params || {}),
        options: {
          ...(defaultQueryParams.options || {}),
          ...(kb.query_params?.options || {}),
        },
      })
      setQueryParamSchema(querySchemaPayload)
      setSampleQuestions(questionPayload.questions || [])
      setMindmap(null)
      setGraphStats(graphStatsPayload)
      setActiveTab((previous) => {
        const isSwitchingKb = currentKb?.kbId !== kb.kbId
        if (isSwitchingKb) {
          return 'files'
        }
        return previous || 'files'
      })
      await loadBenchmarkState(nextKbId)
      setError(null)
      setSelectedFileIds([])
    } catch (loadError) {
      setError(getErrorMessage(loadError, '加载知识库详情失败'))
    } finally {
      setLoadingField('detail', false)
    }
  }

  async function loadMindmap(targetKbId: string) {
    try {
      setLoadingField('mindmap', true)
      const payload = await api.getKnowledgeMindmap(targetKbId)
      setMindmap(payload.mindmap)
    } catch {
      setMindmap(null)
    } finally {
      setLoadingField('mindmap', false)
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
      setLoadingField('benchmark', true)
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
      setLoadingField('benchmark', false)
    }
  }

  function buildKnowledgeModelInfo(kind: 'embedding' | 'llm') {
    const bindingName = kind === 'embedding' ? formState.embedBindingName : formState.llmBindingName
    const fallbackModelName = kind === 'embedding' ? formState.embedModelName : formState.llmModelName
    const binding = modelBindings[bindingName] as ModelBinding | undefined
    const modelName = String(binding?.model || fallbackModelName || '').trim()
    if (!bindingName && !modelName) {
      return {}
    }
    return {
      bindingName: bindingName || null,
      modelName: modelName || null,
      model: modelName || null,
      provider: binding?.provider || null,
      label: binding?.label || bindingName || null,
      capabilityType: binding ? resolveBindingCapabilityType(binding) : (kind === 'embedding' ? 'embedding' : 'text_chat'),
    }
  }

  async function handleCreateKnowledgeBase() {
    try {
      setLoadingField('creating', true)
      const created = await api.createKnowledgeBase({
        name: formState.name.trim(),
        description: formState.description.trim(),
        enabled: formState.enabled,
        embedInfo: buildKnowledgeModelInfo('embedding'),
        llmInfo: buildKnowledgeModelInfo('llm'),
        additionalParams: buildKnowledgeAdditionalParams(null, formState, indexConfig),
        tags: parseTags(formState.tagsText),
      })
      message.success('知识库已创建')
      closeModal('create')
      setFormState(createKnowledgeForm())
      setIndexConfig(createIndexConfigState())
      await loadKnowledgeBases()
      startTransition(() => navigate(`/knowledge/${created.kbId}`))
    } catch (createError) {
      message.error(getErrorMessage(createError, '创建知识库失败'))
    } finally {
      setLoadingField('creating', false)
    }
  }

  async function handleSaveKnowledgeBase() {
    if (!currentKb) return
    try {
      setLoadingField('saving', true)
      const updated = await api.updateKnowledgeBase(currentKb.kbId, {
        name: formState.name.trim(),
        description: formState.description.trim(),
        enabled: formState.enabled,
        embedInfo: buildKnowledgeModelInfo('embedding'),
        llmInfo: buildKnowledgeModelInfo('llm'),
        additionalParams: buildKnowledgeAdditionalParams(currentKb.additionalParams, formState, indexConfig),
        tags: parseTags(formState.tagsText),
      })
      setCurrentKb(updated)
      setFormState(createKnowledgeForm(updated))
      setIndexConfig(createIndexConfigState(updated))
      message.success('知识库设置已保存')
      await loadKnowledgeBases()
    } catch (saveError) {
      message.error(getErrorMessage(saveError, '保存知识库设置失败'))
    } finally {
      setLoadingField('saving', false)
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
      setLoadingField('generatingDescription', true)
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
      setLoadingField('generatingDescription', false)
    }
  }

  async function handleCreateFolder() {
    if (!currentKb || !folderForm.name.trim()) return
    try {
      await api.createKnowledgeFolder(currentKb.kbId, {
        name: folderForm.name.trim(),
        parentId: folderForm.parentId,
      })
      message.success('文件夹已创建')
      closeModal('folder')
      resetFolderForm()
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
      setLoadingField('parsing', true)
      await api.parseKnowledgeFiles(currentKb.kbId, { fileIds: targetFileIds })
      message.success('解析任务已提交')
      await loadKnowledgeDetail(currentKb.kbId)
    } catch (parseError) {
      message.error(getErrorMessage(parseError, '提交解析任务失败'))
    } finally {
      setLoadingField('parsing', false)
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
      setLoadingField('indexing', true)
      await api.indexKnowledgeFiles(currentKb.kbId, {
        fileIds: targetFileIds,
        params: {
          chunk_size: indexConfig.chunkSize,
          chunk_overlap: indexConfig.chunkOverlap,
          chunk_preset_id: indexConfig.chunkPresetId,
          qa_separator: indexConfig.qaSeparator.trim() || undefined,
        },
      })
      message.success('索引任务已提交')
      await loadKnowledgeDetail(currentKb.kbId)
      await loadKnowledgeBases()
    } catch (indexError) {
      message.error(getErrorMessage(indexError, '提交索引任务失败'))
    } finally {
      setLoadingField('indexing', false)
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
        targetParentId: moveForm.targetParentId,
        filename: moveForm.targetName.trim() || target.filename,
      })
      closeModal('move')
      resetMoveForm()
      await loadKnowledgeDetail(currentKb.kbId)
      message.success('文件位置已更新')
    } catch (moveError) {
      message.error(getErrorMessage(moveError, '移动文件失败'))
    }
  }

  function openMoveModal() {
    if (!hasSingleSelection) return
    setMoveForm({
      targetParentId: selectedFiles[0].parentId || null,
      targetName: selectedFiles[0].filename,
    })
    openModal('move')
  }

  async function handleOpenFileDetail(target: KnowledgeDocument) {
    if (!currentKb || target.isFolder) return
    try {
      openModal('fileDetail')
      setLoadingField('fileDetail', true)
      const detail = await api.getKnowledgeFileDetail(currentKb.kbId, target.fileId)
      setFileDetail(detail)
    } catch (detailError) {
      closeModal('fileDetail')
      setFileDetail(null)
      message.error(getErrorMessage(detailError, '加载文件详情失败'))
    } finally {
      setLoadingField('fileDetail', false)
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
      case 'top_k':
        return queryParams.top_k
      case 'chunk_top_k':
        return queryParams.chunk_top_k
      case 'response_type':
        return queryParams.response_type
      case 'only_need_context':
        return queryParams.only_need_context
      case 'only_need_prompt':
        return queryParams.only_need_prompt
      case 'enable_rerank':
        return queryParams.enable_rerank
      default:
        return queryParams.options?.[key]
    }
  }

  function setQueryConfigValue(key: string, value: unknown) {
    switch (key) {
      case 'mode':
        setQueryParams((prev) => ({ ...prev, mode: String(value || prev.mode) }))
        return
      case 'top_k':
        setQueryParams((prev) => ({ ...prev, top_k: Number(value || prev.top_k || 10) }))
        return
      case 'chunk_top_k':
        setQueryParams((prev) => ({ ...prev, chunk_top_k: Number(value || prev.chunk_top_k || 12) }))
        return
      case 'response_type':
        setQueryParams((prev) => ({ ...prev, response_type: String(value || prev.response_type) }))
        return
      case 'only_need_context':
        setQueryParams((prev) => ({ ...prev, only_need_context: Boolean(value) }))
        return
      case 'only_need_prompt':
        setQueryParams((prev) => ({ ...prev, only_need_prompt: Boolean(value) }))
        return
      case 'enable_rerank':
        setQueryParams((prev) => ({ ...prev, enable_rerank: Boolean(value) }))
        return
      default:
        updateQueryOption(key, value)
    }
  }

  async function handleQuery(nextQuery?: string) {
    const query = (nextQuery ?? queryText).trim()
    if (!currentKb || !query) return
    try {
      setLoadingField('query', true)
      const result = await api.queryKnowledgeBase(currentKb.kbId, {
        query,
        mode: queryParams.mode,
        top_k: queryParams.top_k,
        chunk_top_k: queryParams.chunk_top_k,
        enable_rerank: queryParams.enable_rerank,
        only_need_context: false,
        only_need_prompt: false,
        ...queryParams.options,
      })
      setQueryResult(result)
    } catch (queryError) {
      message.error(getErrorMessage(queryError, '知识库查询失败'))
    } finally {
      setLoadingField('query', false)
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
      setLoadingField('mindmap', true)
      const payload = await api.generateKnowledgeMindmap(currentKb.kbId)
      setMindmap(payload.mindmap)
      message.success('知识导图已生成')
    } catch (generateError) {
      message.error(getErrorMessage(generateError, '生成知识导图失败'))
    } finally {
      setLoadingField('mindmap', false)
    }
  }

  async function loadGraph(targetKbId: string) {
    try {
      setLoadingField('graph', true)
      const [graph, stats] = await Promise.all([
        api.getKnowledgeGraph(targetKbId, {
          nodeLabel: graphConfig.label,
          maxDepth: graphConfig.depth,
          maxNodes: graphConfig.maxNodes,
        }),
        api.getKnowledgeGraphStats(targetKbId).catch(() => null),
      ])
      setGraphData(graph)
      setGraphStats(stats)
    } catch (graphError) {
      message.error(getErrorMessage(graphError, '加载知识图谱失败'))
    } finally {
      setLoadingField('graph', false)
    }
  }

  async function handleUploadBenchmark() {
    if (!currentKb || !benchmarkUploadForm.file) return
    try {
      setLoadingField('uploadingBenchmark', true)
      await api.uploadKnowledgeBenchmark(currentKb.kbId, {
        file: benchmarkUploadForm.file,
        name: benchmarkUploadForm.name.trim() || benchmarkUploadForm.file.name.replace(/\.jsonl$/i, ''),
        description: benchmarkUploadForm.description.trim(),
      })
      message.success('评估基准已上传')
      closeModal('benchmarkUpload')
      resetBenchmarkUploadForm()
      await loadBenchmarkState(currentKb.kbId)
    } catch (uploadError) {
      message.error(getErrorMessage(uploadError, '上传评估基准失败'))
    } finally {
      setLoadingField('uploadingBenchmark', false)
    }
  }

  async function handleGenerateBenchmark() {
    if (!currentKb) return
    try {
      setLoadingField('generatingBenchmark', true)
      await api.generateKnowledgeBenchmark(currentKb.kbId, {
        count: benchmarkGenerateForm.count,
        name: benchmarkGenerateForm.name.trim() || '自动生成评估基准',
        description: benchmarkGenerateForm.description.trim(),
      })
      message.success('评估基准已生成')
      closeModal('benchmarkGenerate')
      resetBenchmarkGenerateForm()
      await loadBenchmarkState(currentKb.kbId)
    } catch (generateError) {
      message.error(getErrorMessage(generateError, '生成评估基准失败'))
    } finally {
      setLoadingField('generatingBenchmark', false)
    }
  }

  async function handlePreviewBenchmark(benchmark: KnowledgeBenchmark, page = 1, pageSize = 20) {
    if (!currentKb) return
    try {
      setLoadingField('benchmarkPreview', true)
      setBenchmarkPreviewPage(page)
      setBenchmarkPreviewPageSize(pageSize)
      const detail = await api.getKnowledgeBenchmarkDetail(currentKb.kbId, benchmark.benchmarkId, page, pageSize)
      setBenchmarkPreview(detail)
    } catch (previewError) {
      message.error(getErrorMessage(previewError, '加载评估基准详情失败'))
    } finally {
      setLoadingField('benchmarkPreview', false)
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
      setLoadingField('runningEvaluation', true)
      const payload = await api.runKnowledgeEvaluation(currentKb.kbId, {
        benchmarkId: selectedBenchmarkId,
      })
      message.success(`评测任务已启动：${payload.taskId}`)
      await loadBenchmarkState(currentKb.kbId)
    } catch (runError) {
      message.error(getErrorMessage(runError, '启动评测失败'))
    } finally {
      setLoadingField('runningEvaluation', false)
    }
  }

  async function handleViewEvaluationResult(taskId: string, errorOnly = false) {
    if (!currentKb) return
    try {
      setLoadingField('evaluation', true)
      const result = await api.getKnowledgeEvaluationResult(currentKb.kbId, taskId, {
        page: 1,
        pageSize: 20,
        errorOnly,
      })
      setEvaluationResult(result)
      setEvaluationErrorOnly(errorOnly)
      openModal('evaluationResult')
    } catch (viewError) {
      message.error(getErrorMessage(viewError, '加载评测结果失败'))
    } finally {
      setLoadingField('evaluation', false)
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
          closeModal('evaluationResult')
        }
        message.success('评测结果已删除')
      },
    })
  }

  const benchmarkColumns = useMemo(
    () => buildKnowledgeBenchmarkColumns({
      currentKbId: currentKb?.kbId || '',
      onPreviewBenchmark: (benchmark) => {
        void handlePreviewBenchmark(benchmark)
      },
      onDeleteBenchmark: handleDeleteBenchmark,
    }),
    [currentKb?.kbId],
  )

  const evaluationColumns = useMemo(
    () => buildKnowledgeEvaluationColumns({
      onViewEvaluationResult: (taskId) => {
        void handleViewEvaluationResult(taskId)
      },
      onDeleteEvaluationResult: handleDeleteEvaluationResult,
    }),
    [currentKb?.kbId, evaluationResult?.taskId],
  )

  return (
    <ErrorBoundary>
    <Flex vertical gap={16} className="page-stack">
      {(!currentKb && !shouldOpenCreateModal && !loading.detail) ? (
        <>
          <PageHeader
            title="知识引擎"
            actions={(
              <>
                <Button icon={<ReloadOutlined />} onClick={() => void loadKnowledgeBases()}>
                  刷新目录
                </Button>
                <Button
                  type="primary"
                  icon={<PlusOutlined />}
                  onClick={() => {
                    setFormState(createKnowledgeForm())
                    setIndexConfig(createIndexConfigState())
                    startTransition(() => navigate('/knowledge/new'))
                  }}
                >
                  新建知识库
                </Button>
              </>
            )}
          />

          <div className="knowledge-master-container">
            <KnowledgeList
              knowledgeBases={knowledgeBases}
              visibleKnowledgeBases={visibleKnowledgeBases}
              selectedKbId={selectedKbId}
              knowledgeSearch={knowledgeSearch}
              loading={loading.workspace}
              onSearchChange={setKnowledgeSearch}
            />
          </div>
        </>
      ) : null}

      {(currentKb || shouldOpenCreateModal || loading.detail) ? (
          <KnowledgeProvider value={{
            currentKb,
            filesState,
            jobs,
            loading,
            selectedFileIds,
            fileSearch,
            queryParams,
            queryText,
            queryResult,
            resultView,
            sampleQuestions,
            queryParamSchema,
            mindmap,
            graphData,
            graphStats,
            graphConfig,
            benchmarks,
            evaluationHistory,
            evaluationResult,
            evaluationErrorOnly,
            selectedBenchmarkId,
            visibleFiles,
            pendingParseCount,
            pendingIndexCount,
            pendingParseFileIds,
            pendingIndexFileIds,
            hasSelectedFiles,
            canParseSelectedDocuments,
            canIndexSelectedDocuments,
            hasSingleSelection,
            parseableSelectedFileIds,
            indexableSelectedFileIds,
            selectedDocumentIds,
            selectedFiles,
            folderOptions,
            benchmarkColumns,
            evaluationColumns,
            formState,
            indexConfig,
            embeddingBindingOptions,
            llmBindingOptions,
            rerankBindingOptions,
            multimodalBindingOptions,
            onFormStateChange: setFormState,
            onIndexConfigChange: setIndexConfig,
            onActiveTabChange: setActiveTab,
            onFileSearchChange: setFileSearch,
            onSelectedFileIdsChange: setSelectedFileIds,
            onRefreshDetail: () => void refreshDetail(),
            onDeleteKnowledgeBase: handleDeleteKnowledgeBase,
            onOpenModal: openModal,
            onSetUrlParentId: setUrlParentId,
            onParseSelected: (fileIds?: string[], notifySkipped?: boolean) => void handleParseSelected(fileIds, notifySkipped),
            onIndexSelected: (fileIds?: string[], notifySkipped?: boolean) => void handleIndexSelected(fileIds, notifySkipped),
            onDeleteSelectedFiles: (files?: KnowledgeDocument[]) => void handleDeleteSelectedFiles(files),
            onOpenMoveModal: openMoveModal,
            onOpenFileDetail: handleOpenFileDetail,
            onQueryParamsChange: setQueryParams,
            onQueryTextChange: setQueryText,
            onQuery: (query?: string) => void handleQuery(query),
            onResultViewChange: setResultView,
            onSaveQueryDefaults: () => void handleSaveQueryDefaults(),
            onGenerateQuestions: () => void handleGenerateQuestions(),
            onGraphConfigChange: (config: { label?: string; depth?: number; maxNodes?: number }) => setGraphConfig((prev) => ({ ...prev, ...config })),
            onReloadGraph: () => currentKb && void loadGraph(currentKb.kbId),
            onRegenerateMindmap: () => void handleGenerateMindmap(),
            onBenchmarkChange: setSelectedBenchmarkId,
            onRunEvaluation: () => void handleRunEvaluation(),
            onRefreshBenchmarks: () => currentKb && void loadBenchmarkState(currentKb.kbId),
            onViewEvaluationResult: (taskId: string, errorOnly?: boolean) => void handleViewEvaluationResult(taskId, errorOnly),
            onDeleteEvaluationResult: handleDeleteEvaluationResult,
            onOpenBenchmarkGenerate: () => {
              resetBenchmarkGenerateForm()
              openModal('benchmarkGenerate')
            },
            onOpenBenchmarkUpload: () => {
              resetBenchmarkUploadForm()
              openModal('benchmarkUpload')
            },
            onSaveKnowledgeBase: () => void handleSaveKnowledgeBase(),
            onGenerateDescription: () => void handleGenerateDescription(),
          }}>
            <KnowledgeWorkspace />
          </KnowledgeProvider>
      ) : null}

      {/* Modals */}
      <Modal
        open={modals.create}
        title="新建知识库"
        onCancel={() => {
          closeModal('create')
          if (shouldOpenCreateModal) {
            startTransition(() => navigate('/knowledge'))
          }
        }}
        onOk={() => void handleCreateKnowledgeBase()}
        okText="创建"
        confirmLoading={loading.creating}
      >
        <Flex vertical gap={16}>
          <div className="studio-form-field">
            <Typography.Text type="secondary">名称</Typography.Text>
            <Input
              value={formState.name}
              onChange={(e) => setFormState((prev) => ({ ...prev, name: e.target.value }))}
              placeholder="知识库名称"
            />
          </div>
          <div className="studio-form-field">
            <Flex justify="space-between" align="center">
              <Typography.Text type="secondary">描述</Typography.Text>
              <Button
                size="small"
                disabled={!formState.name.trim() || loading.generatingDescription}
                loading={loading.generatingDescription}
                onClick={() => void handleGenerateDescription()}
              >
                AI 生成描述
              </Button>
            </Flex>
            <Input.TextArea
              rows={3}
              value={formState.description}
              onChange={(e) => setFormState((prev) => ({ ...prev, description: e.target.value }))}
              placeholder="知识库描述"
            />
          </div>
          <Flex gap={16}>
            <div className="studio-form-field" style={{ flex: 1, minWidth: 0 }}>
              <Typography.Text type="secondary">Embedding 模型</Typography.Text>
              <Select
                value={formState.embedBindingName || undefined}
                onChange={(value) => setFormState((prev) => ({ ...prev, embedBindingName: value }))}
                options={embeddingBindingOptions}
                placeholder="选择 Embedding 模型"
                showSearch
                optionFilterProp="label"
                style={{ width: '100%' }}
                notFoundContent={
                  <Flex vertical align="center" gap={8} style={{ padding: '16px 12px' }}>
                    <Typography.Text type="secondary" style={{ fontSize: 'var(--nb-text-sm)' }}>
                      暂无可用的 Embedding 模型
                    </Typography.Text>
                    <Button
                      type="link"
                      size="small"
                      onClick={() => navigate('/models')}
                    >
                      前往模型页面配置 →
                    </Button>
                  </Flex>
                }
              />
            </div>
            <div className="studio-form-field" style={{ flex: 1, minWidth: 0 }}>
              <Typography.Text type="secondary">LLM 模型</Typography.Text>
              <Select
                value={formState.llmBindingName || undefined}
                onChange={(value) => setFormState((prev) => ({ ...prev, llmBindingName: value }))}
                options={llmBindingOptions}
                placeholder="选择 LLM 模型"
                showSearch
                optionFilterProp="label"
                style={{ width: '100%' }}
              />
            </div>
          </Flex>
          <div className="studio-form-field">
            <Typography.Text type="secondary">语言</Typography.Text>
            <Select
              value={formState.language}
              onChange={(value) => setFormState((prev) => ({ ...prev, language: value }))}
              options={LANGUAGE_OPTIONS}
              style={{ width: '100%' }}
            />
          </div>
        </Flex>
      </Modal>

      <Modal
        open={modals.folder}
        title="新建文件夹"
        onCancel={() => { closeModal('folder'); resetFolderForm() }}
        onOk={() => void handleCreateFolder()}
        okText="创建"
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <Input
            placeholder="名称"
            value={folderForm.name}
            onChange={(e) => setFolderForm((prev) => ({ ...prev, name: e.target.value }))}
          />
          <Select
            value={folderForm.parentId || undefined}
            onChange={(value) => setFolderForm((prev) => ({ ...prev, parentId: value || null }))}
            options={[{ value: '', label: '根目录' }, ...folderOptions]}
            placeholder="选择父目录"
            style={{ width: '100%' }}
            allowClear
          />
        </Space>
      </Modal>

      <KnowledgeUploadModal
        open={modals.url}
        kb={currentKb}
        folderOptions={folderOptions}
        defaultParentId={urlParentId}
        onClose={() => closeModal('url')}
        onSuccess={() => refreshDetail()}
      />

      <Modal
        open={modals.move}
        title="移动文件"
        onCancel={() => { closeModal('move'); resetMoveForm() }}
        onOk={() => void handleMoveSelectedFile()}
        okText="保存"
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <Input
            value={moveForm.targetName}
            onChange={(e) => setMoveForm((prev) => ({ ...prev, targetName: e.target.value }))}
            placeholder="新的名称"
          />
          <Select
            value={moveForm.targetParentId || undefined}
            onChange={(value) => setMoveForm((prev) => ({ ...prev, targetParentId: value || null }))}
            options={[{ value: '', label: '根目录' }, ...folderOptions.filter((item) => item.value !== selectedFiles[0]?.fileId)]}
            placeholder="选择目标目录"
            style={{ width: '100%' }}
            allowClear
          />
        </Space>
      </Modal>

      <Modal
        open={modals.indexConfig}
        title="索引配置"
        onCancel={() => closeModal('indexConfig')}
        onOk={() => closeModal('indexConfig')}
        okText="保存配置"
      >
        <div className="knowledge-settings-grid">
          <div className="studio-form-field">
            <Typography.Text type="secondary">分块策略</Typography.Text>
            <Select
              value={indexConfig.chunkPresetId}
              onChange={(value) => setIndexConfig((prev) => ({ ...prev, chunkPresetId: value }))}
              options={CHUNK_PRESET_OPTIONS}
              style={{ width: '100%' }}
            />
          </div>
          <div className="studio-form-field">
            <Typography.Text type="secondary">Chunk Size</Typography.Text>
            <InputNumber
              min={200}
              max={8000}
              value={indexConfig.chunkSize}
              onChange={(value) => setIndexConfig((prev) => ({ ...prev, chunkSize: Number(value || 1000) }))}
              style={{ width: '100%' }}
            />
          </div>
          <div className="studio-form-field">
            <Typography.Text type="secondary">Chunk Overlap</Typography.Text>
            <InputNumber
              min={0}
              max={4000}
              value={indexConfig.chunkOverlap}
              onChange={(value) => setIndexConfig((prev) => ({ ...prev, chunkOverlap: Number(value || 0) }))}
              style={{ width: '100%' }}
            />
          </div>
          <div className="studio-form-field studio-form-field-span-2">
            <Typography.Text type="secondary">QA 分隔符</Typography.Text>
            <Input
              placeholder="QA 分隔符"
              value={indexConfig.qaSeparator}
              onChange={(e) => setIndexConfig((prev) => ({ ...prev, qaSeparator: e.target.value }))}
            />
          </div>
        </div>
      </Modal>

      <Modal
        open={modals.queryConfig}
        title="检索配置"
        onCancel={() => closeModal('queryConfig')}
        onOk={() => {
          closeModal('queryConfig')
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
                <Typography.Text type="secondary">{option.label}</Typography.Text>
                {option.type === 'select' ? (
                  <Select
                    value={String(getQueryConfigValue(option.key) ?? option.default ?? '')}
                    onChange={(value) => setQueryConfigValue(option.key, value)}
                    options={option.options || []}
                    style={{ width: '100%' }}
                  />
                ) : option.type === 'number' ? (
                  <InputNumber
                    min={option.min}
                    max={option.max}
                    step={option.step}
                    value={Number(getQueryConfigValue(option.key) ?? option.default ?? 0)}
                    onChange={(value) => setQueryConfigValue(option.key, Number(value ?? option.default ?? 0))}
                    style={{ width: '100%' }}
                  />
                ) : (
                  <Switch
                    checked={Boolean(getQueryConfigValue(option.key) ?? option.default ?? false)}
                    onChange={(checked) => setQueryConfigValue(option.key, checked)}
                  />
                )}
                {option.description ? (
                  <Typography.Text type="secondary" style={{ display: 'block' }}>{option.description}</Typography.Text>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <Typography.Text type="secondary">当前知识库没有额外检索配置</Typography.Text>
        )}
      </Modal>

      <Modal
        open={modals.benchmarkUpload}
        title="上传评估基准"
        onCancel={() => {
          closeModal('benchmarkUpload')
          resetBenchmarkUploadForm()
        }}
        onOk={() => void handleUploadBenchmark()}
        okText="上传"
        confirmLoading={loading.uploadingBenchmark}
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <Input
            placeholder="基准名称"
            value={benchmarkUploadForm.name}
            onChange={(e) => setBenchmarkUploadForm((prev) => ({ ...prev, name: e.target.value }))}
          />
          <Input.TextArea
            rows={3}
            placeholder="基准描述"
            value={benchmarkUploadForm.description}
            onChange={(e) => setBenchmarkUploadForm((prev) => ({ ...prev, description: e.target.value }))}
          />
          <Button onClick={() => benchmarkUploadInputRef.current?.click()}>
            {benchmarkUploadForm.file ? `已选择：${benchmarkUploadForm.file.name}` : '选择 JSONL 文件'}
          </Button>
          <input
            ref={benchmarkUploadInputRef}
            type="file"
            accept=".jsonl"
            style={{ display: 'none' }}
            onChange={(e) => setBenchmarkUploadForm((prev) => ({ ...prev, file: e.target.files?.[0] || null }))}
          />
        </Space>
      </Modal>

      <Modal
        open={modals.benchmarkGenerate}
        title="生成评估基准"
        onCancel={() => closeModal('benchmarkGenerate')}
        onOk={() => void handleGenerateBenchmark()}
        okText="生成"
        confirmLoading={loading.generatingBenchmark}
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <Input
            placeholder="基准名称"
            value={benchmarkGenerateForm.name}
            onChange={(e) => setBenchmarkGenerateForm((prev) => ({ ...prev, name: e.target.value }))}
          />
          <Input.TextArea
            rows={3}
            placeholder="基准描述"
            value={benchmarkGenerateForm.description}
            onChange={(e) => setBenchmarkGenerateForm((prev) => ({ ...prev, description: e.target.value }))}
          />
          <Space.Compact style={{ width: '100%' }}>
            <Button disabled>题目数</Button>
            <InputNumber
              min={1}
              max={50}
              value={benchmarkGenerateForm.count}
              onChange={(value) => setBenchmarkGenerateForm((prev) => ({ ...prev, count: Number(value || 10) }))}
              style={{ flex: 1 }}
            />
          </Space.Compact>
        </Space>
      </Modal>

      <KnowledgeBenchmarkPreviewModal
        open={!!benchmarkPreview}
        loading={loading.benchmarkPreview}
        benchmark={benchmarkPreview}
        page={benchmarkPreviewPage}
        pageSize={benchmarkPreviewPageSize}
        onClose={() => {
          setBenchmarkPreview(null)
          setBenchmarkPreviewPage(1)
          setBenchmarkPreviewPageSize(20)
        }}
        onPageChange={(page, pageSize) => {
          if (benchmarkPreview) {
            void handlePreviewBenchmark(benchmarkPreview, page, pageSize)
          }
        }}
      />

      <KnowledgeEvaluationResultModal
        open={modals.evaluationResult}
        loading={loading.evaluation}
        result={evaluationResult}
        errorOnly={evaluationErrorOnly}
        onClose={() => closeModal('evaluationResult')}
        onToggleErrorOnly={() => evaluationResult && void handleViewEvaluationResult(evaluationResult.taskId, !evaluationErrorOnly)}
      />

      <KnowledgeFileDetailModal
        kbId={currentKb?.kbId || null}
        open={modals.fileDetail}
        loading={loading.fileDetail}
        detail={fileDetail}
        onClose={() => closeModal('fileDetail')}
      />
    </Flex>
    </ErrorBoundary>
  )
}
