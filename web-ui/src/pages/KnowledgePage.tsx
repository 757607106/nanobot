import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  App,
  Button,
  Card,
  Checkbox,
  Collapse,
  Empty,
  Input,
  InputNumber,
  List,
  Select,
  Segmented,
  Space,
  Spin,
  Tag,
  Tabs,
  Typography,
} from 'antd'
import {
  CloudUploadOutlined,
  DatabaseOutlined,
  DeleteOutlined,
  GlobalOutlined,
  PlusOutlined,
  ReloadOutlined,
  SaveOutlined,
  SearchOutlined,
} from '@ant-design/icons'
import { useNavigate, useParams } from 'react-router-dom'
import { api, ApiError } from '../api'
import PageHero from '../components/PageHero'
import { formatDateTimeZh } from '../locale'
import type {
  KnowledgeBaseDefinition,
  KnowledgeBaseMutationInput,
  KnowledgeDocument,
  KnowledgeHit,
  KnowledgeIngestJob,
  KnowledgeSource,
} from '../types'

const { Text, Paragraph } = Typography
const { TextArea } = Input

type SourceMode = 'file' | 'url' | 'faq'

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
}

interface SourceEditorState {
  title: string
  enabled: boolean
  url: string
  faqItemsText: string
}

function createEmptyForm(): KnowledgeFormState {
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
  }
}

function sourceToEditor(source: KnowledgeSource): SourceEditorState {
  const config = source.config || {}
  const faqItems = Array.isArray(config['items']) ? config['items'] : []
  return {
    title: source.title,
    enabled: source.enabled,
    url: String(config['url'] || source.sourceUri || ''),
    faqItemsText:
      source.sourceType === 'faq_table'
        ? JSON.stringify(faqItems, null, 2)
        : '[]',
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
      rerankEnabled: false,
      metadataFilters: {},
    },
  }
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

