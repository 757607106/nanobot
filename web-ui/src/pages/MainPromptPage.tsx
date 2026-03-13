import { useEffect, useMemo, useState } from 'react'
import { Alert, App, Button, Card, Popconfirm, Segmented, Space, Tag, Typography } from 'antd'
import { EditOutlined, EyeOutlined, ReloadOutlined, SaveOutlined } from '@ant-design/icons'
import TextArea from 'antd/es/input/TextArea'
import ReactMarkdown from 'react-markdown'
import { api } from '../api'
import PageHero from '../components/PageHero'
import { formatDateTimeZh } from '../locale'
import type { WorkspaceDocument, WorkspaceDocumentSummary } from '../types'

const { Text } = Typography

type PreviewMode = 'edit' | 'preview'
type DocumentGroupKey = 'guidance' | 'memory'

const documentOrder = [
  'AGENTS.md',
  'SOUL.md',
  'USER.md',
  'TOOLS.md',
  'HEARTBEAT.md',
  'memory/MEMORY.md',
  'memory/HISTORY.md',
] as const

const documentMeta: Record<string, { group: DocumentGroupKey; title: string; summary: string }> = {
  'AGENTS.md': {
    group: 'guidance',
    title: '主引导',
    summary: '定义 nanobot 在当前工作区中的核心行为、约束和协作方式。',
  },
  'SOUL.md': {
    group: 'guidance',
    title: '风格与价值观',
    summary: '补充角色气质、表达风格和长期协作倾向。',
  },
  'USER.md': {
    group: 'guidance',
    title: '用户偏好',
    summary: '记录这个工作区里使用者的背景、习惯和交付偏好。',
  },
  'TOOLS.md': {
    group: 'guidance',
    title: '工具约束',
    summary: '约束工具使用边界、默认流程和高频操作规则。',
  },
  'HEARTBEAT.md': {
    group: 'guidance',
    title: '节奏与巡检',
    summary: '沉淀工作节奏、例行检查项和推进策略。',
  },
  'memory/MEMORY.md': {
    group: 'memory',
    title: '长期记忆',
    summary: '沉淀需要跨会话延续的重要事实、决策和上下文。',
  },
  'memory/HISTORY.md': {
    group: 'memory',
    title: '历史记录',
    summary: '记录阶段性变更、里程碑和可追溯的历史背景。',
  },
}

const groupMeta: Record<DocumentGroupKey, { label: string; summary: string }> = {
  guidance: {
    label: '工作区引导',
    summary: '这组文件决定当前实例在这个工作区里如何行动、如何表达以及如何使用工具。',
  },
  memory: {
    label: '长期记忆',
    summary: '这组文件用于沉淀跨会话延续的信息，而不是描述一次性的任务输入。',
  },
}

