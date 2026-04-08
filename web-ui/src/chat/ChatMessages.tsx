import type { ComponentProps, ComponentRef } from 'react'
import { useRef } from 'react'
import type { MessageInfo } from '@ant-design/x-sdk'
import { Bubble, Welcome } from '@ant-design/x'
import { Button, Card, Empty, Flex, Space, Spin, Typography, theme } from 'antd'
import { ReloadOutlined, RobotOutlined, ToolOutlined, UserOutlined } from '@ant-design/icons'
import { ChatMessageBody, getChatMessageTitle } from './chatPresentation'
import { normalizeChatMessage } from './chatMessageUtils'
import { formatDateTimeZh } from '../locale'
import { testIds } from '../testIds'
import type { ChatMessage } from '../types'

const { Text } = Typography

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

export interface ChatMessagesProps {
  messageInfos: MessageInfo<ChatMessage>[]
  currentSessionId: string | null
  isRequesting: boolean
  isLoadingMessages: boolean
  assistantLabel: string
  quickPrompts?: string[]
  onReloadMessage: (messageId: string | number) => void
  onQuickPromptClick: (prompt: string) => void
  isDesktopLayout: boolean
}

export function ChatMessages({
  messageInfos,
  currentSessionId,
  isRequesting,
  isLoadingMessages,
  assistantLabel,
  quickPrompts,
  onReloadMessage,
  onQuickPromptClick,
  isDesktopLayout,
}: ChatMessagesProps) {
  const { token } = theme.useToken()
  const historyRef = useRef<HTMLDivElement | null>(null)
  const surfaceRadius = token.borderRadiusLG + 8

  const bubbleItems: ComponentProps<typeof Bubble.List>['items'] = messageInfos.map((info) => {
    const item = normalizeChatMessage(info.message)
    const isUser = item.role === 'user'
    const isAssistant = item.role === 'assistant'
    const isTool = item.role === 'tool'
    const canReload = isAssistant && !isRequesting

    let background = 'var(--nb-surface-panel-bg)'
    let borderColor = 'var(--nb-surface-panel-border)'
    let color = token.colorText

    if (isUser) {
      background = `linear-gradient(135deg, var(--nb-accent) 0%, var(--nb-accent-2) 100%)`
      borderColor = 'transparent'
      color = 'var(--nb-ink)'
    } else if (isTool) {
      background = 'var(--nb-card-subtle-bg)'
      borderColor = 'var(--nb-card-subtle-border)'
    }

    if (info.status === 'error') {
      borderColor = 'var(--nb-error)'
    } else if (info.status === 'abort') {
      borderColor = 'var(--nb-warning)'
    }

    return {
      key: info.id,
      placement: isUser ? 'end' : 'start',
      loading:
        isAssistant &&
        (info.status === 'loading' || info.status === 'updating') &&
        !(item.progressSteps?.length || item.content),
      avatar: {
        icon: isUser ? <UserOutlined /> : isTool ? <ToolOutlined /> : <RobotOutlined />,
        style: {
          background: isUser ? 'var(--nb-accent)' : isTool ? 'var(--nb-warning)' : 'var(--nb-surface-panel-bg)',
          color: isUser ? 'var(--nb-ink)' : token.colorText,
          boxShadow: 'var(--nb-shadow-soft)',
        },
      },
      variant: 'borderless', // custom defined via styles
      shape: 'round',
      classNames: {
        content: [
          'chat-bubble-content',
          isUser ? 'chat-bubble-content-user' : '',
          isAssistant ? 'chat-bubble-content-assistant' : '',
          isTool ? 'chat-bubble-content-tool' : '',
        ]
          .filter(Boolean)
          .join(' '),
      },
      styles: {
        content: {
          borderRadius: 20,
          padding: isDesktopLayout ? '16px 20px' : '14px 18px',
          background,
          border: `1px solid ${borderColor}`,
          color,
          boxShadow: isUser ? '0 12px 24px rgba(36, 88, 198, 0.12)' : 'var(--nb-surface-soft-shadow)',
          backdropFilter: isUser ? 'none' : 'blur(28px) saturate(140%)',
        },
        header: {
          marginBottom: 8,
        },
        footer: {
          marginTop: 8,
        },
      },
      header: (
        <Flex justify="space-between" gap={12} wrap="wrap">
          <Text type="secondary" style={{ fontSize: 12 }}>
            {getChatMessageTitle(item, { assistantLabel })}
          </Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {item.createdAt ? formatDateTimeZh(item.createdAt) : '刚刚'}
          </Text>
        </Flex>
      ),
      footer: isAssistant ? (
        <Space size={12} wrap>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {getMessageStatusLabel(info.status)}
          </Text>
          {canReload ? (
            <Button
              type="link"
              size="small"
              icon={<ReloadOutlined />}
              onClick={() => onReloadMessage(info.id)}
            >
              重新生成
            </Button>
          ) : null}
        </Space>
      ) : isTool ? (
        <Text type="secondary" style={{ fontSize: 12 }}>
          工具结果
        </Text>
      ) : null,
      content: <ChatMessageBody info={info} />,
    }
  })

  return (
    <div ref={historyRef} style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: isDesktopLayout ? '20px 24px 12px' : '16px 16px 12px' }}>
      {isLoadingMessages ? (
        <Flex align="center" justify="center" style={{ minHeight: 280 }}>
          <Spin />
        </Flex>
      ) : messageInfos.length === 0 ? (
        <Flex vertical align="center" justify="center" gap={16} style={{ minHeight: '100%', padding: 24 }}>
          <Welcome
            variant="borderless"
            title={assistantLabel}
            description="有什么想聊的或者需要帮忙的吗？"
          />
        </Flex>
      ) : (
        <div data-testid={testIds.chat.bubbleList}>
          <Bubble.List items={bubbleItems} className="chat-bubble-list" autoScroll />
        </div>
      )}
    </div>
  )
}

export type ChatMessagesRef = ComponentRef<typeof ChatMessages>
