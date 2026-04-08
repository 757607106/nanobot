import { Suspense, lazy, useMemo, useState } from 'react'
import {
  Alert,
  Badge,
  Button,
  Collapse,
  Dropdown,
  Empty,
  Flex,
  Input,
  Select,
  Space,
  Spin,
  Switch,
  Table,
  Tabs,
  Tag,
  Typography,
  type TableColumnsType,
} from 'antd'
import {
  BranchesOutlined,
  DeleteOutlined,
  FileSearchOutlined,
  FileTextOutlined,
  FolderAddOutlined,
  FolderOpenOutlined,
  MoreOutlined,
  ReloadOutlined,
  RetweetOutlined,
  SaveOutlined,
  SearchOutlined,
  UploadOutlined,
} from '@ant-design/icons'
import { startTransition } from 'react'
import { useNavigate } from 'react-router-dom'
import SectionCard from '../../components/console/SectionCard'
import MetricCard from '../../components/console/MetricCard'
import { formatDateTimeZh } from '../../locale'
import { api } from '../../api'
import { KNOWLEDGE_ARCHITECTURE_LABEL, canDeleteKnowledgeFile, canParseKnowledgeFile, canIndexKnowledgeFile, statusColor, statusLabel, LANGUAGE_OPTIONS, CHUNK_PRESET_OPTIONS } from './shared'
import type {
  KnowledgeBaseDefinition,
  KnowledgeDocument,
  KnowledgeFileListResponse,
  KnowledgeIngestJob,
  KnowledgeQueryParams,
  KnowledgeRetrieveResult,
  KnowledgeGraphData,
  KnowledgeGraphStats,
  KnowledgeMindmapNode,
  KnowledgeBenchmark,
  KnowledgeEvaluationSummary,
  KnowledgeEvaluationResult,
  KnowledgeQueryParamSchema,
} from '../../types'
import { useKnowledge } from './KnowledgeContext'
import { KnowledgeQueryTab } from './KnowledgeQueryTab'
const KnowledgeGraphTab = lazy(() => import('./KnowledgeGraphTab').then(mod => ({ default: mod.KnowledgeGraphTab })))
import { KnowledgeMindmapTab } from './KnowledgeMindmapTab'
import { KnowledgeEvaluationTab } from './KnowledgeEvaluationTab'
import { KnowledgeBenchmarksTab } from './KnowledgeBenchmarksTab'
import type { ColumnsType } from 'antd/es/table'

