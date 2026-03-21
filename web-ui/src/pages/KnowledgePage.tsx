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
  Dropdown,
  Empty,
  Form,
  Input,
  InputNumber,
  List,
  Modal,
  Popconfirm,
  Row,
  Select,
  Space,
  Spin,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
  Upload,
} from 'antd'
import type { TableProps, UploadFile } from 'antd'
import {
  CloudUploadOutlined,
  DatabaseOutlined,
  DeleteOutlined,
  GlobalOutlined,
  PlusOutlined,
  ReloadOutlined,
  SaveOutlined,
  SearchOutlined,
  FileTextOutlined,
  SettingOutlined,
  ExperimentOutlined,
  CloudSyncOutlined,
  MoreOutlined,
  InboxOutlined,
  QuestionCircleOutlined,
  RobotOutlined,
  UserOutlined,
} from '@ant-design/icons'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { api, ApiError } from '../api'
import PageHero from '../components/PageHero'
import DevOnly from '../components/DevOnly'
import { formatDateTimeZh } from '../locale'
import { MotionPanel } from '../components/MotionSurface'
import type {
  KnowledgeBaseDefinition,
  KnowledgeBaseMutationInput,
  KnowledgeDocument,
  KnowledgeHit,
  KnowledgeIngestJob,
  KnowledgeSource,
} from '../types'

