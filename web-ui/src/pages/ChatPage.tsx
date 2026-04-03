import type { ComponentProps, ComponentRef } from 'react'
import { ErrorBoundary } from '../components/ErrorBoundary'
import { useEffect, useMemo, useRef, useState } from 'react'
import { App, Button, Flex, Grid, Input, Layout, Modal, Select, Space, Tag, Typography, theme } from 'antd'
import { ReloadOutlined, RobotOutlined, SearchOutlined, SwapOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { PLATFORM_ASSISTANT_NAME } from '../branding'
import { getDisplaySessionTitle } from '../chat/chatPresentation'
import { ChatSidebar } from '../chat/ChatSidebar'
import { ChatMessages } from '../chat/ChatMessages'
import { ChatInput } from '../chat/ChatInput'
import '../chat/chat.css'
import { formatRelativeTimeZh } from '../locale'
import { testIds } from '../testIds'
import type {
  AgentDefinition,
  SessionSummary,
} from '../types'
import { useToast } from '../toast'
import { useChatSession } from '../chat/useChatSession'

const { Title, Text } = Typography
const { Content, Sider } = Layout

const SESSION_RAIL_WIDTH = 352

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
  const [composerValue, setComposerValue] = useState('')
  const [agents, setAgents] = useState<AgentDefinition[]>([])
  const [loadingAgents, setLoadingAgents] = useState(false)

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
    pendingAttachments,
    setPendingAttachments,
    draftAttachmentRefs,
    setDraftAttachmentRefs,
    handleCreateSession,
    handleRenameSession,
    handleDeleteSession,
    handleReloadMessage,
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
    : ''

  const assistantLabel = inAgentMode
    ? String(activeAgent?.name || agentId || '智能体')
    : PLATFORM_ASSISTANT_NAME

  const isDesktopLayout = Boolean(screens.lg)

  // Agent picker options for the Select component
  const agentSelectOptions = useMemo(() => {
    const opts = [
      {
        value: 'platform',
        label: `${PLATFORM_ASSISTANT_NAME}（通用）`,
      },
      ...agents
        .filter((item) => item.enabled)
        .map((item) => ({
          value: item.agentId,
          label: item.name || item.agentId,
        })),
    ]
    return opts
  }, [agents])

  const currentAgentValue = inAgentMode ? agentId : 'platform'

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
          message.error(error instanceof Error ? error.message : '加载智能体失败')
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
      message.error(error instanceof Error ? error.message : '加载智能体失败')
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

  function handleSwitchAgent(target: string) {
    if (isRequesting) {
      abort()
    }
    resetSessionState()

    if (target === 'platform') {
      navigate('/chat')
      return
    }

    navigate(`/chat/agent/${encodeURIComponent(target)}`)
  }

  async function executeSubmit(content: string) {
    const success = await handleSubmit(content)
    if (success) {
      setComposerValue('')
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
      <div
        style={{
          height: '100%',
          minHeight: isDesktopLayout ? 0 : 680,
          borderRadius: token.borderRadiusLG + 8,
          background: token.colorBgContainer,
          border: `1px solid ${token.colorBorderSecondary}`,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* ── Header bar ── */}
        <Flex
          justify="space-between"
          align="center"
          gap={12}
          style={{
            padding: isDesktopLayout ? '14px 20px' : '12px 16px',
            borderBottom: `1px solid ${token.colorBorderSecondary}`,
            flexShrink: 0,
          }}
        >
          <Flex align="center" gap={12} style={{ flex: 1, minWidth: 0 }}>
            <Flex vertical gap={2} style={{ minWidth: 0 }}>
              <Title level={5} style={{ margin: 0, fontSize: 15 }} ellipsis>
                {selectedSessionTitle}
              </Title>
              {selectedSessionSubtitle ? (
                <Text type="secondary" style={{ fontSize: 11 }}>{selectedSessionSubtitle}</Text>
              ) : null}
            </Flex>
          </Flex>

          <Flex align="center" gap={8}>
            {/* Agent switcher — inline Select */}
            <Select
              value={currentAgentValue}
              onChange={handleSwitchAgent}
              loading={loadingAgents || loadingActiveAgent}
              options={agentSelectOptions}
              suffixIcon={<SwapOutlined />}
              popupMatchSelectWidth={false}
              style={{ minWidth: 140, maxWidth: 220 }}
              size="middle"
              data-testid={testIds.chat.switchAgent}
              optionRender={(option) => (
                <Flex align="center" gap={8}>
                  <RobotOutlined style={{ color: token.colorTextSecondary, fontSize: 13 }} />
                  <span>{option.label}</span>
                  {option.value === currentAgentValue ? (
                    <Tag color="blue" style={{ marginLeft: 'auto', fontSize: 10 }}>当前</Tag>
                  ) : null}
                </Flex>
              )}
            />
            <Button
              type="text"
              icon={<ReloadOutlined />}
              onClick={() => void refreshWorkspaceData({ quiet: true })}
              loading={refreshingWorkspace}
              aria-label="刷新工作区"
            />
          </Flex>
        </Flex>

        {/* ── Messages area ── */}
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
            dropContainerRef={chatPanelRef}
            isDesktopLayout={isDesktopLayout}
          />
        </Flex>
      </div>
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
