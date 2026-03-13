import { useEffect, useMemo, useState } from 'react'
import { Alert, App, Button, Card, Empty, Input, List, Select, Space, Spin, Switch, Tag, Typography } from 'antd'
import { AppstoreOutlined, DeleteOutlined, DownloadOutlined, PlusOutlined, ReloadOutlined, SaveOutlined, UploadOutlined } from '@ant-design/icons'
import { api, ApiError } from '../api'
import PageHero from '../components/PageHero'
import { formatDateTimeZh } from '../locale'
import type {
  AgentTemplateItem,
  AgentTemplateMutationInput,
  AgentTemplateTool,
  InstalledSkill,
} from '../types'

const { Text } = Typography

type ConflictMode = 'skip' | 'rename' | 'replace'

interface TemplateFormState {
  name: string
  description: string
  toolsText: string
  rulesText: string
  skillsText: string
  systemPrompt: string
  model: string
  backend: string
  enabled: boolean
}

function parseListInput(value: string) {
  return Array.from(
    new Set(
      value
        .split(/[\n,]/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  )
}

function templateToForm(template: AgentTemplateItem): TemplateFormState {
  return {
    name: template.name,
    description: template.description,
    toolsText: template.tools.join('\n'),
    rulesText: template.rules.join('\n'),
    skillsText: template.skills.join('\n'),
    systemPrompt: template.system_prompt,
    model: template.model || '',
    backend: template.backend || '',
    enabled: template.enabled,
  }
}

function createEmptyTemplateForm(): TemplateFormState {
  return {
    name: '',
    description: '',
    toolsText: 'read_file\nlist_dir',
    rulesText: '先理解上下文\n总结关键结果',
    skillsText: '',
    systemPrompt: '# Agent Template\n\nTask: {task}',
    model: '',
    backend: '',
    enabled: true,
  }
}

function formToPayload(form: TemplateFormState): AgentTemplateMutationInput {
  return {
    name: form.name.trim(),
    description: form.description.trim(),
    tools: parseListInput(form.toolsText),
    rules: parseListInput(form.rulesText),
    skills: parseListInput(form.skillsText),
    system_prompt: form.systemPrompt.trim(),
    model: form.model.trim() || null,
    backend: form.backend.trim() || null,
    enabled: form.enabled,
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

export default function TemplatesPage() {
  const { message } = App.useApp()
  const [templates, setTemplates] = useState<AgentTemplateItem[]>([])
  const [template, setTemplate] = useState<AgentTemplateItem | null>(null)
  const [validTools, setValidTools] = useState<AgentTemplateTool[]>([])
  const [installedSkills, setInstalledSkills] = useState<InstalledSkill[]>([])
  const [selectedTemplateName, setSelectedTemplateName] = useState<string | null>(null)
  const [form, setForm] = useState<TemplateFormState>(() => createEmptyTemplateForm())
  const [loading, setLoading] = useState(true)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [reloading, setReloading] = useState(false)
  const [importing, setImporting] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [templateError, setTemplateError] = useState<string | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [importResult, setImportResult] = useState<string | null>(null)
  const [exportContent, setExportContent] = useState('')
  const [importContent, setImportContent] = useState('')
  const [conflictMode, setConflictMode] = useState<ConflictMode>('rename')

  useEffect(() => {
    void loadTemplateWorkspace()
  }, [])

  useEffect(() => {
    if (!selectedTemplateName) {
      setTemplate(null)
      return
    }
    void loadTemplateDetail(selectedTemplateName)
  }, [selectedTemplateName])

  const enabledCount = useMemo(
    () => templates.filter((item) => item.enabled).length,
    [templates],
  )

  const builtInCount = useMemo(
    () => templates.filter((item) => item.is_builtin).length,
    [templates],
  )

  async function loadTemplateWorkspace() {
    try {
      setLoading(true)
      const [templateList, toolCatalog, skills] = await Promise.all([
        api.getAgentTemplates(),
        api.getValidTemplateTools(),
        api.getInstalledSkills(),
      ])
      setTemplates(templateList)
      setValidTools(toolCatalog)
      setInstalledSkills(skills)
      if (selectedTemplateName && templateList.some((item) => item.name === selectedTemplateName)) {
        await loadTemplateDetail(selectedTemplateName)
        return
      }
      if (templateList[0]) {
        setSelectedTemplateName(templateList[0].name)
      } else {
        setSelectedTemplateName(null)
        setTemplate(null)
        setForm(createEmptyTemplateForm())
      }
      setTemplateError(null)
      setImportError(null)
    } catch (error) {
      setTemplateError(getErrorMessage(error, '加载模板工作区失败'))
    } finally {
      setLoading(false)
    }
  }

  async function loadTemplateDetail(templateName: string) {
    try {
      setLoadingDetail(true)
      const result = await api.getAgentTemplate(templateName)
      setTemplate(result)
      setForm(templateToForm(result))
      setTemplateError(null)
    } catch (error) {
      setTemplateError(getErrorMessage(error, '加载模板详情失败'))
    } finally {
      setLoadingDetail(false)
    }
  }

  function startCreateTemplate(copyCurrent = false) {
    if (copyCurrent && template) {
      setTemplate(null)
      setSelectedTemplateName(null)
      setForm({
        ...templateToForm(template),
        name: `${template.name}-copy`,
      })
      return
    }
    setTemplate(null)
    setSelectedTemplateName(null)
    setForm(createEmptyTemplateForm())
    setTemplateError(null)
  }

  async function handleSaveTemplate() {
    const payload = formToPayload(form)
    if (!payload.name) {
      setTemplateError('模板名称不能为空。')
      return
    }
    if (!payload.tools.length) {
      setTemplateError('至少需要一个工具。')
      return
    }
    if (!payload.rules.length) {
      setTemplateError('至少需要一条规则。')
      return
    }
    if (!payload.system_prompt) {
      setTemplateError('系统提示词不能为空。')
      return
    }

    try {
      setSaving(true)
      if (template && template.name === payload.name) {
        await api.updateAgentTemplate(template.name, payload)
        message.success('模板已更新')
      } else {
        await api.createAgentTemplate(payload)
        message.success('模板已创建')
      }
      await loadTemplateWorkspace()
      setSelectedTemplateName(payload.name)
      await loadTemplateDetail(payload.name)
    } catch (error) {
      setTemplateError(getErrorMessage(error, '保存模板失败'))
    } finally {
      setSaving(false)
    }
  }

  async function handleDeleteTemplate() {
    if (!template) {
      return
    }
    try {
      setDeleting(true)
      await api.deleteAgentTemplate(template.name)
      message.success('模板已删除')
      const nextTemplates = templates.filter((item) => item.name !== template.name)
      setTemplates(nextTemplates)
      if (nextTemplates[0]) {
        setSelectedTemplateName(nextTemplates[0].name)
      } else {
        setSelectedTemplateName(null)
        setTemplate(null)
        setForm(createEmptyTemplateForm())
      }
      setTemplateError(null)
    } catch (error) {
      setTemplateError(getErrorMessage(error, '删除模板失败'))
    } finally {
      setDeleting(false)
    }
  }

  async function handleReloadTemplates() {
    try {
      setReloading(true)
      await api.reloadAgentTemplates()
      await loadTemplateWorkspace()
      message.success('模板索引已重新加载')
    } catch (error) {
      setTemplateError(getErrorMessage(error, '重载模板失败'))
    } finally {
      setReloading(false)
    }
  }

  async function handleExportTemplates(currentOnly: boolean) {
    try {
      setExporting(true)
      const names = currentOnly && template ? [template.name] : undefined
      const result = await api.exportAgentTemplates(names)
      setExportContent(result.content)
      message.success(currentOnly ? '当前模板已导出' : '模板集合已导出')
    } catch (error) {
      setImportError(getErrorMessage(error, '导出模板失败'))
    } finally {
      setExporting(false)
    }
  }

  async function handleImportTemplates() {
    if (!importContent.trim()) {
      setImportError('请先粘贴要导入的 YAML 内容。')
      return
    }
    try {
      setImporting(true)
      const result = await api.importAgentTemplates({
        content: importContent,
        on_conflict: conflictMode,
      })
      setImportError(result.errors[0] || null)
      setImportResult(
        result.imported.length
          ? `已处理 ${result.imported.length} 个模板：${result.imported.map((item) => `${item.name} (${item.action})`).join('，')}`
          : '没有导入任何模板',
      )
      await loadTemplateWorkspace()
    } catch (error) {
      setImportError(getErrorMessage(error, '导入模板失败'))
    } finally {
      setImporting(false)
    }
  }

  if (loading && !templates.length && !template) {
    return (
      <div className="center-box page-card">
        <Spin />
      </div>
    )
  }

  return (
    <div className="page-stack">
      <PageHero
        className="page-hero-compact"
        eyebrow="Templates"
        title="把 Agent 模板当成一等资产来管理"
        description="这页集中处理内置模板、工作区模板、导入导出和冲突策略，不需要再通过原始 API 手工维护。"
        actions={(
          <Space wrap>
            <Button icon={<ReloadOutlined />} onClick={() => void loadTemplateWorkspace()} loading={loading}>
              刷新模板
            </Button>
            <Button icon={<PlusOutlined />} onClick={() => startCreateTemplate(false)}>
              新建模板
            </Button>
            <Button icon={<AppstoreOutlined />} onClick={() => void handleReloadTemplates()} loading={reloading}>
              重载模板索引
            </Button>
          </Space>
        )}
        stats={[
          { label: '模板总数', value: templates.length },
          { label: '已启用', value: enabledCount },
          { label: '内置模板', value: builtInCount },
          { label: '可用工具', value: validTools.length },
        ]}
      />

      <div className="page-grid templates-page-grid">
        <Card className="config-panel-card template-index-card">
          <div className="config-card-header">
            <div className="page-section-title">
              <Typography.Title level={4}>模板索引</Typography.Title>
              <Text type="secondary">先区分内置模板和工作区模板，再决定是直接编辑、复制还是导出。</Text>
            </div>
            <Tag>{templates.length} 项</Tag>
          </div>

          <div className="page-scroll-shell template-index-shell">
            {templates.length ? (
              <List
                dataSource={templates}
                renderItem={(item) => (
                  <List.Item>
                    <div className="page-stack">
                      <div className="config-card-header">
                        <div className="page-section-title">
                          <Typography.Title level={5}>{item.name}</Typography.Title>
                          <Text type="secondary">{item.description || '当前没有描述'}</Text>
                        </div>
                        <Tag>{item.enabled ? '已启用' : '已停用'}</Tag>
                      </div>

                      <Space wrap>
                        <Tag>{item.is_builtin ? '内置' : '工作区'}</Tag>
                        {item.model ? <Tag>{item.model}</Tag> : null}
                        {item.backend ? <Tag>{item.backend}</Tag> : null}
                      </Space>

                      <Button type={selectedTemplateName === item.name ? 'primary' : 'default'} onClick={() => setSelectedTemplateName(item.name)}>
                        {selectedTemplateName === item.name ? '正在查看' : '查看模板'}
                      </Button>
                    </div>
                  </List.Item>
                )}
              />
            ) : (
              <Empty description="当前还没有模板" className="empty-block" />
            )}
          </div>
        </Card>

        <div className="page-stack templates-editor-stack">
          <Card className="config-panel-card" loading={loadingDetail}>
            <div className="config-card-header">
              <div className="page-section-title">
                <Typography.Title level={4}>{template ? `维护 ${template.name}` : '创建工作区模板'}</Typography.Title>
                <Text type="secondary">模板级启用态、工具清单、规则与系统提示词都在这里维护。</Text>
              </div>
              <Space wrap>
                {template ? <Tag>{template.is_builtin ? '内置只读' : '工作区模板'}</Tag> : <Tag>新建中</Tag>}
                {template?.updated_at ? <Tag>{formatDateTimeZh(template.updated_at)}</Tag> : null}
              </Space>
            </div>

            <div className="page-stack">
              {template?.is_builtin ? (
                <Alert
                  type="info"
                  showIcon
                  message="当前模板来自内置模板库，只读。"
                  description="如果你想基于它继续改造，建议使用“另存为副本”，把内置模板转成工作区模板后再编辑。"
                />
              ) : null}

              <div className="page-meta-grid prompt-info-grid">
                <label className="auth-field">
                  <span>模板名称</span>
                  <Input
                    value={form.name}
                    disabled={Boolean(template?.is_builtin)}
                    onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                  />
                </label>
                <label className="auth-field">
                  <span>启用</span>
                  <Switch
                    checked={form.enabled}
                    disabled={Boolean(template?.is_builtin)}
                    onChange={(checked) => setForm((current) => ({ ...current, enabled: checked }))}
                  />
                </label>
              </div>

              <label className="auth-field">
                <span>描述</span>
                <Input
                  value={form.description}
                  disabled={Boolean(template?.is_builtin)}
                  onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                />
              </label>

              <div className="page-meta-grid prompt-info-grid">
                <label className="auth-field">
                  <span>模型</span>
                  <Input
                    value={form.model}
                    disabled={Boolean(template?.is_builtin)}
                    onChange={(event) => setForm((current) => ({ ...current, model: event.target.value }))}
                    placeholder="deepseek/deepseek-chat"
                  />
                </label>
                <label className="auth-field">
                  <span>后端</span>
                  <Input
                    value={form.backend}
                    disabled={Boolean(template?.is_builtin)}
                    onChange={(event) => setForm((current) => ({ ...current, backend: event.target.value }))}
                    placeholder="claude_code"
                  />
                </label>
              </div>

              <label className="auth-field">
                <span>工具清单（每行一个，也支持逗号分隔）</span>
                <Input.TextArea
                  value={form.toolsText}
                  disabled={Boolean(template?.is_builtin)}
                  onChange={(event) => setForm((current) => ({ ...current, toolsText: event.target.value }))}
                />
              </label>

              <label className="auth-field">
                <span>规则清单</span>
                <Input.TextArea
                  value={form.rulesText}
                  disabled={Boolean(template?.is_builtin)}
                  onChange={(event) => setForm((current) => ({ ...current, rulesText: event.target.value }))}
                />
              </label>

              <label className="auth-field">
                <span>技能清单</span>
                <Input.TextArea
                  value={form.skillsText}
                  disabled={Boolean(template?.is_builtin)}
                  onChange={(event) => setForm((current) => ({ ...current, skillsText: event.target.value }))}
                />
              </label>

              <label className="auth-field">
                <span>系统提示词</span>
                <Input.TextArea
                  value={form.systemPrompt}
                  disabled={Boolean(template?.is_builtin)}
                  onChange={(event) => setForm((current) => ({ ...current, systemPrompt: event.target.value }))}
                  style={{ minHeight: 220 }}
                />
              </label>

              {templateError ? <Alert type="error" showIcon message={templateError} /> : null}

              <Space wrap>
                <Button type="primary" icon={<SaveOutlined />} disabled={Boolean(template?.is_builtin)} loading={saving} onClick={() => void handleSaveTemplate()}>
                  {template ? '保存模板' : '创建模板'}
                </Button>
                <Button icon={<AppstoreOutlined />} onClick={() => startCreateTemplate(true)} disabled={!template}>
                  另存为副本
                </Button>
                <Button danger icon={<DeleteOutlined />} disabled={!template || !template.is_deletable} loading={deleting} onClick={() => void handleDeleteTemplate()}>
                  删除模板
                </Button>
              </Space>
            </div>
          </Card>

          <Card className="config-panel-card templates-assets-card">
            <div className="config-card-header">
              <div className="page-section-title">
                <Typography.Title level={4}>导入 / 导出 / 冲突策略</Typography.Title>
                <Text type="secondary">直接把导出的 YAML 留在这里做 round trip，冲突行为在导入前就明确声明。</Text>
              </div>
            </div>

            <div className="page-stack">
              <Space wrap>
                <Button icon={<DownloadOutlined />} loading={exporting} onClick={() => void handleExportTemplates(true)} disabled={!template}>
                  导出当前模板
                </Button>
                <Button icon={<DownloadOutlined />} loading={exporting} onClick={() => void handleExportTemplates(false)}>
                  导出全部模板
                </Button>
              </Space>

              <label className="auth-field">
                <span>导出内容</span>
                <Input.TextArea value={exportContent} onChange={(event) => setExportContent(event.target.value)} style={{ minHeight: 180 }} />
              </label>

              <label className="auth-field">
                <span>冲突策略</span>
                <Select
                  value={conflictMode}
                  options={[
                    { label: '重命名导入', value: 'rename' },
                    { label: '跳过冲突项', value: 'skip' },
                    { label: '覆盖现有项', value: 'replace' },
                  ]}
                  onChange={(value) => setConflictMode(value as ConflictMode)}
                />
              </label>

              <label className="auth-field">
                <span>导入内容</span>
                <Input.TextArea value={importContent} onChange={(event) => setImportContent(event.target.value)} style={{ minHeight: 180 }} />
              </label>

              {importError ? <Alert type="error" showIcon message={importError} /> : null}
              {importResult ? <Alert type="success" showIcon message={importResult} /> : null}

              <Button type="primary" icon={<UploadOutlined />} loading={importing} onClick={() => void handleImportTemplates()}>
                导入模板
              </Button>
            </div>
          </Card>

          <Card className="config-panel-card">
            <div className="config-card-header">
              <div className="page-section-title">
                <Typography.Title level={4}>可用工具与技能</Typography.Title>
                <Text type="secondary">先看合法工具，再决定模板里的工具和技能组合，避免保存时再撞上校验错误。</Text>
              </div>
            </div>

            <div className="page-stack">
              <div className="tag-cloud">
                {validTools.map((tool) => (
                  <Tag key={tool.name}>{tool.name}</Tag>
                ))}
              </div>

              <div className="page-scroll-shell template-assets-shell">
                <List
                  dataSource={validTools}
                  renderItem={(tool) => (
                    <List.Item>
                      <div className="page-stack">
                        <Text>{tool.name}</Text>
                        <Text type="secondary">{tool.description}</Text>
                      </div>
                    </List.Item>
                  )}
                />
              </div>

              <div className="tag-cloud">
                {installedSkills.length ? installedSkills.map((skill) => <Tag key={skill.id}>{skill.name}</Tag>) : <Tag>当前没有可见技能</Tag>}
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}
