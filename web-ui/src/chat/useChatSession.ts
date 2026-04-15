import { startTransition, useEffect, useMemo, useRef, useState } from 'react'
import { useXChat, type SSEOutput } from '@ant-design/x-sdk'
import { api } from '../api'
import { createNanobotChatProvider } from './NanobotChatProvider'
import {
  buildChatRequestQuery,
  dedupeAttachmentRefs,
  normalizeChatMessage,
  toChatAttachmentRef,
} from './chatMessageUtils'
import type {
  ChatAttachmentRef,
  ChatMessage,
  ChatRequestInput,
  ChatUploadItem,
  ChatWorkspaceData,
  SessionSummary,
} from '../types'
import { useToast } from '../toast'

export const DRAFT_SESSION_KEY = '__draft__'

export type ComposerAttachment = any

export interface UseChatSessionOptions {
  agentId?: string
}

export function useChatSession({ agentId }: UseChatSessionOptions = {}) {
  const message = useToast()
  const inAgentMode = Boolean(agentId)

  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null)
  const [loadingSessions, setLoadingSessions] = useState(true)
  const [refreshingWorkspace, setRefreshingWorkspace] = useState(false)
  const [uploadingFiles, setUploadingFiles] = useState(false)
  const [workspaceData, setWorkspaceData] = useState<ChatWorkspaceData | null>(null)
  const [pendingAttachments, setPendingAttachments] = useState<ComposerAttachment[]>([])
  const [draftAttachmentRefs, setDraftAttachmentRefs] = useState<ChatAttachmentRef[]>([])
  const [sessionFiles, setSessionFiles] = useState<ChatUploadItem[]>([])
  const [mutatingSessionFiles, setMutatingSessionFiles] = useState(false)

  const currentSessionIdRef = useRef<string | null>(null)
  const pendingSyncSessionIdRef = useRef<string | null>(null)
  const shouldSyncSessionRef = useRef(false)
  const wasRequestingRef = useRef(false)
  const setMessagesRef = useRef<any>(() => { /* placeholder */ })

  const provider = useMemo(() => {
    if (!inAgentMode) {
      return createNanobotChatProvider()
    }
    return createNanobotChatProvider({
      url: '/api/v1/agents/messages?stream=1',
      agentId,
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
        id: item.id ? `h_${item.id}` : `${inAgentMode ? 'agent' : 'history'}-${sessionId}-${index}`,
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

  // Keep setMessages ref in sync so the init effect doesn't depend on its identity
  useEffect(() => {
    setMessagesRef.current = setMessages
  }, [setMessages])

  useEffect(() => {
    currentSessionIdRef.current = null
    pendingSyncSessionIdRef.current = null
    shouldSyncSessionRef.current = false
    startTransition(() => {
      setCurrentSessionId(null)
    })
    setSessions([])
    setMessagesRef.current([])
    setSessionFiles([])
    setDraftAttachmentRefs([])
    setPendingAttachments([])
    void loadSessions()
    void refreshWorkspaceData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        // Preserve streaming-accumulated data that the server doesn't have:
        // - progressSteps (tool/thinking chain, purely client-side)
        // - reasoningContent (streaming accumulates ALL iterations; server may only have the last)
        // - content (streaming accumulates ALL iterations)
        const lastStreamingAssistant = [...messages].reverse().find(
          (m) => m.message?.role === 'assistant'
        )?.message

        const serverItems = history.map((item, index) => ({
          id: item.id ? `h_${item.id}` : `${inAgentMode ? 'agent' : 'history'}-${sessionId}-${index}`,
          message: normalizeChatMessage(item),
          status: 'success' as const,
        }))

        // Merge streaming enrichments into the FIRST server assistant message.
        // ChatMessages.tsx groups consecutive assistant+tool messages into one Bubble,
        // using the FIRST assistant as the primary (whose progressSteps/content/reasoning are rendered).
        // Streaming accumulates everything into a single message; the server splits into per-iteration messages.
        // We must put the accumulated data on the FIRST assistant so the grouping primary has it.
        if (lastStreamingAssistant) {
          const streamSubMessages = Array.isArray((lastStreamingAssistant as any)._subMessages)
            ? ((lastStreamingAssistant as any)._subMessages as ChatMessage[])
            : [lastStreamingAssistant]
          const streamFinalContent = [...streamSubMessages]
            .reverse()
            .find((m) => m.role === 'assistant' && m.content?.trim())
            ?.content || ''

          for (let i = 0; i < serverItems.length; i++) {
            if (serverItems[i].message.role === 'assistant') {
              const serverMsg = serverItems[i].message
              const streamSteps = lastStreamingAssistant.progressSteps || []
              const streamReasoning = lastStreamingAssistant.reasoningContent || ''
              const serverReasoning = serverMsg.reasoningContent || ''
              const serverContent = serverMsg.content || ''

              serverItems[i] = {
                ...serverItems[i],
                message: normalizeChatMessage({
                  ...serverMsg,
                  // Prefer persisted server content; only fallback to stream value when missing.
                  content: serverContent.trim() ? serverContent : streamFinalContent,
                  reasoningContent: serverReasoning.trim() ? serverReasoning : streamReasoning,
                  // Server never has progressSteps; always use the streaming version
                  progressSteps: streamSteps.length > 0 ? streamSteps : (serverMsg.progressSteps || []),
                }),
              }
              break  // only merge into the first assistant message
            }
          }
        }

        setMessages(serverItems)
      }
      await Promise.all([loadSessions(sessionId), loadSessionFiles(sessionId), refreshWorkspaceData({ quiet: true })])

      // Auto-rename: if session still has default title, use first user message
      void autoRenameSessionIfNeeded(sessionId, history)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '同步会话内容失败')
    }
  }

  async function autoRenameSessionIfNeeded(sessionId: string, history: ChatMessage[]) {
    try {
      const session = sessions.find((s) => s.id === sessionId)
      if (!session) return
      const title = session.title
      // Only auto-rename if still default title
      if (title && title !== 'New Chat') return

      // Find first user message to derive title
      const firstUserMsg = history.find((m) => m.role === 'user')
      if (!firstUserMsg?.content) return

      const raw = String(firstUserMsg.content).replace(/\s+/g, ' ').trim()
      if (!raw) return

      const newTitle = raw.length > 40 ? `${raw.slice(0, 40)}...` : raw
      if (inAgentMode && agentId) {
        await api.renameAgentSession(agentId, sessionId, newTitle)
      } else {
        await api.renameSession(sessionId, newTitle)
      }
      setSessions((prev) =>
        prev.map((s) => (s.id === sessionId ? { ...s, title: newTitle } : s)),
      )
    } catch {
      // Silent failure — auto-rename is best-effort
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

  async function handleRenameSession(target: SessionSummary, newTitle: string) {
    try {
      const updated =
        inAgentMode && agentId
          ? await api.renameAgentSession(agentId, target.id, newTitle)
          : await api.renameSession(target.id, newTitle)
      setSessions((prev) => prev.map((item) => (item.id === updated.id ? updated : item)))
      message.success('会话已重命名')
      return true
    } catch (error) {
      message.error(error instanceof Error ? error.message : '重命名会话失败')
      return false
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

  function resetSessionState() {
    currentSessionIdRef.current = null
    pendingSyncSessionIdRef.current = null
    shouldSyncSessionRef.current = false
    setSessions([])
    setMessages([])
    setSessionFiles([])
    setDraftAttachmentRefs([])
    setPendingAttachments([])
    startTransition(() => {
      setCurrentSessionId(null)
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
      await loadSessions(sessionId)
      message.success(`已将 ${item.name} 导入当前对话`)
      return true
    } catch (error) {
      message.error(error instanceof Error ? error.message : '导入文件失败')
      return false
    } finally {
      setMutatingSessionFiles(false)
    }
  }

  async function handleSubmit(content: string, options?: { reasoningEffort?: 'low' | 'medium' | 'high' | null }) {
    const trimmed = content.trim()
    if (!trimmed || isRequesting || uploadingFiles) {
      return
    }

    const reasoningEffort = options?.reasoningEffort ?? null

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
          reasoningEffort,
        })
      } else {
        shouldSyncSessionRef.current = true
        pendingSyncSessionIdRef.current = createdSessionId
        queueRequest(createdSessionId, {
          sessionId: createdSessionId,
          displayContent: trimmed,
          query: buildChatRequestQuery(trimmed, attachments),
          attachments,
          reasoningEffort,
        })
      }

      setDraftAttachmentRefs([])
      return true
    } catch (error) {
      if (error instanceof Error) {
        message.error(error.message)
      }
      return false
    }
  }

  return {
    sessions,
    currentSessionId,
    setCurrentSessionId,
    loadingSessions,
    messages: messageInfos,
    isRequesting,
    isDefaultMessagesRequesting,
    abort,
    workspaceData,
    refreshingWorkspace,
    refreshWorkspaceData,
    uploadingFiles,
    sessionFiles,
    mutatingSessionFiles,
    pendingAttachments,
    setPendingAttachments,
    draftAttachmentRefs,
    setDraftAttachmentRefs,
    handleCreateSession,
    handleRenameSession,
    handleDeleteSession,
    handleReloadMessage,
    uploadAttachmentsToSession,
    toggleSessionFileReference,
    handleImportSessionFile,
    handleSubmit,
    resetSessionState,
  }
}