const { Text, Paragraph, Title } = Typography
const { TextArea } = Input
const { Dragger } = Upload

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
    case 'indexed': return '已索引'
    case 'parsing': return '解析中'
    case 'indexing': return '索引中'
    case 'error_parsing': return '解析失败'
    case 'error_indexing': return '索引失败'
    case 'uploaded': return '已上传'
    default: return status
  }
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
  const location = useLocation()
  const navigate = useNavigate()
  const { kbId } = useParams()
  const selectedKbId = kbId && kbId !== 'new' ? kbId : null
  const isCreatingKb = kbId === 'new' || location.pathname.endsWith('/knowledge/new')
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
  const [selectedDocIds, setSelectedDocIds] = useState<string[]>([])
  const [retrieveQuery, setRetrieveQuery] = useState('restart the worker')
  const [retrieveHits, setRetrieveHits] = useState<KnowledgeHit[]>([])
  const [retrieveMode, setRetrieveMode] = useState('hybrid')
  const [retrieveEffectiveMode, setRetrieveEffectiveMode] = useState<string | null>(null)
  
  // UI State
  const [uploadDrawerOpen, setUploadDrawerOpen] = useState(false)
  const [loadingWorkspace, setLoadingWorkspace] = useState(true)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [ingesting, setIngesting] = useState(false)
  const [reindexingTarget, setReindexingTarget] = useState<string | 'all' | null>(null)
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
    if (!kbId && !isCreatingKb && knowledgeBases[0]) {
      navigate(`/knowledge/${knowledgeBases[0].kbId}`, { replace: true })
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
  }, [isCreatingKb, kbId, knowledgeBases, loadingWorkspace, navigate, selectedKbId])

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
      setForm(kbToForm(kb))
      setRetrieveMode(kb.retrievalProfile.mode)
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
      navigate(`/knowledge/${saved.kbId}`, { replace: true })
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
        navigate(`/knowledge/${remaining[0].kbId}`, { replace: true })
      } else {
        navigate('/knowledge/new', { replace: true })
      }
    } catch (deleteError) {
      setError(getErrorMessage(deleteError, '删除知识库失败'))
    } finally {
      setDeleting(false)
    }
  }

  async function handleUploadFiles(fileList: File[]) {
    if (!currentKb) return
    try {
      setIngesting(true)
      const formData = new FormData()
      fileList.forEach((file) => formData.append('file', file))
      await api.uploadKnowledgeDocuments(currentKb.kbId, formData)
      message.success(`已提交 ${fileList.length} 个文件，后台正在入库`)
      setSelectedFiles([])
      setUploadDrawerOpen(false)
      await loadKnowledgeDetail(currentKb.kbId)
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
      await api.addKnowledgeSource(currentKb.kbId, {
        sourceType: 'web_url',
        url: urlInput.trim(),
      })
      message.success('URL 已提交，后台正在抓取和入库')
      setUrlInput('')
      setUploadDrawerOpen(false)
      await loadKnowledgeDetail(currentKb.kbId)
    } catch (ingestError) {
      setError(getErrorMessage(ingestError, '接入 URL 失败'))
    } finally {
      setIngesting(false)
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
      setRetrieveError(null)
    } catch (retrieveErrorValue) {
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

  async function handleReindex(docIds: string[]) {
    if (!currentKb) return
    try {
      setReindexingTarget('all') // Simplified for now
      await api.reindexKnowledgeBase(currentKb.kbId, { docIds })
      message.success(`已提交 ${docIds.length} 个文档的重建任务`)
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
          <Text type="secondary" className="knowledge-meta-text">{record.fileName}</Text>
        </Space>
      ),
    },
    {
      title: '类型',
      dataIndex: 'sourceType',
      key: 'sourceType',
      width: 100,
      render: (text) => <Tag>{text === 'file' ? '文件' : text === 'web_url' ? '网页' : text}</Tag>,
    },
    {
      title: '状态',
      key: 'status',
      width: 120,
      render: (_, record) => <Badge status={statusBadgeStatus(record.docStatus)} text={statusLabel(record.docStatus)} />,
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
      width: 100,
      render: (_, record) => (
        <Space>
          <Tooltip title="重新索引">
            <Button size="small" icon={<ReloadOutlined />} onClick={() => handleReindex([record.docId])} />
          </Tooltip>
          <Popconfirm title="确认删除？" onConfirm={() => handleDeleteDocument(record.docId)}>
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ]

  // Render Content based on active tab
  const renderTabContent = (key: string) => {
    switch (key) {
      case 'overview':
        return (
          <Space direction="vertical" size={24} style={{ width: '100%' }}>
            <Card title="基础信息" className="page-card" bordered={false}>
              <Descriptions column={2}>
                <Descriptions.Item label="名称">{currentKb?.name}</Descriptions.Item>
                <Descriptions.Item label="状态">
                  <Badge status={currentKb?.enabled ? 'success' : 'default'} text={currentKb?.enabled ? '已启用' : '已停用'} />
                </Descriptions.Item>
                <Descriptions.Item label="文档数量">{documents.length}</Descriptions.Item>
                <Descriptions.Item label="检索模式">
                  {currentKb?.retrievalProfile.mode === 'keyword' ? '标准 (Keyword)' : 
                   currentKb?.retrievalProfile.mode === 'semantic' ? '深度 (Semantic)' : '平衡 (Hybrid)'}
                </Descriptions.Item>
                <Descriptions.Item label="描述" span={2}>
                  {currentKb?.description || '暂无描述'}
                </Descriptions.Item>
              </Descriptions>
            </Card>

            <Card title="最近任务" className="page-card" bordered={false}>
              {jobs.length > 0 ? (
                <List
                  dataSource={jobs.slice(0, 5)}
                  renderItem={job => (
                    <List.Item>
                      <List.Item.Meta
                        avatar={
                          job.status === 'failed' ? <Badge status="error" /> : 
                          job.status === 'completed' ? <Badge status="success" /> : <Badge status="processing" />
                        }
                        title={`任务 ID: ${job.jobId.substring(0, 8)}`}
                        description={formatDateTimeZh(job.createdAt)}
                      />
                      <div>{job.status}</div>
                    </List.Item>
                  )}
                />
              ) : <Empty description="暂无任务记录" image={Empty.PRESENTED_IMAGE_SIMPLE} />}
            </Card>
          </Space>
        )
      case 'documents':
        return (
          <Card 
            className="page-card" 
            bordered={false} 
            styles={{ body: { padding: 0 } }}
            title="文档管理"
            extra={
              <Button type="primary" icon={<PlusOutlined />} onClick={() => setUploadDrawerOpen(true)}>
                添加文档
              </Button>
            }
          >
            <Table
              dataSource={documents}
              columns={documentColumns}
              rowKey="docId"
              scroll={{ x: 'max-content' }}
              pagination={{ pageSize: 10 }}
              loading={loadingDetail}
            />
          </Card>
        )
      case 'testing':
        return (
          <Card className="page-card" bordered={false} title="检索验证">
            <div className="knowledge-testing-shell">
              <Space direction="vertical" style={{ width: '100%' }} size={24}>
                <Space.Compact className="knowledge-search-compact">
                  <Input 
                    size="large"
                    placeholder="输入问题测试检索效果..." 
                    value={retrieveQuery}
                    onChange={(e) => setRetrieveQuery(e.target.value)}
                    onPressEnter={() => void handleRetrieve()}
                  />
                  <Button type="primary" size="large" icon={<SearchOutlined />} onClick={() => void handleRetrieve()} loading={retrieving}>
                    检索
                  </Button>
                </Space.Compact>

                {retrieveError && <Alert type="error" message={retrieveError} showIcon />}

                {retrieveHits.length > 0 && (
                  <List
                    itemLayout="vertical"
                    dataSource={retrieveHits}
                    renderItem={(item) => (
                      <List.Item style={{ padding: '16px', background: 'var(--nb-surface-strong)', borderRadius: 8, marginBottom: 16 }}>
                        <Space direction="vertical" style={{ width: '100%' }}>
                          <Space>
                            <Tag color="blue">{item.score.toFixed(4)}</Tag>
                            <Text strong>{String(item.metadata?.title || '未命名文档')}</Text>
                          </Space>
                          <Paragraph ellipsis={{ rows: 3, expandable: true }}>
                            {item.content}
                          </Paragraph>
                          <Text type="secondary" className="knowledge-meta-text">Doc ID: {item.docId}</Text>
                        </Space>
                      </List.Item>
                    )}
                  />
                )}
              </Space>
            </div>
          </Card>
        )
      case 'settings':
        return (
          <Card className="page-card" bordered={false} title="知识库配置">
             <div className="studio-form-grid knowledge-settings-shell">
              <Row gutter={[24, 24]}>
                <Col span={24}>
                  <div className="studio-form-field">
                    <Text type="secondary">名称</Text>
                    <Input value={form.name} onChange={(e) => updateForm('name', e.target.value)} />
                  </div>
                </Col>
                <Col span={24}>
                  <div className="studio-form-field">
                    <Text type="secondary">描述</Text>
                    <TextArea value={form.description} onChange={(e) => updateForm('description', e.target.value)} rows={3} />
                  </div>
                </Col>
                <Col xs={24} md={12}>
                  <div className="studio-form-field">
                    <Text type="secondary">检索模式</Text>
                    <Select
                      value={form.mode}
                      onChange={(v) => updateForm('mode', v)}
                      options={[
                        { label: '标准 (Keyword)', value: 'keyword' },
                        { label: '平衡 (Hybrid)', value: 'hybrid' },
                        { label: '深度 (Semantic)', value: 'semantic' },
                      ]}
                      style={{ width: '100%' }}
                    />
                  </div>
                </Col>
                <Col xs={24} md={12}>
                  <div className="studio-form-field">
                    <Text type="secondary">Chunk Size</Text>
                    <InputNumber 
                      value={form.chunkSize} 
                      onChange={(v) => updateForm('chunkSize', v || 800)} 
                      style={{ width: '100%' }}
                    />
                  </div>
                </Col>
                <Col xs={24} md={12}>
                  <div className="studio-form-field">
                    <Text type="secondary">Top K</Text>
                    <InputNumber 
                      value={form.topK} 
                      onChange={(v) => updateForm('topK', v || 8)} 
                      style={{ width: '100%' }}
                    />
                  </div>
                </Col>
              </Row>
              
              <div style={{ marginTop: 24, paddingTop: 24, borderTop: '1px solid var(--nb-border)' }}>
                <Space>
                  <Button type="primary" icon={<SaveOutlined />} onClick={handleSave} loading={saving}>
                    保存配置
                  </Button>
                  {currentKb && (
                    <Popconfirm title="确定删除此知识库？" onConfirm={handleDelete} okButtonProps={{ danger: true }}>
                      <Button danger icon={<DeleteOutlined />} loading={deleting}>删除</Button>
                    </Popconfirm>
                  )}
                </Space>
              </div>
            </div>
          </Card>
        )
      default:
        return null
    }
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
        title="知识库"
        actions={(
          <Space wrap>
            <Button icon={<ReloadOutlined />} onClick={() => void loadWorkspace()} loading={loadingWorkspace}>
              刷新
            </Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/knowledge/new')}>
              新建
            </Button>
          </Space>
        )}
      />

      {error ? <Alert type="error" showIcon message={error} style={{ margin: '0 var(--nb-layout-gutter)' }} /> : null}

      <div className="page-content-wrapper" style={{ padding: '0 var(--nb-layout-gutter)' }}>
        <Row gutter={[24, 24]}>
          <Col xs={24} md={6}>
            <Card title="知识库列表" className="page-card" bordered={false} styles={{ body: { padding: 0 } }}>
              {knowledgeBases.length === 0 ? (
                <Empty description="暂无知识库" style={{ padding: 24 }} />
              ) : (
                <List
                  dataSource={knowledgeBases}
                  renderItem={(item) => (
                    <List.Item
                      className={`studio-knowledge-list-item ${selectedKbId === item.kbId ? 'is-active' : ''}`}
                      onClick={() => navigate(`/knowledge/${item.kbId}`)}
                      style={{ 
                        cursor: 'pointer', 
                        padding: '12px 16px',
                        borderBottom: '1px solid var(--nb-border)',
                        background: selectedKbId === item.kbId ? 'var(--nb-card-subtle-bg)' : 'transparent',
                        borderLeft: selectedKbId === item.kbId ? '3px solid var(--nb-accent)' : '3px solid transparent',
                        transition: 'all 0.2s'
                      }}
                    >
                      <div style={{ width: '100%' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                          <Text strong>{item.name}</Text>
                          <Badge status={item.enabled ? 'success' : 'default'} />
                        </div>
                        <Text type="secondary" ellipsis>
                          {item.description || '暂无描述'}
                        </Text>
                      </div>
                    </List.Item>
                  )}
                />
              )}
            </Card>
          </Col>

          <Col xs={24} md={18}>
            {!selectedKbId && !isCreatingKb ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="选择知识库或新建"
                style={{ background: 'var(--nb-card-bg)', padding: 48, borderRadius: 12 }}
              />
            ) : (
              <div className="commercial-tabs-container">
                 <Tabs
                  items={[
                    { label: '概览', key: 'overview', children: renderTabContent('overview') },
                    { label: '文档', key: 'documents', children: renderTabContent('documents') },
                    { label: '验证', key: 'testing', children: renderTabContent('testing') },
                    { label: '设置', key: 'settings', children: renderTabContent('settings') },
                  ]}
                  type="card"
                  className="commercial-tabs"
                />
              </div>
            )}
          </Col>
        </Row>
      </div>

      <Drawer
        title="添加文档"
        open={uploadDrawerOpen}
        onClose={() => setUploadDrawerOpen(false)}
        width="min(500px, calc(100vw - 16px))"
      >
        <Tabs items={[
          {
            label: '上传文件',
            key: 'file',
            children: (
              <div style={{ marginTop: 16 }}>
                <Dragger
                  name="file"
                  multiple
                  showUploadList={false}
                  customRequest={({ file, onSuccess }) => {
                    setTimeout(() => onSuccess?.('ok'), 0)
                  }}
                  onChange={(info) => {
                    if (info.file.status !== 'uploading') {
                      setSelectedFiles((curr) => [...curr, info.file.originFileObj as File])
                    }
                  }}
                  style={{ padding: 24, background: 'var(--nb-surface-strong)', border: '1px dashed var(--nb-border)' }}
                >
                  <p className="ant-upload-drag-icon">
                    <InboxOutlined style={{ color: 'var(--nb-primary)' }} />
                  </p>
                  <p className="ant-upload-text">点击或拖拽文件到此区域</p>
                  <p className="ant-upload-hint">支持 PDF, Markdown, TXT, DOCX</p>
                </Dragger>
                
                {selectedFiles.length > 0 && (
                  <div style={{ marginTop: 24 }}>
                    <List
                      size="small"
                      header={<Text strong>已选文件 ({selectedFiles.length})</Text>}
                      dataSource={selectedFiles}
                      renderItem={(file, index) => (
                        <List.Item
                          actions={[<Button type="text" danger icon={<DeleteOutlined />} onClick={() => setSelectedFiles(curr => curr.filter((_, i) => i !== index))} />]}
                        >
                          <Text ellipsis>{file.name}</Text>
                        </List.Item>
                      )}
                    />
                    <Button type="primary" block style={{ marginTop: 16 }} onClick={() => handleUploadFiles(selectedFiles)} loading={ingesting}>
                      开始上传
                    </Button>
                  </div>
                )}
              </div>
            )
          },
          {
            label: '网页抓取',
            key: 'url',
            children: (
              <Space direction="vertical" style={{ width: '100%', marginTop: 16 }}>
                <Input 
                  prefix={<GlobalOutlined />} 
                  placeholder="https://example.com/page" 
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                />
                <Button type="primary" block onClick={handleIngestUrl} loading={ingesting}>
                  开始抓取
                </Button>
              </Space>
            )
          }
        ]} />
      </Drawer>
    </div>
  )
}
