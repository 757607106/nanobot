import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { App, Alert, Button, Card, Empty, Input, List, Modal, Space, Spin, Tag, Typography } from 'antd'
import {
  DeleteOutlined,
  EditOutlined,
  MessageOutlined,
  PaperClipOutlined,
  PlusOutlined,
  ReloadOutlined,
  RobotOutlined,
  SendOutlined,
  StopOutlined,
  UploadOutlined,
} from '@ant-design/icons'
import { useXChat, type MessageInfo, type SSEOutput } from '@ant-design/x-sdk'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useNavigate, useParams } from 'react-router-dom'
import { ApiError, api } from '../api'
import { createNanobotChatProvider } from '../chat/NanobotChatProvider'
import {
  buildChatRequestQuery,
  dedupeAttachmentRefs,
  normalizeChatMessage,
  toChatAttachmentRef,
} from '../chat/chatMessageUtils'
import { formatRelativeTimeZh } from '../locale'
import type {
  AgentDefinition,
  ChatAttachmentRef,
  ChatMessage,
  ChatRequestInput,
  ChatUploadItem,
  SessionSummary,
} from '../types'

const { Title, Paragraph, Text } = Typography
const { TextArea } = Input
const DRAFT_SESSION_KEY = '__draft__'

function MarkdownBubble({ content }: { content: string }) {
  return (
    <div className="markdown-bubble">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  )
}

function AttachmentTags({
  attachments,
  removable,
  onRemove,
}: {
  attachments: ChatAttachmentRef[]
  removable?: boolean
  onRemove?: (relativePath: string) => void
}) {
  if (!attachments.length) {
    return null
  }

  return (
    <div className="chat-attachment-tags">
      {attachments.map((item) => (
        <Tag
          key={item.relativePath}
          closable={removable}
          onClose={(event) => {
            event.preventDefault()
            onRemove?.(item.relativePath)
          }}
          icon={<PaperClipOutlined />}
          className="chat-attachment-tag"
        >
          {item.name || item.relativePath}
        </Tag>
      ))}
    </div>
  )
}

function MessageBody({ info }: { info: MessageInfo<ChatMessage> }) {
  const message = normalizeChatMessage(info.message)
  return (
    <div className="chat-message-stack">
      {message.progressSteps?.length ? (
        <div className="chat-message-meta-block">
          <div className="chat-message-meta-label">执行过程</div>
          <Space wrap>
            {message.progressSteps.map((step) => (
              <Tag key={step.key} color={step.kind === 'tool' ? 'blue' : 'gold'}>
                {step.label}
              </Tag>
            ))}
          </Space>
        </div>
      ) : null}
      <MarkdownBubble content={String(message.content || '') || (info.status === 'loading' ? '正在生成回复...' : '')} />
    </div>
  )
}

function getMessageTitle(message: ChatMessage) {
  if (message.role === 'user') {
    return '你'
  }
  if (message.role === 'assistant') {
    return 'Agent'
  }
  return message.role
}

function getDisplaySessionTitle(title?: string) {
  if (!title || title === 'New Chat') {
    return '新会话'
  }
  return title
}