function statusColor(status: string) {
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

function isActiveDocumentStatus(status: string) {
  return ['uploaded', 'parsing', 'parsed', 'indexing'].includes(status)
}

function isActiveJobStatus(status: string) {
  return ['queued', 'running'].includes(status)
}

function isFailedDocumentStatus(status: string) {
  return ['error_parsing', 'error_indexing'].includes(status)
}

export default function KnowledgePage() {
  const { message, modal } = App.useApp()
  const navigate = useNavigate()
  const { kbId } = useParams()
  const selectedKbId = kbId && kbId !== 'new' ? kbId : null
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBaseDefinition[]>([])
  const [currentKb, setCurrentKb] = useState<KnowledgeBaseDefinition | null>(null)
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([])
  const [sources, setSources] = useState<KnowledgeSource[]>([])
  const [jobs, setJobs] = useState<KnowledgeIngestJob[]>([])
  const [form, setForm] = useState<KnowledgeFormState>(() => createEmptyForm())
  const [sourceEditor, setSourceEditor] = useState<SourceEditorState>(() => createEmptySourceEditor())
  const [sourceMode, setSourceMode] = useState<SourceMode>('file')
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null)
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [urlInput, setUrlInput] = useState('')
  const [faqQuestion, setFaqQuestion] = useState('')
  const [faqAnswer, setFaqAnswer] = useState('')
  const [faqItems, setFaqItems] = useState<Array<{ question: string; answer: string }>>([])
  const [documentQuery, setDocumentQuery] = useState('')
  const [documentStatusFilter, setDocumentStatusFilter] = useState('all')
  const [documentSourceFilter, setDocumentSourceFilter] = useState('all')
  const [selectedDocIds, setSelectedDocIds] = useState<string[]>([])
  const [jobStatusFilter, setJobStatusFilter] = useState('all')
  const [retrieveQuery, setRetrieveQuery] = useState('restart the worker')
  const [retrieveHits, setRetrieveHits] = useState<KnowledgeHit[]>([])
  const [retrieveMode, setRetrieveMode] = useState('hybrid')
  const [retrieveEffectiveMode, setRetrieveEffectiveMode] = useState<string | null>(null)
  const [activeSection, setActiveSection] = useState<'overview' | 'ingest' | 'sources' | 'testing'>('overview')
  const [loadingWorkspace, setLoadingWorkspace] = useState(true)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [ingesting, setIngesting] = useState(false)
  const [reindexingTarget, setReindexingTarget] = useState<string | 'all' | null>(null)
  const [syncingSourceId, setSyncingSourceId] = useState<string | null>(null)
  const [savingSourceId, setSavingSourceId] = useState<string | null>(null)
  const [retrieving, setRetrieving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [retrieveError, setRetrieveError] = useState<string | null>(null)

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
      setForm(createEmptyForm())
      return
    }
    void loadKnowledgeDetail(selectedKbId)
  }, [kbId, knowledgeBases, loadingWorkspace, navigate, selectedKbId])

  const enabledCount = useMemo(
    () => knowledgeBases.filter((item) => item.enabled).length,
    [knowledgeBases],
  )
  const syncableSources = useMemo(
    () => sources.filter((item) => item.syncSupported),
    [sources],
  )
  const selectedSource = useMemo(
    () => sources.find((item) => item.sourceId === selectedSourceId) ?? null,
    [selectedSourceId, sources],
  )
  const filteredDocuments = useMemo(() => {
    const query = documentQuery.trim().toLowerCase()
    return documents.filter((item) => {
      if (documentStatusFilter !== 'all' && item.docStatus !== documentStatusFilter) {
        return false
      }
      if (documentSourceFilter !== 'all' && item.sourceType !== documentSourceFilter) {
        return false
      }
      if (!query) {
        return true
      }
      return [
        item.title,
        item.fileName,
        item.sourceUri,
        item.errorSummary,
      ].some((value) => String(value || '').toLowerCase().includes(query))
    })
  }, [documentQuery, documentSourceFilter, documentStatusFilter, documents])
  const filteredJobs = useMemo(() => {
    if (jobStatusFilter === 'all') {
      return jobs
    }
    return jobs.filter((item) => item.status === jobStatusFilter)
  }, [jobStatusFilter, jobs])
  const failedDocuments = useMemo(
    () => documents.filter((item) => isFailedDocumentStatus(item.docStatus)),
    [documents],
  )
  const filteredDocumentIds = useMemo(
    () => filteredDocuments.map((item) => item.docId),
    [filteredDocuments],
  )
  const selectedFilteredDocIds = useMemo(
    () => filteredDocumentIds.filter((docId) => selectedDocIds.includes(docId)),
    [filteredDocumentIds, selectedDocIds],
  )
  const allFilteredSelected =
    filteredDocumentIds.length > 0 && selectedFilteredDocIds.length === filteredDocumentIds.length
  const partiallySelected =
    selectedFilteredDocIds.length > 0 && selectedFilteredDocIds.length < filteredDocumentIds.length
  const hasActiveIngest = useMemo(
    () =>
      documents.some((item) => isActiveDocumentStatus(item.docStatus)) ||
      jobs.some((item) => isActiveJobStatus(item.status)),
    [documents, jobs],
  )

  useEffect(() => {
    if (!currentKb || !hasActiveIngest) {
      return
    }
    const timer = window.setInterval(() => {
      void loadKnowledgeDetail(currentKb.kbId)
    }, 2000)
    return () => window.clearInterval(timer)
  }, [currentKb, hasActiveIngest])

  useEffect(() => {
    setSelectedDocIds((current) => current.filter((docId) => documents.some((item) => item.docId === docId)))
  }, [documents])

  useEffect(() => {
    if (sources.length === 0) {
      setSelectedSourceId(null)
      setSourceEditor(createEmptySourceEditor())
      return
    }
    if (!selectedSourceId || !sources.some((item) => item.sourceId === selectedSourceId)) {
      setSelectedSourceId(sources[0].sourceId)
    }
  }, [selectedSourceId, sources])

  useEffect(() => {
    if (!selectedSource) {
      return
    }
    setSourceEditor(sourceToEditor(selectedSource))
  }, [selectedSource])

  async function loadWorkspace() {
    try {
      setLoadingWorkspace(true)
      const kbList = await api.getKnowledgeBases()
      setKnowledgeBases(kbList)
      setError(null)
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
      setSelectedDocIds((current) => current.filter((docId) => docs.some((item) => item.docId === docId)))
      setForm(kbToForm(kb))
      setRetrieveMode(kb.retrievalProfile.mode)
      setRetrieveEffectiveMode(null)
      setError(null)
    } catch (loadError) {
      setError(getErrorMessage(loadError, '加载知识库详情失败'))
    } finally {
      setLoadingDetail(false)
    }
  }

  function updateForm<K extends keyof KnowledgeFormState>(key: K, value: KnowledgeFormState[K]) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  function updateSourceEditor<K extends keyof SourceEditorState>(key: K, value: SourceEditorState[K]) {
    setSourceEditor((current) => ({ ...current, [key]: value }))
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

  async function refreshCurrentKb() {
    if (currentKb) {
      await loadKnowledgeDetail(currentKb.kbId)
    }
  }

  async function handleUploadFiles() {
    if (!currentKb) {
      setError('请先保存知识库，再上传文档。')
      return
    }
    if (selectedFiles.length === 0) {
      setError('请先选择要上传的文件。')
      return
    }
    try {
      setIngesting(true)
      const formData = new FormData()
      selectedFiles.forEach((file) => formData.append('file', file))
      await api.uploadKnowledgeDocuments(currentKb.kbId, formData)
      message.success(`已提交 ${selectedFiles.length} 个文件，后台正在入库`)
      setSelectedFiles([])
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
      await refreshCurrentKb()
    } catch (ingestError) {
      setError(getErrorMessage(ingestError, '上传知识文档失败'))
    } finally {
      setIngesting(false)
    }
  }

  function handleAddFaqItem() {
    const question = faqQuestion.trim()
    const answer = faqAnswer.trim()
    if (!question || !answer) {
      setError('FAQ 问答都不能为空。')
      return
    }
    setFaqItems((current) => [...current, { question, answer }])
    setFaqQuestion('')
    setFaqAnswer('')
    setError(null)
  }

  async function handleIngestFaq() {
    if (!currentKb) {
      setError('请先保存知识库，再导入 FAQ。')
      return
    }
    if (faqItems.length === 0) {
      setError('请先至少添加一条 FAQ。')
      return
    }
    try {
      setIngesting(true)
      await api.addKnowledgeSource(currentKb.kbId, {
        sourceType: 'faq_table',
        title: `${currentKb.name} FAQ`,
        items: faqItems,
      })
      message.success(`已提交 ${faqItems.length} 条 FAQ，后台正在入库`)
      setFaqItems([])
      await refreshCurrentKb()
    } catch (ingestError) {
      setError(getErrorMessage(ingestError, '导入 FAQ 失败'))
    } finally {
      setIngesting(false)
    }
  }

  async function handleIngestUrl() {
    if (!currentKb) {
      setError('请先保存知识库，再添加 URL。')
      return
    }
    if (!urlInput.trim()) {
      setError('请输入要接入的单个 URL。')
      return
    }
    try {
      setIngesting(true)
      await api.addKnowledgeSource(currentKb.kbId, {
        sourceType: 'web_url',
        url: urlInput.trim(),
      })
      message.success('URL 已提交，后台正在抓取和入库')
      setUrlInput('')
      await refreshCurrentKb()
    } catch (ingestError) {
      setError(getErrorMessage(ingestError, '接入 URL 失败'))
    } finally {
      setIngesting(false)
    }
  }

  async function handleRetrieve() {
    if (!currentKb) {
      setRetrieveError('请先保存知识库。')
      return
    }
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
      setRetrieveError(null)
    } catch (retrieveErrorValue) {
      setRetrieveError(getErrorMessage(retrieveErrorValue, '检索测试失败'))
    } finally {
      setRetrieving(false)
    }
  }

  async function handleDeleteDocument(document: KnowledgeDocument) {
    if (!currentKb) {
      return
    }
    try {
      await api.deleteKnowledgeDocument(currentKb.kbId, document.docId)
      message.success('文档已删除')
      await refreshCurrentKb()
    } catch (deleteError) {
      setError(getErrorMessage(deleteError, '删除文档失败'))
    }
  }

  async function handleDeleteDocuments(docIds: string[]) {
    if (!currentKb) {
      return
    }
    if (docIds.length === 0) {
      setError('请至少选择一个文档。')
      return
    }
    modal.confirm({
      title: `删除 ${docIds.length} 个文档`,
      content: '这会移除对应文档、切片和 ingest 轨迹，适合批量清理失效来源或错误导入。',
      okText: '确认删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        try {
          const result = await api.deleteKnowledgeDocuments(currentKb.kbId, docIds)
          message.success(`已删除 ${result.deletedCount} 个文档`)
          setSelectedDocIds((current) => current.filter((docId) => !result.docIds.includes(docId)))
          await refreshCurrentKb()
        } catch (deleteError) {
          setError(getErrorMessage(deleteError, '批量删除文档失败'))
        }
      },
    })
  }

  async function handleReindex(docIds?: string[]) {
    if (!currentKb) {
      setError('请先保存知识库。')
      return
    }
    if (docIds && docIds.length === 0) {
      setError('请至少选择一个文档进行重建。')
      return
    }
    const target = docIds && docIds.length === 1 ? docIds[0] : 'all'
    try {
      setReindexingTarget(target)
      const result = await api.reindexKnowledgeBase(currentKb.kbId, docIds ? { docIds } : {})
      const docCount = result.documents.length
      message.success(
        target === 'all'
          ? `已提交 ${docCount} 个文档的重建任务`
          : '文档已提交重建任务',
      )
      await refreshCurrentKb()
    } catch (reindexError) {
      setError(getErrorMessage(reindexError, '提交重建索引失败'))
    } finally {
      setReindexingTarget(null)
    }
  }

  async function handleSyncSource(source: KnowledgeSource) {
    if (!currentKb) {
      setError('请先保存知识库。')
      return
    }
    try {
      setSyncingSourceId(source.sourceId)
      const result = await api.syncKnowledgeSource(currentKb.kbId, source.sourceId)
      message.success(`来源已提交同步：${result.source.title}`)
      await refreshCurrentKb()
    } catch (syncError) {
      setError(getErrorMessage(syncError, '重新同步来源失败'))
    } finally {
      setSyncingSourceId(null)
    }
  }

  async function handleSaveSource() {
    if (!currentKb || !selectedSource) {
      setError('请先选择一个来源。')
      return
    }
    const nextTitle = sourceEditor.title.trim()
    if (!nextTitle) {
      setError('来源标题不能为空。')
      return
    }
    const payload: {
      title?: string
      enabled?: boolean
      url?: string
      items?: Array<{ question: string; answer: string }>
    } = {
      title: nextTitle,
      enabled: sourceEditor.enabled,
    }
    if (selectedSource.sourceType === 'web_url') {
      const nextUrl = sourceEditor.url.trim()
      if (!nextUrl) {
        setError('URL 来源必须填写地址。')
        return
      }
      payload.url = nextUrl
    }
    if (selectedSource.sourceType === 'faq_table') {
      try {
        const items = JSON.parse(sourceEditor.faqItemsText)
        if (!Array.isArray(items)) {
          throw new Error('FAQ items must be an array.')
        }
        payload.items = items as Array<{ question: string; answer: string }>
      } catch {
        setError('FAQ 来源编辑区需要填写合法的 JSON 数组。')
        return
      }
    }
    try {
      setSavingSourceId(selectedSource.sourceId)
      await api.updateKnowledgeSource(currentKb.kbId, selectedSource.sourceId, payload)
      message.success('来源已更新')
      await refreshCurrentKb()
    } catch (saveSourceError) {
      setError(getErrorMessage(saveSourceError, '更新来源失败'))
    } finally {
      setSavingSourceId(null)
    }
  }

  function toggleDocumentSelection(docId: string, checked: boolean) {
    setSelectedDocIds((current) => {
      if (checked) {
        return current.includes(docId) ? current : [...current, docId]
      }
      return current.filter((item) => item !== docId)
    })
  }

  function handleToggleFilteredSelection(checked: boolean) {
    setSelectedDocIds((current) => {
      if (checked) {
        return Array.from(new Set([...current, ...filteredDocumentIds]))
      }
      return current.filter((docId) => !filteredDocumentIds.includes(docId))
    })
  }

  if (loadingWorkspace && knowledgeBases.length === 0 && !selectedKbId) {
    return (
      <div className="page-card center-box">
        <Spin />
      </div>
    )
  }

  return (
    <div className="page-stack">
      <PageHero
        className="page-hero-compact studio-hero"
        eyebrow="企业知识库"
        title="知识库"
        description="集中管理企业资料、问答内容和网页来源，并在绑定给 AI 员工前先完成接入、校验和检索测试。"
        stats={[
          { label: '知识库总数', value: knowledgeBases.length },
          { label: '启用中', value: enabledCount },
          { label: '当前来源', value: sources.length },
          { label: '当前文档', value: documents.length },
          { label: '最近任务', value: jobs.length },
        ]}
        badges={[
          <Tag key="engine" color="processing">支持内容接入</Tag>,
          <Tag key="mode">支持检索测试</Tag>,
        ]}
        actions={(
          <Space wrap>
            <Button icon={<ReloadOutlined />} onClick={() => void loadWorkspace()} loading={loadingWorkspace}>
              刷新
            </Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/studio/knowledge/new')}>
              新建知识库
            </Button>
          </Space>
        )}
      />

      {error ? <Alert type="error" showIcon message={error} /> : null}
      {currentKb && hasActiveIngest ? (
        <Alert
          type="info"
          showIcon
          message="当前有知识库任务正在后台处理中，页面会自动刷新状态。"
        />
      ) : null}

      <div className="page-grid studio-knowledge-grid">
        <Card className="config-panel-card studio-knowledge-list-card">
          <div className="config-card-header">
            <div className="page-section-title">
              <Typography.Title level={4}>知识库列表</Typography.Title>
              <Text type="secondary">先选定一个知识库，再对它做内容接入、来源治理和检索测试。</Text>
            </div>
            <Tag color="blue">{knowledgeBases.length}</Tag>
          </div>

          {knowledgeBases.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前还没有知识库。">
              <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/studio/knowledge/new')}>
                创建第一个知识库
              </Button>
            </Empty>
          ) : (
            <List
              className="studio-knowledge-list"
              dataSource={knowledgeBases}
              renderItem={(item) => (
                <List.Item
                  className={`studio-knowledge-list-item ${selectedKbId === item.kbId ? 'is-active' : ''}`}
                  onClick={() => navigate(`/studio/knowledge/${item.kbId}`)}
                >
                  <div className="studio-knowledge-list-copy">
                    <div className="studio-agent-list-head">
                      <Space size={8}>
                        <DatabaseOutlined />
                        <strong>{item.name}</strong>
                      </Space>
                      <Tag color={item.enabled ? 'success' : 'default'}>{item.enabled ? '启用' : '停用'}</Tag>
                    </div>
                    <Text type="secondary">{item.description || '暂未补充说明。'}</Text>
                    <div className="studio-agent-list-meta">
                      <Tag>
                        {item.retrievalProfile.mode === 'keyword'
                          ? '标准'
                          : item.retrievalProfile.mode === 'hybrid'
                            ? '平衡'
                            : '深度'}
                      </Tag>
                      <Tag>{item.tags.length} 个标签</Tag>
                    </div>
                  </div>
                </List.Item>
              )}
            />
          )}
        </Card>

        <div className="page-stack">
          <Tabs
            activeKey={activeSection}
            onChange={(value) => setActiveSection(value as 'overview' | 'ingest' | 'sources' | 'testing')}
            items={[
              { key: 'overview', label: '基础设置' },
              { key: 'ingest', label: '内容接入' },
              { key: 'sources', label: '来源与文档' },
              { key: 'testing', label: '检索测试' },
            ]}
          />

          {activeSection === 'overview' ? (
          <Card className="config-panel-card studio-knowledge-editor-card" loading={loadingDetail}>
            <div className="config-card-header">
              <div className="page-section-title">
                <Typography.Title level={4}>{currentKb ? '知识库设置' : '新建知识库'}</Typography.Title>
                <Text type="secondary">管理知识库名称、用途说明、检索方式和启用状态。</Text>
              </div>
              {currentKb ? <Tag color="purple">{currentKb.kbId}</Tag> : <Tag>未保存</Tag>}
            </div>

            <div className="studio-form-grid">
              <div className="studio-form-field studio-form-field-span-2">
                <Text type="secondary">名称</Text>
                <Input
                  value={form.name}
                  onChange={(event) => updateForm('name', event.target.value)}
                  placeholder="例如：客服知识库、法务制度库"
                />
              </div>

              <div className="studio-form-field studio-form-field-span-2">
                <Text type="secondary">描述</Text>
                <TextArea
                  value={form.description}
                  onChange={(event) => updateForm('description', event.target.value)}
                  rows={3}
                  placeholder="说明该知识库服务什么业务、主要包含哪些文档。"
                />
              </div>

              <div className="studio-form-field">
                <Text type="secondary">检索模式</Text>
                <Segmented
                  block
                  value={form.mode}
                  onChange={(value) => updateForm('mode', String(value))}
                  options={[
                    { label: '标准', value: 'keyword' },
                    { label: '平衡', value: 'hybrid' },
                    { label: '深度', value: 'semantic' },
                  ]}
                />
              </div>

              <div className="studio-form-field">
                <Text type="secondary">标签</Text>
                <Input
                  value={form.tags.join(', ')}
                  onChange={(event) => updateForm(
                    'tags',
                    event.target.value
                      .split(',')
                      .map((item) => item.trim())
                      .filter(Boolean),
                  )}
                  placeholder="用逗号分隔，例如：客服、FAQ、制度"
                />
              </div>
            </div>

            <Collapse
              className="studio-inline-collapse"
              items={[
                {
                  key: 'advanced',
                  label: '高级检索设置',
                  children: (
                    <div className="studio-form-grid">
                      <div className="studio-form-field">
                        <Text type="secondary">召回条数</Text>
                        <InputNumber min={1} max={20} value={form.topK} onChange={(value) => updateForm('topK', Number(value) || 8)} />
                      </div>

                      <div className="studio-form-field">
                        <Text type="secondary">片段候选数</Text>
                        <InputNumber min={1} max={50} value={form.chunkTopK} onChange={(value) => updateForm('chunkTopK', Number(value) || 20)} />
                      </div>

                      <div className="studio-form-field">
                        <Text type="secondary">单片段长度</Text>
                        <InputNumber min={200} max={4000} value={form.chunkSize} onChange={(value) => updateForm('chunkSize', Number(value) || 800)} />
                      </div>

                      <div className="studio-form-field">
                        <Text type="secondary">片段重叠</Text>
                        <InputNumber min={0} max={1000} value={form.chunkOverlap} onChange={(value) => updateForm('chunkOverlap', Number(value) || 120)} />
                      </div>
                    </div>
                  ),
                },
              ]}
            />

            <Alert
              className="studio-inline-alert"
              type="info"
              showIcon
              message="优先保证知识库主链可解释、可追踪、可测试。大多数场景先用默认设置即可。"
            />

            <div className="studio-form-actions">
              <Space wrap>
                <Button icon={<DeleteOutlined />} danger onClick={() => void handleDelete()} disabled={!currentKb} loading={deleting}>
                  删除知识库
                </Button>
                <Button
                  icon={<ReloadOutlined />}
                  onClick={() => void handleReindex()}
                  disabled={!currentKb || documents.length === 0}
                  loading={reindexingTarget === 'all'}
                >
                  重建全部
                </Button>
                <Button type="primary" icon={<SaveOutlined />} onClick={() => void handleSave()} loading={saving}>
                  保存知识库
                </Button>
              </Space>
            </div>
          </Card>
          ) : null}

          {activeSection === 'ingest' ? (
          <Card className="config-panel-card studio-knowledge-ingest-card">
            <div className="config-card-header">
              <div className="page-section-title">
                <Typography.Title level={4}>接入与入库</Typography.Title>
                <Text type="secondary">先支持文件、单 URL 和 FAQ，后面再补企业连接器。</Text>
              </div>
              {currentKb ? <Tag color="blue">{currentKb.name}</Tag> : <Tag>请先保存知识库</Tag>}
            </div>

            <Segmented
              value={sourceMode}
              onChange={(value) => setSourceMode(value as SourceMode)}
              options={[
                { label: '文件上传', value: 'file' },
                { label: '单 URL', value: 'url' },
                { label: 'FAQ', value: 'faq' },
              ]}
            />

            {sourceMode === 'file' ? (
              <div className="page-stack">
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  hidden
                  onChange={(event) => setSelectedFiles(Array.from(event.target.files || []))}
                />
                <div className="studio-form-actions">
                  <Space wrap>
                    <Button icon={<CloudUploadOutlined />} onClick={() => fileInputRef.current?.click()}>
                      选择文件
                    </Button>
                    <Button type="primary" onClick={() => void handleUploadFiles()} loading={ingesting} disabled={!currentKb}>
                      上传并入库
                    </Button>
                  </Space>
                </div>
                {selectedFiles.length > 0 ? (
                  <div className="studio-chip-wrap">
                    {selectedFiles.map((file) => (
                      <Tag key={`${file.name}-${file.size}`}>{file.name}</Tag>
                    ))}
                  </div>
                ) : (
                  <Text type="secondary">支持多文件批量上传，后端会逐个解析并建立入库状态。</Text>
                )}
              </div>
            ) : null}

            {sourceMode === 'url' ? (
              <div className="page-stack">
                <div className="studio-form-field">
                  <Text type="secondary">URL</Text>
                  <Input
                    prefix={<GlobalOutlined />}
                    value={urlInput}
                    onChange={(event) => setUrlInput(event.target.value)}
                    placeholder="https://example.com/help/article"
                  />
                </div>
                <div className="studio-form-actions">
                  <Button type="primary" onClick={() => void handleIngestUrl()} loading={ingesting} disabled={!currentKb}>
                    抓取并入库
                  </Button>
                </div>
              </div>
            ) : null}

            {sourceMode === 'faq' ? (
              <div className="page-stack">
                <div className="studio-form-field">
                  <Text type="secondary">问题</Text>
                  <Input
                    value={faqQuestion}
                    onChange={(event) => setFaqQuestion(event.target.value)}
                    placeholder="例如：如何重置客服工作台会话？"
                  />
                </div>
                <div className="studio-form-field">
                  <Text type="secondary">答案</Text>
                  <TextArea
                    value={faqAnswer}
                    onChange={(event) => setFaqAnswer(event.target.value)}
                    rows={3}
                    placeholder="写入稳定、可复用的标准答案。"
                  />
                </div>
                <div className="studio-form-actions">
                  <Space wrap>
                    <Button onClick={handleAddFaqItem}>添加 FAQ 条目</Button>
                    <Button type="primary" onClick={() => void handleIngestFaq()} loading={ingesting} disabled={!currentKb}>
                      导入 FAQ
                    </Button>
                  </Space>
                </div>
                {faqItems.length > 0 ? (
                  <List
                    size="small"
                    dataSource={faqItems}
                    renderItem={(item, index) => (
                      <List.Item>
                        <Space direction="vertical" size={2}>
                          <strong>{index + 1}. {item.question}</strong>
                          <Text type="secondary">{item.answer}</Text>
                        </Space>
                      </List.Item>
                    )}
                  />
                ) : null}
              </div>
            ) : null}
          </Card>
          ) : null}

          {activeSection === 'sources' ? (
            <>
          <Card className="config-panel-card studio-knowledge-source-card">
            <div className="config-card-header">
              <div className="page-section-title">
                <Typography.Title level={4}>来源治理</Typography.Title>
                <Text type="secondary">把文档背后的长期来源单独看清楚。当前先支持来源列表、最近状态回看和手动重新同步。</Text>
              </div>
              <Tag color="gold">{sources.length} sources</Tag>
            </div>

            <div className="studio-form-actions">
              <Space wrap>
                <Tag color="processing">可同步 {syncableSources.length}</Tag>
                <Text type="secondary">URL / FAQ 会保留为可重复同步的来源对象；上传文件也会记录成一次性来源。</Text>
              </Space>
            </div>

            {sources.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前知识库还没有来源对象。" />
            ) : (
              <div className="page-grid studio-knowledge-detail-grid">
                <List
                  className="studio-run-list"
                  dataSource={sources}
                  renderItem={(item) => (
                    <List.Item
                      className={`studio-run-list-item ${selectedSourceId === item.sourceId ? 'is-active' : ''}`}
                      actions={[
                        <Button
                          key={`sync-${item.sourceId}`}
                          size="small"
                          type="text"
                          icon={<ReloadOutlined />}
                          onClick={() => void handleSyncSource(item)}
                          disabled={!item.syncSupported}
                          loading={syncingSourceId === item.sourceId}
                        >
                          重新同步
                        </Button>,
                      ]}
                      onClick={() => setSelectedSourceId(item.sourceId)}
                    >
                      <div className="studio-run-list-copy">
                        <div className="studio-run-list-head">
                          <Space wrap>
                            <strong>{item.title}</strong>
                            <Tag>{item.sourceType}</Tag>
                            <Tag color={item.enabled ? 'success' : 'default'}>{item.enabled ? '启用' : '停用'}</Tag>
                            <Tag color={item.syncSupported ? 'processing' : 'default'}>
                              {item.syncSupported ? '可同步' : '仅历史记录'}
                            </Tag>
                          </Space>
                          <Text type="secondary">{item.lastSyncedAt ? formatDateTimeZh(item.lastSyncedAt) : '尚未同步'}</Text>
                        </div>
                        <Text type="secondary">
                          文档 {item.docCount} · 已同步 {item.syncCount} 次
                          {item.sourceUri ? ` · ${item.sourceUri}` : ''}
                        </Text>
                        {item.latestDocument ? (
                          <Text type="secondary">
                            最近文档：{item.latestDocument.title} · {item.latestDocument.docStatus}
                          </Text>
                        ) : null}
                        {item.latestJob?.errorSummary ? <Text type="danger">{item.latestJob.errorSummary}</Text> : null}
                      </div>
                    </List.Item>
                  )}
                />

                {selectedSource ? (
                  <Card size="small" className="config-panel-card">
                    <div className="config-card-header">
                      <div className="page-section-title">
                        <Typography.Title level={5}>来源详情</Typography.Title>
                        <Text type="secondary">在同步前先管理来源标题、启停状态，以及网页地址或问答内容。</Text>
                      </div>
                      <Tag color="blue">{selectedSource.sourceType}</Tag>
                    </div>

                    <div className="studio-form-grid">
                      <div className="studio-form-field studio-form-field-span-2">
                        <Text type="secondary">来源标题</Text>
                        <Input
                          value={sourceEditor.title}
                          onChange={(event) => updateSourceEditor('title', event.target.value)}
                          placeholder="填写来源标题"
                        />
                      </div>

                      <div className="studio-form-field studio-form-field-span-2">
                        <Checkbox
                          checked={sourceEditor.enabled}
                          onChange={(event) => updateSourceEditor('enabled', event.target.checked)}
                        >
                          启用该来源
                        </Checkbox>
                      </div>

                      {selectedSource.sourceType === 'web_url' ? (
                        <div className="studio-form-field studio-form-field-span-2">
                          <Text type="secondary">URL</Text>
                          <Input
                            prefix={<GlobalOutlined />}
                            value={sourceEditor.url}
                            onChange={(event) => updateSourceEditor('url', event.target.value)}
                            placeholder="https://example.com/help/article"
                          />
                        </div>
                      ) : null}

                      {selectedSource.sourceType === 'faq_table' ? (
                        <div className="studio-form-field studio-form-field-span-2">
                          <Text type="secondary">问答条目</Text>
                          <TextArea
                            value={sourceEditor.faqItemsText}
                            onChange={(event) => updateSourceEditor('faqItemsText', event.target.value)}
                            rows={8}
                            placeholder='[{"question":"问题","answer":"答案"}]'
                          />
                        </div>
                      ) : null}

                      {selectedSource.sourceType === 'upload_file' ? (
                        <Alert
                          className="studio-inline-alert studio-form-field-span-2"
                          type="info"
                          showIcon
                          message="上传文件来源当前只支持标题 / 启停治理；如需替换原始文件，请重新上传。"
                        />
                      ) : null}
                    </div>

                    <div className="studio-form-actions">
                      <Space wrap>
                        <Button
                          onClick={() => void handleSaveSource()}
                          loading={savingSourceId === selectedSource.sourceId}
                        >
                          保存来源
                        </Button>
                        <Button
                          type="primary"
                          icon={<ReloadOutlined />}
                          onClick={() => void handleSyncSource(selectedSource)}
                          disabled={!selectedSource.syncSupported}
                          loading={syncingSourceId === selectedSource.sourceId}
                        >
                          立即同步
                        </Button>
                      </Space>
                    </div>
                  </Card>
                ) : null}
              </div>
            )}
          </Card>

          <div className="page-grid studio-knowledge-detail-grid">
            <Card className="config-panel-card studio-knowledge-doc-card">
              <div className="config-card-header">
                <div className="page-section-title">
                  <Typography.Title level={4}>文档与状态</Typography.Title>
                  <Text type="secondary">查看当前文档的入库结果、片段数量和错误摘要。</Text>
                </div>
                <Tag>{filteredDocuments.length}/{documents.length}</Tag>
              </div>

              <div className="studio-form-grid">
                <div className="studio-form-field studio-form-field-span-2">
                  <Text type="secondary">文档筛选</Text>
                  <Input
                    value={documentQuery}
                    onChange={(event) => setDocumentQuery(event.target.value)}
                    placeholder="按标题、文件名、URL 或错误信息搜索"
                  />
                </div>
                <div className="studio-form-field">
                  <Text type="secondary">状态</Text>
                  <Select
                    value={documentStatusFilter}
                    onChange={setDocumentStatusFilter}
                    options={[
                      { value: 'all', label: '全部状态' },
                      { value: 'uploaded', label: 'uploaded' },
                      { value: 'parsing', label: 'parsing' },
                      { value: 'parsed', label: 'parsed' },
                      { value: 'indexing', label: 'indexing' },
                      { value: 'indexed', label: 'indexed' },
                      { value: 'error_parsing', label: 'error_parsing' },
                      { value: 'error_indexing', label: 'error_indexing' },
                    ]}
                  />
                </div>
                <div className="studio-form-field">
                  <Text type="secondary">来源</Text>
                  <Select
                    value={documentSourceFilter}
                    onChange={setDocumentSourceFilter}
                    options={[
                      { value: 'all', label: '全部来源' },
                      { value: 'upload_file', label: 'upload_file' },
                      { value: 'web_url', label: 'web_url' },
                      { value: 'faq_table', label: 'faq_table' },
                    ]}
                  />
                </div>
              </div>

              <div className="studio-form-actions">
                <Space wrap>
                  <Checkbox
                    checked={allFilteredSelected}
                    indeterminate={partiallySelected}
                    onChange={(event) => handleToggleFilteredSelection(event.target.checked)}
                    disabled={filteredDocumentIds.length === 0}
                  >
                    选择当前筛选结果
                  </Checkbox>
                  <Tag color={selectedDocIds.length > 0 ? 'processing' : 'default'}>
                    已选 {selectedDocIds.length}
                  </Tag>
                  <Button
                    onClick={() => void handleReindex(failedDocuments.map((item) => item.docId))}
                    disabled={!currentKb || failedDocuments.length === 0}
                    loading={reindexingTarget === 'all'}
                  >
                    重试失败文档
                  </Button>
                  <Button
                    onClick={() => void handleReindex(selectedDocIds)}
                    disabled={!currentKb || selectedDocIds.length === 0}
                    loading={reindexingTarget === 'all'}
                  >
                    重建选中
                  </Button>
                  <Button
                    danger
                    onClick={() => void handleDeleteDocuments(selectedDocIds)}
                    disabled={!currentKb || selectedDocIds.length === 0}
                  >
                    删除选中
                  </Button>
                  <Button onClick={() => setSelectedDocIds([])} disabled={selectedDocIds.length === 0}>
                    清空选择
                  </Button>
                </Space>
              </div>

              {filteredDocuments.length === 0 ? (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={documents.length === 0 ? '当前知识库还没有文档。' : '没有符合当前筛选条件的文档。'}
                />
              ) : (
                <List
                  className="studio-doc-list"
                  dataSource={filteredDocuments}
                  renderItem={(item) => (
                    <List.Item
                      className="studio-doc-list-item"
                      actions={[
                        <Button
                          key={`reindex-${item.docId}`}
                          type="text"
                          size="small"
                          onClick={() => void handleReindex([item.docId])}
                          loading={reindexingTarget === item.docId}
                        >
                          {isFailedDocumentStatus(item.docStatus) ? '重试' : '重建'}
                        </Button>,
                        <Button
                          key={`delete-${item.docId}`}
                          type="text"
                          danger
                          size="small"
                          onClick={() => void handleDeleteDocument(item)}
                        >
                          删除
                        </Button>,
                      ]}
                    >
                      <Space align="start" size={12} style={{ width: '100%' }}>
                        <Checkbox
                          checked={selectedDocIds.includes(item.docId)}
                          onChange={(event) => toggleDocumentSelection(item.docId, event.target.checked)}
                        />
                        <div className="studio-run-list-copy">
                          <div className="studio-run-list-head">
                            <Space wrap>
                              <strong>{item.title}</strong>
                              <Tag color={statusColor(item.docStatus)}>{item.docStatus}</Tag>
                              <Tag>{item.sourceType}</Tag>
                            </Space>
                            <Text type="secondary">{formatDateTimeZh(item.updatedAt)}</Text>
                          </div>
                          <Text type="secondary">
                            {item.chunkCount} chunks
                            {item.fileName ? ` · ${item.fileName}` : ''}
                            {item.sourceUri ? ` · ${item.sourceUri}` : ''}
                          </Text>
                          {item.errorSummary ? <Text type="danger">{item.errorSummary}</Text> : null}
                        </div>
                      </Space>
                    </List.Item>
                  )}
                />
              )}
            </Card>

            <Card className="config-panel-card studio-knowledge-job-card">
              <div className="config-card-header">
                <div className="page-section-title">
                  <Typography.Title level={4}>入库任务</Typography.Title>
                  <Text type="secondary">后台入库会留下处理轨迹，便于回看失败阶段和处理进度。</Text>
                </div>
                <Tag>{filteredJobs.length}/{jobs.length}</Tag>
              </div>

              <div className="studio-form-field">
                <Text type="secondary">任务状态</Text>
                <Select
                  value={jobStatusFilter}
                  onChange={setJobStatusFilter}
                  options={[
                    { value: 'all', label: '全部任务' },
                    { value: 'queued', label: 'queued' },
                    { value: 'running', label: 'running' },
                    { value: 'succeeded', label: 'succeeded' },
                    { value: 'failed', label: 'failed' },
                  ]}
                />
              </div>

              {filteredJobs.length === 0 ? (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={jobs.length === 0 ? '还没有 ingest job。' : '没有符合当前筛选条件的任务。'}
                />
              ) : (
                <List
                  className="studio-run-list"
                  dataSource={filteredJobs}
                  renderItem={(item) => (
                    <List.Item className="studio-run-list-item">
                      <div className="studio-run-list-copy">
                        <div className="studio-run-list-head">
                          <Space wrap>
                            <strong>{item.jobId}</strong>
                            <Tag color={statusColor(item.status)}>{item.status}</Tag>
                          </Space>
                          <Text type="secondary">{formatDateTimeZh(item.updatedAt)}</Text>
                        </div>
                        <Text type="secondary">track: {item.trackId}</Text>
                        {item.errorSummary ? <Text type="danger">{item.errorSummary}</Text> : null}
                      </div>
                    </List.Item>
                  )}
                />
              )}
            </Card>
          </div>
            </>
          ) : null}

          {activeSection === 'testing' ? (
            <Card className="config-panel-card studio-knowledge-retrieve-card">
            <div className="config-card-header">
              <div className="page-section-title">
                <Typography.Title level={4}>检索测试</Typography.Title>
                <Text type="secondary">先看召回片段和 citation，再决定要不要绑定给 agent。</Text>
              </div>
              {currentKb ? (
                <Tag color="cyan">
                  {retrieveMode === 'keyword' ? '标准' : retrieveMode === 'hybrid' ? '平衡' : '深度'}
                </Tag>
              ) : null}
              {currentKb && retrieveEffectiveMode && retrieveEffectiveMode !== retrieveMode ? (
                <Tag color="purple">实际使用 {retrieveEffectiveMode}</Tag>
              ) : null}
            </div>

            <div className="studio-form-grid">
              <div className="studio-form-field studio-form-field-span-2">
                <Text type="secondary">查询问题</Text>
                <TextArea
                  value={retrieveQuery}
                  onChange={(event) => setRetrieveQuery(event.target.value)}
                  rows={3}
                  placeholder="例如：restart the worker"
                />
              </div>

              <div className="studio-form-field">
                <Text type="secondary">请求模式</Text>
                <Segmented
                  block
                  value={retrieveMode}
                  onChange={(value) => setRetrieveMode(String(value))}
                  options={[
                    { label: '标准', value: 'keyword' },
                    { label: '平衡', value: 'hybrid' },
                    { label: '深度', value: 'semantic' },
                  ]}
                />
              </div>
            </div>

            <div className="studio-form-actions">
              <Space wrap>
                <Button
                  type="primary"
                  icon={<SearchOutlined />}
                  onClick={() => void handleRetrieve()}
                  loading={retrieving}
                  disabled={!currentKb}
                >
                  执行检索测试
                </Button>
                <Text type="secondary">
                  {retrieveEffectiveMode
                    ? `当前使用：${retrieveEffectiveMode}`
                    : '标准适合快速匹配，平衡适合通用问答，深度适合更宽松的语义召回。'}
                </Text>
              </Space>
            </div>

            {retrieveError ? <Alert type="error" showIcon message={retrieveError} /> : null}

            {retrieveHits.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="执行一次检索测试后，会在这里看到命中的证据块。" />
            ) : (
              <List
                className="studio-hit-list"
                dataSource={retrieveHits}
                renderItem={(hit) => (
                  <List.Item className="studio-run-list-item">
                    <div className="studio-run-list-copy">
                      <div className="studio-run-list-head">
                        <Space wrap>
                          <strong>{hit.citation.title}</strong>
                          <Tag>{hit.citation.sourceType || 'knowledge'}</Tag>
                          <Tag color="blue">score {hit.score.toFixed(3)}</Tag>
                        </Space>
                        <Text type="secondary">{hit.kbName}</Text>
                      </div>
                      <Paragraph className="studio-run-preview">{hit.preview}</Paragraph>
                      {hit.citation.sourceUri ? <Text type="secondary">{hit.citation.sourceUri}</Text> : null}
                    </div>
                  </List.Item>
                )}
              />
            )}
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  )
}
