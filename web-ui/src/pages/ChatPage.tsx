import { startTransition, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import {
  App,
  Button,
  Card,
  Empty,
  Input,
  Modal,
  Select,
  Spin,
  Tag,
  Typography,
} from 'antd'
import { Attachments, Bubble, Conversations, Prompts, Sender, ThoughtChain, Welcome } from '@ant-design/x'
import type { Conversation, PromptProps, ThoughtChainItem } from '@ant-design/x'
import { useXChat, type MessageInfo, type SSEOutput } from '@ant-design/x-sdk'
import {
  CloudUploadOutlined,
  DeleteOutlined,
  EditOutlined,
  LinkOutlined,
  MessageOutlined,
  NodeIndexOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
  ToolOutlined,
  UserOutlined,
} from '@ant-design/icons'
import { RobotOutlined } from '@ant-design/icons'
import { api } from '../api'
import { PLATFORM_ASSISTANT_NAME } from '../branding'
import ChatFileCards from '../chat/ChatFileCards'
import ChatMarkdown from '../chat/ChatMarkdown'
import { createNanobotChatProvider } from '../chat/NanobotChatProvider'
import ChatToolExecutionCards, { type ToolExecutionEntry } from '../chat/ChatToolExecutionCards'
import {
  buildChatRequestQuery,
  dedupeAttachmentRefs,
  normalizeChatMessage,
  toChatAttachmentRef,
} from '../chat/chatMessageUtils'
import { buildToolExecutionState } from '../chat/chatToolExecutionState'
import { formatDateTimeZh, formatRelativeTimeZh } from '../locale'
import { testIds } from '../testIds'
import type {
  ChatAttachmentRef,
  ChatMessage,
  ChatRequestInput,
  ChatWorkspaceData,
  SessionSummary,
} from '../types'

const { Text, Title } = Typography
const DRAFT_SESSION_KEY = '__draft__'
const TOOL_RESULT_PREVIEW_LIMIT = 1400
const SESSION_PAGE_SIZE = 20

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

function getAgentName(
  agentId: string | null | undefined,
  agents: ChatWorkspaceData['availableAgents'],
) {
  if (!agentId) {
    return '工作区默认助手'
  }
  return agents.find((item) => item.agentId === agentId)?.name || agentId
}

function toStringList(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => String(item || '').trim()).filter(Boolean)
    : []
}

function getMessageBindingSummary(message: ChatMessage) {
  const bindings =
    message.appliedBindings && typeof message.appliedBindings === 'object'
      ? message.appliedBindings as Record<string, unknown>
      : {}
  return {
    knowledgeBindingIds: toStringList(bindings.knowledgeBindingIds),
    mcpServerIds: toStringList(bindings.mcpServerIds),
    toolAllowlist: toStringList(bindings.toolAllowlist),
  }
}

function appendComposerValue(value: string, next: string) {
  if (!value.trim()) {
    return next
  }
  return `${value.trim()}\n${next}`
}

function truncateContent(content: string, limit = TOOL_RESULT_PREVIEW_LIMIT) {
  if (content.length <= limit) {
    return content
  }
  return `${content.slice(0, limit)}\n\n...`
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
  return <ChatMarkdown content={content} />
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
    <ChatFileCards items={attachments} variant={removable ? 'draft' : 'message'} removable={removable} onRemove={onRemove} />
  )
}

function RecentUploadActions({
  uploads,
  variant = 'inline',
  onReference,
  onInsertPath,
}: {
  uploads: ChatWorkspaceData['recentUploads']
  variant?: 'inline' | 'welcome'
  onReference: (attachment: ChatAttachmentRef) => void
  onInsertPath: (relativePath: string) => void
}) {
  if (!uploads.length) {
    return null
  }

  const visibleUploads = uploads.slice(0, variant === 'welcome' ? 4 : 3).map(toChatAttachmentRef)

  return (
    <div className={['chat-recent-uploads', variant === 'welcome' ? 'is-welcome' : 'is-inline'].join(' ')}>
      <div className="chat-inline-section-head">
        <span>{variant === 'welcome' ? '从最近文件开始' : '最近文件'}</span>
        <Text type="secondary">
          {variant === 'welcome'
            ? '直接把文件加入上下文，或者插入路径继续提问。'
            : '只保留和当前对话最相关的文件入口。'}
        </Text>
      </div>
      <ChatFileCards items={visibleUploads} variant="recent" onReference={onReference} onInsertPath={onInsertPath} />
    </div>
  )
}

