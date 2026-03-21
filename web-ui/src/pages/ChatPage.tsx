import { startTransition, useEffect, useMemo, useRef, useState } from 'react'
import {
  App,
  Button,
  Empty,
  Input,
  Modal,
  Spin,
  Tag,
  Tooltip,
  Typography,
} from 'antd'
import { Attachments, Bubble, Conversations, Sender, ThoughtChain } from '@ant-design/x'
import type { Conversation, ThoughtChainItem } from '@ant-design/x'
import { useXChat, type MessageInfo, type SSEOutput } from '@ant-design/x-sdk'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  CloudUploadOutlined,
  DeleteOutlined,
  EditOutlined,
  LinkOutlined,
  MessageOutlined,
  NodeIndexOutlined,
  PaperClipOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
  ToolOutlined,
  UserOutlined,
} from '@ant-design/icons'
import { RobotOutlined } from '@ant-design/icons'
import { api } from '../api'
import { PLATFORM_ASSISTANT_NAME } from '../branding'
import { createNanobotChatProvider } from '../chat/NanobotChatProvider'
import {
  buildChatRequestQuery,
  dedupeAttachmentRefs,
  getToolCallName,
  normalizeChatMessage,
  toChatAttachmentRef,
} from '../chat/chatMessageUtils'
import { formatDateTimeZh, formatRelativeTimeZh } from '../locale'
import { testIds } from '../testIds'
import type {
  ChatAttachmentRef,
  ChatMessage,
  ChatRequestInput,
  ChatToolCall,
  ChatUploadItem,
  ChatWorkspaceData,
  SessionSummary,
} from '../types'

const { Text, Title } = Typography
const DRAFT_SESSION_KEY = '__draft__'
const TOOL_RESULT_PREVIEW_LIMIT = 1400

type ComposerAttachment = NonNullable<React.ComponentProps<typeof Attachments>['items']>[number]

function getDisplaySessionTitle(title?: string) {
  if (!title || title === 'New Chat') {
    return '新会话'
  }
  return title
}

function getSessionGroup(value?: string) {
  if (!value) {
    return '最近'
  }
  const now = new Date()
  const date = new Date(value)
  const diff = now.getTime() - date.getTime()
  if (diff < 24 * 60 * 60 * 1000) {
    return '今天'
  }
  if (diff < 7 * 24 * 60 * 60 * 1000) {
    return '本周'
  }
  return '更早'
}