export default function AgentChatPage() {
  const { message, modal } = App.useApp()
  const navigate = useNavigate()
  const { agentId } = useParams()
  const [agent, setAgent] = useState<AgentDefinition | null>(null)
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null)
  const [loadingAgent, setLoadingAgent] = useState(true)
  const [loadingSessions, setLoadingSessions] = useState(true)
  const [loadingSessionFiles, setLoadingSessionFiles] = useState(false)
  const [uploadingFiles, setUploadingFiles] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [composerValue, setComposerValue] = useState('')
  const [sessionFiles, setSessionFiles] = useState<ChatUploadItem[]>([])
  const [draftAttachmentRefs, setDraftAttachmentRefs] = useState<ChatAttachmentRef[]>([])
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const [renameTarget, setRenameTarget] = useState<SessionSummary | null>(null)
  const currentSessionIdRef = useRef<string | null>(null)
  const pendingSyncSessionIdRef = useRef<string | null>(null)
  const shouldSyncSessionRef = useRef(false)
  const wasRequestingRef = useRef(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const provider = useMemo(
    () =>
      createNanobotChatProvider({
        buildMessagesPath: (requestParams) => {
          const resolvedAgentId = String(requestParams.agentId || agentId || '').trim()
          const sessionId = String(requestParams.sessionId || '').trim()
          return `/api/v1/agents/${encodeURIComponent(resolvedAgentId)}/sessions/${encodeURIComponent(sessionId)}/messages?stream=1`
        },
      }),
    [agentId],
  )

  const {
    messages,
    onRequest,
    queueRequest,
    isRequesting,
    setMessages,
    abort,
  } = useXChat<ChatMessage, ChatMessage, ChatRequestInput, SSEOutput>({
    provider,
    conversationKey: currentSessionId ?? DRAFT_SESSION_KEY,
    defaultMessages: async (info?: { conversationKey?: string }) => {
      const sessionId = String(info?.conversationKey || '')
      if (!agentId || !sessionId || sessionId === DRAFT_SESSION_KEY) {
        return []
      }
      const data = await api.getAgentMessages(agentId, sessionId)
      return data.map((item, index) => ({
        id: item.id || `agent-history-${sessionId}-${index}`,
        message: normalizeChatMessage(item),
        status: 'success' as const,
      }))
    },
    requestPlaceholder: () =>
      normalizeChatMessage({
        role: 'assistant',
        content: '',
        createdAt: new Date().toISOString(),
        progressSteps: [],
      }),
    requestFallback: (_requestParams, { error: requestError, errorInfo, messageInfo }) => {
      const baseMessage = normalizeChatMessage(
        messageInfo?.message ?? {
          role: 'assistant',
          content: '',
          createdAt: new Date().toISOString(),
        },
      )
      if (requestError.name === 'AbortError') {
        return {
          ...baseMessage,
          content: baseMessage.content || '已停止生成，你可以继续输入要求。',
        }
      }
      const fallbackMessage =
        errorInfo instanceof Error
          ? errorInfo.message
          : typeof errorInfo?.message === 'string'
            ? errorInfo.message
            : requestError.message
      return {
        ...baseMessage,
        content: baseMessage.content || fallbackMessage || '网络异常，请稍后重试',
      }
    },
  })

  const messageInfos = useMemo(
    () =>
      messages.map((info) => ({
        ...info,
        message: normalizeChatMessage(info.message),
      })),
    [messages],
  )

  const selectedSession = useMemo(
    () => sessions.find((item) => item.id === currentSessionId) ?? null,
    [currentSessionId, sessions],
  )
  const selectedSessionTitle = selectedSession ? getDisplaySessionTitle(selectedSession.title) : '开始新会话'
  const selectedSessionSubtitle = selectedSession?.updatedAt || selectedSession?.createdAt
    ? `最近更新 ${formatRelativeTimeZh(selectedSession.updatedAt || selectedSession.createdAt)}`
    : '发送消息或上传文件，启动独立 Agent 工作流。'

  useEffect(() => {
    currentSessionIdRef.current = currentSessionId
  }, [currentSessionId])

  useEffect(() => {
    if (!currentSessionId || !agentId) {
      setSessionFiles([])
      setDraftAttachmentRefs([])
      return
    }
    void loadSessionFiles(currentSessionId)
  }, [agentId, currentSessionId])

  useEffect(() => {
    void loadAgent()
    void loadSessions()
  }, [agentId])

  useEffect(() => {
    const wasRequesting = wasRequestingRef.current
    if (wasRequesting && !isRequesting) {
      const sessionId = pendingSyncSessionIdRef.current
      pendingSyncSessionIdRef.current = null
      if (sessionId && shouldSyncSessionRef.current) {
        shouldSyncSessionRef.current = false
        void syncSessionAfterRequest(sessionId)
      }
    }
    wasRequestingRef.current = isRequesting
  }, [isRequesting])

  async function loadAgent() {
    if (!agentId) {
      setError('缺少 agentId')
      setLoadingAgent(false)
      return
    }
    try {
      setLoadingAgent(true)
      const data = await api.getAgent(agentId)
      setAgent(data)
      setError(null)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '加载 Agent 失败')
    } finally {
      setLoadingAgent(false)
    }
  }

  async function loadSessions(preferredSessionId?: string | null) {
    if (!agentId) {
      return
    }
    try {
      setLoadingSessions(true)
      const data = await api.listAgentSessions(agentId)
      setSessions(data.items)
      setCurrentSessionId((current) => {
        if (preferredSessionId && data.items.some((item) => item.id === preferredSessionId)) {
          return preferredSessionId
        }
        if (current && data.items.some((item) => item.id === current)) {
          return current
        }
        return data.items[0]?.id || null
      })
      if (!data.items.length) {
        setMessages([])
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '加载 Agent 会话失败')
    } finally {
      setLoadingSessions(false)
    }
  }

  async function loadSessionFiles(sessionId: string) {
    if (!agentId) {
      return
    }
    try {
      setLoadingSessionFiles(true)
      const files = await api.getAgentSessionFiles(agentId, sessionId)
      setSessionFiles(files)
      setDraftAttachmentRefs((prev) =>
        prev.filter((item) => files.some((file) => file.relativePath === item.relativePath)),
      )
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '加载 Agent 会话文件失败')
    } finally {
      setLoadingSessionFiles(false)
    }
  }

  async function createSession(selectAfterCreate = true) {
    if (!agentId) {
      throw new Error('缺少 agentId')
    }
    const created = await api.createAgentSession(agentId, agent?.name ? `${agent.name} 新会话` : undefined)
    await loadSessions(created.id)
    if (selectAfterCreate) {
      setCurrentSessionId(created.id)
      setMessages([])
      setSessionFiles([])
      setDraftAttachmentRefs([])
    }
    return created
  }

  async function ensureActiveSession() {
    if (currentSessionIdRef.current) {
      return currentSessionIdRef.current
    }
    const created = await createSession()
    return created.id
  }

  async function syncSessionAfterRequest(sessionId: string) {
    if (!agentId) {
      return
    }
    try {
      const history = await api.getAgentMessages(agentId, sessionId)
      if (currentSessionIdRef.current === sessionId) {
        setMessages(
          history.map((item, index) => ({
            id: item.id || `agent-history-${sessionId}-${index}`,
            message: normalizeChatMessage(item),
            status: 'success' as const,
          })),
        )
      }
      await Promise.all([loadSessions(sessionId), loadSessionFiles(sessionId)])
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : '同步 Agent 会话失败')
    }
  }

  async function uploadFiles(files: File[]) {
    if (!agentId || !files.length) {
      return
    }
    try {
      setUploadingFiles(true)
      const sessionId = await ensureActiveSession()
      const uploadedRefs: ChatAttachmentRef[] = []
      for (const file of files) {
        const formData = new FormData()
        formData.append('file', file)
        const result = await api.uploadAgentSessionChatFile(agentId, sessionId, formData)
        if (result.uploadedFile) {
          uploadedRefs.push(toChatAttachmentRef(result.uploadedFile))
        }
        setSessionFiles(result.sessionFiles)
      }
      if (uploadedRefs.length) {
        setDraftAttachmentRefs((prev) => dedupeAttachmentRefs([...prev, ...uploadedRefs]))
        await loadSessions(sessionId)
        message.success(uploadedRefs.length === 1 ? `已上传 ${uploadedRefs[0].name}` : `已上传 ${uploadedRefs.length} 个文件`)
      }
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : '上传文件失败')
    } finally {
      setUploadingFiles(false)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  function handleFileSelection(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || [])
    if (!files.length) {
      return
    }
    void uploadFiles(files)
  }

  function toggleSessionFileReference(item: ChatUploadItem) {
    const attachment = toChatAttachmentRef(item)
    setDraftAttachmentRefs((prev) => {
      if (prev.some((entry) => entry.relativePath === attachment.relativePath)) {
        return prev.filter((entry) => entry.relativePath !== attachment.relativePath)
      }
      return dedupeAttachmentRefs([...prev, attachment])
    })
  }

  async function handleRemoveSessionFile(relativePath: string) {
    if (!agentId || !currentSessionId) {
      return
    }
    try {
      const result = await api.removeAgentSessionFile(agentId, currentSessionId, relativePath)
      setSessionFiles(result.sessionFiles)
      setDraftAttachmentRefs((prev) => prev.filter((item) => item.relativePath !== relativePath))
      await loadSessions(currentSessionId)
      message.success('文件已移除')
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : '移除文件失败')
    }
  }

  function openRenameModal(session: SessionSummary) {
    setRenameTarget(session)
    setRenameValue(getDisplaySessionTitle(session.title))
    setRenameOpen(true)
  }

  async function handleRenameSession() {
    if (!agentId || !renameTarget || !renameValue.trim()) {
      return
    }
    try {
      const updated = await api.renameAgentSession(agentId, renameTarget.id, renameValue.trim())
      setSessions((prev) => prev.map((item) => (item.id === updated.id ? updated : item)))
      setRenameOpen(false)
      setRenameTarget(null)
      message.success('会话已重命名')
    } catch (renameError) {
      setError(renameError instanceof Error ? renameError.message : '重命名会话失败')
    }
  }

  async function handleDeleteSession(session: SessionSummary) {
    if (!agentId) {
      return
    }
    try {
      await api.deleteAgentSession(agentId, session.id)
      const remaining = sessions.filter((item) => item.id !== session.id)
      setSessions(remaining)
      if (currentSessionId === session.id) {
        setCurrentSessionId(remaining[0]?.id ?? null)
        setMessages([])
        setSessionFiles([])
        setDraftAttachmentRefs([])
      }
      message.success('会话已删除')
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : '删除会话失败')
    }
  }

  function confirmDeleteSession(session: SessionSummary) {
    modal.confirm({
      title: '确定删除这个 Agent 会话吗？',
      content: '删除后，会移除这个 Agent 独立会话的已保存历史记录。',
      okText: '删除',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: async () => {
        await handleDeleteSession(session)
      },
    })
  }

  async function handleSubmit() {
    const trimmed = composerValue.trim()
    if (!trimmed || !agentId || isRequesting || uploadingFiles) {
      return
    }
    try {
      let sessionId = currentSessionIdRef.current
      let createdSessionId: string | null = null
      if (!sessionId) {
        const created = await createSession(false)
        sessionId = created.id
        createdSessionId = created.id
        setCurrentSessionId(created.id)
      }
      const attachments = dedupeAttachmentRefs(draftAttachmentRefs)
      const query = buildChatRequestQuery(trimmed, attachments)

      shouldSyncSessionRef.current = true
      pendingSyncSessionIdRef.current = createdSessionId || sessionId

      if (createdSessionId) {
        queueRequest(createdSessionId, {
          agentId,
          sessionId: createdSessionId,
          query,
          displayContent: trimmed,
          attachments,
        })
      } else if (sessionId) {
        onRequest({
          agentId,
          sessionId,
          query,
          displayContent: trimmed,
          attachments,
        })
      }
      setComposerValue('')
      setDraftAttachmentRefs([])
    } catch (submitError) {
      const nextError =
        submitError instanceof ApiError
          ? submitError.message
          : submitError instanceof Error
            ? submitError.message
            : '发送消息失败'
      setError(nextError)
      message.error(nextError)
    }
  }

  if (loadingAgent) {
    return (
      <div className="page-card center-box">
        <Spin size="large" />
      </div>
    )
  }

  return (
    <div className="page-stack">
      <div className="page-hero-compact studio-hero">
        <div>
          <Title level={2} style={{ marginBottom: 8 }}>{agent?.name || 'Agent Workbench'}</Title>
          <Paragraph style={{ marginBottom: 0 }}>
            这里的会话会走 Agent 独立运行时，session、文件和工作目录都不会和别的 Agent 串在一起。
          </Paragraph>
        </div>
        <Space wrap>
          {agent?.agentId ? <Tag color="blue">{agent.agentId}</Tag> : null}
          <Button onClick={() => navigate(`/studio/agents/${agentId}`)}>返回配置</Button>
        </Space>
      </div>

      {error ? <Alert type="error" showIcon message={error} /> : null}

      <div className="page-grid studio-agents-grid">
        <Card className="config-panel-card studio-agent-list-card" loading={loadingSessions}>
          <div className="studio-runs-header" style={{ marginBottom: 16 }}>
            <div>
              <Text strong>会话列表</Text>
              <div><Text type="secondary">{sessions.length} 个独立 Agent Session</Text></div>
            </div>
            <Button icon={<PlusOutlined />} type="primary" onClick={() => void createSession()}>
              新会话
            </Button>
          </div>

          {sessions.length === 0 ? (
            <Empty image={false} description="还没有会话，先发起一次独立 Agent 对话。" />
          ) : (
            <List
              className="studio-agent-list"
              dataSource={sessions}
              renderItem={(item) => (
                <List.Item
                  className={`studio-agent-list-item ${item.id === currentSessionId ? 'is-active' : ''}`}
                  onClick={() => setCurrentSessionId(item.id)}
                  style={{ cursor: 'pointer' }}
                  actions={[
                    <Button
                      key="rename"
                      type="text"
                      size="small"
                      icon={<EditOutlined />}
                      onClick={(event) => {
                        event.stopPropagation()
                        openRenameModal(item)
                      }}
                    />,
                    <Button
                      key="delete"
                      type="text"
                      size="small"
                      danger
                      icon={<DeleteOutlined />}
                      onClick={(event) => {
                        event.stopPropagation()
                        confirmDeleteSession(item)
                      }}
                    />,
                  ]}
                >
                  <div className="studio-agent-list-copy">
                    <div className="studio-agent-list-head">
                      <Text strong>{getDisplaySessionTitle(item.title)}</Text>
                      <Tag>{item.messageCount} 条</Tag>
                    </div>
                    <div className="studio-agent-list-meta">
                      <Text type="secondary">
                        {item.updatedAt || item.createdAt ? formatRelativeTimeZh(item.updatedAt || item.createdAt) : '刚创建'}
                      </Text>
                    </div>
                  </div>
                </List.Item>
              )}
            />
          )}
        </Card>

        <div className="page-stack">
          <Card className="config-panel-card">
            <div className="studio-runs-header" style={{ marginBottom: 16 }}>
              <div>
                <Text strong>{agent?.name || 'Agent'} 对话</Text>
                <div>
                  <Text type="secondary">{selectedSessionTitle} · {selectedSessionSubtitle}</Text>
                </div>
              </div>
              <Space>
                {isRequesting ? (
                  <Button icon={<StopOutlined />} onClick={() => abort()}>
                    停止
                  </Button>
                ) : null}
                <Button icon={<ReloadOutlined />} onClick={() => currentSessionId && void syncSessionAfterRequest(currentSessionId)}>
                  刷新
                </Button>
                <Button icon={<MessageOutlined />} onClick={() => navigate(`/studio/agents/${agentId}`)}>
                  查看 Agent
                </Button>
              </Space>
            </div>

            {messageInfos.length === 0 ? (
              <Empty image={false} description="发送第一条消息，开始这个 Agent 的隔离会话。" />
            ) : (
              <div className="page-stack">
                {messageInfos.map((info) => {
                  const normalized = normalizeChatMessage(info.message)
                  return (
                    <div key={String(info.id)} className="studio-run-message-item">
                      <div className="studio-run-message-shell">
                        <div className={`studio-run-message-avatar ${normalized.role === 'user' ? 'is-user' : ''}`}>
                          {normalized.role === 'user' ? '你' : <RobotOutlined />}
                        </div>
                        <div className="studio-run-message-content">
                          <div className="studio-run-message-meta">
                            <Text strong>{getMessageTitle(normalized)}</Text>
                            <Text type="secondary">
                              {normalized.createdAt ? formatRelativeTimeZh(normalized.createdAt) : '刚刚'}
                            </Text>
                          </div>
                          <div className={`studio-run-message-bubble ${normalized.role === 'user' ? 'is-user' : ''}`}>
                            <MessageBody info={info} />
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </Card>

          <Card className="config-panel-card" loading={loadingSessionFiles}>
            <div className="studio-runs-header" style={{ marginBottom: 16 }}>
              <div>
                <Text strong>会话文件</Text>
                <div><Text type="secondary">这些文件存放在当前 Agent 会话自己的 workspace 里。</Text></div>
              </div>
              <Space>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  hidden
                  onChange={handleFileSelection}
                />
                <Button
                  icon={<UploadOutlined />}
                  loading={uploadingFiles}
                  onClick={() => fileInputRef.current?.click()}
                >
                  上传文件
                </Button>
              </Space>
            </div>

            {sessionFiles.length === 0 ? (
              <Empty image={false} description="当前会话还没有上传文件。" />
            ) : (
              <List
                className="studio-run-list"
                dataSource={sessionFiles}
                renderItem={(item) => {
                  const isSelected = draftAttachmentRefs.some((entry) => entry.relativePath === item.relativePath)
                  return (
                    <List.Item
                      className="studio-run-list-item"
                      actions={[
                        <Button
                          key="toggle"
                          type={isSelected ? 'primary' : 'default'}
                          size="small"
                          onClick={() => toggleSessionFileReference(item)}
                        >
                          {isSelected ? '取消引用' : '引用'}
                        </Button>,
                        <Button
                          key="remove"
                          type="text"
                          size="small"
                          danger
                          icon={<DeleteOutlined />}
                          onClick={() => void handleRemoveSessionFile(item.relativePath)}
                        />,
                      ]}
                    >
                      <div className="studio-run-list-copy">
                        <div className="studio-run-list-head">
                          <Text strong>{item.name}</Text>
                          {isSelected ? <Tag color="blue">本轮引用</Tag> : null}
                        </div>
                        <Paragraph className="studio-run-preview" ellipsis={{ rows: 2 }}>
                          {item.relativePath}
                        </Paragraph>
                      </div>
                    </List.Item>
                  )
                }}
              />
            )}
          </Card>

          <Card className="config-panel-card">
            {draftAttachmentRefs.length > 0 ? (
              <div className="studio-form-field" style={{ marginBottom: 16 }}>
                <Text type="secondary">本轮引用文件</Text>
                <AttachmentTags
                  attachments={draftAttachmentRefs}
                  removable
                  onRemove={(relativePath) => {
                    setDraftAttachmentRefs((prev) => prev.filter((item) => item.relativePath !== relativePath))
                  }}
                />
              </div>
            ) : null}

            <div className="studio-form-field">
              <Text type="secondary">发送给 {agent?.name || 'Agent'}</Text>
              <TextArea
                value={composerValue}
                onChange={(event) => setComposerValue(event.target.value)}
                placeholder="输入任务，让这个 Agent 在它自己的独立上下文里处理。"
                autoSize={{ minRows: 4, maxRows: 8 }}
                onPressEnter={(event) => {
                  if (event.shiftKey) {
                    return
                  }
                  event.preventDefault()
                  void handleSubmit()
                }}
              />
            </div>
            <div className="studio-form-actions" style={{ marginTop: 16 }}>
              <Button icon={<PlusOutlined />} onClick={() => void createSession()}>
                新建隔离会话
              </Button>
              <Button
                type="default"
                icon={<UploadOutlined />}
                loading={uploadingFiles}
                onClick={() => fileInputRef.current?.click()}
              >
                上传并引用文件
              </Button>
              <Button
                type="primary"
                icon={<SendOutlined />}
                onClick={() => void handleSubmit()}
                loading={isRequesting}
                disabled={uploadingFiles}
              >
                发送
              </Button>
            </div>
          </Card>
        </div>
      </div>

      <Modal
        title="重命名 Agent 会话"
        open={renameOpen}
        onOk={() => void handleRenameSession()}
        onCancel={() => {
          setRenameOpen(false)
          setRenameTarget(null)
        }}
        okText="保存"
        cancelText="取消"
      >
        <Input
          value={renameValue}
          onChange={(event) => setRenameValue(event.target.value)}
          placeholder="输入新的会话标题"
          onPressEnter={() => void handleRenameSession()}
        />
      </Modal>
    </div>
  )
}