export default function MainPromptPage() {
  const { message } = App.useApp()
  const [loadingList, setLoadingList] = useState(true)
  const [loadingDocument, setLoadingDocument] = useState(true)
  const [saving, setSaving] = useState(false)
  const [documents, setDocuments] = useState<WorkspaceDocumentSummary[]>([])
  const [activeDocumentId, setActiveDocumentId] = useState('AGENTS.md')
  const [document, setDocument] = useState<WorkspaceDocument | null>(null)
  const [draft, setDraft] = useState('')
  const [previewMode, setPreviewMode] = useState<PreviewMode>('edit')

  const orderedDocuments = useMemo(() => {
    const known = documents
      .filter((item) => documentMeta[item.id])
      .sort((left, right) => documentOrder.indexOf(left.id as (typeof documentOrder)[number]) - documentOrder.indexOf(right.id as (typeof documentOrder)[number]))
    const unknown = documents.filter((item) => !documentMeta[item.id])
    return [...known, ...unknown]
  }, [documents])

  const activeSummary = useMemo(
    () => orderedDocuments.find((item) => item.id === activeDocumentId) ?? null,
    [activeDocumentId, orderedDocuments],
  )
  const activeMeta = documentMeta[activeDocumentId]
  const groupedDocuments = useMemo(
    () => ({
      guidance: orderedDocuments.filter((item) => documentMeta[item.id]?.group === 'guidance'),
      memory: orderedDocuments.filter((item) => documentMeta[item.id]?.group === 'memory'),
    }),
    [orderedDocuments],
  )

  useEffect(() => {
    void loadDocuments()
  }, [])

  useEffect(() => {
    void loadDocument(activeDocumentId)
  }, [activeDocumentId])

  function applyDocument(next: WorkspaceDocument) {
    setDocument(next)
    setDraft(next.content || '')
    setDocuments((current) =>
      current.map((item) =>
        item.id === next.id
          ? {
              ...item,
              updatedAt: next.updatedAt,
              path: next.sourcePath,
              hasTemplate: next.hasTemplate,
            }
          : item,
      ),
    )
  }

  async function loadDocuments() {
    try {
      setLoadingList(true)
      const data = await api.getDocuments()
      setDocuments(data)
      if (!data.find((item) => item.id === activeDocumentId)) {
        setActiveDocumentId(data[0]?.id || 'AGENTS.md')
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载文档目录失败')
    } finally {
      setLoadingList(false)
    }
  }

  async function loadDocument(documentId: string) {
    try {
      setLoadingDocument(true)
      const data = await api.getDocument(documentId)
      setDocument(data)
      setDraft(data.content || '')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载文档失败')
    } finally {
      setLoadingDocument(false)
    }
  }

  async function handleSave() {
    try {
      setSaving(true)
      const saved = await api.updateDocument(activeDocumentId, draft)
      applyDocument(saved)
      message.success(`${saved.label} 已保存`)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '保存文档失败')
    } finally {
      setSaving(false)
    }
  }

  async function handleReset() {
    try {
      const reset = await api.resetDocument(activeDocumentId)
      applyDocument(reset)
      message.success(`${reset.label} 已重置`)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '重置文档失败')
    }
  }

  return (
    <div className="page-stack">
      <PageHero
        className="page-hero-compact"
        eyebrow="提示词与记忆"
        title="维护工作区引导与长期记忆"
        description="这里只管理 `AGENTS.md`、`SOUL.md`、`USER.md`、`TOOLS.md`、`HEARTBEAT.md`、`memory/MEMORY.md` 和 `memory/HISTORY.md`。"
        actions={(
          <Space wrap>
            <Button
              icon={<ReloadOutlined />}
              onClick={() => {
                void loadDocuments()
                void loadDocument(activeDocumentId)
              }}
              loading={loadingList || loadingDocument}
            >
              刷新页面
            </Button>
            <Popconfirm
              title="确定恢复默认内容吗？"
              description={document?.hasTemplate ? '这会使用内置模板覆盖当前文档。' : '这会把当前文档重置为空白状态。'}
              okText="重置"
              cancelText="取消"
              okButtonProps={{ danger: true }}
              onConfirm={() => void handleReset()}
            >
              <Button>重置</Button>
            </Popconfirm>
            <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={() => void handleSave()}>
              保存
            </Button>
          </Space>
        )}
        stats={[
          { label: '当前文档', value: document?.label || activeSummary?.label || '--' },
          { label: '文档分组', value: activeMeta ? groupMeta[activeMeta.group].label : '--' },
          { label: '最后更新时间', value: document?.updatedAt ? formatDateTimeZh(document.updatedAt) : '--' },
          { label: '管理范围', value: `${orderedDocuments.length} 份文档` },
        ]}
      />

      <div className="page-grid prompt-workspace-grid">
        <div className="page-stack prompt-nav-stack">
          <Alert
            showIcon
            type="info"
            message="这不是通用文档中心。"
            description="这个页面只负责工作区引导和长期记忆；单次任务说明、模型配置、渠道接入和模板管理都不应该塞到这里。"
          />

          <Card className="config-panel-card prompt-nav-card">
            <div className="config-card-header">
              <div className="page-section-title">
                <Typography.Title level={4}>工作区文件选择</Typography.Title>
                <Text type="secondary">先选对文件，再编辑内容。引导文件和长期记忆文件分开管理。</Text>
              </div>
              <Tag>{previewMode === 'edit' ? '编辑模式' : '预览模式'}</Tag>
            </div>

            <Space direction="vertical" size={16} style={{ width: '100%' }}>
              {(Object.keys(groupMeta) as DocumentGroupKey[]).map((groupKey) => (
                <div className="config-section-stack" key={groupKey}>
                  <div className="page-section-title">
                    <Typography.Title level={5}>{groupMeta[groupKey].label}</Typography.Title>
                    <Text type="secondary">{groupMeta[groupKey].summary}</Text>
                  </div>
                  <div className="document-chip-list">
                    {groupedDocuments[groupKey].map((item) => (
                      <Button
                        key={item.id}
                        type={activeDocumentId === item.id ? 'primary' : 'default'}
                        onClick={() => setActiveDocumentId(item.id)}
                      >
                        {item.label}
                      </Button>
                    ))}
                  </div>
                </div>
              ))}
            </Space>
          </Card>

          <Card className="config-panel-card prompt-info-card">
            <div className="page-meta-grid prompt-info-grid prompt-info-grid-compact">
              <div className="page-meta-card">
                <span>当前文件</span>
                <strong>{document?.label || activeSummary?.label || '--'}</strong>
              </div>
              <div className="page-meta-card">
                <span>文件角色</span>
                <strong>{activeMeta?.title || '工作区文档'}</strong>
              </div>
              <div className="page-meta-card">
                <span>模板来源</span>
                <strong>{document?.hasTemplate ? '内置模板' : '空白重置'}</strong>
              </div>
              <div className="page-meta-card">
                <span>当前状态</span>
                <strong>{saving ? '正在保存' : loadingDocument ? '正在加载' : '可继续编辑'}</strong>
              </div>
            </div>

            {activeMeta ? (
              <Alert
                showIcon
                type={activeMeta.group === 'memory' ? 'success' : 'info'}
                message={activeMeta.title}
                description={activeMeta.summary}
              />
            ) : null}

            {document?.sourcePath ? (
              <div className="prompt-source-strip">
                <Text type="secondary">实际文件路径</Text>
                <div className="mono-block prompt-source-block">{document.sourcePath}</div>
              </div>
            ) : (
              null
            )}
          </Card>

        </div>

        <Card className="surface-card prompt-editor-card prompt-page-card" loading={loadingDocument}>
          <div className="config-card-header">
            <div className="page-section-title">
              <Typography.Title level={4}>{document?.label || activeSummary?.label || '文档内容'}</Typography.Title>
              <Text type="secondary">
                {activeMeta?.summary || '支持直接编辑或切到预览模式查看 Markdown 渲染效果。'}
              </Text>
            </div>
            <Segmented
              value={previewMode}
              options={[
                { value: 'edit', label: <span><EditOutlined /> 编辑</span> },
                { value: 'preview', label: <span><EyeOutlined /> 预览</span> },
              ]}
              onChange={(value) => setPreviewMode(value as PreviewMode)}
            />
          </div>

          {previewMode === 'edit' ? (
            <TextArea
              className="prompt-textarea"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              style={{
                height: 'clamp(420px, 66vh, 860px)',
                resize: 'none',
                fontFamily: '"IBM Plex Mono", "SFMono-Regular", Consolas, monospace',
              }}
            />
          ) : (
            <div className="prompt-preview prompt-preview-tall">
              <ReactMarkdown>{draft || '_当前没有文档内容_'}</ReactMarkdown>
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}
