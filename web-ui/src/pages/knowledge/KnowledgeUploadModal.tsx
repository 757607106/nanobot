import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from 'react'
import {
  Alert,
  Button,
  Card,
  Empty,
  Input,
  InputNumber,
  List,
  Modal,
  Segmented,
  Select,
  Space,
  Switch,
  Tag,
  Typography,
  Upload,
  theme,
} from 'antd'
import {
  DeleteOutlined,
  PlusOutlined,
  ReloadOutlined,
  UploadOutlined,
} from '@ant-design/icons'
import { api } from '../../api'
import type { KnowledgeBaseDefinition, KnowledgeDocument } from '../../types'
import {
  CHUNK_PRESET_OPTIONS,
  KNOWLEDGE_ARCHITECTURE_LABEL,
  buildIndexParams,
  getErrorMessage,
} from './shared'
import { useToast } from '../../toast'

const { Paragraph, Text, Title } = Typography

type UploadMode = 'file' | 'web_url' | 'faq_table'

interface FolderOption {
  label: string
  value: string
}

interface KnowledgeUploadModalProps {
  open: boolean
  kb: KnowledgeBaseDefinition | null
  folderOptions: FolderOption[]
  defaultParentId?: string | null
  onClose: () => void
  onSuccess: () => Promise<void> | void
}

interface UrlLoadItem {
  url: string
  status: 'pending' | 'loading' | 'success' | 'error'
  file?: KnowledgeDocument
  error?: string
}

