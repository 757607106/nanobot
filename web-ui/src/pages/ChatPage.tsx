import type { ComponentProps, ComponentRef } from 'react'
import { ErrorBoundary } from '../components/ErrorBoundary'
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

import { useChatSession } from '../chat/useChatSession'

const { Title, Text } = Typography
const { Content, Sider } = Layout

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
  const [sessionQuery, setSessionQuery] = useState('')
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const [renameTarget, setRenameTarget] = useState<SessionSummary | null>(null)
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [composerValue, setComposerValue] = useState('')
  const [agents, setAgents] = useState<AgentDefinition[]>([])
  const [loadingAgents, setLoadingAgents] = useState(false)
  const [switchAgentOpen, setSwitchAgentOpen] = useState(false)
  const [switchAgentQuery, setSwitchAgentQuery] = useState('')

  const chatPanelRef = useRef<HTMLDivElement | null>(null)
  const senderRef = useRef<ComponentRef<typeof ChatInput> | null>(null)

  const {
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
  } = useChatSession({ agentId })

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

  function openRenameModal(session: SessionSummary) {
    setRenameTarget(session)
    setRenameValue(getDisplaySessionTitle(session.title))
    setRenameOpen(true)
  }

  async function submitRename() {
    if (!renameTarget || !renameValue.trim()) return
    const success = await handleRenameSession(renameTarget, renameValue.trim())
    if (success) {
      setRenameOpen(false)
      setRenameTarget(null)
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
    resetSessionState()

    if (target === 'platform') {
      navigate('/chat')
      return
    }

    navigate(`/studio/agents/${encodeURIComponent(target)}/chat`)
  }

  async function executeSubmit(content: string) {
    const success = await handleSubmit(content)
    if (success) {
      setComposerValue('')
    }
  }

  async function doHandleImportSessionFile(item: ChatUploadItem) {
    const success = await handleImportSessionFile(item)
    if (success) {
      setLibraryOpen(false)
      if (senderRef.current && 'focus' in senderRef.current && typeof senderRef.current.focus === 'function') {
        ;(senderRef.current as { focus: () => void }).focus()
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
            onSubmit={executeSubmit}
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
    <ErrorBoundary>
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
                          void doHandleImportSessionFile(item)
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
        onOk={() => void submitRename()}
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
    </ErrorBoundary>
  )
}
