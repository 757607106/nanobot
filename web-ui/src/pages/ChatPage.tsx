import { useEffect, useMemo, useState } from 'react'
import { App, Button, Card, Empty, Flex, Input, List, Popconfirm, Space, Spin, Tag, Typography } from 'antd'
import { Bubble, Sender } from '@ant-design/x'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons'
import { api } from '../api'
import type { ChatMessage, SessionSummary, StreamEvent } from '../types'

const { Title, Text } = Typography

function MarkdownBubble({ content }: { content: string }) {
  return (
    <div className="markdown-bubble">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  )
}

function buildBubbleItems(messages: ChatMessage[]) {
  return messages.map((message) => ({
    key: message.id,
    placement: message.role === 'user' ? 'end' : 'start',
    content: <MarkdownBubble content={String(message.content ?? '')} />,
    messageRender: undefined,
  })) as unknown as React.ComponentProps<typeof Bubble.List>['items']
}

export default function ChatPage() {
  const { message } = App.useApp()
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [loadingSessions, setLoadingSessions] = useState(true)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [sending, setSending] = useState(false)
  const [progressEvents, setProgressEvents] = useState<string[]>([])

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

  async function loadSessions() {
    try {
      setLoadingSessions(true)
      const data = await api.getSessions()
      setSessions(data.items)
      if (!currentSessionId && data.items.length > 0) {
        setCurrentSessionId(data.items[0].id)
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Failed to load sessions')
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
      message.error(error instanceof Error ? error.message : 'Failed to load messages')
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
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Failed to create session')
    }
  }

  async function handleRenameSession(session: SessionSummary) {
    const nextTitle = window.prompt('Rename session', session.title)
    if (!nextTitle || nextTitle.trim() === '' || nextTitle.trim() === session.title) {
      return
    }
    try {
      const updated = await api.renameSession(session.id, nextTitle.trim())
      setSessions((prev) => prev.map((item) => (item.id === updated.id ? updated : item)))
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Failed to rename session')
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
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Failed to delete session')
    }
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
          setProgressEvents((prev) => [...prev.slice(-3), event.content])
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
                    title: item.title === 'New Chat' ? trimmed.slice(0, 40) : item.title,
                  }
                : item,
            ),
          )
        }
      })
    } catch (error) {
      setMessages((prev) => prev.filter((item) => item.id !== optimisticUserMessage.id))
      message.error(error instanceof Error ? error.message : 'Failed to send message')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="page-grid chat-grid">
      <Card className="sidebar-card" bodyStyle={{ padding: 0 }}>
        <div className="sidebar-header-row">
          <div>
            <Title level={4}>Sessions</Title>
            <Text type="secondary">Web conversations stored in your workspace.</Text>
          </div>
          <Button type="primary" icon={<PlusOutlined />} onClick={handleCreateSession}>
            New
          </Button>
        </div>
        {loadingSessions ? (
          <div className="center-box">
            <Spin />
          </div>
        ) : sessions.length === 0 ? (
          <Empty description="Create your first web session" className="empty-block" />
        ) : (
          <List
            dataSource={sessions}
            renderItem={(session) => (
              <List.Item
                className={`session-item ${session.id === currentSessionId ? 'active' : ''}`}
                onClick={() => setCurrentSessionId(session.id)}
                actions={[
                  <Button
                    key="edit"
                    type="text"
                    icon={<EditOutlined />}
                    onClick={(event) => {
                      event.stopPropagation()
                      void handleRenameSession(session)
                    }}
                  />,
                  <Popconfirm
                    key="delete"
                    title="Delete this session?"
                    onConfirm={(event) => {
                      event?.stopPropagation()
                      void handleDeleteSession(session)
                    }}
                  >
                    <Button
                      type="text"
                      danger
                      icon={<DeleteOutlined />}
                      onClick={(event) => event.stopPropagation()}
                    />
                  </Popconfirm>,
                ]}
              >
                <List.Item.Meta
                  title={session.title}
                  description={`${session.messageCount} messages`}
                />
              </List.Item>
            )}
          />
        )}
      </Card>

      <div className="chat-column">
        <Card className="chat-card">
          <Flex vertical gap={16} className="chat-card-inner">
            <div className="chat-heading">
              <div>
                <Title level={3}>{sessions.find((item) => item.id === currentSessionId)?.title || 'nanobot Chat'}</Title>
                <Text type="secondary">
                  Direct chat sessions backed by the current nanobot agent runtime.
                </Text>
              </div>
              {currentSessionId && <Tag color="cyan">{currentSessionId.slice(0, 8)}</Tag>}
            </div>

            <div className="chat-history">
              {loadingMessages ? (
                <div className="center-box">
                  <Spin />
                </div>
              ) : messages.length === 0 ? (
                <Empty description="Start a conversation to create messages here." className="empty-block" />
              ) : (
                <Bubble.List items={bubbleItems} className="bubble-list" />
              )}
            </div>

            {progressEvents.length > 0 && (
              <Card size="small" className="progress-card">
                <Space direction="vertical" size={6}>
                  <Text strong>Agent progress</Text>
                  {progressEvents.map((event, index) => (
                    <Text key={`${event}-${index}`} type="secondary">
                      {event}
                    </Text>
                  ))}
                </Space>
              </Card>
            )}

            <Sender
              loading={sending}
              onSubmit={(value) => {
                void handleSubmit(value)
              }}
              placeholder="Ask nanobot anything..."
              className="chat-sender"
            />
          </Flex>
        </Card>
      </div>
    </div>
  )
}