function ToolExecutionSummary({ entries }: { entries: ToolExecutionEntry[] }) {
  if (!entries.length) {
    return null
  }

  return (
    <div className="chat-message-meta-block">
      <div className="chat-message-meta-label">工具执行</div>
      <ChatToolExecutionCards entries={entries} />
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
  return (
    <div className="chat-tool-result-card">
      <div className="chat-tool-result-head">
        <span>{message.name || 'tool'}</span>
        <span>{message.createdAt ? formatDateTimeZh(message.createdAt) : '刚刚'}</span>
      </div>
      <pre className="chat-tool-result-pre">{truncateContent(String(message.content || ''))}</pre>
    </div>
  )
}

function MessageBody({ info, toolExecutions }: { info: MessageInfo<ChatMessage>; toolExecutions?: ToolExecutionEntry[] }) {
  const message = normalizeChatMessage(info.message)
  const progressSteps = message.progressSteps ?? []
  const bindingSummary = getMessageBindingSummary(message)
  const hasBindingSummary =
    Boolean(message.resolvedModel)
    || bindingSummary.knowledgeBindingIds.length > 0
    || bindingSummary.mcpServerIds.length > 0
    || bindingSummary.toolAllowlist.length > 0

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

      {message.role === 'assistant' && message.citations?.length ? (
        <div className="chat-message-meta-block">
          <div className="chat-message-meta-label">参考来源</div>
          <div className="chat-rail-tag-list">
            {message.citations.map((citation, index) => (
              <Tag key={`${citation.kbId}-${citation.docId}-${citation.chunkOrdinal ?? index}`} className="chat-stage-tag">
                {citation.title || citation.fileName || citation.docId}
              </Tag>
            ))}
          </div>
        </div>
      ) : null}

      {message.role === 'assistant' && hasBindingSummary ? (
        <div className="chat-message-meta-block">
          <div className="chat-message-meta-label">本次绑定</div>
          <div className="chat-rail-tag-list">
            <Tag className="chat-stage-tag">{message.resolvedModel || '默认模型'}</Tag>
            <Tag className="chat-stage-tag">知识库 {bindingSummary.knowledgeBindingIds.length}</Tag>
            <Tag className="chat-stage-tag">MCP {bindingSummary.mcpServerIds.length}</Tag>
            <Tag className="chat-stage-tag">工具 {bindingSummary.toolAllowlist.length}</Tag>
          </div>
          {bindingSummary.knowledgeBindingIds.length > 0 ? (
            <Text type="secondary">知识库：{bindingSummary.knowledgeBindingIds.join('、')}</Text>
          ) : null}
          {bindingSummary.mcpServerIds.length > 0 ? (
            <Text type="secondary">MCP：{bindingSummary.mcpServerIds.join('、')}</Text>
          ) : null}
        </div>
      ) : null}

      {message.role === 'assistant' && toolExecutions?.length ? <ToolExecutionSummary entries={toolExecutions} /> : null}
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
  const [loadingMoreSessions, setLoadingMoreSessions] = useState(false)
  const [sessionTotal, setSessionTotal] = useState(0)
  const [sessionPage, setSessionPage] = useState(1)
  const [refreshingWorkspace, setRefreshingWorkspace] = useState(false)
  const [uploadingFiles, setUploadingFiles] = useState(false)
  const [workspaceData, setWorkspaceData] = useState<ChatWorkspaceData | null>(null)
  const [sessionQuery, setSessionQuery] = useState('')
  const [sessionAgentFilter, setSessionAgentFilter] = useState<string>('all')
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const [renameTarget, setRenameTarget] = useState<SessionSummary | null>(null)
  const [composerValue, setComposerValue] = useState('')
  const [pendingAttachments, setPendingAttachments] = useState<ComposerAttachment[]>([])
  const [draftAttachmentRefs, setDraftAttachmentRefs] = useState<ChatAttachmentRef[]>([])
  const [draftAgentId, setDraftAgentId] = useState<string | null>(null)
  const chatPanelRef = useRef<HTMLDivElement | null>(null)
  const senderRef = useRef<React.ComponentRef<typeof Sender> | null>(null)
  const currentSessionIdRef = useRef<string | null>(null)
  const pendingSyncSessionIdRef = useRef<string | null>(null)
  const shouldSyncSessionRef = useRef(false)
  const wasRequestingRef = useRef(false)
  const deferredSessionQuery = useDeferredValue(sessionQuery)

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
  const toolExecutionState = useMemo(() => buildToolExecutionState(messageInfos), [messageInfos])

  const selectedSession = useMemo(
    () => sessions.find((item) => item.id === currentSessionId) ?? null,
    [currentSessionId, sessions],
  )
  const selectedSessionUpdatedAt = selectedSession?.updatedAt || selectedSession?.createdAt
  const selectedSessionTitle = selectedSession
    ? getDisplaySessionTitle(selectedSession.title)
    : '开始一个新的工作区会话'
  const availableAgents = workspaceData?.availableAgents || []
  const selectedSessionAgentName = getAgentName(selectedSession?.agentId, availableAgents)
  const draftAgentName = getAgentName(draftAgentId, availableAgents)
  const selectedRuntimeAgent = useMemo(
    () => availableAgents.find((item) => item.agentId === (selectedSession?.agentId || draftAgentId)) ?? null,
    [availableAgents, draftAgentId, selectedSession?.agentId],
  )
  const latestAssistantMessage = useMemo(
    () => [...messageInfos].reverse().map((item) => item.message).find((item) => item.role === 'assistant') ?? null,
    [messageInfos],
  )
  const latestBindingSummary = useMemo(
    () => (latestAssistantMessage ? getMessageBindingSummary(latestAssistantMessage) : null),
    [latestAssistantMessage],
  )
  const headerKnowledgeIds = latestBindingSummary?.knowledgeBindingIds.length
    ? latestBindingSummary.knowledgeBindingIds
    : selectedRuntimeAgent?.knowledgeBindingIds || []
  const headerMcpIds = latestBindingSummary?.mcpServerIds.length
    ? latestBindingSummary.mcpServerIds
    : selectedRuntimeAgent?.mcpServerIds || []
  const headerModelLabel =
    latestAssistantMessage?.resolvedModel
    || selectedRuntimeAgent?.chatModelSelection?.qualifiedModelName
    || workspaceData?.runtime.model
    || '默认模型'

  const filteredSessions = useMemo(() => {
    const query = deferredSessionQuery.trim().toLowerCase()
    return sessions.filter((item) => {
      const matchesQuery = !query
        || `${item.title} ${getDisplaySessionTitle(item.title)} ${item.sessionId}`.toLowerCase().includes(query)
      const matchesAgent = sessionAgentFilter === 'all'
        || (sessionAgentFilter === DRAFT_SESSION_KEY ? !item.agentId : item.agentId === sessionAgentFilter)
      return matchesQuery && matchesAgent
    })
  }, [deferredSessionQuery, sessionAgentFilter, sessions])

  const conversationItems = useMemo(() => {
      return filteredSessions.map((session) => ({
      key: session.id,
      group: getSessionGroup(session.updatedAt || session.createdAt),
      timestamp: new Date(session.updatedAt || session.createdAt || Date.now()).getTime(),
      label: (
        <div className="conversation-copy">
          <span className="conversation-title">{getDisplaySessionTitle(session.title)}</span>
          <span className="conversation-summary">
            {getAgentName(session.agentId, availableAgents)} · {session.messageCount} 条消息 · {formatRelativeTimeZh(session.updatedAt || session.createdAt)}
          </span>
        </div>
      ),
      icon: <MessageOutlined />,
    })) as Conversation[]
  }, [availableAgents, filteredSessions])

  const quickPromptItems = useMemo(() => {
    return (workspaceData?.quickPrompts || []).map((prompt: string, index: number) => ({
      key: `prompt-${index}`,
      icon: <MessageOutlined />,
      label: prompt,
      description: '一键填入输入框，作为下一步协作起点。',
    })) as PromptProps[]
  }, [workspaceData])
  const recentUploads = workspaceData?.recentUploads || []
  const activeMcp = workspaceData?.activeMcp || []

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

  async function handleCopyMessage(content: string) {
    const trimmed = content.trim()
    if (!trimmed) {
      return
    }
    if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
      message.error('当前环境暂不支持复制')
      return
    }
    try {
      await navigator.clipboard.writeText(trimmed)
      message.success('已复制消息内容')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '复制失败')
    }
  }

  const bubbleItems = useMemo(() => {
    return messageInfos
      .filter((info) => !toolExecutionState.hiddenToolMessageIds.has(info.id))
      .map((info) => {
      const item = info.message
      const isUser = item.role === 'user'
      const isAssistant = item.role === 'assistant'
      const isTool = item.role === 'tool'
      const canReload = isAssistant && !isRequesting
      const canCopy = Boolean(String(item.content || '').trim())
      const canAbort = isAssistant && (info.status === 'loading' || info.status === 'updating') && isRequesting
      const toolExecutions = toolExecutionState.byAssistantId.get(info.id) || []

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
            {canCopy ? (
              <Button
                type="link"
                size="small"
                onClick={() => void handleCopyMessage(String(item.content || ''))}
                className="bubble-footer-button"
              >
                复制
              </Button>
            ) : null}
            {canAbort ? (
              <Button type="link" size="small" onClick={abort} className="bubble-footer-button">
                停止
              </Button>
            ) : null}
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
        ) : isUser ? (
          <div className="bubble-footer-actions">
            {canCopy ? (
              <Button
                type="link"
                size="small"
                onClick={() => void handleCopyMessage(String(item.content || ''))}
                className="bubble-footer-button"
              >
                复制
              </Button>
            ) : null}
          </div>
        ) : isTool ? (
          <div className="bubble-footer-actions">
            <span className="bubble-footer-note">工具结果</span>
            {canCopy ? (
              <Button
                type="link"
                size="small"
                onClick={() => void handleCopyMessage(String(item.content || ''))}
                className="bubble-footer-button"
              >
                复制
              </Button>
            ) : null}
          </div>
        ) : null,
        content: <MessageBody info={info} toolExecutions={toolExecutions} />,
      }
    }) as React.ComponentProps<typeof Bubble.List>['items']
  }, [abort, isRequesting, messageInfos, toolExecutionState])

  useEffect(() => {
    currentSessionIdRef.current = currentSessionId
  }, [currentSessionId])

  useEffect(() => {
    void loadSessions()
    void refreshWorkspaceData()
  }, [])

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

  async function loadSessions(options?: { preferredSessionId?: string | null; append?: boolean; page?: number }) {
    const append = Boolean(options?.append)
    const page = options?.page ?? 1
    try {
      if (append) {
        setLoadingMoreSessions(true)
      } else {
        setLoadingSessions(true)
      }
      const data = await api.getSessions(page, SESSION_PAGE_SIZE)
      setSessionTotal(data.total)
      setSessionPage(data.page)
      setSessions((prev) => {
        if (!append) {
          return data.items
        }
        const seen = new Set(prev.map((item) => item.id))
        return [...prev, ...data.items.filter((item) => !seen.has(item.id))]
      })
      if (!append) {
        startTransition(() => {
          setCurrentSessionId((prev) => {
            if (options?.preferredSessionId && data.items.some((item) => item.id === options.preferredSessionId)) {
              return options.preferredSessionId
            }
            if (prev && data.items.some((item) => item.id === prev)) {
              return prev
            }
            return data.items[0]?.id ?? null
          })
        })
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载会话失败')
    } finally {
      if (append) {
        setLoadingMoreSessions(false)
      } else {
        setLoadingSessions(false)
      }
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
      await Promise.all([loadSessions({ preferredSessionId: sessionId }), refreshWorkspaceData({ quiet: true })])
    } catch (error) {
      message.error(error instanceof Error ? error.message : '同步会话内容失败')
    }
  }

  async function handleLoadMoreSessions() {
    if (loadingMoreSessions || sessions.length >= sessionTotal) {
      return
    }
    await loadSessions({
      append: true,
      page: sessionPage + 1,
      preferredSessionId: currentSessionIdRef.current,
    })
  }

  async function handleCreateSession() {
    try {
      const session = await api.createSession(undefined, draftAgentId)
      setSessions((prev) => [session, ...prev])
      setSessionTotal((prev) => prev + 1)
      startTransition(() => {
        setCurrentSessionId(session.id)
      })
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
      setSessionTotal((prev) => Math.max(0, prev - 1))
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

  async function uploadPendingAttachments() {
    if (!pendingAttachments.length) {
      return [] as ChatAttachmentRef[]
    }

    setUploadingFiles(true)
    const uploadedRefs: ChatAttachmentRef[] = []
    let uploadError: Error | null = null

    try {
      for (let index = 0; index < pendingAttachments.length; index += 1) {
        const attachment = pendingAttachments[index]
        const originFile = attachment.originFileObj
        if (!(originFile instanceof File)) {
          continue
        }

        try {
          const formData = new FormData()
          formData.append('file', originFile)
          const uploaded = await api.uploadChatFile(formData)
          uploadedRefs.push(toChatAttachmentRef(uploaded))
          setPendingAttachments((prev) => prev.filter((item) => item.uid !== attachment.uid))
        } catch (error) {
          uploadError = error instanceof Error ? error : new Error('上传文件失败')
          break
        }
      }

      if (uploadedRefs.length) {
        setDraftAttachmentRefs((prev) => dedupeAttachmentRefs([...prev, ...uploadedRefs]))
        await refreshWorkspaceData({ quiet: true })
        message.success(
          uploadedRefs.length === 1 ? `已上传 ${uploadedRefs[0].name}` : `已上传 ${uploadedRefs.length} 个附件`,
        )
      }

      if (uploadError) {
        throw uploadError
      }

      return uploadedRefs
    } finally {
      setUploadingFiles(false)
    }
  }

  function handleInsertPrompt(prompt: string) {
    setComposerValue((prev) => appendComposerValue(prev, prompt))
    senderRef.current?.focus()
  }

  function handleReferenceUpload(item: ChatAttachmentRef) {
    setDraftAttachmentRefs((prev) => dedupeAttachmentRefs([...prev, item]))
    senderRef.current?.focus()
  }

  function handleInsertUploadPath(relativePath: string) {
    setComposerValue((prev) => appendComposerValue(prev, relativePath))
    senderRef.current?.focus()
  }

  async function handleSubmit(content: string) {
    const trimmed = content.trim()
    if (!trimmed || isRequesting || uploadingFiles) {
      return
    }

    try {
      const uploadedRefs = pendingAttachments.length > 0 ? await uploadPendingAttachments() : []
      const attachments = dedupeAttachmentRefs([...draftAttachmentRefs, ...uploadedRefs])

      if (currentSessionId) {
        shouldSyncSessionRef.current = true
        pendingSyncSessionIdRef.current = currentSessionId
        onRequest({
          sessionId: currentSessionId,
          displayContent: trimmed,
          query: buildChatRequestQuery(trimmed, attachments),
          attachments,
        })
      } else {
        const session = await api.createSession(undefined, draftAgentId)
        setSessions((prev) => [session, ...prev])
        setSessionTotal((prev) => prev + 1)
        shouldSyncSessionRef.current = true
        pendingSyncSessionIdRef.current = session.id
        queueRequest(session.id, {
          sessionId: session.id,
          displayContent: trimmed,
          query: buildChatRequestQuery(trimmed, attachments),
          attachments,
        })
        startTransition(() => {
          setCurrentSessionId(session.id)
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
    <div className="page-stack chat-page-shell">
      <div className="page-grid chat-grid">
        <Card className="sidebar-card sidebar-surface chat-rail-card" styles={{ body: { padding: 0 } }}>
          <div className="chat-rail-head">
            <div>
              <span className="section-kicker">会话中心</span>
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

          <div className="chat-rail-search">
            <div className="chat-inline-section-head" style={{ marginBottom: 8 }}>
              <span>新会话绑定</span>
              <Text type="secondary">选择后，新建会话和首次提问都会自动使用对应 Agent。</Text>
            </div>
            <Select
              allowClear
              value={draftAgentId ?? undefined}
              placeholder="工作区默认助手"
              style={{ width: '100%' }}
              options={availableAgents.map((agent) => ({
                value: agent.agentId,
                label: `${agent.name} · KB ${agent.knowledgeBindingIds.length} · MCP ${agent.mcpServerIds.length}`,
              }))}
              onChange={(value) => setDraftAgentId(value || null)}
            />
          </div>

          <div className="chat-rail-search">
            <div className="chat-inline-section-head" style={{ marginBottom: 8 }}>
              <span>会话筛选</span>
              <Text type="secondary">按 Agent 查看已加载会话，可继续加载更多历史。</Text>
            </div>
            <Select
              value={sessionAgentFilter}
              style={{ width: '100%' }}
              options={[
                { value: 'all', label: '全部会话' },
                { value: DRAFT_SESSION_KEY, label: '工作区默认助手' },
                ...availableAgents.map((agent) => ({
                  value: agent.agentId,
                  label: agent.name,
                })),
              ]}
              onChange={(value) => setSessionAgentFilter(value)}
            />
          </div>

          {activeMcp.length > 0 ? (
            <div className="chat-rail-meta-section">
              <div className="chat-inline-section-head">
                <span>当前连接能力</span>
                <Text type="secondary">优先展示当前工作区可直接使用的连接。</Text>
              </div>
              <div className="chat-rail-tag-list">
                {activeMcp.slice(0, 4).map((item) => (
                  <Tag key={item.name} className="chat-stage-tag">
                    {item.displayName}
                  </Tag>
                ))}
              </div>
            </div>
          ) : null}

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

          {sessions.length < sessionTotal ? (
            <div className="chat-rail-load-more">
              <Text type="secondary">已加载 {sessions.length} / {sessionTotal} 个会话</Text>
              <Button size="small" onClick={() => void handleLoadMoreSessions()} loading={loadingMoreSessions}>
                加载更多
              </Button>
            </div>
          ) : null}
        </Card>

        <Card className="chat-card surface-card chat-session-card" styles={{ body: { padding: 0, height: '100%' } }}>
          <div className="chat-panel" ref={chatPanelRef}>
            <div className="chat-stage-header">
              <div className="chat-stage-copy">
                <span className="section-kicker">当前会话</span>
                <Title level={4}>{selectedSessionTitle}</Title>
                <Text type="secondary">
                  {selectedSession
                    ? `当前绑定：${selectedSessionAgentName} · 最后更新于 ${formatRelativeTimeZh(selectedSessionUpdatedAt)}。`
                    : `下一次新会话将使用：${draftAgentName}。直接开始输入，系统会自动创建新会话。`}
                </Text>
                <div className="chat-stage-tags" style={{ marginTop: 12 }}>
                  <Tag className="chat-stage-tag">{headerModelLabel}</Tag>
                  <Tag className="chat-stage-tag">知识库 {headerKnowledgeIds.length}</Tag>
                  <Tag className="chat-stage-tag">MCP {headerMcpIds.length}</Tag>
                  {latestAssistantMessage?.citations?.length ? (
                    <Tag className="chat-stage-tag">引用 {latestAssistantMessage.citations.length}</Tag>
                  ) : null}
                </div>
                {headerKnowledgeIds.length > 0 || headerMcpIds.length > 0 ? (
                  <Text type="secondary">
                    {headerKnowledgeIds.length > 0 ? `知识库：${headerKnowledgeIds.join('、')}` : '知识库：未绑定'}
                    {headerMcpIds.length > 0 ? ` · MCP：${headerMcpIds.join('、')}` : ''}
                  </Text>
                ) : null}
              </div>
              <div className="chat-stage-actions">
                <div className="chat-stage-tags">
                  <Tag className="chat-stage-tag">{selectedSession ? selectedSessionAgentName : draftAgentName}</Tag>
                </div>
                {workspaceData?.runtime.model ? (
                  <div className="chat-stage-tags">
                    <Tag className="chat-stage-tag">{workspaceData.runtime.model}</Tag>
                  </div>
                ) : null}
                <Button
                  type="text"
                  icon={<ReloadOutlined />}
                  onClick={() => void refreshWorkspaceData({ quiet: true })}
                  loading={refreshingWorkspace}
                />
              </div>
            </div>

            <div className="chat-history chat-history-expanded">
              {isDefaultMessagesRequesting ? (
                <div className="center-box">
                  <Spin />
                </div>
              ) : messageInfos.length === 0 ? (
                <div className="chat-empty-state chat-empty-state-compact">
                    <Welcome
                      variant="borderless"
                      icon={<RobotOutlined />}
                      title={selectedSession ? `继续 ${selectedSessionAgentName} 的对话` : `开始一个由 ${draftAgentName} 驱动的新会话`}
                      description="把问题、文件和必要上下文放进同一个输入区，系统会沿用当前 Agent 绑定的模型、MCP 和知识库。"
                    extra={
                      <div className="chat-empty-extra">
                        {quickPromptItems.length > 0 ? (
                          <Prompts
                            items={quickPromptItems}
                            wrap
                            className="chat-welcome-prompts"
                            onItemClick={({ data }) => handleInsertPrompt(String(data.label || ''))}
                          />
                        ) : null}
                        {recentUploads.length > 0 ? (
                          <RecentUploadActions
                            uploads={recentUploads}
                            variant="welcome"
                            onReference={handleReferenceUpload}
                            onInsertPath={handleInsertUploadPath}
                          />
                        ) : null}
                      </div>
                    }
                  />
                </div>
              ) : (
                <div className="chat-history-canvas" data-testid={testIds.chat.bubbleList}>
                  <Bubble.List items={bubbleItems} className="bubble-list" />
                </div>
              )}
            </div>

            <div className="chat-composer-panel">
              {pendingAttachments.length > 0 ? (
                <div className="composer-pending-attachments">
                  <div className="chat-inline-section-head">
                    <span>待发送附件</span>
                    <Text type="secondary">发送时会自动上传到当前工作区。</Text>
                  </div>
                  <div>
                    <Attachments
                      items={pendingAttachments}
                      multiple
                      disabled={uploadingFiles}
                      overflow="scrollX"
                      beforeUpload={() => false}
                      onChange={({ fileList }) => setPendingAttachments(fileList)}
                    />
                  </div>
                </div>
              ) : null}

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
                  placeholder={`输入你的问题，或让${PLATFORM_ASSISTANT_NAME}协调多Agent检查、规划、评审当前工作区...`}
                  className="chat-sender"
                  prefix={
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
                          description: '支持文档、图片、代码等，发送时自动上传。',
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
                  }
                  footer={
                    <div className="composer-footer">
                      <div className="composer-footer-copy">
                        <Text type="secondary">
                          {uploadingFiles
                            ? '正在上传附件，请稍候...'
                            : pendingAttachments.length
                            ? `发送时将自动上传 ${pendingAttachments.length} 个附件。Enter 发送，Shift + Enter 换行。`
                            : 'Enter 发送，Shift + Enter 换行。也可以直接拖拽或粘贴文件。'}
                        </Text>
                      </div>
                      <div className="composer-footer-actions">
                        {draftAttachmentRefs.length ? (
                          <AttachmentTags
                            attachments={draftAttachmentRefs}
                            removable
                            onRemove={(relativePath) => {
                              setDraftAttachmentRefs((prev) =>
                                prev.filter((item) => item.relativePath !== relativePath),
                              )
                            }}
                          />
                        ) : null}
                      </div>
                    </div>
                  }
                />
              </div>
            </div>
          </div>
        </Card>
      </div>

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
