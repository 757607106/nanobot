import type { ConversationItemType } from '@ant-design/x'
import { Conversations } from '@ant-design/x'
import { DeleteOutlined, EditOutlined, MessageOutlined, PlusOutlined, SearchOutlined } from '@ant-design/icons'
import { App, Button, Empty, Flex, Spin, Typography, theme } from 'antd'
import { startTransition } from 'react'
import { getDisplaySessionTitle } from './chatPresentation'
import { formatRelativeTimeZh } from '../locale'
import { testIds } from '../testIds'
import type { SessionSummary } from '../types'

const { Text } = Typography

export interface ChatSidebarProps {
  sessions: SessionSummary[]
  activeSessionId: string | null
  loading: boolean
  sessionQuery: string
  onSessionQueryChange: (query: string) => void
  onSessionSelect: (sessionId: string) => void
  onNewSession: () => void
  onRenameSession: (session: SessionSummary) => void
  onDeleteSession: (session: SessionSummary) => void
  isDesktopLayout: boolean
}

function getSessionGroup(value?: string) {
  if (!value) {
    return '最近'
  }

  const now = Date.now()
  const time = new Date(value).getTime()
  const diff = now - time

  if (diff < 24 * 60 * 60 * 1000) {
    return '今天'
  }
  if (diff < 7 * 24 * 60 * 60 * 1000) {
    return '本周'
  }
  return '更早'
}

export function ChatSidebar({
  sessions,
  activeSessionId,
  loading,
  sessionQuery,
  onSessionQueryChange,
  onSessionSelect,
  onNewSession,
  onRenameSession,
  onDeleteSession,
  isDesktopLayout,
}: ChatSidebarProps) {
  const { token } = theme.useToken()

  const filteredSessions = sessions.filter((item) => {
    const query = sessionQuery.trim().toLowerCase()
    if (!query) {
      return true
    }
    return `${item.title} ${getDisplaySessionTitle(item.title)} ${item.sessionId}`
      .toLowerCase()
      .includes(query)
  })

  const conversationItems: ConversationItemType[] = filteredSessions.map((session) => ({
    key: session.id,
    group: getSessionGroup(session.updatedAt || session.createdAt),
    timestamp: new Date(session.updatedAt || session.createdAt || Date.now()).getTime(),
    icon: <MessageOutlined />,
    label: (
      <Flex vertical gap={2} style={{ width: '100%' }}>
        <span className="conversation-title">{getDisplaySessionTitle(session.title)}</span>
        <Text type="secondary" className="conversation-summary">
          {session.messageCount} 条消息
          {session.fileCount ? ` · ${session.fileCount} 个文件` : ''}
          {' · '}
          {formatRelativeTimeZh(session.updatedAt || session.createdAt)}
        </Text>
      </Flex>
    ),
  }))

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      padding: '16px 8px 16px 12px',
      borderRadius: 22,
      background: token.colorBgContainer,
      border: `1px solid ${token.colorBorderSecondary}`,
      boxShadow: token.boxShadowSecondary,
    }}>
      <Button
        type="primary"
        icon={<PlusOutlined />}
        onClick={onNewSession}
        data-testid={testIds.chat.newSession}
        block
        style={{
          height: 40,
          borderRadius: 8,
          justifyContent: 'center',
          marginBottom: 20,
          fontWeight: 500,
        }}
      >
        全新对话
      </Button>

      <Text
        style={{
          fontSize: token.fontSizeSM,
          fontWeight: 700,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          paddingLeft: 8,
          marginBottom: 8,
          color: token.colorText,
        }}
      >
        历史会话
      </Text>

      <div style={{ flex: 1, minHeight: isDesktopLayout ? 0 : 280, overflow: 'auto' }}>
        {loading ? (
          <Flex align="center" justify="center" style={{ minHeight: 220 }}>
            <Spin />
          </Flex>
        ) : filteredSessions.length === 0 ? (
          <Flex align="center" justify="center" style={{ minHeight: 220 }}>
            <Empty description={<Text style={{ color: token.colorText }}>{sessionQuery ? '无匹配项' : '暂无会话'}</Text>} />
          </Flex>
        ) : (
          <Conversations
            aria-label="聊天会话列表"
            className="chat-conversation-list"
            items={conversationItems}
            activeKey={activeSessionId ?? undefined}
            classNames={{ item: 'chat-conversation-item' }}
            tabIndex={0}
            groupable={{
              label: (group: string) => <Text style={{ color: token.colorText }}>{group}</Text>,
            }}
            onActiveChange={(key) => {
              startTransition(() => {
                onSessionSelect(String(key))
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
                  onRenameSession(session)
                }
                if (key === 'delete') {
                  onDeleteSession(session)
                }
              },
            })}
          />
        )}
      </div>
    </div>
  )
}
