import type { ComponentProps, ComponentRef } from 'react'
import { startTransition, useEffect, useMemo, useRef, useState } from 'react'
import { App, Button, Card, Empty, Flex, Grid, Input, Layout, List, Modal, Space, Tag, Typography, theme } from 'antd'
import type { Conversation } from '@ant-design/x'
import { useXChat, type MessageInfo, type SSEOutput } from '@ant-design/x-sdk'
import { ReloadOutlined, RobotOutlined, SearchOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { PLATFORM_ASSISTANT_NAME } from '../branding'
import { createNanobotChatProvider } from '../chat/NanobotChatProvider'
import { getDisplaySessionTitle } from '../chat/chatPresentation'
import {
  buildChatRequestQuery,
  dedupeAttachmentRefs,
  normalizeChatMessage,
  toChatAttachmentRef,
} from '../chat/chatMessageUtils'
import { ChatSidebar } from '../chat/ChatSidebar'
import { ChatMessages } from '../chat/ChatMessages'
import { ChatInput } from '../chat/ChatInput'
import '../chat/chat.css'
import { formatRelativeTimeZh } from '../locale'
import { testIds } from '../testIds'
import type {
  AgentDefinition,
  ChatAttachmentRef,
  ChatMessage,
  ChatRequestInput,
  ChatUploadItem,
  ChatWorkspaceData,
  SessionSummary,
} from '../types'
import { useToast } from '../toast'

const { Title, Text } = Typography
const { Content, Sider } = Layout

const DRAFT_SESSION_KEY = '__draft__'
const SESSION_RAIL_WIDTH = 352

type ComposerAttachment = NonNullable<ComponentProps<typeof ChatInput>['pendingAttachments']>[number]

type AgentPickerOption = {
  key: string
  title: string
  description: string
  active: boolean
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

export default function ChatPage({ agentId }: { agentId?: string } = {}) {
  const { modal } = App.useApp()
  const message = useToast()
  const { token } = theme.useToken()
  const screens = Grid.useBreakpoint()
  const navigate = useNavigate()
  const inAgentMode = Boolean(agentId)

  const [activeAgent, setActiveAgent] = useState<AgentDefinition | null>(null)
  const [loadingActiveAgent, setLoadingActiveAgent] = useState(false)
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
  const [agents, setAgents] = useState<AgentDefinition[]>([])
  const [loadingAgents, setLoadingAgents] = useState(false)
  const [switchAgentOpen, setSwitchAgentOpen] = useState(false)
  const [switchAgentQuery, setSwitchAgentQuery] = useState('')

  const chatPanelRef = useRef<HTMLDivElement | null>(null)
  const senderRef = useRef<ComponentRef<typeof ChatInput> | null>(null)
  const currentSessionIdRef = useRef<string | null>(null)
  const pendingSyncSessionIdRef = useRef<string | null>(null)
  const shouldSyncSessionRef = useRef(false)
  const wasRequestingRef = useRef(false)

  const provider = useMemo(() => {
    if (!inAgentMode) {
      return createNanobotChatProvider()
    }
    return createNanobotChatProvider({
      buildMessagesPath: (requestParams) => {
        const resolvedAgentId = String(requestParams.agentId || agentId || '').trim()
        const sessionId = String(requestParams.sessionId || '').trim()
        return `/api/v1/agents/${encodeURIComponent(resolvedAgentId)}/sessions/${encodeURIComponent(sessionId)}/messages?stream=1`
      },
    })
  }, [agentId, inAgentMode])

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
      const data = inAgentMode && agentId ? await api.getAgentMessages(agentId, sessionId) : await api.getMessages(sessionId)
      return data.map((item, index) => ({
        id: item.id || `${inAgentMode ? 'agent' : 'history'}-${sessionId}-${index}`,
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
  const selectedSessionTitle = selectedSession ? getDisplaySessionTitle(selectedSession.title) : '开始新对话'
  const selectedSessionSubtitle = selectedSessionUpdatedAt
    ? `最近更新 ${formatRelativeTimeZh(selectedSessionUpdatedAt)}`
    : '发送一条消息，或先上传文件作为对话起点。'

  const assistantLabel = inAgentMode
    ? String(activeAgent?.name || agentId || '自定义 Agent')
    : PLATFORM_ASSISTANT_NAME

  const recentUploads = workspaceData?.recentUploads || []
  const isDesktopLayout = Boolean(screens.lg)
  const surfaceRadius = token.borderRadiusLG + 8

  const agentPickerOptions = useMemo(() => {
    const query = switchAgentQuery.trim().toLowerCase()
    const options: AgentPickerOption[] = [
      {
        key: 'platform',
        title: `${PLATFORM_ASSISTANT_NAME}（通用聊天）`,
        description: '使用默认平台助手',
        active: !inAgentMode,
      },
      ...agents
        .filter((item) => item.enabled)
        .map((item) => ({
          key: item.agentId,
          title: item.name || item.agentId,
          description: item.description || item.agentId,
          active: item.agentId === agentId,
        })),
    ]

    if (!query) {
      return options
    }

    return options.filter((item) => `${item.title} ${item.description}`.toLowerCase().includes(query))
  }, [agentId, agents, inAgentMode, switchAgentQuery])

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
    void refreshWorkspaceData({ quiet: true })
  }, [agentId, currentSessionId])

  useEffect(() => {
    currentSessionIdRef.current = null
    pendingSyncSessionIdRef.current = null
    shouldSyncSessionRef.current = false
    startTransition(() => {
      setCurrentSessionId(null)
    })
    setSessions([])
    setMessages([])
    setSessionFiles([])
    setDraftAttachmentRefs([])
    setPendingAttachments([])
    setComposerValue('')
    void loadSessions()
    void refreshWorkspaceData()
  }, [agentId, setMessages])

  useEffect(() => {
    let cancelled = false

    async function loadActiveAgent() {
      if (!agentId) {
        setActiveAgent(null)
        return
      }
      try {
        setLoadingActiveAgent(true)
        const data = await api.getAgent(agentId)
        if (!cancelled) {
          setActiveAgent(data)
        }
      } catch (error) {
        if (!cancelled) {
          setActiveAgent(null)
          message.error(error instanceof Error ? error.message : '加载 Agent 失败')
        }
      } finally {
        if (!cancelled) {
          setLoadingActiveAgent(false)
        }
      }
    }

    void loadActiveAgent()

    return () => {
      cancelled = true
    }
  }, [agentId, message])

  useEffect(() => {
    void refreshAgentsList()
  }, [message])

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

  async function refreshAgentsList() {
    try {
      setLoadingAgents(true)
      setAgents(await api.getAgents(true))
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载 Agent 失败')
    } finally {
      setLoadingAgents(false)
    }
  }

  async function loadSessions(preferredSessionId?: string | null) {
    try {
      setLoadingSessions(true)
      const data = inAgentMode && agentId ? await api.listAgentSessions(agentId) : await api.getSessions()
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
      if (inAgentMode && agentId) {
        const sessionId = currentSessionIdRef.current
        if (!sessionId) {
          const fallback = await api.getChatWorkspace()
          setWorkspaceData({ ...fallback, recentUploads: [] })
          return
        }
        const data = await api.getAgentChatWorkspace(agentId, sessionId)
        setWorkspaceData(data)
        return
      }
      setWorkspaceData(await api.getChatWorkspace())
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
      const history = inAgentMode && agentId ? await api.getAgentMessages(agentId, sessionId) : await api.getMessages(sessionId)
      if (currentSessionIdRef.current === sessionId) {
        setMessages(
          history.map((item, index) => ({
            id: item.id || `${inAgentMode ? 'agent' : 'history'}-${sessionId}-${index}`,
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
      const files = inAgentMode && agentId ? await api.getAgentSessionFiles(agentId, sessionId) : await api.getSessionFiles(sessionId)
      setSessionFiles(files)
      setDraftAttachmentRefs((prev) => prev.filter((item) => files.some((file) => file.relativePath === item.relativePath)))
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载会话文件失败')
    }
  }

  async function createAndSelectSession() {
    const session = inAgentMode && agentId ? await api.createAgentSession(agentId) : await api.createSession()
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
      const updated =
        inAgentMode && agentId
          ? await api.renameAgentSession(agentId, renameTarget.id, renameValue.trim())
          : await api.renameSession(renameTarget.id, renameValue.trim())
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
      if (inAgentMode && agentId) {
        await api.deleteAgentSession(agentId, session.id)
      } else {
        await api.deleteSession(session.id)
      }
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

  function handleSwitchTarget(target: string) {
    setSwitchAgentOpen(false)
    if (isRequesting) {
      abort()
    }
    currentSessionIdRef.current = null
    pendingSyncSessionIdRef.current = null
    shouldSyncSessionRef.current = false
    setSessions([])
    setMessages([])
    setSessionFiles([])
    setDraftAttachmentRefs([])
    setPendingAttachments([])
    setComposerValue('')
    startTransition(() => {
      setCurrentSessionId(null)
    })

    if (target === 'platform') {
      navigate('/chat')
      return
    }

    navigate(`/studio/agents/${encodeURIComponent(target)}/chat`)
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
          const result =
            inAgentMode && agentId
              ? await api.uploadAgentSessionChatFile(agentId, sessionId, formData)
              : await api.uploadSessionChatFile(sessionId, formData)
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
    if (senderRef.current && 'focus' in senderRef.current && typeof senderRef.current.focus === 'function') {
      ;(senderRef.current as { focus: () => void }).focus()
    }
  }

  async function handleImportSessionFile(item: ChatUploadItem) {
    try {
      const sessionId = await ensureActiveSession()
      setMutatingSessionFiles(true)
      const result =
        inAgentMode && agentId
          ? await api.importAgentSessionFiles(agentId, sessionId, [item])
          : await api.importSessionFiles(sessionId, [item])
      setSessionFiles(result.sessionFiles)
      setDraftAttachmentRefs((prev) => dedupeAttachmentRefs([...prev, toChatAttachmentRef(item)]))
      setLibraryOpen(false)
      await loadSessions(sessionId)
      if (senderRef.current && 'focus' in senderRef.current && typeof senderRef.current.focus === 'function') {
        ;(senderRef.current as { focus: () => void }).focus()
      }
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

  const sessionRail = (
    <ChatSidebar
      sessions={sessions}
      activeSessionId={currentSessionId}
      loading={loadingSessions}
      sessionQuery={sessionQuery}
      onSessionQueryChange={setSessionQuery}
      onSessionSelect={(id) => setCurrentSessionId(id)}
      onNewSession={handleCreateSession}
      onRenameSession={openRenameModal}
      onDeleteSession={confirmDeleteSession}
      isDesktopLayout={isDesktopLayout}
    />
  )

  const workspacePanel = (
    <div ref={chatPanelRef} style={{ height: '100%' }}>
      <Card
        styles={{
          body: {
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
            height: '100%',
            padding: 0,
          },
        }}
        style={{
          height: '100%',
          minHeight: isDesktopLayout ? 0 : 680,
          borderRadius: surfaceRadius,
        }}
      >
        <Flex
          justify="space-between"
          align={isDesktopLayout ? 'flex-start' : 'stretch'}
          gap={16}
          wrap="wrap"
          style={{
            padding: isDesktopLayout ? 24 : 20,
            borderBottom: `1px solid ${token.colorBorderSecondary}`,
          }}
        >
          <Flex vertical gap={6} flex={1} style={{ minWidth: 0 }}>
            <Text
              type="secondary"
              style={{
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
              }}
            >
              会话
            </Text>
            <Title level={4} style={{ margin: 0 }}>
              {selectedSessionTitle}
            </Title>
            <Text type="secondary">{selectedSessionSubtitle}</Text>
          </Flex>

          <Space wrap>
            <Button
              icon={<RobotOutlined />}
              loading={loadingAgents || loadingActiveAgent}
              onClick={() => {
                setSwitchAgentQuery('')
                setSwitchAgentOpen(true)
                void refreshAgentsList()
              }}
              data-testid={testIds.chat.switchAgent}
            >
              {inAgentMode ? activeAgent?.name || '自定义Agent' : '切换 Agent'}
            </Button>
            <Button
              type="text"
              icon={<ReloadOutlined />}
              onClick={() => void refreshWorkspaceData({ quiet: true })}
              loading={refreshingWorkspace}
              aria-label="刷新工作区"
            />
          </Space>
        </Flex>

        <Flex vertical style={{ flex: 1, minHeight: 0 }}>
          <ChatMessages
            messageInfos={messageInfos}
            currentSessionId={currentSessionId}
            isRequesting={isRequesting}
            isLoadingMessages={isDefaultMessagesRequesting}
            assistantLabel={assistantLabel}
            quickPrompts={workspaceData?.quickPrompts}
            onReloadMessage={handleReloadMessage}
            onQuickPromptClick={(prompt) => {
              setComposerValue(prompt)
              if (senderRef.current && 'focus' in senderRef.current && typeof senderRef.current.focus === 'function') {
                ;(senderRef.current as { focus: () => void }).focus()
              }
            }}
            isDesktopLayout={isDesktopLayout}
          />

          <ChatInput
            ref={senderRef}
            value={composerValue}
            onChange={setComposerValue}
            onSubmit={handleSubmit}
            onCancel={abort}
            isRequesting={isRequesting}
            uploadingFiles={uploadingFiles}
            assistantLabel={assistantLabel}
            pendingAttachments={pendingAttachments}
            onPendingAttachmentsChange={setPendingAttachments}
            draftAttachmentRefs={draftAttachmentRefs}
            onDraftAttachmentRefsChange={setDraftAttachmentRefs}
            sessionFiles={sessionFiles}
            recentUploads={recentUploads}
            onOpenLibrary={() => setLibraryOpen(true)}
            onToggleSessionFile={toggleSessionFileReference}
            dropContainerRef={chatPanelRef}
            isDesktopLayout={isDesktopLayout}
          />
        </Flex>
      </Card>
    </div>
  )

  return (
    <Layout className="page-stack" style={{ minHeight: 0, height: '100%', background: 'transparent' }}>
      {isDesktopLayout ? (
        <Layout hasSider style={{ flex: 1, minHeight: 0, gap: 16, background: 'transparent' }}>
          <Sider
            width={SESSION_RAIL_WIDTH}
            theme="light"
            style={{
              background: 'transparent',
            }}
          >
            {sessionRail}
          </Sider>
          <Content style={{ minWidth: 0, background: 'transparent' }}>
            {workspacePanel}
          </Content>
        </Layout>
      ) : (
        <Layout style={{ flex: 1, minHeight: 0, background: 'transparent' }}>
          <Content style={{ background: 'transparent' }}>
            <Flex vertical gap={16}>
              {sessionRail}
              {workspacePanel}
            </Flex>
          </Content>
        </Layout>
      )}

      <Modal
        title="切换到自定义Agent"
        open={switchAgentOpen}
        onCancel={() => setSwitchAgentOpen(false)}
        footer={null}
      >
        <Flex vertical gap={12}>
          <Input
            allowClear
            prefix={<SearchOutlined />}
            placeholder="搜索员工"
            value={switchAgentQuery}
            onChange={(event) => setSwitchAgentQuery(event.target.value)}
          />
          <List
            rowKey="key"
            dataSource={agentPickerOptions}
            renderItem={(item) => (
              <List.Item
                key={item.key}
                onClick={() => handleSwitchTarget(item.key)}
                extra={item.active ? <Tag color="blue">当前</Tag> : null}
                style={{ cursor: 'pointer' }}
              >
                <List.Item.Meta title={item.title} description={item.description} />
              </List.Item>
            )}
          />
        </Flex>
      </Modal>

      <Modal
        title="历史文件"
        open={libraryOpen}
        footer={null}
        onCancel={() => setLibraryOpen(false)}
      >
        {recentUploads.length === 0 ? (
          <Empty description="文件库里还没有可导入的最近文件" />
        ) : (
          <List
            rowKey="relativePath"
            itemLayout="horizontal"
            dataSource={recentUploads}
            renderItem={(item) => {
              const alreadyInSession = sessionFiles.some((entry) => entry.relativePath === item.relativePath)
              return (
                <List.Item
                  actions={[
                    alreadyInSession ? (
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
                    ),
                  ]}
                >
                  <List.Item.Meta
                    title={item.name}
                    description={`${item.relativePath} · ${formatFileSize(item.sizeBytes)}`}
                  />
                </List.Item>
              )
            }}
          />
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
          placeholder="会话标题"
          maxLength={80}
        />
      </Modal>
    </Layout>
  )
}
