import { useEffect, useMemo, useState } from 'react'
import { Alert, App, Button, Card, Popconfirm, Segmented, Space, Tag, Typography } from 'antd'
import { EditOutlined, EyeOutlined, ReloadOutlined, SaveOutlined } from '@ant-design/icons'
import TextArea from 'antd/es/input/TextArea'
import ReactMarkdown from 'react-markdown'
import { api } from '../api'
import PageHero from '../components/PageHero'
import { formatDateTimeZh } from '../locale'

const { Text } = Typography

type PreviewMode = 'edit' | 'preview'

export default function MainPromptPage() {
  const { message } = App.useApp()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [identityContent, setIdentityContent] = useState('')
  const [updatedAt, setUpdatedAt] = useState('')
  const [sourcePath, setSourcePath] = useState('')
  const [previewMode, setPreviewMode] = useState<PreviewMode>('edit')

  const characterCount = useMemo(() => identityContent.trim().length, [identityContent])
  const lineCount = useMemo(
    () => (identityContent.trim() ? identityContent.split('\n').length : 0),
    [identityContent],
  )

  useEffect(() => {
    void loadPrompt()
  }, [])

  async function loadPrompt() {
    try {
      setLoading(true)
      const data = await api.getMainAgentPrompt()
      setIdentityContent(data.identity_content || '')
      setUpdatedAt(data.updated_at || '')
      setSourcePath(data.source_path || '')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载主提示词失败')
    } finally {
      setLoading(false)
    }
  }

  async function handleSave() {
    try {
      setSaving(true)
      const saved = await api.updateMainAgentPrompt(identityContent)
      setIdentityContent(saved.identity_content || '')
      setUpdatedAt(saved.updated_at || '')
      setSourcePath(saved.source_path || '')
      message.success('主提示词已保存')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '保存主提示词失败')
    } finally {
      setSaving(false)
    }
  }

  async function handleReset() {
    try {
      await api.resetMainAgentPrompt()
      message.success('已重置为工作区默认提示词')
      await loadPrompt()
    } catch (error) {
      message.error(error instanceof Error ? error.message : '重置主提示词失败')
    }
  }

  return (
    <div className="page-stack">
      <PageHero
        className="page-hero-compact"
        eyebrow="主提示词"
        title="维护当前工作区的 AGENTS.md"
        description="这里编辑的是工作区中的 `AGENTS.md`，当前后端会把它自动装载进系统提示词。"
        actions={(
          <Space wrap>
            <Button icon={<ReloadOutlined />} onClick={() => void loadPrompt()} loading={loading}>
              刷新
            </Button>
            <Popconfirm
              title="确定重置为默认模板吗？"
              description="这会使用内置模板覆盖当前工作区中的 AGENTS.md。"
              okText="重置"
              cancelText="取消"
              okButtonProps={{ danger: true }}
              onConfirm={() => void handleReset()}
            >
              <Button>重置</Button>
            </Popconfirm>
            <Button
              type="primary"
              icon={<SaveOutlined />}
              loading={saving}
              onClick={() => void handleSave()}
            >
              保存
            </Button>
          </Space>
        )}
        stats={[
          { label: '最后更新时间', value: updatedAt ? formatDateTimeZh(updatedAt) : '--' },
          { label: '当前模式', value: previewMode === 'edit' ? '编辑' : '预览' },
          { label: '内容长度', value: `${characterCount} 字符` },
          { label: '行数', value: `${lineCount} 行` },
        ]}
      />

      <div className="page-card prompt-page-card">
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          <div className="section-heading-row">
            <div className="page-section-title">
              <Typography.Title level={4}>提示词工作区</Typography.Title>
              <Text type="secondary">统一查看来源、状态和正文内容，减少编辑区的视觉噪音。</Text>
            </div>
            <Tag>{previewMode === 'edit' ? '编辑模式' : '预览模式'}</Tag>
          </div>

          <Alert
            showIcon
            type="info"
            message="这里的修改会影响后续新对话。"
            description="保存后会直接更新当前工作区中的 `AGENTS.md`，新会话会通过现有后端引导文件加载这些内容，因此适合维护长期规则、角色设定和执行边界。"
          />

          <div className="page-meta-grid prompt-info-grid">
            <div className="page-meta-card">
              <span>来源文件</span>
              <strong>{sourcePath ? '工作区 AGENTS.md' : '--'}</strong>
            </div>
            <div className="page-meta-card">
              <span>最后更新时间</span>
              <strong>{updatedAt ? formatDateTimeZh(updatedAt) : '--'}</strong>
            </div>
            <div className="page-meta-card">
              <span>当前模式</span>
              <strong>{previewMode === 'edit' ? '编辑' : '预览'}</strong>
            </div>
            <div className="page-meta-card">
              <span>当前状态</span>
              <strong>{saving ? '正在保存' : loading ? '正在加载' : '可继续编辑'}</strong>
            </div>
          </div>

          {sourcePath ? (
            <div className="prompt-source-strip">
              <Text type="secondary">实际文件路径</Text>
              <div className="mono-block prompt-source-block">{sourcePath}</div>
            </div>
          ) : null}

          <Card className="workbench-card prompt-editor-card" loading={loading}>
            <div className="config-card-header">
              <div className="page-section-title">
                <Typography.Title level={4}>主提示词内容</Typography.Title>
                <Text type="secondary">这里是完整编辑区。内容较长时会在当前面板内部滚动，不再把整页无限拉长。</Text>
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
                value={identityContent}
                onChange={(event) => setIdentityContent(event.target.value)}
                style={{
                  height: 'clamp(360px, 58vh, 780px)',
                  resize: 'none',
                  fontFamily: '"IBM Plex Mono", "SFMono-Regular", Consolas, monospace',
                }}
              />
            ) : (
              <div className="prompt-preview prompt-preview-tall">
                <ReactMarkdown>{identityContent || '_当前没有提示词内容_'}</ReactMarkdown>
              </div>
            )}
          </Card>
        </Space>
      </div>
    </div>
  )
}
