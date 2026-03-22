import { startTransition, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  App,
  Button,
  Card,
  Empty,
  Input,
  InputNumber,
  List,
  Modal,
  Select,
  Skeleton,
  Space,
  Spin,
  Statistic,
  Switch,
  Table,
  Tabs,
  Tag,
  Typography,
} from 'antd'
import {
  BranchesOutlined,
  DatabaseOutlined,
  DeleteOutlined,
  EditOutlined,
  FileSearchOutlined,
  FileTextOutlined,
  FolderAddOutlined,
  FolderOpenOutlined,
  PlusOutlined,
  ReloadOutlined,
  RetweetOutlined,
  SaveOutlined,
  SearchOutlined,
  UploadOutlined,
} from '@ant-design/icons'
import { motion } from 'framer-motion'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { api } from '../api'
import { formatDateTimeZh } from '../locale'
import {
  getAllModelBindings,
  normalizeModelConfig,
  resolveBindingCapabilityType,
} from '../modelConfig'
import type {
  ConfigData,
  ConfigMeta,
  KnowledgeBaseDefinition,
  KnowledgeBenchmark,
  KnowledgeBenchmarkDetail,
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
  ModelBinding,
} from '../types'
import {
  CHUNK_PRESET_OPTIONS,
  LANGUAGE_OPTIONS,
  KNOWLEDGE_ARCHITECTURE_LABEL,
  buildKnowledgeAdditionalParams,
  buildKnowledgeTree,
  canDeleteKnowledgeFile,
  canIndexKnowledgeFile,
  canParseKnowledgeFile,
  collectExpandedFolderKeys,
  createEmptyListState,
  createIndexConfigState,
  createKnowledgeFormState,
  formatScorePercent,
  getDefaultQueryParams,
  getErrorMessage,
  parseTags,
  statusColor,
  statusLabel,
  type KnowledgeFormState,
  type KnowledgeIndexConfigState,
  type KnowledgeTreeNode,
} from './knowledge/shared'
import { KnowledgeBenchmarkPreviewModal } from './knowledge/KnowledgeBenchmarkPreviewModal'
import { KnowledgeEvaluationResultModal } from './knowledge/KnowledgeEvaluationResultModal'
import { KnowledgeQueryTab } from './knowledge/KnowledgeQueryTab'
import { KnowledgeGraphTab } from './knowledge/KnowledgeGraphTab'
import { KnowledgeMindmapTab } from './knowledge/KnowledgeMindmapTab'
import { KnowledgeEvaluationTab } from './knowledge/KnowledgeEvaluationTab'
import { KnowledgeBenchmarksTab } from './knowledge/KnowledgeBenchmarksTab'
import { KnowledgeSettingsTab } from './knowledge/KnowledgeSettingsTab'
import { KnowledgeFileDetailModal } from './knowledge/KnowledgeFileDetailModal'
import { KnowledgeUploadModal } from './knowledge/KnowledgeUploadModal'
import {
  buildKnowledgeBenchmarkColumns,
  buildKnowledgeEvaluationColumns,
  buildKnowledgeFileColumns,
} from './knowledge/columns'

const { Paragraph, Text, Title } = Typography