export default function KnowledgeWorkspace() {
  const ctx = useKnowledge()
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState('files')

  const {
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
    onFormStateChange,
    onActiveTabChange,
    onFileSearchChange,
    onSelectedFileIdsChange,
    onRefreshDetail,
    onDeleteKnowledgeBase,
    onOpenModal,
    onSetUrlParentId,
    onParseSelected,
    onIndexSelected,
    onDeleteSelectedFiles,
    onOpenMoveModal,
    onOpenFileDetail,
    onQueryParamsChange,
    onQueryTextChange,
    onQuery,
    onResultViewChange,
    onSaveQueryDefaults,
    onGraphConfigChange,
    onReloadGraph,
    onRegenerateMindmap,
    onBenchmarkChange,
    onRunEvaluation,
    onRefreshBenchmarks,
    onViewEvaluationResult,
    onDeleteEvaluationResult,
    onOpenBenchmarkGenerate,
    onOpenBenchmarkUpload,
    onSaveKnowledgeBase,
    onGenerateDescription,
  } = ctx

  const selectableVisibleFileIds = useMemo(
    () => visibleFiles
      .filter((item) => item.isFolder || canDeleteKnowledgeFile(item.status))
      .map((item) => item.fileId),
    [visibleFiles]
  )

  const allVisibleSelected = selectableVisibleFileIds.length > 0
    && selectableVisibleFileIds.every((item) => selectedFileIds.includes(item))
  const hasVisibleSelection = selectableVisibleFileIds.some((item) => selectedFileIds.includes(item))

  const fileColumns: TableColumnsType<KnowledgeDocument> = useMemo(() => [
    {
      title: '名称',
      key: 'name',
      width: 260,
      render: (_value, item) => (
        <Flex gap={12} align="center">
          <Tag color={item.isFolder ? 'warning' : 'default'} bordered={false}>{item.isFolder ? 'DIR' : 'DOC'}</Tag>
          <Flex vertical gap={4} style={{ minWidth: 0, justifyContent: 'center' }}>
            <Typography.Text strong style={{ marginTop: 2 }}>{item.filename}</Typography.Text>
            <Typography.Text type="secondary">{item.title || item.originalFilename || '未命名条目'}</Typography.Text>
            {item.errorMessage || item.errorSummary ? (
              <Typography.Text type="danger">{item.errorSummary || item.errorMessage}</Typography.Text>
            ) : null}
          </Flex>
        </Flex>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 120,
      render: (status) => (
        <Badge
          status={statusColor(status) as 'success' | 'processing' | 'default' | 'error' | 'warning'}
          text={statusLabel(status)}
        />
      ),
    },
    {
      title: '类型',
      dataIndex: 'fileType',
      key: 'fileType',
      width: 120,
      render: (fileType) => fileType || '--',
    },
    {
      title: '路径',
      dataIndex: 'path',
      key: 'path',
      width: 240,
      render: (path) => <Typography.Text type="secondary">{path}</Typography.Text>,
    },
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      key: 'updatedAt',
      width: 170,
      render: (updatedAt) => <Typography.Text type="secondary">{updatedAt ? formatDateTimeZh(updatedAt) : '--'}</Typography.Text>,
    },
    {
      title: '操作',
      key: 'actions',
      width: 240,
      align: 'right',
      render: (_value, item) => {
        const selectable = item.isFolder || canDeleteKnowledgeFile(item.status)
        return (
          <Space wrap size={[8, 8]} style={{ justifyContent: 'flex-end' }}>
            {!item.isFolder ? (
              <>
                <Button size="small" onClick={() => void onOpenFileDetail(item)}>
                  详情
                </Button>
                <Button
                  size="small"
                  onClick={() => window.open(api.downloadKnowledgeFileUrl(currentKb?.kbId || '', item.fileId, 'raw'), '_blank', 'noopener')}
                >
                  原文
                </Button>
                {item.markdownFile ? (
                  <Button
                    size="small"
                    onClick={() => window.open(api.downloadKnowledgeFileUrl(currentKb?.kbId || '', item.fileId, 'parsed'), '_blank', 'noopener')}
                  >
                    解析稿
                  </Button>
                ) : null}
              </>
            ) : null}
            <Button
              size="small"
              danger
              disabled={!selectable}
              onClick={() => void onDeleteSelectedFiles([item])}
            >
              删除
            </Button>
          </Space>
        )
      },
    },
  ], [currentKb?.kbId])

  const handleTabChange = (key: string) => {
    setActiveTab(key)
    onActiveTabChange(key)
  }

  const renderFilesTab = () => (
    <Flex vertical gap={16}>
      <div className="knowledge-tab-content-borderless"><Flex vertical gap={16}>
          <div className="knowledge-section-header">文件列表</div>
          <div className="resource-summary-strip">
            <div className="resource-summary-tile" style={{ padding: '12px 14px' }}>
              <span className="resource-summary-label">当前选择</span>
              <span className="resource-summary-value">{selectedFileIds.length}</span>
            </div>
            <div className="resource-summary-tile" style={{ padding: '12px 14px' }}>
              <span className="resource-summary-label">待解析</span>
              <span className="resource-summary-value">{pendingParseCount}</span>
            </div>
            <div className="resource-summary-tile" style={{ padding: '12px 14px' }}>
              <span className="resource-summary-label">待索引</span>
              <span className="resource-summary-value">{pendingIndexCount}</span>
            </div>
            <div className="resource-summary-tile" style={{ padding: '12px 14px' }}>
              <span className="resource-summary-label">最近任务</span>
              <span className="resource-summary-value">{jobs.length}</span>
            </div>
          </div>

          <Flex justify="space-between" align="center" gap={12} wrap="wrap">
            <div className="knowledge-file-search">
              <Input
                placeholder="搜索文件名、标题或路径"
                value={fileSearch}
                onChange={(event) => onFileSearchChange(event.target.value)}
                prefix={<SearchOutlined />}
                allowClear
                aria-label="搜索文件"
              />
            </div>

            <Flex gap={8} wrap="wrap" align="center">
              {/* 主操作按钮 */}
              <Space size={8}>
                <Button
                  type="primary"
                  icon={<UploadOutlined />}
                  onClick={() => {
                    onSetUrlParentId(hasSingleSelection && selectedFiles[0].isFolder ? selectedFiles[0].fileId : null)
                    onOpenModal('url')
                  }}
                >
                  添加文件
                </Button>
                <Button
                  icon={<BranchesOutlined />}
                  disabled={!canIndexSelectedDocuments}
                  onClick={() => onIndexSelected()}
                  loading={loading.indexing}
                >
                  建索引
                </Button>
              </Space>

              {/* 分隔线 */}
              <div className="knowledge-toolbar-divider" />

              {/* 次操作 Dropdown */}
              <Dropdown
                menu={{
                  items: [
                    {
                      key: 'folder',
                      icon: <FolderAddOutlined />,
                      label: '新建文件夹',
                      onClick: () => onOpenModal('folder'),
                    },
                    {
                      key: 'parse',
                      icon: <RetweetOutlined />,
                      label: '解析选中文件',
                      disabled: !canParseSelectedDocuments,
                      onClick: () => onParseSelected(),
                    },
                    {
                      key: 'indexConfig',
                      icon: <SaveOutlined />,
                      label: '索引配置',
                      onClick: () => onOpenModal('indexConfig'),
                    },
                    {
                      type: 'divider',
                    },
                    {
                      key: 'move',
                      icon: <FolderOpenOutlined />,
                      label: '移动',
                      disabled: !hasSingleSelection,
                      onClick: onOpenMoveModal,
                    },
                    {
                      key: 'delete',
                      icon: <DeleteOutlined />,
                      label: '删除',
                      disabled: !hasSelectedFiles,
                      danger: true,
                      onClick: () => onDeleteSelectedFiles(),
                    },
                  ],
                }}
              >
                <Button icon={<MoreOutlined />}>更多</Button>
              </Dropdown>
            </Flex>
          </Flex>

          <Table
            size="middle"
            rowKey="fileId"
            columns={fileColumns}
            dataSource={visibleFiles}
            pagination={false}
            scroll={{ x: 1100 }}
            rowSelection={{
              selectedRowKeys: selectedFileIds,
              columnTitle: (
                <input
                  aria-label="选择可见文件"
                  type="checkbox"
                  checked={allVisibleSelected}
                  ref={(node) => {
                    if (node) {
                      node.indeterminate = hasVisibleSelection && !allVisibleSelected
                    }
                  }}
                  onChange={(event) => {
                    const nextChecked = event.target.checked
                    onSelectedFileIdsChange(
                      nextChecked
                        ? Array.from(new Set([...selectedFileIds, ...selectableVisibleFileIds]))
                        : selectedFileIds.filter((item) => !selectableVisibleFileIds.includes(item))
                    )
                  }}
                />
              ),
              onChange: (nextKeys) => onSelectedFileIdsChange(nextKeys.map(String)),
              getCheckboxProps: (record) => ({
                disabled: !(record.isFolder || canDeleteKnowledgeFile(record.status)),
                'aria-label': `选择 ${record.filename}`,
              }),
            }}
            locale={{
              emptyText: <Empty image={false} className="minimal-empty" description="暂无数据" />,
            }}
          />
        </Flex>
      </div>

      <SectionCard
        title="最近任务"
        description=""
      >
        {jobs.slice(0, 6).length === 0 ? (
          <Empty image={false} className="minimal-empty" description="暂无后台任务" />
        ) : (
          <Flex vertical gap={12}>
            {jobs.slice(0, 6).map((item) => (
              <div
                key={item.jobId}
                className="knowledge-job-item"
              >
                <Flex justify="space-between" align="center" gap={12} wrap="wrap">
                  <Space wrap size={[8, 8]}>
                    <Tag color={statusColor(item.status)}>{statusLabel(item.status)}</Tag>
                    <Typography.Text strong>{item.jobKind}</Typography.Text>
                    <Typography.Text type="secondary">{item.targetFileIds.length} 个文件</Typography.Text>
                  </Space>
                  <Typography.Text type="secondary">
                    {item.updatedAt ? formatDateTimeZh(item.updatedAt) : '--'}
                  </Typography.Text>
                </Flex>
              </div>
            ))}
          </Flex>
        )}
      </SectionCard>
    </Flex>
  )

  const workspaceTabItems = [
    {
      key: 'files',
      label: (
        <span>
          文件
          {pendingParseCount > 0 && (
            <Badge count={pendingParseCount} size="small" style={{ marginLeft: 4 }} />
          )}
        </span>
      ),
      children: renderFilesTab(),
    },
    {
      key: 'query',
      label: '检索测试',
      children: (
        <KnowledgeQueryTab
          queryParams={queryParams}
          queryText={queryText}
          queryLoading={loading.query}
          queryResult={queryResult}
          resultView={resultView}
          onModeChange={(value) =>
            onQueryParamsChange({
              ...queryParams,
              mode: value,
            })
          }
          onTopKChange={(value) => onQueryParamsChange({ ...queryParams, topK: value })}
          onChunkTopKChange={(value) => onQueryParamsChange({ ...queryParams, chunkTopK: value })}
          onEnableRerankChange={(checked) => onQueryParamsChange({ ...queryParams, enableRerank: checked })}
          onSaveQueryDefaults={onSaveQueryDefaults}
          onOpenQueryConfig={() => onOpenModal('queryConfig')}
          onResultViewChange={onResultViewChange}
          onQueryTextChange={onQueryTextChange}
          onQuery={(query) => onQuery(query)}
        />
      ),
    },
    {
      key: 'graph',
      label: '知识图谱',
      children: (
        <Suspense fallback={<Flex justify="center" align="center" style={{ minHeight: 400 }}><Spin tip="正在加载知识图谱引擎..."><div /></Spin></Flex>}>
          <KnowledgeGraphTab
            graphLabel={graphConfig.label}
            graphDepth={graphConfig.depth}
            graphMaxNodes={graphConfig.maxNodes}
            graphLoading={loading.graph}
            graphData={graphData}
            graphStats={graphStats}
            onGraphLabelChange={(value) => onGraphConfigChange({ label: value })}
            onGraphDepthChange={(value) => onGraphConfigChange({ depth: value })}
            onGraphMaxNodesChange={(value) => onGraphConfigChange({ maxNodes: value })}
            onReload={onReloadGraph}
          />
        </Suspense>
      ),
    },
    {
      key: 'mindmap',
      label: '知识导图',
      children: (
        <KnowledgeMindmapTab
          mindmapLoading={loading.mindmap}
          mindmap={mindmap}
          onRegenerate={onRegenerateMindmap}
        />
      ),
    },
    {
      key: 'evaluation',
      label: `RAG 评测 (${evaluationHistory.length})`,
      children: (
        <KnowledgeEvaluationTab
          selectedBenchmarkId={selectedBenchmarkId}
          benchmarks={benchmarks}
          runningEvaluation={loading.runningEvaluation}
          benchmarkLoading={loading.benchmark}
          evaluationHistory={evaluationHistory}
          columns={evaluationColumns}
          onBenchmarkChange={onBenchmarkChange}
          onRun={onRunEvaluation}
          onRefresh={onRefreshBenchmarks}
        />
      ),
    },
    {
      key: 'benchmarks',
      label: `评估基准 (${benchmarks.length})`,
      children: (
        <KnowledgeBenchmarksTab
          benchmarkLoading={loading.benchmark}
          benchmarks={benchmarks}
          columns={benchmarkColumns}
          onOpenGenerate={onOpenBenchmarkGenerate}
          onOpenUpload={onOpenBenchmarkUpload}
          onRefresh={onRefreshBenchmarks}
        />
      ),
    },
    {
      key: 'settings',
      label: '设置',
      children: (
        <Flex vertical gap={20}>
          {/* ━━━ 基础信息 ━━━ */}
          <SectionCard
            title="基础信息"
            action={(
              <Space wrap size={[8, 8]}>
                <Button
                  onClick={onGenerateDescription}
                  disabled={!formState.name.trim() || loading.generatingDescription}
                  loading={loading.generatingDescription}
                >
                  AI 生成描述
                </Button>
                <Button
                  type="primary"
                  icon={<SaveOutlined />}
                  onClick={onSaveKnowledgeBase}
                  loading={loading.saving}
                >
                  保存设置
                </Button>
              </Space>
            )}
          >
            <div className="knowledge-settings-grid">
              <div className="studio-form-field">
                <Typography.Text type="secondary">知识库名称</Typography.Text>
                <Input
                  value={formState.name}
                  onChange={(e) => onFormStateChange({ ...formState, name: e.target.value })}
                  placeholder="名称"
                />
              </div>
              <div className="studio-form-field">
                <Typography.Text type="secondary">启用状态</Typography.Text>
                <div style={{ marginTop: 6 }}>
                  <Switch
                    checked={formState.enabled}
                    onChange={(checked) => onFormStateChange({ ...formState, enabled: checked })}
                  />
                </div>
              </div>
              <div className="studio-form-field studio-form-field-span-2">
                <Typography.Text type="secondary">描述</Typography.Text>
                <Input.TextArea
                  rows={3}
                  value={formState.description}
                  onChange={(e) => onFormStateChange({ ...formState, description: e.target.value })}
                  placeholder="知识库描述"
                />
              </div>
              <div className="studio-form-field studio-form-field-span-2">
                <Typography.Text type="secondary">标签</Typography.Text>
                <Input
                  value={formState.tagsText}
                  onChange={(e) => onFormStateChange({ ...formState, tagsText: e.target.value })}
                  placeholder="逗号分隔，例如: AI, 文档, FAQ"
                />
                <Typography.Text type="secondary" style={{ fontSize: 12, marginTop: 2, display: 'block' }}>
                  多个标签用英文逗号分隔
                </Typography.Text>
              </div>
            </div>
          </SectionCard>

          {/* ━━━ 模型配置 ━━━ */}
          <SectionCard title="模型配置" description="用于文档索引和检索的模型。">
            <div className="knowledge-settings-grid">
              <div className="studio-form-field">
                <Typography.Text type="secondary">Embedding 模型</Typography.Text>
                <Select
                  value={formState.embedBindingName || undefined}
                  onChange={(value) => onFormStateChange({ ...formState, embedBindingName: value })}
                  options={embeddingBindingOptions}
                  placeholder="选择 Embedding 模型"
                  showSearch
                  optionFilterProp="label"
                  style={{ width: '100%' }}
                  notFoundContent={
                    <Flex vertical align="center" gap={8} style={{ padding: '16px 12px' }}>
                      <Typography.Text type="secondary" style={{ fontSize: 13 }}>
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
                {embeddingBindingOptions.length === 0 && (
                  <Typography.Text type="warning" style={{ fontSize: 12, marginTop: 4, display: 'block' }}>
                    ⚠ 未配置 Embedding 模型，文档索引将无法工作。
                    <Button
                      type="link"
                      size="small"
                      style={{ fontSize: 12, padding: '0 4px' }}
                      onClick={() => navigate('/models')}
                    >
                      前往配置
                    </Button>
                  </Typography.Text>
                )}
              </div>
              <div className="studio-form-field">
                <Typography.Text type="secondary">LLM 模型</Typography.Text>
                <Select
                  value={formState.llmBindingName || undefined}
                  onChange={(value) => onFormStateChange({ ...formState, llmBindingName: value })}
                  options={llmBindingOptions}
                  placeholder="选择 LLM 模型"
                  showSearch
                  optionFilterProp="label"
                  style={{ width: '100%' }}
                  notFoundContent={
                    <Flex vertical align="center" gap={8} style={{ padding: '16px 12px' }}>
                      <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                        暂无可用的 LLM 模型
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
              <div className="studio-form-field">
                <Typography.Text type="secondary">语言</Typography.Text>
                <Select
                  value={formState.language}
                  onChange={(value) => onFormStateChange({ ...formState, language: value })}
                  options={LANGUAGE_OPTIONS}
                  style={{ width: '100%' }}
                />
              </div>
              <div className="studio-form-field">
                <Typography.Text type="secondary">分块策略</Typography.Text>
                <Select
                  value={formState.chunkPresetId}
                  onChange={(value) => onFormStateChange({ ...formState, chunkPresetId: value })}
                  options={CHUNK_PRESET_OPTIONS}
                  style={{ width: '100%' }}
                />
              </div>
            </div>
          </SectionCard>

          {/* ━━━ 高级设置（折叠） ━━━ */}
          <Collapse ghost defaultActiveKey={[]}>
            <Collapse.Panel header="高级设置" key="advanced">
              <Flex vertical gap={20}>
                {/* — 多模态处理 — */}
                <div>
                  <Typography.Text strong style={{ fontSize: 13, display: 'block', marginBottom: 12, color: 'var(--ant-color-text-secondary)' }}>
                    多模态处理
                  </Typography.Text>
                  <div className="knowledge-settings-grid">
                    <div className="studio-form-field">
                      <Typography.Text type="secondary">Vision 模型</Typography.Text>
                      <Select
                        value={formState.visionBindingName || undefined}
                        onChange={(value) => onFormStateChange({ ...formState, visionBindingName: value ?? '' })}
                        options={[{ value: '', label: '无' }, ...multimodalBindingOptions]}
                        placeholder="选择 Vision 模型（用于 PDF 图片理解）"
                        showSearch
                        optionFilterProp="label"
                        style={{ width: '100%' }}
                      />
                    </div>
                    <div className="studio-form-field">
                      <Typography.Text type="secondary">启用多模态解析</Typography.Text>
                      <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Switch
                          checked={formState.enableMultimodal}
                          onChange={(checked) => onFormStateChange({ ...formState, enableMultimodal: checked })}
                          disabled={!formState.visionBindingName}
                        />
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          {formState.visionBindingName ? 'PDF 图片将被 AI 理解并加入索引' : '请先选择 Vision 模型'}
                        </Typography.Text>
                      </div>
                    </div>
                  </div>
                </div>

                {/* — 检索增强 — */}
                <div>
                  <Typography.Text strong style={{ fontSize: 13, display: 'block', marginBottom: 12, color: 'var(--ant-color-text-secondary)' }}>
                    检索增强
                  </Typography.Text>
                  <div className="knowledge-settings-grid">
                    <div className="studio-form-field">
                      <Typography.Text type="secondary">Rerank 模型</Typography.Text>
                      <Select
                        value={formState.rerankBindingName || undefined}
                        onChange={(value) => onFormStateChange({ ...formState, rerankBindingName: value })}
                        options={[{ value: '', label: '无 (使用向量检索默认机制)' }, ...rerankBindingOptions]}
                        placeholder="选择 Rerank 模型"
                        showSearch
                        optionFilterProp="label"
                        style={{ width: '100%' }}
                      />
                    </div>
                  </div>
                </div>

                {/* — 其他 — */}
                <div>
                  <Typography.Text strong style={{ fontSize: 13, display: 'block', marginBottom: 12, color: 'var(--ant-color-text-secondary)' }}>
                    其他
                  </Typography.Text>
                  <div className="knowledge-settings-grid">
                    <div className="studio-form-field">
                      <Typography.Text type="secondary">自动生成问题</Typography.Text>
                      <div style={{ marginTop: 6 }}>
                        <Switch
                          checked={formState.autoGenerateQuestions}
                          onChange={(checked) => onFormStateChange({ ...formState, autoGenerateQuestions: checked })}
                        />
                      </div>
                    </div>
                    {formState.chunkPresetId === 'qa' && (
                      <div className="studio-form-field">
                        <Typography.Text type="secondary">QA 分隔符</Typography.Text>
                        <Input
                          placeholder="QA 分隔符"
                          value={formState.qaSeparator}
                          onChange={(e) => onFormStateChange({ ...formState, qaSeparator: e.target.value })}
                        />
                      </div>
                    )}
                  </div>
                </div>
              </Flex>
            </Collapse.Panel>
          </Collapse>
        </Flex>
      ),
    },
  ]

  if (loading.detail) {
    return (
      <div className="knowledge-workspace-container">
        <SectionCard title="知识库">
          <Flex justify="center" align="center" className="knowledge-workspace-loading">
            <Spin tip="正在加载知识库详情..."><div /></Spin>
          </Flex>
        </SectionCard>
      </div>
    )
  }

  if (!currentKb) {
    return (
      <div className="knowledge-workspace-container">
        <SectionCard title="知识库">
          <Empty
            image={false} className="minimal-empty"
            description="未选择知识库"
          >
            <Button
              type="primary"
              icon={<UploadOutlined />}
              onClick={() => startTransition(() => navigate('/knowledge/new'))}
            >
              新建知识库
            </Button>
          </Empty>
        </SectionCard>
      </div>
    )
  }

  return (
    <div className="knowledge-workspace-container">
      <Flex vertical gap={20}>
        <div className="knowledge-page-header">
          <Flex justify="space-between" align="flex-start" gap={16}>
            <div>
              <h1 className="knowledge-page-title">{currentKb.name}</h1>
              <Typography.Text type="secondary">{currentKb.description || '暂无描述'}</Typography.Text>
              <div style={{ marginTop: 12 }}>
                <Space wrap size={[8, 8]}>
                  <Tag color={currentKb.enabled ? 'success' : 'default'} bordered={false}>{currentKb.enabled ? '已启用' : '已停用'}</Tag>
                  <Tag bordered={false}>{KNOWLEDGE_ARCHITECTURE_LABEL}</Tag>
                  {currentKb.tags.map((tag) => (
                    <Tag key={tag} bordered={false}>{tag}</Tag>
                  ))}
                </Space>
              </div>
            </div>
            
            <Space wrap size={[8, 8]}>
              <Button icon={<ReloadOutlined />} onClick={onRefreshDetail}>
                刷新
              </Button>
              <Button onClick={() => handleTabChange('settings')}>设置</Button>
              <Button danger icon={<DeleteOutlined />} onClick={onDeleteKnowledgeBase}>
                删除
              </Button>
            </Space>
          </Flex>

          <div className="knowledge-metrics-grid" style={{ marginTop: 24, display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 16 }}>
            <MetricCard label="文件记录" value={filesState.stats.fileCount} icon={<FileTextOutlined />} tone="neutral" />
            <MetricCard label="已索引" value={filesState.stats.indexedCount} icon={<BranchesOutlined />} tone="success" />
            <MetricCard label="待处理" value={pendingParseCount + pendingIndexCount} icon={<RetweetOutlined />} tone={pendingParseCount + pendingIndexCount > 0 ? 'warning' : 'neutral'} />
            <MetricCard label="异常" value={filesState.stats.errorCount} icon={<FileSearchOutlined />} tone={filesState.stats.errorCount > 0 ? 'error' : 'neutral'} />
          </div>
        </div>

        {(pendingParseCount > 0 || pendingIndexCount > 0) && (
          <Alert
            type="warning"
            showIcon
            message="存在待处理文件"
            action={(
              <Space wrap size={[8, 8]}>
                {pendingParseCount > 0 && (
                  <Button
                    size="small"
                    icon={<FileSearchOutlined />}
                    onClick={() => onParseSelected(pendingParseFileIds, false)}
                  >
                    {pendingParseCount} 个文件待解析
                  </Button>
                )}
                {pendingIndexCount > 0 && (
                  <Button
                    size="small"
                    icon={<BranchesOutlined />}
                    onClick={() => onIndexSelected(pendingIndexFileIds, false)}
                  >
                    {pendingIndexCount} 个文件待入库
                  </Button>
                )}
              </Space>
            )}
          />
        )}

        <div className="knowledge-tab-container">
          <Tabs
            activeKey={activeTab}
            onChange={handleTabChange}
            size="large"
            tabBarGutter={24}
            items={workspaceTabItems.map(({ key, label }) => ({ key, label }))}
            style={{ marginBottom: 0 }}
          />
          <div className="knowledge-tab-content-borderless" style={{ background: '#fff', borderRadius: '0 8px 8px 8px', padding: '16px' }}>
            {workspaceTabItems.find((item) => item.key === activeTab)?.children}
          </div>
        </div>
      </Flex>
    </div>
  )
}