function splitUrls(text: string) {
  return Array.from(
    new Set(
      text
        .split(/\r?\n|,|；|;/g)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  )
}

function normalizeFileKey(file: File) {
  return `${file.name}:${file.size}:${file.lastModified}`
}

function normalizeModeLabel(mode: UploadMode) {
  switch (mode) {
    case 'file':
      return '文件'
    case 'web_url':
      return 'URL'
    case 'faq_table':
      return 'FAQ'
  }
}

export function KnowledgeUploadModal({
  open,
  kb,
  folderOptions,
  defaultParentId = null,
  onClose,
  onSuccess,
}: KnowledgeUploadModalProps) {
  const message = useToast()
  const inputRef = useRef<HTMLInputElement | null>(null)
  const { token } = theme.useToken()

  const [mode, setMode] = useState<UploadMode>('file')
  const [targetParentId, setTargetParentId] = useState<string | null>(defaultParentId)
  const [autoIndex, setAutoIndex] = useState(false)
  const [sourceTitle, setSourceTitle] = useState('')
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [urlInput, setUrlInput] = useState('')
  const [urlItems, setUrlItems] = useState<UrlLoadItem[]>([])
  const [faqItems, setFaqItems] = useState<Array<{ question: string; answer: string }>>([{ question: '', answer: '' }])
  const [chunkPresetId, setChunkPresetId] = useState('general')
  const [chunkSize, setChunkSize] = useState(1000)
  const [chunkOverlap, setChunkOverlap] = useState(200)
  const [qaSeparator, setQaSeparator] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [loadingUrls, setLoadingUrls] = useState(false)

  const createdUrlFileIds = useMemo(
    () =>
      urlItems
        .filter((item) => item.status === 'success' && item.file && !item.file.isFolder)
        .map((item) => item.file!.fileId),
    [urlItems],
  )

  useEffect(() => {
    if (!open) {
      return
    }
    setMode('file')
    setTargetParentId(defaultParentId)
    setAutoIndex(false)
    setSourceTitle('')
    setSelectedFiles([])
    setUrlInput('')
    setUrlItems([])
    setFaqItems([{ question: '', answer: '' }])
    setChunkPresetId(String(kb?.additionalParams?.chunk_preset_id || 'general'))
    setChunkSize(Number(kb?.additionalParams?.chunk_size || 1000))
    setChunkOverlap(Number(kb?.additionalParams?.chunk_overlap || 200))
    setQaSeparator(String(kb?.additionalParams?.qa_separator || ''))
  }, [defaultParentId, kb, open])

  async function waitForJobCompletion(kbId: string, jobId: string, label: string) {
    for (let attempt = 0; attempt < 180; attempt += 1) {
      const jobs = await api.getKnowledgeJobs(kbId)
      const current = jobs.find((item) => item.jobId === jobId)
      if (current?.status === 'succeeded') {
        return current
      }
      if (current?.status === 'failed') {
        throw new Error(`${label}任务失败`)
      }
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
    throw new Error(`${label}任务超时`)
  }

  function collectValidFaqItems() {
    return faqItems
      .map((item) => ({
        question: item.question.trim(),
        answer: item.answer.trim(),
      }))
      .filter((item) => item.question && item.answer)
  }

  function resetAfterSuccess() {
    setMode('file')
    setTargetParentId(defaultParentId)
    setAutoIndex(false)
    setSourceTitle('')
    setSelectedFiles([])
    setUrlInput('')
    setUrlItems([])
    setFaqItems([{ question: '', answer: '' }])
    setSubmitting(false)
    setLoadingUrls(false)
  }

  function closeModal() {
    resetAfterSuccess()
    onClose()
  }

  function appendFiles(files: File[]) {
    if (files.length === 0) return
    setSelectedFiles((prev) => {
      const seen = new Set(prev.map((item) => normalizeFileKey(item)))
      const next = [...prev]
      for (const file of files) {
        const key = normalizeFileKey(file)
        if (seen.has(key)) continue
        seen.add(key)
        next.push(file)
      }
      return next
    })
  }

  function handleFileInputChange(event: ChangeEvent<HTMLInputElement>) {
    appendFiles(Array.from(event.target.files || []))
    event.target.value = ''
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    if (submitting || loadingUrls) return
    appendFiles(Array.from(event.dataTransfer.files || []))
  }

  function removeFile(file: File) {
    const key = normalizeFileKey(file)
    setSelectedFiles((prev) => prev.filter((item) => normalizeFileKey(item) !== key))
  }

  async function loadUrls(skipRefresh = false) {
    if (!kb) return []
    const urls = splitUrls(urlInput)
    if (urls.length === 0) {
      message.warning('请先输入至少一个 URL')
      return []
    }

    const nextItems: UrlLoadItem[] = urls.map((url) => ({ url, status: 'pending' }))
    setUrlItems(nextItems)
    setLoadingUrls(true)

    try {
      const results: UrlLoadItem[] = []
      for (const [index, url] of urls.entries()) {
        setUrlItems((prev) =>
          prev.map((item, itemIndex) => (itemIndex === index ? { ...item, status: 'loading' } : item)),
        )
        try {
          const file = await api.addKnowledgeSource(kb.kbId, {
            sourceType: 'web_url',
            url,
            title: sourceTitle.trim() || undefined,
            parentId: targetParentId,
          })
          results.push({ url, status: 'success', file })
        } catch (loadError) {
          results.push({ url, status: 'error', error: getErrorMessage(loadError, '抓取失败') })
        }
        const currentResult = results[results.length - 1]
        setUrlItems((prev) =>
          prev.map((item, itemIndex) => (itemIndex === index ? currentResult : item)),
        )
      }
      const successCount = results.filter((item) => item.status === 'success').length
      if (successCount > 0) {
        message.success(`已加载 ${successCount} 个 URL`)
      }
      if (results.some((item) => item.status === 'error')) {
        message.warning('部分 URL 加载失败，请查看列表')
      }
      if (!skipRefresh) {
        await onSuccess()
      }
      return results
    } finally {
      setLoadingUrls(false)
    }
  }

  async function autoIndexFiles(fileIds: string[]) {
    if (!kb || fileIds.length === 0) {
      return
    }
    const indexPayload = {
      fileIds,
      params: buildIndexParams(chunkPresetId, chunkSize, chunkOverlap, qaSeparator),
    }
    const parsePayload = await api.parseKnowledgeFiles(kb.kbId, { fileIds })
    await waitForJobCompletion(kb.kbId, parsePayload.job.jobId, '解析')
    const indexPayloadResult = await api.indexKnowledgeFiles(kb.kbId, indexPayload)
    await waitForJobCompletion(kb.kbId, indexPayloadResult.job.jobId, '入库')
  }

  async function handleSubmit() {
    if (!kb) return
    try {
      setSubmitting(true)

      if (mode === 'file') {
        if (selectedFiles.length === 0) {
          message.warning('请先选择要上传的文件')
          return
        }
        const formData = new FormData()
        selectedFiles.forEach((file) => {
          formData.append('file', file)
        })
        if (targetParentId) {
          formData.append('parentId', targetParentId)
        }
        const uploaded = await api.uploadKnowledgeFiles(kb.kbId, formData)
        const fileIds = uploaded.items.filter((item) => !item.isFolder).map((item) => item.fileId)
        if (autoIndex) {
          await autoIndexFiles(fileIds)
          message.success('文件已上传并入库')
        } else {
          message.success('文件已上传')
        }
        await onSuccess()
        closeModal()
        return
      }

      if (mode === 'web_url') {
        const loaded = urlItems.filter((item) => item.status === 'success' && item.file)
        if (loaded.length === 0) {
          const results = await loadUrls(true)
          const fresh = results.filter((item) => item.status === 'success' && item.file)
          if (autoIndex && fresh.length > 0) {
            await autoIndexFiles(fresh.map((item) => item.file!.fileId))
            message.success('URL 已加载并入库')
          }
          if (fresh.length === 0) {
            return
          }
          await onSuccess()
          closeModal()
          return
        }
        if (autoIndex) {
          await autoIndexFiles(loaded.map((item) => item.file!.fileId))
          message.success('URL 已加载并入库')
        } else {
          message.success('URL 已加载')
        }
        await onSuccess()
        closeModal()
        return
      }

      const items = collectValidFaqItems()
      if (items.length === 0) {
        message.warning('请至少填写一条 FAQ 问答')
        return
      }
      const created = await api.addKnowledgeSource(kb.kbId, {
        sourceType: 'faq_table',
        title: sourceTitle.trim() || 'faq-table',
        parentId: targetParentId,
        items,
      })
      const fileIds = created.isFolder ? [] : [created.fileId]
      if (autoIndex && fileIds.length > 0) {
        await autoIndexFiles(fileIds)
        message.success('FAQ 已保存并入库')
      } else {
        message.success('FAQ 已保存')
      }
      await onSuccess()
      closeModal()
    } catch (submitError) {
      message.error(getErrorMessage(submitError, '添加内容失败'))
    } finally {
      setSubmitting(false)
    }
  }

  const okText = (() => {
    if (mode === 'file') {
      return autoIndex ? '上传并入库' : '上传到知识库'
    }
    if (mode === 'web_url') {
      return autoIndex ? '加载并入库' : '完成'
    }
    return autoIndex ? '保存并入库' : '保存到知识库'
  })()

  return (
    <Modal
      open={open}
      width={720}
      title="添加文件"
      onCancel={closeModal}
      confirmLoading={submitting}
      destroyOnHidden
      className="knowledge-upload-modal"
      footer={(
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text type="secondary" style={{ fontSize: '13px' }}>
            当前模式: {normalizeModeLabel(mode)}
            {mode === 'web_url' && createdUrlFileIds.length > 0 ? ` · 已抓取 ${createdUrlFileIds.length} 条` : ''}
          </Text>
          <Space>
            <Button onClick={closeModal}>取消</Button>
            <Button type="primary" loading={submitting} onClick={() => void handleSubmit()}>
              {okText}
            </Button>
          </Space>
        </div>
      )}
    >
      <div className="knowledge-upload-workbench">
        <div style={{ marginBottom: 24 }}>
          <Space align="center" style={{ marginBottom: 4 }}>
            <Text type="secondary">
              支持文件、URL 和 FAQ 三种来源，提交后会写入当前知识库 {kb?.name ? `「${kb.name}」` : ''}。
            </Text>
            <Tag color="green">{KNOWLEDGE_ARCHITECTURE_LABEL}</Tag>
          </Space>
        </div>

        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Segmented
            value={mode}
            onChange={(value) => setMode(value as UploadMode)}
            options={[
              { label: '文件', value: 'file' },
              { label: 'URL', value: 'web_url' },
              { label: 'FAQ', value: 'faq_table' },
            ]}
          />

          <Card size="small" bordered={false} style={{ background: token.colorBgLayout }}>
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              <div style={{ display: 'flex', gap: 16 }}>
                <div style={{ flex: 1 }}>
                  <Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>目标文件夹</Text>
                  <Select
                    allowClear
                    placeholder="选填"
                    value={targetParentId}
                    options={folderOptions}
                    onChange={(value) => setTargetParentId(value)}
                    style={{ width: '100%' }}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>上传后自动入库</Text>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 32 }}>
                    <Switch checked={autoIndex} onChange={setAutoIndex} />
                    <Text type="secondary">解析并生成索引</Text>
                  </div>
                </div>
              </div>
              {(mode === 'web_url' || mode === 'faq_table') ? (
                <div>
                  <Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>来源标题</Text>
                  <Input
                    value={sourceTitle}
                    onChange={(event) => setSourceTitle(event.target.value)}
                    placeholder={mode === 'web_url' ? '可选，用于同一批 URL 的来源标题' : 'FAQ 文件标题'}
                  />
                </div>
              ) : null}
            </Space>
          </Card>

          {autoIndex ? (
            <Card size="small" title={<Text strong>入库参数</Text>} style={{ background: token.colorBgContainer }}>
              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                <div style={{ display: 'flex', gap: 16 }}>
                  <div style={{ flex: 1 }}>
                    <Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>分块策略</Text>
                    <Select
                      value={chunkPresetId}
                      options={CHUNK_PRESET_OPTIONS.map((item) => ({ label: item.label, value: item.value }))}
                      onChange={(value) => setChunkPresetId(value)}
                      style={{ width: '100%' }}
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>Chunk Size / Overlap</Text>
                    <Space.Compact style={{ width: '100%' }}>
                      <InputNumber
                        min={200}
                        max={8000}
                        value={chunkSize}
                        onChange={(value) => setChunkSize(Number(value || 1000))}
                        style={{ flex: 1 }}
                        placeholder="Size"
                      />
                      <InputNumber
                        min={0}
                        max={4000}
                        value={chunkOverlap}
                        onChange={(value) => setChunkOverlap(Number(value || 0))}
                        style={{ flex: 1 }}
                        placeholder="Overlap"
                      />
                    </Space.Compact>
                  </div>
                </div>
                <div style={{ flex: 1 }}>
                  <Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>QA 分隔符</Text>
                  <Input
                    value={qaSeparator}
                    onChange={(event) => setQaSeparator(event.target.value)}
                    placeholder="选填（例如：---FAQ---）"
                  />
                </div>
              </Space>
            </Card>
          ) : null}

          {mode === 'file' ? (
            <Card size="small" style={{ background: token.colorBgContainer }}>
              <Upload.Dragger
                multiple
                beforeUpload={(file, fileList) => {
                  appendFiles(fileList as unknown as File[])
                  return false
                }}
                showUploadList={false}
                fileList={[]}
                style={{ padding: '24px 0', background: token.colorFillAlter, border: `1px dashed ${token.colorBorder}`, borderRadius: token.borderRadiusLG }}
              >
                <p className="ant-upload-drag-icon">
                  <UploadOutlined style={{ fontSize: 28, color: token.colorPrimary }} />
                </p>
                <p className="ant-upload-text" style={{ fontSize: token.fontSize, fontWeight: 500, margin: '4px 0' }}>
                  点击或拖拽文件到此区域
                </p>
                <p className="ant-upload-hint" style={{ fontSize: token.fontSizeSM, color: token.colorTextSecondary, padding: '0 24px', margin: 0 }}>
                  支持单次多选
                </p>
              </Upload.Dragger>

              {selectedFiles.length > 0 ? (
                <List
                  size="small"
                  className="knowledge-upload-list"
                  dataSource={selectedFiles}
                  style={{ marginTop: 12, maxHeight: 200, overflowY: 'auto' }}
                  renderItem={(file) => (
                    <List.Item
                      actions={[
                        <Button
                          key="remove"
                          type="text"
                          danger
                          icon={<DeleteOutlined />}
                          onClick={() => removeFile(file)}
                        />,
                      ]}
                    >
                      <List.Item.Meta
                        title={file.name}
                        description={`${Math.max(1, Math.round(file.size / 1024))} KB`}
                      />
                    </List.Item>
                  )}
                />
              ) : null}
            </Card>
          ) : null}

          {mode === 'web_url' ? (
            <Card size="small" title={<Text strong>URL 批量加载</Text>}>
              <Space direction="vertical" style={{ width: '100%' }}>
                <Input.TextArea
                  value={urlInput}
                  onChange={(event) => setUrlInput(event.target.value)}
                  autoSize={{ minRows: 3, maxRows: 6 }}
                  placeholder="一行一个 URL，也支持逗号分隔"
                />
                <Button
                  icon={<ReloadOutlined />}
                  loading={loadingUrls}
                  onClick={() => void loadUrls()}
                  disabled={!urlInput.trim()}
                  block
                >
                  预加载 URLs
                </Button>
                {urlItems.length > 0 ? (
                  <List
                    size="small"
                    dataSource={urlItems}
                    style={{ maxHeight: 200, overflowY: 'auto' }}
                    renderItem={(item) => (
                      <List.Item
                        actions={[
                          item.status === 'success' && item.file ? (
                            <Tag key="ok" color="green">已抓取</Tag>
                          ) : item.status === 'error' ? (
                            <Tag key="err" color="red">失败</Tag>
                          ) : (
                            <Tag key="pending" color="processing">处理中</Tag>
                          ),
                        ]}
                      >
                        <List.Item.Meta
                          title={<Text style={{ fontSize: '13px' }} ellipsis>{item.url}</Text>}
                          description={<Text style={{ fontSize: '12px' }} type="secondary" ellipsis>{item.status === 'error' ? item.error : item.file?.title || item.file?.filename || '...'}</Text>}
                        />
                      </List.Item>
                    )}
                  />
                ) : null}
              </Space>
            </Card>
          ) : null}

          {mode === 'faq_table' ? (
            <Card size="small" style={{ maxHeight: 400, overflowY: 'auto' }}>
              <Space direction="vertical" style={{ width: '100%' }}>
                {faqItems.map((item, index) => (
                  <Card
                    key={`faq-${index}`}
                    size="small"
                    type="inner"
                    title={`FAQ ${index + 1}`}
                    extra={
                      faqItems.length > 1 ? (
                        <Button
                          type="text"
                          danger
                          icon={<DeleteOutlined />}
                          onClick={() => setFaqItems((prev) => prev.filter((_, itemIndex) => itemIndex !== index))}
                        />
                      ) : null
                    }
                  >
                    <Space direction="vertical" style={{ width: '100%' }}>
                      <Input
                        value={item.question}
                        placeholder="问题"
                        onChange={(event) =>
                          setFaqItems((prev) =>
                            prev.map((entry, itemIndex) =>
                              itemIndex === index ? { ...entry, question: event.target.value } : entry,
                            ),
                          )
                        }
                      />
                      <Input.TextArea
                        value={item.answer}
                        placeholder="答案"
                        rows={2}
                        onChange={(event) =>
                          setFaqItems((prev) =>
                            prev.map((entry, itemIndex) =>
                              itemIndex === index ? { ...entry, answer: event.target.value } : entry,
                            ),
                          )
                        }
                      />
                    </Space>
                  </Card>
                ))}
                <Button
                  type="dashed"
                  block
                  icon={<PlusOutlined />}
                  onClick={() => setFaqItems((prev) => [...prev, { question: '', answer: '' }])}
                >
                  添加 FAQ
                </Button>
              </Space>
            </Card>
          ) : null}
        </Space>
      </div>
    </Modal>
  )
}