export default function KnowledgePage() {
  const { message } = App.useApp()
  const navigate = useNavigate()
  const location = useLocation()
  const { kbId } = useParams()
  const selectedKbId = kbId && kbId !== 'new' ? kbId : null
  const shouldOpenCreateModal = location.pathname.endsWith('/knowledge/new')
  const benchmarkUploadInputRef = useRef<HTMLInputElement | null>(null)

  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBaseDefinition[]>([])
  const [modelConfig, setModelConfig] = useState<ConfigData | null>(null)
  const [configMeta, setConfigMeta] = useState<ConfigMeta | null>(null)
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
  const [activeTab, setActiveTab] = useState('files')
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
  const [formState, setFormState] = useState<KnowledgeFormState>(() => createKnowledgeFormState())
  const [indexConfig, setIndexConfig] = useState<KnowledgeIndexConfigState>(() => createIndexConfigState())
  const [folderName, setFolderName] = useState('')
  const [folderParentId, setFolderParentId] = useState<string | null>(null)
  const [urlParentId, setUrlParentId] = useState<string | null>(null)
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
  const modelBindings = useMemo(
    () => (modelConfig && configMeta ? getAllModelBindings(modelConfig, configMeta) : {}),
    [modelConfig, configMeta],
  )

  function getBindingModel(bindingName: string) {
    return String(modelBindings[bindingName]?.model || '').trim()
  }

  function buildKnowledgeBindingOptions(capability: 'embedding' | 'llm') {
    return Object.entries(modelBindings)
      .filter(([, binding]) => {
        const resolved = resolveBindingCapabilityType(binding)
        if (capability === 'embedding') {
          return resolved === 'embedding'
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
  const defaultEmbeddingBindingName = useMemo(
    () => String(modelConfig?.rag?.embeddingBinding || '').trim() || embeddingBindingOptions[0]?.value || '',
    [modelConfig, embeddingBindingOptions],
  )
  const defaultLlmBindingName = useMemo(
    () => String(modelConfig?.rag?.llmBinding || '').trim() || llmBindingOptions[0]?.value || '',
    [modelConfig, llmBindingOptions],
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
    })
  }

  useEffect(() => {
    void loadKnowledgeBases()
    void loadModelConfig()
  }, [])

  useEffect(() => {
    setCreateModalOpen(shouldOpenCreateModal)
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
      setExpandedFileIds([])
      setFileDetail(null)
      setFileDetailOpen(false)
      setSettingsModalOpen(false)
      setActiveTab('files')
      return
    }
    setActiveTab('files')
    void loadKnowledgeDetail(selectedKbId)
  }, [selectedKbId, defaultEmbeddingBindingName, defaultLlmBindingName])

  useEffect(() => {
    if (activeTab === 'graph' && currentKb) {
      void loadGraph(currentKb.kbId)
    }
  }, [activeTab, currentKb, graphDepth, graphMaxNodes])

  useEffect(() => {
    if (activeTab === 'mindmap' && currentKb && !mindmap && !mindmapLoading) {
      void loadMindmap(currentKb.kbId)
    }
  }, [activeTab, currentKb, mindmap, mindmapLoading])

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
  const supportsDescriptionGeneration = Boolean(formState.name.trim())
  const pendingParseCount = pendingParseFileIds.length
  const pendingIndexCount = pendingIndexFileIds.length
  const showListPage = !selectedKbId

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
      setFormState(createKnowledgeForm(kb))
      setIndexConfig(createIndexConfigState(kb))
      setFilesState(filePayload)
      setJobs(jobPayload)
      const defaultQueryParams = getDefaultQueryParams()
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
      setExpandedFileIds([])
      setSettingsModalOpen(false)
    } catch (loadError) {
      setError(getErrorMessage(loadError, '加载知识库详情失败'))
    } finally {
      setDetailLoading(false)
    }
  }

  async function loadMindmap(targetKbId: string) {
    try {
      setMindmapLoading(true)
      const payload = await api.getKnowledgeMindmap(targetKbId)
      setMindmap(payload.mindmap)
    } catch {
      setMindmap(null)
    } finally {
      setMindmapLoading(false)
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
      setCreatingKb(true)
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
      setCreateModalOpen(false)
      setFormState(createKnowledgeForm())
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
        params: {
          chunkSize: indexConfig.chunkSize,
          chunkOverlap: indexConfig.chunkOverlap,
          chunkPresetId: indexConfig.chunkPresetId,
          qaSeparator: indexConfig.qaSeparator.trim() || undefined,
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
        onlyNeedContext: false,
        onlyNeedPrompt: false,
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

  const fileColumns = useMemo(
    () => buildKnowledgeFileColumns({
      currentKbId: currentKb?.kbId || '',
      onOpenFileDetail: (record) => {
        void handleOpenFileDetail(record)
      },
      onDeleteFiles: (targets) => {
        void handleDeleteSelectedFiles(targets)
      },
    }),
    [currentKb?.kbId],
  )

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

  const tabItems = [
    {
      key: 'files',
      label: '文件',
      children: (
        <div className="knowledge-tab-panel knowledge-files-tab">
          <div className="knowledge-files-toolbar">
            <Input
              prefix={<SearchOutlined />}
              placeholder="搜索文件名或路径"
              value={fileSearch}
              onChange={(event) => setFileSearch(event.target.value)}
            />
            <Space wrap>
              <Button
                type="primary"
                icon={<UploadOutlined />}
                onClick={() => {
                  setUrlParentId(hasSingleSelection && selectedFiles[0].isFolder ? selectedFiles[0].fileId : null)
                  setUrlModalOpen(true)
                }}
              >
                添加文件
              </Button>
              <Button icon={<FolderAddOutlined />} onClick={() => setFolderModalOpen(true)}>新建文件夹</Button>
              <Button
                icon={<RetweetOutlined />}
                loading={parsingFiles}
                disabled={!canParseSelectedDocuments}
                onClick={() => void handleParseSelected()}
              >
                解析
              </Button>
              <Button onClick={() => setIndexConfigOpen(true)}>索引配置</Button>
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
            scroll={{ x: 'max-content' }}
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
        </div>
      ),
    },
    {
      key: 'query',
      label: '检索测试',
      children: (
        <KnowledgeQueryTab
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
              options: prev.options,
            }))
          }
          onTopKChange={(value) => setQueryParams((prev) => ({ ...prev, topK: value }))}
          onChunkTopKChange={(value) => setQueryParams((prev) => ({ ...prev, chunkTopK: value }))}
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
      label: 'RAG 评测',
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
      label: '评估基准',
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
              </div>
              <Space>
                <Button icon={<ReloadOutlined />} onClick={() => void loadKnowledgeBases()} />
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
              </Space>
            </div>

            {error ? <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} /> : null}

            <Card className="knowledge-sidebar-card" bodyStyle={{ padding: 0 }}>
              <div className="knowledge-sidebar-header">
                <Text strong>知识库列表</Text>
                <Tag>{knowledgeBases.length}</Tag>
              </div>
              {workspaceLoading ? (
                <div className="knowledge-card-grid">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="knowledge-sidebar-item" style={{ height: 160, padding: 18 }}>
                      <Skeleton active title={{ width: '60%' }} paragraph={{ rows: 2, width: ['100%', '80%'] }} />
                    </div>
                  ))}
                </div>
              ) : knowledgeBases.length === 0 ? (
                <div className="knowledge-card-grid">
                  <motion.button
                    type="button"
                    className="knowledge-sidebar-item knowledge-create-card"
                    whileHover={{ y: -2 }}
                    onClick={() => {
                      setFormState(createKnowledgeForm())
                      setIndexConfig(createIndexConfigState())
                      startTransition(() => navigate('/knowledge/new'))
                    }}
                  >
                    <div className="knowledge-create-card-content">
                      <PlusOutlined style={{ fontSize: 24, marginBottom: 12, color: 'var(--ant-color-primary)' }} />
                      <Text strong style={{ fontSize: 16 }}>新建知识库</Text>
                      <Text type="secondary" style={{ marginTop: 8 }}>创建一个新的文档知识库并上传文件</Text>
                    </div>
                  </motion.button>
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
                      <div className="knowledge-card-body">
                        <div className="knowledge-sidebar-item-top">
                          <Text strong>{item.name}</Text>
                        </div>
                        {item.description ? (
                          <Paragraph ellipsis={{ rows: 2 }} type="secondary" style={{ marginBottom: 0 }}>
                            {item.description}
                          </Paragraph>
                        ) : null}
                      </div>
                      <div className="knowledge-card-footer">
                        <div className="knowledge-card-stats">
                          <span title="文件数"><FileTextOutlined /> {item.stats?.fileCount || 0}</span>
                          <span title="已索引"><DatabaseOutlined /> {item.stats?.indexedCount || 0}</span>
                          <span title="文件夹"><FolderOpenOutlined /> {item.stats?.folderCount || 0}</span>
                        </div>
                      </div>
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
                        <Tag color={currentKb.enabled ? 'green' : 'default'}>{KNOWLEDGE_ARCHITECTURE_LABEL}</Tag>
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

                <Card className="knowledge-tabs-card knowledge-main-tabs-card">
                  <Tabs
                    activeKey={activeTab}
                    onChange={setActiveTab}
                    items={tabItems}
                  />
                </Card>
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
            <Text type="secondary">知识库架构</Text>
            <Input value={KNOWLEDGE_ARCHITECTURE_LABEL} disabled />
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
            <Select
              showSearch
              value={formState.embedBindingName || undefined}
              options={embeddingBindingOptions}
              placeholder={embeddingBindingOptions.length > 0 ? '选择模型' : '请先到模型页配置模型'}
              disabled={embeddingBindingOptions.length === 0}
              onChange={(value) => setFormState((prev) => ({ ...prev, embedBindingName: value }))}
              optionFilterProp="label"
            />
          </div>
          <div className="studio-form-field">
            <Text type="secondary">LLM 模型</Text>
            <Select
              showSearch
              value={formState.llmBindingName || undefined}
              options={llmBindingOptions}
              placeholder={llmBindingOptions.length > 0 ? '选择模型' : '请先到模型页配置模型'}
              disabled={llmBindingOptions.length === 0}
              onChange={(value) => setFormState((prev) => ({ ...prev, llmBindingName: value }))}
              optionFilterProp="label"
            />
          </div>
          <div className="studio-form-field">
            <Text type="secondary">语言</Text>
            <Select
              value={formState.language}
              options={[...LANGUAGE_OPTIONS]}
              onChange={(value) => setFormState((prev) => ({ ...prev, language: value }))}
            />
          </div>
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
          <div className="studio-form-field studio-form-field-span-2">
            <Text type="secondary">QA 分隔符</Text>
            <Input
              placeholder="例如：---FAQ---"
              value={formState.qaSeparator}
              onChange={(event) => setFormState((prev) => ({ ...prev, qaSeparator: event.target.value }))}
            />
          </div>
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
          formState={formState}
          indexConfig={indexConfig}
          embeddingBindingOptions={embeddingBindingOptions}
          llmBindingOptions={llmBindingOptions}
          chunkPresetOptions={CHUNK_PRESET_OPTIONS.map((item) => ({ label: item.label, value: item.value }))}
          languageOptions={[...LANGUAGE_OPTIONS]}
          generatingDescription={generatingDescription}
          supportsDescriptionGeneration={supportsDescriptionGeneration}
          savingKb={savingKb}
          onFormStateChange={setFormState}
          onIndexConfigChange={setIndexConfig}
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

      <KnowledgeBenchmarkPreviewModal
        open={!!benchmarkPreview}
        loading={benchmarkPreviewLoading}
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
        open={evaluationResultOpen}
        loading={evaluationLoading}
        result={evaluationResult}
        errorOnly={evaluationErrorOnly}
        onClose={() => setEvaluationResultOpen(false)}
        onToggleErrorOnly={() => evaluationResult && void handleViewEvaluationResult(evaluationResult.taskId, !evaluationErrorOnly)}
      />

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