function formatFileSize(sizeBytes?: number) {
  if (!sizeBytes || sizeBytes <= 0) {
    return '未知大小'
  }
  if (sizeBytes < 1024) {
    return `${sizeBytes} B`
  }
  if (sizeBytes < 1024 * 1024) {
    return `${(sizeBytes / 1024).toFixed(1)} KB`
  }
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`
}

function getAttachmentName(item: ChatAttachmentRef) {
  return item.name || item.relativePath.split('/').filter(Boolean).pop() || item.relativePath
}

function truncateContent(content: string, limit = TOOL_RESULT_PREVIEW_LIMIT) {
  if (content.length <= limit) {
    return content
  }
  return `${content.slice(0, limit)}\n\n...`
}

function safeJsonParse(value?: string) {
  if (!value) {
    return null
  }
  try {
    return JSON.parse(value) as unknown
  } catch {
    return null
  }
}

function summarizeValue(value: unknown, limit = 64): string {
  if (typeof value === 'string') {
    const compact = value.replace(/\s+/g, ' ').trim()
    return compact.length > limit ? `${compact.slice(0, limit)}...` : compact
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  if (Array.isArray(value)) {
    return `${value.length} 项`
  }
  if (value && typeof value === 'object') {
    return '对象'
  }
  return '空'
}

function getToolArgumentsPreview(toolCall: ChatToolCall) {
  const args = toolCall.function?.arguments
  if (!args) {
    return '无参数'
  }

  const parsed = safeJsonParse(args)
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const preview = Object.entries(parsed as Record<string, unknown>)
      .slice(0, 3)
      .map(([key, value]) => `${key}: ${summarizeValue(value)}`)
      .join(' · ')
    return preview || '查看参数'
  }

  const compact = args.replace(/\s+/g, ' ').trim()
  return compact.length > 120 ? `${compact.slice(0, 120)}...` : compact
}

function formatToolArgumentsBlock(toolCall: ChatToolCall) {
  const args = toolCall.function?.arguments
  if (!args) {
    return '无参数'
  }
  const parsed = safeJsonParse(args)
  if (parsed) {
    return JSON.stringify(parsed, null, 2)
  }
  return args
}

function createPendingAttachment(file: File): ComposerAttachment {
  const uid = `${Date.now()}-${file.name}`
  return {
    uid,
    name: file.name,
    size: file.size,
    type: file.type,
    originFileObj: Object.assign(file, {
      uid,
      lastModifiedDate: new Date(file.lastModified),
    }) as ComposerAttachment['originFileObj'],
    status: 'done',
  } as ComposerAttachment
}

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
        <Tooltip key={item.relativePath} title={item.relativePath}>
          <Tag
            closable={removable}
            onClose={(event) => {
              event.preventDefault()
              onRemove?.(item.relativePath)
            }}
            icon={<PaperClipOutlined />}
            className="chat-attachment-tag"
          >
            {getAttachmentName(item)}
          </Tag>
        </Tooltip>
      ))}
    </div>
  )
}

function ToolCallCards({ toolCalls }: { toolCalls: ChatToolCall[] }) {
  if (!toolCalls.length) {
    return null
  }

  return (
    <div className="chat-message-meta-block">
      <div className="chat-message-meta-label">工具调用</div>
      <div className="chat-tool-call-list">
        {toolCalls.map((toolCall, index) => {
          const name = getToolCallName(toolCall)
          return (
            <details key={`${name}-${index}`} className="chat-tool-call-card">
              <summary className="chat-tool-call-summary">
                <span className="chat-tool-call-title">
                  <ToolOutlined />
                  <span>{name}</span>
                </span>
                <span className="chat-tool-call-preview">{getToolArgumentsPreview(toolCall)}</span>
              </summary>
              <pre className="chat-tool-call-pre">{formatToolArgumentsBlock(toolCall)}</pre>
            </details>
          )
        })}
      </div>
    </div>
  )
}

function buildThoughtChainItems(
  steps: ChatMessage['progressSteps'],
  status: MessageInfo<ChatMessage>['status'],
): ThoughtChainItem[] {
  const progressSteps = steps ?? []
  return progressSteps.map((step, index) => {
    const isLast = index === progressSteps.length - 1
    let itemStatus: ThoughtChainItem['status'] = 'success'
    if (status === 'loading' || status === 'updating') {
      itemStatus = isLast ? 'pending' : 'success'
    } else if (status === 'error' || status === 'abort') {
      itemStatus = isLast ? 'error' : 'success'
    }
    return {
      key: step.key,
      icon: step.kind === 'tool' ? <ToolOutlined /> : <NodeIndexOutlined />,
      title: step.kind === 'tool' ? `工具：${step.label}` : step.label,
      description: step.kind === 'tool' ? '工具调用进度' : '执行过程',
      status: itemStatus,
    }
  })
}

function ToolResultCard({ message }: { message: ChatMessage }) {
  const fullContent = String(message.content || '')
  const previewContent = truncateContent(fullContent)
  const isTruncated = previewContent !== fullContent

  return (
    <div className="chat-tool-result-card">
      <div className="chat-tool-result-head">
        <span>{message.name || 'tool'}</span>
        <span>{message.createdAt ? formatDateTimeZh(message.createdAt) : '刚刚'}</span>
      </div>
      <pre className="chat-tool-result-pre">{previewContent}</pre>
      {isTruncated ? (
        <details className="chat-tool-result-details">
          <summary className="chat-tool-result-summary">展开完整工具结果</summary>
          <pre className="chat-tool-result-pre is-expanded">{fullContent}</pre>
        </details>
      ) : null}
    </div>
  )
}

function MessageBody({ info }: { info: MessageInfo<ChatMessage> }) {
  const message = normalizeChatMessage(info.message)
  const progressSteps = message.progressSteps ?? []

  if (message.role === 'tool') {
    return <ToolResultCard message={message} />
  }

  const hasMessageContent = Boolean(String(message.content || '').trim())
  const showPlaceholderCopy =
    !hasMessageContent &&
    message.role === 'assistant' &&
    (info.status === 'loading' || info.status === 'updating')

  return (
    <div className="chat-message-stack">
      {progressSteps.length > 0 ? (
        <div className="chat-message-meta-block">
          <div className="chat-message-meta-label">执行过程</div>
          <ThoughtChain items={buildThoughtChainItems(progressSteps, info.status)} className="chat-thought-chain" />
        </div>
      ) : null}

      {message.attachments?.length ? <AttachmentTags attachments={message.attachments} /> : null}

      {hasMessageContent ? (
        <MarkdownBubble content={String(message.content ?? '')} />
      ) : showPlaceholderCopy ? (
        <div className="chat-loading-copy">正在组织回复与工具执行结果...</div>
      ) : null}

      {message.role === 'assistant' ? <ToolCallCards toolCalls={message.toolCalls || []} /> : null}
    </div>
  )
}

function getMessageTitle(message: ChatMessage) {
  if (message.role === 'user') {
    return '你'
  }
  if (message.role === 'assistant') {
    return PLATFORM_ASSISTANT_NAME
  }
  if (message.role === 'tool') {
    return message.name || 'tool'
  }
  return message.role
}

function getMessageStatusLabel(status: MessageInfo<ChatMessage>['status']) {
  if (status === 'loading' || status === 'updating') {
    return '生成中'
  }
  if (status === 'error') {
    return '回复失败'
  }
  if (status === 'abort') {
    return '已停止生成'
  }
  return '助手回复'
}

export default function ChatPage() {
  const { message, modal } = App.useApp()
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null)
  const [loadingSessions, setLoadingSessions] = useState(true)
  const [refreshingWorkspace, setRefreshingWorkspace] = useState(false)
  const [uploadingFiles, setUploadingFiles] = useState(false)
  const [workspaceData, setWorkspaceData] = useState<ChatWorkspaceData | null>(null)
  const [sessionQuery, setSessionQuery] = useState('')
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const [renameTarget, setRenameTarget] = useState<SessionSummary | null>(null)
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [composerValue, setComposerValue] = useState('')
  const [pendingAttachments, setPendingAttachments] = useState<ComposerAttachment[]>([])
  const [draftAttachmentRefs, setDraftAttachmentRefs] = useState<ChatAttachmentRef[]>([])
  const [sessionFiles, setSessionFiles] = useState<ChatUploadItem[]>([])
  const [mutatingSessionFiles, setMutatingSessionFiles] = useState(false)
  const historyRef = useRef<HTMLDivElement | null>(null)
  const chatPanelRef = useRef<HTMLDivElement | null>(null)
  const senderRef = useRef<React.ComponentRef<typeof Sender> | null>(null)
  const currentSessionIdRef = useRef<string | null>(null)
  const pendingSyncSessionIdRef = useRef<string | null>(null)
  const shouldSyncSessionRef = useRef(false)
  const wasRequestingRef = useRef(false)

  const provider = useMemo(() => createNanobotChatProvider(), [])

  const {
    messages,
    onRequest,
    onReload,
    setMessages,
    abort,
    isRequesting,
    isDefaultMessagesRequesting,
    queueRequest,
  } = useXChat<ChatMessage, ChatMessage, ChatRequestInput, SSEOutput>({
    provider,
    conversationKey: currentSessionId ?? DRAFT_SESSION_KEY,
    defaultMessages: async (info?: { conversationKey?: string }) => {
      const conversationKey = info?.conversationKey
      const sessionId = String(conversationKey || '')
      if (!sessionId || sessionId === DRAFT_SESSION_KEY) {
        return []
      }
      const data = await api.getMessages(sessionId)
      return data.map((item, index) => ({
        id: item.id || `history-${sessionId}-${index}`,
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
    requestFallback: (_requestParams, { error, errorInfo, messageInfo }) => {
      shouldSyncSessionRef.current = false
      const baseMessage = normalizeChatMessage(
        messageInfo?.message ?? {
          role: 'assistant',
          content: '',
          createdAt: new Date().toISOString(),
        },
      )

      if (error.name === 'AbortError') {
        return {
          ...baseMessage,
          content: baseMessage.content || '已停止生成，你可以继续补充要求或重新生成。',
        }
      }

      const fallbackMessage =
        errorInfo instanceof Error
          ? errorInfo.message
          : typeof errorInfo?.message === 'string'
            ? errorInfo.message
            : error.message

      return {
        ...baseMessage,
        content: baseMessage.content || fallbackMessage || '网络异常，请稍后重试',
      }
    },
  })

  const messageInfos = useMemo(() => {
    return messages.map((info) => ({
      ...info,
      message: normalizeChatMessage(info.message),
    }))
  }, [messages])

  const selectedSession = useMemo(
    () => sessions.find((item) => item.id === currentSessionId) ?? null,
    [currentSessionId, sessions],
  )
  const selectedSessionUpdatedAt = selectedSession?.updatedAt || selectedSession?.createdAt
  const selectedSessionTitle = selectedSession
    ? getDisplaySessionTitle(selectedSession.title)
    : '开始新对话'
  const selectedSessionSubtitle = selectedSessionUpdatedAt
    ? `最近更新 ${formatRelativeTimeZh(selectedSessionUpdatedAt)}`
    : '发送一条消息，或先上传文件作为对话起点。'

  const filteredSessions = useMemo(() => {
    const query = sessionQuery.trim().toLowerCase()
    if (!query) {
      return sessions
    }
    return sessions.filter((item) => {
      return `${item.title} ${getDisplaySessionTitle(item.title)} ${item.sessionId}`
        .toLowerCase()
        .includes(query)
    })
  }, [sessionQuery, sessions])

  const conversationItems = useMemo(() => {
    return filteredSessions.map((session) => ({
      key: session.id,
      group: getSessionGroup(session.updatedAt || session.createdAt),
      timestamp: new Date(session.updatedAt || session.createdAt || Date.now()).getTime(),
      label: (
        <div className="conversation-copy">
          <span className="conversation-title">{getDisplaySessionTitle(session.title)}</span>
          <span className="conversation-summary">
            {session.messageCount} 条消息
            {session.fileCount ? ` · ${session.fileCount} 个文件` : ''}
            {' · '}
            {formatRelativeTimeZh(session.updatedAt || session.createdAt)}
          </span>
        </div>
      ),
      icon: <MessageOutlined />,
    })) as Conversation[]
  }, [filteredSessions])

  const recentUploads = workspaceData?.recentUploads || []
  const showSenderHeader = pendingAttachments.length > 0 || draftAttachmentRefs.length > 0

  function buildReloadRequest(messageId: string | number) {
    if (!currentSessionId) {
      return null
    }

    const messageIndex = messageInfos.findIndex((item) => item.id === messageId)
    if (messageIndex <= 0) {
      return null
    }

    for (let index = messageIndex - 1; index >= 0; index -= 1) {
      const candidate = messageInfos[index]?.message
      if (candidate?.role !== 'user') {
        continue
      }

      const attachments = dedupeAttachmentRefs(candidate.attachments || [])
      return {
        sessionId: currentSessionId,
        displayContent: candidate.content,
        query: buildChatRequestQuery(candidate.content, attachments),
        attachments,
      }
    }

    return null
  }

  function handleReloadMessage(messageId: string | number) {
    const requestParams = buildReloadRequest(messageId)
    if (!requestParams) {
      message.error('没有找到可用于重新生成的用户提问')
      return
    }

    shouldSyncSessionRef.current = true
    pendingSyncSessionIdRef.current = requestParams.sessionId
    onReload(messageId, requestParams)
  }

  const bubbleItems = useMemo(() => {
    return messageInfos.map((info) => {
      const item = info.message
      const isUser = item.role === 'user'
      const isAssistant = item.role === 'assistant'
      const isTool = item.role === 'tool'
      const canReload = isAssistant && !isRequesting

      return {
        key: info.id,
        role: item.role,
        placement: isUser ? 'end' : 'start',
        loading:
          isAssistant &&
          (info.status === 'loading' || info.status === 'updating') &&
          !(item.progressSteps?.length || item.content),
        avatar: {
          icon: isUser ? <UserOutlined /> : isTool ? <ToolOutlined /> : <RobotOutlined />,
          style: {
            background: isUser
              ? 'var(--nb-user-avatar-bg)'
              : isTool
                ? 'color-mix(in srgb, var(--nb-accent) 70%, transparent)'
                : 'var(--nb-assistant-avatar-bg)',
          },
        },
        variant: isUser ? 'filled' : isTool ? 'outlined' : 'shadow',
        shape: 'corner',
        classNames: {
          content: [
            'bubble-content-shell',
            isUser ? 'is-user' : '',
            isTool ? 'is-tool' : '',
            isAssistant ? 'is-assistant' : '',
            info.status === 'error' ? 'is-error' : '',
            info.status === 'abort' ? 'is-abort' : '',
          ]
            .filter(Boolean)
            .join(' '),
          header: 'bubble-header-slot',
          footer: 'bubble-footer-slot',
        },
        header: (
          <div className="bubble-meta">
            <span>{getMessageTitle(item)}</span>
            <span>{item.createdAt ? formatDateTimeZh(item.createdAt) : '刚刚'}</span>
          </div>
        ),
        footer: isAssistant ? (
          <div className="bubble-footer-actions">
            <span className="bubble-footer-note">{getMessageStatusLabel(info.status)}</span>
            {canReload ? (
              <Button
                type="link"
                size="small"
                icon={<ReloadOutlined />}
                onClick={() => handleReloadMessage(info.id)}
                className="bubble-footer-button"
              >
                重新生成
              </Button>
            ) : null}
          </div>
        ) : isTool ? (
          <span className="bubble-footer-note">工具结果</span>
        ) : null,
        content: <MessageBody info={info} />,
      }
    }) as React.ComponentProps<typeof Bubble.List>['items']
  }, [isRequesting, messageInfos])

  useEffect(() => {
    currentSessionIdRef.current = currentSessionId
  }, [currentSessionId])

  useEffect(() => {
    setDraftAttachmentRefs([])
    setPendingAttachments([])
    if (!currentSessionId) {
      setSessionFiles([])
      return
    }
    void loadSessionFiles(currentSessionId)
  }, [currentSessionId])

  useEffect(() => {
    void loadSessions()
    void refreshWorkspaceData()
  }, [])

  useEffect(() => {
    historyRef.current?.scrollTo({ top: historyRef.current.scrollHeight, behavior: 'smooth' })
  }, [messageInfos, isRequesting, isDefaultMessagesRequesting])

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

  async function loadSessions(preferredSessionId?: string | null) {
    try {
      setLoadingSessions(true)
      const data = await api.getSessions()
      setSessions(data.items)
      startTransition(() => {
        setCurrentSessionId((prev) => {
          if (preferredSessionId && data.items.some((item) => item.id === preferredSessionId)) {
            return preferredSessionId
          }
          if (prev && data.items.some((item) => item.id === prev)) {
            return prev
          }
          return data.items[0]?.id ?? null
        })
      })
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载会话失败')
    } finally {
      setLoadingSessions(false)
    }
  }

  async function refreshWorkspaceData(options?: { quiet?: boolean }) {
    const quiet = Boolean(options?.quiet)
    try {
      if (quiet) {
        setRefreshingWorkspace(true)
      }
      const data = await api.getChatWorkspace()
      setWorkspaceData(data)
    } catch (error) {
      if (!quiet) {
        message.error(error instanceof Error ? error.message : '加载工作区上下文失败')
      }
    } finally {
      if (quiet) {
        setRefreshingWorkspace(false)
      }
    }
  }

  async function syncSessionAfterRequest(sessionId: string) {
    try {
      const history = await api.getMessages(sessionId)
      if (currentSessionIdRef.current === sessionId) {
        setMessages(
          history.map((item, index) => ({
            id: item.id || `history-${sessionId}-${index}`,
            message: normalizeChatMessage(item),
            status: 'success',
          })),
        )
      }
      await Promise.all([loadSessions(sessionId), loadSessionFiles(sessionId), refreshWorkspaceData({ quiet: true })])
    } catch (error) {
      message.error(error instanceof Error ? error.message : '同步会话内容失败')
    }
  }

  async function loadSessionFiles(sessionId: string) {
    try {
      const files = await api.getSessionFiles(sessionId)
      setSessionFiles(files)
      setDraftAttachmentRefs((prev) => prev.filter((item) => files.some((file) => file.relativePath === item.relativePath)))
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载会话文件失败')
    }
  }

  async function createAndSelectSession() {
    const session = await api.createSession()
    setSessions((prev) => [session, ...prev])
    currentSessionIdRef.current = session.id
    setSessionFiles([])
    startTransition(() => {
      setCurrentSessionId(session.id)
    })
    return session
  }

  async function ensureActiveSession() {
    if (currentSessionIdRef.current) {
      return currentSessionIdRef.current
    }
    const session = await createAndSelectSession()
    return session.id
  }

  async function handleCreateSession() {
    try {
      await createAndSelectSession()
    } catch (error) {
      message.error(error instanceof Error ? error.message : '创建会话失败')
    }
  }

  function openRenameModal(session: SessionSummary) {
    setRenameTarget(session)
    setRenameValue(getDisplaySessionTitle(session.title))
    setRenameOpen(true)
  }

  async function handleRenameSession() {
    if (!renameTarget || !renameValue.trim()) {
      return
    }
    try {
      const updated = await api.renameSession(renameTarget.id, renameValue.trim())
      setSessions((prev) => prev.map((item) => (item.id === updated.id ? updated : item)))
      setRenameOpen(false)
      setRenameTarget(null)
      message.success('会话已重命名')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '重命名会话失败')
    }
  }

  async function handleDeleteSession(session: SessionSummary) {
    try {
      await api.deleteSession(session.id)
      const remaining = sessions.filter((item) => item.id !== session.id)
      setSessions(remaining)
      if (currentSessionId === session.id) {
        startTransition(() => {
          setCurrentSessionId(remaining[0]?.id ?? null)
        })
      }
      message.success('会话已删除')
      await refreshWorkspaceData({ quiet: true })
    } catch (error) {
      message.error(error instanceof Error ? error.message : '删除会话失败')
    }
  }

  function confirmDeleteSession(session: SessionSummary) {
    modal.confirm({
      title: '确定删除这个会话吗？',
      content: '删除后，将移除当前工作区会话的已保存历史记录。',
      okText: '删除',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: async () => {
        await handleDeleteSession(session)
      },
    })
  }

  async function uploadAttachmentsToSession(
    sessionId: string,
    attachmentsToUpload: ComposerAttachment[],
    options?: { selectAfterUpload?: boolean; successMessage?: boolean },
  ) {
    if (!attachmentsToUpload.length) {
      return [] as ChatAttachmentRef[]
    }

    setUploadingFiles(true)
    const uploadedRefs: ChatAttachmentRef[] = []
    let uploadError: Error | null = null

    try {
      for (let index = 0; index < attachmentsToUpload.length; index += 1) {
        const attachment = attachmentsToUpload[index]
        const originFile = attachment.originFileObj
        if (!(originFile instanceof File)) {
          continue
        }

        try {
          const formData = new FormData()
          formData.append('file', originFile)
          const result = await api.uploadSessionChatFile(sessionId, formData)
          if (result.uploadedFile) {
            uploadedRefs.push(toChatAttachmentRef(result.uploadedFile))
          }
          setSessionFiles(result.sessionFiles)
          setPendingAttachments((prev) => prev.filter((item) => item.uid !== attachment.uid))
        } catch (error) {
          uploadError = error instanceof Error ? error : new Error('上传文件失败')
          break
        }
      }

      if (uploadedRefs.length) {
        if (options?.selectAfterUpload !== false) {
          setDraftAttachmentRefs((prev) => dedupeAttachmentRefs([...prev, ...uploadedRefs]))
        }
        await Promise.all([loadSessions(sessionId), refreshWorkspaceData({ quiet: true })])
        if (options?.successMessage !== false) {
          message.success(
            uploadedRefs.length === 1 ? `已上传 ${uploadedRefs[0].name}` : `已上传 ${uploadedRefs.length} 个附件`,
          )
        }
      }

      if (uploadError) {
        throw uploadError
      }

      return uploadedRefs
    } finally {
      setUploadingFiles(false)
    }
  }

  function toggleSessionFileReference(item: ChatUploadItem) {
    const attachment = toChatAttachmentRef(item)
    setDraftAttachmentRefs((prev) => {
      if (prev.some((entry) => entry.relativePath === attachment.relativePath)) {
        return prev.filter((entry) => entry.relativePath !== attachment.relativePath)
      }
      return dedupeAttachmentRefs([...prev, attachment])
    })
    senderRef.current?.focus()
  }

  async function handleImportSessionFile(item: ChatUploadItem) {
    try {
      const sessionId = await ensureActiveSession()
      setMutatingSessionFiles(true)
      const result = await api.importSessionFiles(sessionId, [item])
      setSessionFiles(result.sessionFiles)
      setDraftAttachmentRefs((prev) => dedupeAttachmentRefs([...prev, toChatAttachmentRef(item)]))
      setLibraryOpen(false)
      await loadSessions(sessionId)
      senderRef.current?.focus()
      message.success(`已将 ${item.name} 导入当前对话`)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '导入文件失败')
    } finally {
      setMutatingSessionFiles(false)
    }
  }

  async function handleSubmit(content: string) {
    const trimmed = content.trim()
    if (!trimmed || isRequesting || uploadingFiles) {
      return
    }

    try {
      let sessionId = currentSessionIdRef.current
      let createdSessionId: string | null = null
      if (!sessionId) {
        const createdSession = await createAndSelectSession()
        sessionId = createdSession.id
        createdSessionId = createdSession.id
      }

      const uploadedRefs =
        pendingAttachments.length > 0
          ? await uploadAttachmentsToSession(sessionId, pendingAttachments, {
              selectAfterUpload: false,
              successMessage: false,
            })
          : []
      const attachments = dedupeAttachmentRefs([...draftAttachmentRefs, ...uploadedRefs])

      if (!createdSessionId) {
        shouldSyncSessionRef.current = true
        pendingSyncSessionIdRef.current = sessionId
        onRequest({
          sessionId,
          displayContent: trimmed,
          query: buildChatRequestQuery(trimmed, attachments),
          attachments,
        })
      } else {
        shouldSyncSessionRef.current = true
        pendingSyncSessionIdRef.current = createdSessionId
        queueRequest(createdSessionId, {
          sessionId: createdSessionId,
          displayContent: trimmed,
          query: buildChatRequestQuery(trimmed, attachments),
          attachments,
        })
      }

      setComposerValue('')
      setDraftAttachmentRefs([])
    } catch (error) {
      if (error instanceof Error) {
        message.error(error.message)
      }
    }
  }

  return (
    <div className="chat-page-shell chat-independent-shell">
      <div className="chat-grid chat-independent-grid">
        <aside className="chat-shell-side">
          <div className="chat-rail-head">
            <div className="chat-rail-brand">
              <span className="chat-rail-brand-mark">nanobot</span>
              <span className="section-kicker">会话中心</span>
              <Text type="secondary">独立聊天工作台</Text>
            </div>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={handleCreateSession}
              data-testid={testIds.chat.newSession}
            >
              新建
            </Button>
          </div>

          <div className="chat-rail-search">
            <Input
              allowClear
              prefix={<SearchOutlined />}
              placeholder="按标题或会话 ID 搜索"
              value={sessionQuery}
              onChange={(event) => setSessionQuery(event.target.value)}
              data-testid={testIds.chat.sessionSearch}
            />
          </div>

          {loadingSessions ? (
            <div className="center-box">
              <Spin />
            </div>
          ) : filteredSessions.length === 0 ? (
            <Empty description="没有匹配的会话" className="empty-block" />
          ) : (
            <div className="conversation-list-shell">
              <Conversations
                className="conversation-list"
                items={conversationItems}
                activeKey={currentSessionId ?? undefined}
                classNames={{ item: 'conversation-list-item' }}
                groupable={{
                  title: (group) => <span className="conversation-group-title">{group}</span>,
                }}
                onActiveChange={(key) => {
                  startTransition(() => {
                    setCurrentSessionId(String(key))
                  })
                }}
                menu={(conversation) => ({
                  items: [
                    { key: 'rename', label: '重命名', icon: <EditOutlined /> },
                    { key: 'delete', label: '删除', icon: <DeleteOutlined />, danger: true },
                  ],
                  onClick: ({ key, domEvent }) => {
                    domEvent.stopPropagation()
                    const session = sessions.find((item) => item.id === conversation.key)
                    if (!session) {
                      return
                    }
                    if (key === 'rename') {
                      openRenameModal(session)
                    }
                    if (key === 'delete') {
                      confirmDeleteSession(session)
                    }
                  },
                })}
              />
            </div>
          )}
        </aside>

        <section className="chat-shell-main">
          <div className="chat-panel chat-panel-independent" ref={chatPanelRef}>
            <div className="chat-stage-header">
              <div className="chat-stage-copy">
                <span className="section-kicker">会话</span>
                <Title level={4}>{selectedSessionTitle}</Title>
                <Text type="secondary">{selectedSessionSubtitle}</Text>
              </div>
              <div className="chat-stage-actions">
                <div className="chat-stage-tags">
                  {workspaceData?.runtime.resolvedProvider ? (
                    <Tag className="chat-stage-tag">{workspaceData.runtime.resolvedProvider}</Tag>
                  ) : null}
                  {workspaceData?.runtime.model ? (
                    <Tag className="chat-stage-tag">{workspaceData.runtime.model}</Tag>
                  ) : null}
                </div>
                <Button
                  type="text"
                  icon={<ReloadOutlined />}
                  onClick={() => void refreshWorkspaceData({ quiet: true })}
                  loading={refreshingWorkspace}
                />
              </div>
            </div>

            <div className="chat-history chat-history-expanded" ref={historyRef}>
              {isDefaultMessagesRequesting ? (
                <div className="center-box">
                  <Spin />
                </div>
              ) : messageInfos.length === 0 ? (
                <div className="chat-history-empty" />
              ) : (
                <div className="chat-history-canvas" data-testid={testIds.chat.bubbleList}>
                  <Bubble.List items={bubbleItems} className="bubble-list" autoScroll />
                </div>
              )}
            </div>

            <div className="chat-composer-panel chat-composer-panel-independent">
              <div className="sender-shell" data-testid={testIds.chat.composer}>
                <Sender
                  ref={senderRef}
                  value={composerValue}
                  loading={isRequesting || uploadingFiles}
                  disabled={uploadingFiles}
                  onChange={(value) => setComposerValue(value)}
                  onSubmit={(value) => {
                    void handleSubmit(value)
                  }}
                  onCancel={abort}
                  onPasteFile={(firstFile) => {
                    setPendingAttachments((prev) => [...prev, createPendingAttachment(firstFile)])
                  }}
                  autoSize={{ minRows: 1, maxRows: 5 }}
                  placeholder={`给${PLATFORM_ASSISTANT_NAME}发送消息，或粘贴文件开始对话...`}
                  className="chat-sender"
                  header={
                    showSenderHeader ? (
                      <Sender.Header
                        open
                        title="本轮引用"
                        closable={false}
                        className="chat-sender-header"
                        classNames={{
                          header: 'chat-sender-header-head',
                          content: 'chat-sender-header-body',
                        }}
                      >
                        {draftAttachmentRefs.length ? (
                          <div className="chat-sender-section">
                            <div className="chat-inline-section-head">
                              <span>本轮引用</span>
                            </div>
                            <AttachmentTags
                              attachments={draftAttachmentRefs}
                              removable
                              onRemove={(relativePath) => {
                                setDraftAttachmentRefs((prev) =>
                                  prev.filter((item) => item.relativePath !== relativePath),
                                )
                              }}
                            />
                          </div>
                        ) : null}
                        {pendingAttachments.length > 0 ? (
                          <div className="chat-sender-section">
                            <div className="chat-inline-section-head">
                              <span>待上传文件</span>
                            </div>
                            <Attachments
                              items={pendingAttachments}
                              multiple
                              disabled={uploadingFiles}
                              overflow="scrollX"
                              beforeUpload={() => false}
                              onChange={({ fileList }) => setPendingAttachments(fileList)}
                            />
                          </div>
                        ) : null}
                      </Sender.Header>
                    ) : null
                  }
                  prefix={
                    <span className="chat-sender-prefix-actions">
                      <span data-testid={testIds.chat.fileInput}>
                        <Attachments
                          items={pendingAttachments}
                          multiple
                          disabled={uploadingFiles}
                          beforeUpload={() => false}
                          onChange={({ fileList }) => setPendingAttachments(fileList)}
                          getDropContainer={() => chatPanelRef.current}
                          placeholder={{
                            icon: <CloudUploadOutlined />,
                            title: '拖拽文件到这里',
                            description: '发送时自动上传。',
                          }}
                        >
                          <Button
                            type="text"
                            icon={<LinkOutlined />}
                            className="chat-attach-trigger"
                            disabled={uploadingFiles}
                            data-testid={testIds.chat.uploadFile}
                          />
                        </Attachments>
                      </span>
                      <Button
                        type="text"
                        className="chat-import-trigger"
                        icon={<PaperClipOutlined />}
                        onClick={() => setLibraryOpen(true)}
                        disabled={mutatingSessionFiles || recentUploads.length === 0}
                      >
                        导入文件
                      </Button>
                    </span>
                  }
                  footer={
                    <div className="composer-footer">
                      <div className="composer-footer-copy">
                        <Text type="secondary">
                          {uploadingFiles
                            ? '附件上传中...'
                            : pendingAttachments.length
                              ? `按 Enter 发送，${pendingAttachments.length} 个附件会随消息一并上传。`
                              : 'Enter 发送，Shift + Enter 换行。'}
                        </Text>
                      </div>
                      <div className="composer-footer-actions" />
                    </div>
                  }
                />
              </div>
            </div>
          </div>
        </section>
      </div>

      <Modal
        title="从文件库导入"
        open={libraryOpen}
        footer={null}
        onCancel={() => setLibraryOpen(false)}
      >
        {recentUploads.length === 0 ? (
          <Empty description="文件库里还没有可导入的最近文件" className="empty-block" />
        ) : (
          <div className="chat-library-list">
            {recentUploads.map((item) => {
              const alreadyInSession = sessionFiles.some((entry) => entry.relativePath === item.relativePath)
              return (
                <div key={item.relativePath} className="chat-library-item">
                  <div className="chat-library-item-copy">
                    <strong>{item.name}</strong>
                    <span>
                      {item.relativePath} · {formatFileSize(item.sizeBytes)}
                    </span>
                  </div>
                  <div className="chat-library-item-actions">
                    {alreadyInSession ? (
                      <Button size="small" onClick={() => toggleSessionFileReference(item)}>
                        加入本轮引用
                      </Button>
                    ) : (
                      <Button
                        size="small"
                        type="primary"
                        loading={mutatingSessionFiles}
                        onClick={() => {
                          void handleImportSessionFile(item)
                        }}
                      >
                        导入到对话
                      </Button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </Modal>

      <Modal
        title="重命名会话"
        open={renameOpen}
        onCancel={() => {
          setRenameOpen(false)
          setRenameTarget(null)
        }}
        onOk={() => void handleRenameSession()}
        okText="保存"
      >
        <Input
          value={renameValue}
          onChange={(event) => setRenameValue(event.target.value)}
          placeholder="输入会话标题"
          maxLength={80}
        />
      </Modal>
    </div>
  )
}
