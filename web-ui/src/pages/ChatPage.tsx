import { useEffect, useMemo, useRef, useState } from 'react'
import {
  App,
  Button,
  Card,
  Empty,
  Input,
  Modal,
  Spin,
  Typography,
} from 'antd'
import { Bubble, Conversations, Sender } from '@ant-design/x'
import type { Conversation } from '@ant-design/x'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  DeleteOutlined,
  EditOutlined,
  MessageOutlined,
  PlusOutlined,
  SearchOutlined,
  UserOutlined,
} from '@ant-design/icons'
import { RobotOutlined } from '@ant-design/icons'
import { api } from '../api'
import PageHero from '../components/PageHero'
import { formatDateTimeZh, formatRelativeTimeZh } from '../locale'
import type { ChatMessage, SessionSummary, StreamEvent } from '../types'

const { Text } = Typography

const starterPrompts = [
  '总结当前工作区状态，并给出最值得优先处理的下一步任务。',
  '检查当前配置，指出最重要的风险或缺失项。',
  '在不改动 agent 核心流程的前提下，规划一个清晰的重构方案。',
]

function getDisplaySessionTitle(title?: string) {
  if (!title || title === 'New Chat') {
    return '新会话'
  }
  return title
}

function isDefaultSessionTitle(title?: string) {
  return !title || title === 'New Chat' || title === '新会话'
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

function MarkdownBubble({ content }: { content: string }) {
  return (
    <div className="markdown-bubble">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  )
}

function buildBubbleItems(messages: ChatMessage[]) {
  return messages.map((message) => {
    const isUser = message.role === 'user'
    const title = isUser ? '你' : message.role === 'assistant' ? 'nanobot' : message.role
    return {
      key: message.id,
      role: message.role,
      placement: isUser ? 'end' : 'start',
      avatar: {
        icon: isUser ? <UserOutlined /> : <RobotOutlined />,
        style: {
          background: isUser
            ? 'var(--nb-user-avatar-bg)'
            : 'var(--nb-assistant-avatar-bg)',
        },
      },
      variant: isUser ? 'filled' : 'shadow',
      shape: 'corner',
      classNames: {
        content: `bubble-content-shell ${isUser ? 'is-user' : 'is-assistant'}`,
        header: 'bubble-header-slot',
        footer: 'bubble-footer-slot',
      },
      header: (
        <div className="bubble-meta">
          <span>{title}</span>
          <span>{formatDateTimeZh(message.createdAt)}</span>
        </div>
      ),
      footer: !isUser ? <span className="bubble-footer-note">助手回复</span> : null,
      content: <MarkdownBubble content={String(message.content ?? '')} />,
    }
  }) as React.ComponentProps<typeof Bubble.List>['items']
}

export default function ChatPage() {
  const { message, modal } = App.useApp()
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [loadingSessions, setLoadingSessions] = useState(true)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [sending, setSending] = useState(false)
  const [progressEvents, setProgressEvents] = useState<string[]>([])
  const [sessionQuery, setSessionQuery] = useState('')
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const [renameTarget, setRenameTarget] = useState<SessionSummary | null>(null)
  const historyRef = useRef<HTMLDivElement | null>(null)

  const selectedSession = useMemo(
    () => sessions.find((item) => item.id === currentSessionId) ?? null,
    [currentSessionId, sessions],
  )
  const selectedSessionUpdatedAt = selectedSession?.updatedAt || selectedSession?.createdAt
  const selectedSessionTitle = selectedSession
    ? getDisplaySessionTitle(selectedSession.title)
    : '开始一个新的工作区会话'

  const filteredSessions = useMemo(() => {
    const query = sessionQuery.trim().toLowerCase()
    if (!query) {
      return sessions
    }
    return sessions.filter((item) => {
      return `${item.title} ${getDisplaySessionTitle(item.title)} ${item.sessionId}`.toLowerCase().includes(query)
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
            {session.messageCount} 条消息 · {formatRelativeTimeZh(session.updatedAt || session.createdAt)}
          </span>
        </div>
      ),
      icon: <MessageOutlined />,
    })) as Conversation[]
  }, [filteredSessions])

  const bubbleItems = useMemo(() => buildBubbleItems(messages), [messages])

  useEffect(() => {
    void loadSessions()
  }, [])

  useEffect(() => {
    if (!currentSessionId) {
      setMessages([])
      return
    }
    void loadMessages(currentSessionId)
  }, [currentSessionId])

  useEffect(() => {
    historyRef.current?.scrollTo({ top: historyRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, progressEvents])

  async function loadSessions() {
    try {
      setLoadingSessions(true)
      const data = await api.getSessions()
      setSessions(data.items)
      setCurrentSessionId((prev) => prev ?? data.items[0]?.id ?? null)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载会话失败')
    } finally {
      setLoadingSessions(false)
    }
  }

  async function loadMessages(sessionId: string) {
    try {
      setLoadingMessages(true)
      const data = await api.getMessages(sessionId)
      setMessages(data)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载消息失败')
    } finally {
      setLoadingMessages(false)
    }
  }

  async function ensureSession() {
    if (currentSessionId) {
      return currentSessionId
    }
    const session = await api.createSession()
    setSessions((prev) => [session, ...prev])
    setCurrentSessionId(session.id)
    return session.id
  }

  async function handleCreateSession() {
    try {
      const session = await api.createSession()
      setSessions((prev) => [session, ...prev])
      setCurrentSessionId(session.id)
      setMessages([])
      setProgressEvents([])
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
        setCurrentSessionId(remaining[0]?.id ?? null)
        setMessages([])
      }
      message.success('会话已删除')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '删除会话失败')
    }
  }

  function confirmDeleteSession(session: SessionSummary) {
    modal.confirm({
      title: '确定删除这个会话吗？',
      content: '删除后，将移除当前选中网页会话的已保存历史记录。',
      okText: '删除',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: async () => {
        await handleDeleteSession(session)
      },
    })
  }

  async function handleSubmit(content: string) {
    const trimmed = content.trim()
    if (!trimmed || sending) {
      return
    }

    const sessionId = await ensureSession()
    const optimisticUserMessage: ChatMessage = {
      id: `local-${Date.now()}`,
      sessionId,
      sequence: messages.length + 1,
      role: 'user',
      content: trimmed,
      createdAt: new Date().toISOString(),
    }

    setMessages((prev) => [...prev, optimisticUserMessage])
    setSending(true)
    setProgressEvents([])

    try {
      await api.sendMessageStream(sessionId, trimmed, (event: StreamEvent) => {
        if (event.type === 'progress') {
          setProgressEvents((prev) => [...prev.slice(-4), event.content])
          return
        }
        if (event.type === 'done' && event.assistantMessage) {
          setMessages((prev) => [...prev, event.assistantMessage!])
          setProgressEvents([])
          setSessions((prev) =>
            prev.map((item) =>
              item.id === sessionId
                ? {
                    ...item,
                    messageCount: item.messageCount + 2,
                    updatedAt: new Date().toISOString(),
                    title: isDefaultSessionTitle(item.title) ? trimmed.slice(0, 48) : item.title,
                  }
                : item,
            ),
          )
        }
      })
    } catch (error) {
      setMessages((prev) => prev.filter((item) => item.id !== optimisticUserMessage.id))
      message.error(error instanceof Error ? error.message : '发送消息失败')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="page-stack">
      <PageHero
        className="page-hero-compact"
        eyebrow="工作区对话"
        title="围绕工作区持续协作，而不是临时聊天"
        description="当前页面专门面向真实任务推进。会话会保存在工作区内，方便继续追问、迭代方案和承接上下文。"
        stats={[
          { label: '会话总数', value: sessions.length },
          { label: '当前会话', value: selectedSession ? selectedSession.id.slice(0, 8) : '待创建' },
          { label: '消息数', value: messages.length },
          { label: '状态', value: sending ? '生成中' : selectedSession ? '就绪' : '待开始' },
        ]}
      />

      <div className="page-grid chat-grid chat-grid-enhanced">
        <Card className="sidebar-card sidebar-surface chat-rail-card" styles={{ body: { padding: 0 } }}>
          <div className="chat-rail-head">
            <div>
              <span className="section-kicker">工作区会话</span>
              <Typography.Title level={4}>对话列表</Typography.Title>
              <Text type="secondary">所有网页会话都会保存在当前工作区，可持续追踪与继续处理。</Text>
            </div>
            <Button type="primary" icon={<PlusOutlined />} onClick={handleCreateSession}>
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
            />
          </div>

          <div className="conversation-stats-row">
            <div className="conversation-stat-chip">
              <span>已保存</span>
              <strong>{sessions.length}</strong>
            </div>
            <div className="conversation-stat-chip">
              <span>当前筛选</span>
              <strong>{filteredSessions.length}</strong>
            </div>
          </div>

          <div className="chat-rail-note">
            会话支持重命名、删除和持续追踪，适合把同一项任务拆成多个稳定工作线程。
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
                onActiveChange={(key) => setCurrentSessionId(key)}
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
        </Card>

        <Card className="chat-card workbench-card chat-workbench-card" styles={{ body: { padding: 0, height: '100%' } }}>
          <div className="chat-panel">
            <div className="chat-workbench-head">
              <div className="chat-heading">
                <div>
                  <span className="section-kicker">实时协作</span>
                  <Typography.Title level={3}>{selectedSessionTitle}</Typography.Title>
                  <Text type="secondary">
                    {selectedSession
                      ? `最后更新于 ${formatRelativeTimeZh(selectedSessionUpdatedAt)}，你可以继续追问、收敛方案或推进下一步执行。`
                      : '这里会自动带入当前后端、工作区引导文件、记忆与技能上下文。'}
                  </Text>
                  <div className="chat-inline-meta">
                    <span className="chat-inline-pill">
                      会话 ID · {selectedSession ? selectedSession.id.slice(0, 8) : '待创建'}
                    </span>
                    <span className="chat-inline-pill">消息数 · {messages.length}</span>
                    <span className="chat-inline-pill">状态 · {sending ? '生成中' : '就绪'}</span>
                  </div>
                </div>
              </div>
              <div className="chat-workbench-controls">
                <div className="chat-workbench-actions">
                  {selectedSession ? (
                    <>
                      <Button icon={<EditOutlined />} onClick={() => openRenameModal(selectedSession)}>
                        重命名
                      </Button>
                      <Button danger icon={<DeleteOutlined />} onClick={() => confirmDeleteSession(selectedSession)}>
                        删除
                      </Button>
                    </>
                  ) : null}
                  <Button type="primary" icon={<PlusOutlined />} onClick={handleCreateSession}>
                    新建会话
                  </Button>
                </div>
              </div>
            </div>

            {progressEvents.length > 0 ? (
              <div className="progress-strip">
                <div className="progress-strip-title">实时进度</div>
                <div className="progress-strip-items">
                  {progressEvents.map((event, index) => (
                    <div className="progress-pill" key={`${event}-${index}`}>
                      <span className="progress-dot" />
                      <span>{event}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="chat-history chat-history-expanded" ref={historyRef}>
              {loadingMessages ? (
                <div className="center-box">
                  <Spin />
                </div>
              ) : messages.length === 0 ? (
                <div className="chat-empty-state">
                  <div className="chat-empty-chip">工作区上下文已就绪</div>
                  <Typography.Title level={3}>从一个明确任务开始，让它持续陪你推进</Typography.Title>
                  <Text type="secondary">
                    适合直接做需求拆解、重构方案、代码评审、配置排查、系统诊断和工作区总结。
                  </Text>
                  <div className="starter-prompt-grid">
                    {starterPrompts.map((prompt) => (
                      <Button key={prompt} className="starter-prompt-card" onClick={() => void handleSubmit(prompt)}>
                        {prompt}
                      </Button>
                    ))}
                  </div>
                  <div className="chat-empty-feature-grid">
                    <div className="empty-feature-card">
                      <strong>自动带入工作区</strong>
                      <span>读取当前工作区、主提示词与技能上下文。</span>
                    </div>
                    <div className="empty-feature-card">
                      <strong>保留会话历史</strong>
                      <span>每个网页会话都可独立重命名、继续和追踪。</span>
                    </div>
                    <div className="empty-feature-card">
                      <strong>实时流式反馈</strong>
                      <span>执行中可看到进度，避免黑盒等待。</span>
                    </div>
                  </div>
                </div>
              ) : (
                <Bubble.List items={bubbleItems} className="bubble-list" autoScroll />
              )}
            </div>

            <div className="chat-composer-panel">
              <div className="quick-prompt-row">
                {starterPrompts.map((prompt) => (
                  <button key={prompt} type="button" className="quick-prompt-chip" onClick={() => void handleSubmit(prompt)}>
                    {prompt}
                  </button>
                ))}
              </div>

              <div className="sender-shell">
                <Sender
                  loading={sending}
                  onSubmit={(value) => {
                    void handleSubmit(value)
                  }}
                  placeholder="让 nanobot 帮你检查、规划、评审或修改当前工作区..."
                  className="chat-sender"
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
